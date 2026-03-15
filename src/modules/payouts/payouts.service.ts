/**
 * Payouts Service — Driver payouts WITHOUT Stripe Connect.
 *
 * Uses Interac e-Transfer / bank transfer / Wise / manual.
 * All financial operations go through the immutable ledger.
 */

import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { Errors } from '../../utils/errors';
import { logger } from '../../config/logger';
import { sendPayoutEmail } from '../notifications/emailService';
import { recordPayout, recordPayoutReversal, ensureWallet } from '../fees/ledgerWriter';

/**
 * Get eligible users for payout as of a given date.
 * Eligibility: available_cents > 0 (or available_balance > MIN), has payout_email.
 */
export async function getEligible(asOfDate?: string) {
  const minAmountCents = Math.round((env.MIN_PAYOUT_AMOUNT || 5) * 100);

  // Use raw SQL — available_cents may not exist yet, fallback to available_balance * 100
  const rows = await prisma.$queryRaw<Array<{
    user_id: bigint;
    email: string;
    first_name: string | null;
    last_name: string | null;
    phone_number: string | null;
    payout_email: string | null;
    payout_phone: string | null;
    is_banned: boolean;
    available_cents: number;
    wallet_id: bigint;
  }>>`
    SELECT w.user_id, u.email, u.first_name, u.last_name, u.phone_number,
           u.payout_email, u.payout_phone, u.is_banned,
           ROUND(w.available_balance * 100) as available_cents,
           w.id as wallet_id
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    WHERE ROUND(w.available_balance * 100) >= ${minAmountCents}
    ORDER BY w.available_balance DESC
  `;

  return rows.map((r) => ({
    user_id: r.user_id.toString(),
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    phone_number: r.phone_number,
    payout_email: r.payout_email,
    payout_phone: r.payout_phone,
    available_cents: Number(r.available_cents),
    available_dollars: Number(r.available_cents) / 100,
    wallet_id: r.wallet_id.toString(),
    eligible: !!(r.payout_email && !r.is_banned),
    missing_info: [
      ...(!r.payout_email ? ['payout_email'] : []),
      ...(r.is_banned ? ['account_banned'] : []),
    ],
  }));
}

/**
 * Create a payout batch (admin).
 */
export async function createBatch(
  adminId: string,
  input: { scheduled_for: string; provider?: string; user_ids?: string[]; notes?: string },
) {
  const eligible = await getEligible();
  const toProcess = eligible.filter((e) => {
    if (!e.eligible) return false;
    if (input.user_ids && input.user_ids.length > 0) return input.user_ids.includes(e.user_id);
    return true;
  });

  if (toProcess.length === 0) {
    throw Errors.badRequest('No eligible users for payout', 'NO_ELIGIBLE_USERS');
  }

  const provider = input.provider || 'manual';

  // Create batch
  const batch = await prisma.payout_batches.create({
    data: {
      scheduled_for_date: new Date(input.scheduled_for),
      status: 'draft',
      created_by_admin_id: BigInt(adminId),
    },
  });

  // Set provider via raw SQL (may not be in Prisma client yet)
  await prisma.$executeRaw`UPDATE payout_batches SET provider = ${provider}, notes = ${input.notes || null} WHERE id = ${batch.id}`;

  // Create individual payouts
  for (const user of toProcess) {
    await prisma.payouts.create({
      data: {
        batch_id: batch.id,
        user_id: BigInt(user.user_id),
        amount: user.available_dollars,
        currency: 'CAD',
        status: 'queued',
        payout_method: 'manual',
        destination: user.payout_email || user.email,
      },
    });

    // Set payout_email/phone via raw SQL
    await prisma.$executeRaw`
      UPDATE payouts SET payout_email = ${user.payout_email}, payout_phone = ${user.payout_phone}
      WHERE batch_id = ${batch.id} AND user_id = ${BigInt(user.user_id)}
    `;
  }

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'PAYOUT_BATCH_CREATED',
      entity_type: 'payout_batch',
      entity_id: batch.id,
      details_json: JSON.stringify({
        total_count: toProcess.length,
        total_cents: toProcess.reduce((s, e) => s + e.available_cents, 0),
        provider,
      }),
    },
  });

  logger.info(`Payout batch ${batch.id} created by admin ${adminId}: ${toProcess.length} payouts`);

  return getBatch(batch.id.toString());
}

/**
 * Get a payout batch with its payouts.
 */
export async function getBatch(batchId: string) {
  const batch = await prisma.payout_batches.findUnique({
    where: { id: BigInt(batchId) },
    include: {
      payouts: {
        include: {
          users: { select: { id: true, first_name: true, last_name: true, email: true, payout_email: true } },
        },
      },
    },
  });
  if (!batch) throw Errors.notFound('Payout batch');
  return batch;
}

/**
 * List all payout batches.
 */
export async function listBatches() {
  return prisma.payout_batches.findMany({
    include: { payouts: true },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
}

/**
 * Execute a payout batch — debit wallets via ledger and mark payouts as processing.
 */
export async function executeBatch(adminId: string, batchId: string) {
  const batch = await prisma.payout_batches.findUnique({
    where: { id: BigInt(batchId) },
    include: { payouts: true },
  });

  if (!batch) throw Errors.notFound('Payout batch');
  if (batch.status !== 'draft') throw Errors.badRequest('Batch must be in draft status', 'BATCH_NOT_DRAFT');

  // Update batch to processing
  await prisma.payout_batches.update({
    where: { id: batch.id },
    data: { status: 'processing' },
  });

  let processed = 0;
  let failed = 0;

  for (const payout of batch.payouts) {
    try {
      const amountCents = Math.round(payout.amount.toNumber() * 100);
      const wallet = await prisma.wallets.findUnique({ where: { user_id: payout.user_id } });
      if (!wallet) {
        await prisma.payouts.update({
          where: { id: payout.id },
          data: { status: 'failed', failure_reason: 'No wallet found' },
        });
        failed++;
        continue;
      }

      // Check available balance (use available_balance column, convert to cents)
      const walletData = await prisma.$queryRaw<Array<{ available_cents: number }>>`
        SELECT ROUND(available_balance * 100) as available_cents FROM wallets WHERE id = ${wallet.id}
      `;
      const availableCents = Number(walletData[0]?.available_cents || 0);

      if (availableCents < amountCents) {
        await prisma.payouts.update({
          where: { id: payout.id },
          data: { status: 'failed', failure_reason: `Insufficient balance: ${availableCents}c < ${amountCents}c` },
        });
        failed++;
        continue;
      }

      // Debit via ledger
      await recordPayout(wallet.id, payout.user_id, payout.id, amountCents);

      // Mark payout as sent (waiting for manual confirmation)
      await prisma.payouts.update({
        where: { id: payout.id },
        data: { status: 'sent' },
      });

      processed++;
    } catch (err: any) {
      logger.error(`Failed to process payout ${payout.id}: ${err.message}`);
      await prisma.payouts.update({
        where: { id: payout.id },
        data: { status: 'failed', failure_reason: err.message },
      });
      failed++;
    }
  }

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'PAYOUT_BATCH_EXECUTED',
      entity_type: 'payout_batch',
      entity_id: batch.id,
      details_json: JSON.stringify({ processed, failed }),
    },
  });

  logger.info(`Payout batch ${batchId} executed: ${processed} processed, ${failed} failed`);

  return getBatch(batchId);
}

/**
 * Retry a failed payout (admin).
 * Resets the payout status to 'queued' so it can be re-executed.
 */
export async function retryPayout(adminId: string, payoutId: string) {
  const payout = await prisma.payouts.findUnique({ where: { id: BigInt(payoutId) } });
  if (!payout) throw Errors.notFound('Payout');
  if (payout.status !== 'failed') {
    throw Errors.badRequest('Only failed payouts can be retried', 'PAYOUT_NOT_FAILED');
  }

  await prisma.payouts.update({
    where: { id: BigInt(payoutId) },
    data: { status: 'queued', failure_reason: null },
  });

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'PAYOUT_RETRIED',
      entity_type: 'payout',
      entity_id: BigInt(payoutId),
      details_json: JSON.stringify({ previous_status: 'failed' }),
    },
  });

  logger.info(`Payout ${payoutId} retried by admin ${adminId}`);

  return prisma.payouts.findUnique({ where: { id: BigInt(payoutId) } });
}

/**
 * Mark a payout as paid (admin confirms manual transfer).
 */
export async function markPaid(adminId: string, payoutId: string, providerReference?: string) {
  const payout = await prisma.payouts.findUnique({ where: { id: BigInt(payoutId) } });
  if (!payout) throw Errors.notFound('Payout');
  if (!['sent', 'queued'].includes(payout.status)) {
    throw Errors.badRequest('Payout cannot be marked as paid in current status', 'PAYOUT_INVALID_STATUS');
  }

  await prisma.payouts.update({
    where: { id: BigInt(payoutId) },
    data: { status: 'paid' },
  });

  // Set paid_at and provider_reference via raw SQL
  await prisma.$executeRaw`
    UPDATE payouts SET paid_at = NOW(), provider_reference = ${providerReference || null}
    WHERE id = ${BigInt(payoutId)}
  `;

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'PAYOUT_MARKED_PAID',
      entity_type: 'payout',
      entity_id: BigInt(payoutId),
      details_json: JSON.stringify({ provider_reference: providerReference }),
    },
  });

  // Send payout email to driver (fire & forget)
  try {
    const user = await prisma.users.findUnique({ where: { id: payout.user_id } });
    if (user) {
      const amountStr = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(payout.amount.toNumber());
      sendPayoutEmail(user.email, {
        driverName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        amount: amountStr,
        payoutEmail: (payout as any).payout_email || user.payout_email || user.email,
        payoutId: payoutId,
      }).catch((e: any) => logger.error('Failed to send payout email', { error: e.message }));
    }
  } catch (e: any) { logger.error('Email error in markPaid', { error: e.message }); }

  logger.info(`Payout ${payoutId} marked as paid by admin ${adminId}`);

  return prisma.payouts.findUnique({ where: { id: BigInt(payoutId) } });
}

/**
 * Mark a payout as failed (admin).
 * Reverses the wallet debit via ledger.
 */
export async function markFailed(adminId: string, payoutId: string, reason?: string) {
  const payout = await prisma.payouts.findUnique({ where: { id: BigInt(payoutId) } });
  if (!payout) throw Errors.notFound('Payout');
  if (!['sent', 'queued'].includes(payout.status)) {
    throw Errors.badRequest('Payout cannot be marked as failed in current status', 'PAYOUT_INVALID_STATUS');
  }

  // Reverse the debit — return money to available
  const wallet = await prisma.wallets.findUnique({ where: { user_id: payout.user_id } });
  if (wallet) {
    const amountCents = Math.round(payout.amount.toNumber() * 100);
    await recordPayoutReversal(wallet.id, payout.user_id, BigInt(payoutId), amountCents);
  }

  await prisma.payouts.update({
    where: { id: BigInt(payoutId) },
    data: { status: 'failed', failure_reason: reason || 'Marked as failed by admin' },
  });

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'PAYOUT_MARKED_FAILED',
      entity_type: 'payout',
      entity_id: BigInt(payoutId),
      details_json: JSON.stringify({ reason }),
    },
  });

  logger.info(`Payout ${payoutId} marked as failed by admin ${adminId}: ${reason}`);

  return prisma.payouts.findUnique({ where: { id: BigInt(payoutId) } });
}

/**
 * Generate CSV export for a batch (for Interac/Wise/bank).
 */
export async function exportBatchCsv(batchId: string): Promise<string> {
  const batch = await getBatch(batchId);

  const lines = ['payout_id,user_id,name,email,payout_email,amount_cad,currency,status'];

  for (const payout of batch.payouts) {
    const user = payout.users;
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    lines.push([
      payout.id.toString(),
      payout.user_id.toString(),
      `"${name}"`,
      user.email,
      user.payout_email || '',
      payout.amount.toNumber().toFixed(2),
      payout.currency,
      payout.status,
    ].join(','));
  }

  return lines.join('\n');
}
