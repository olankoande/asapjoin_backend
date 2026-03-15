/**
 * Ledger Writer — Append-only immutable ledger for all financial transactions.
 *
 * P0-1: NO UPDATE on wallet_transactions. Corrections via 'adjustment' entries.
 * P0-3: Every financial event is modeled in the ledger.
 *
 * All amounts in CENTS (integer). Uses raw SQL for MySQL 5.6 compatibility.
 * All writes are wrapped in SQL transactions for atomicity.
 */

import { prisma } from '../../db/prisma';
import { logger } from '../../config/logger';
import type { FeeBreakdown } from './feeCalculator';

// Platform internal user ID for commission tracking (user_id = 0 or a dedicated admin)
const PLATFORM_USER_ID = BigInt(0);

export type TxnType =
  | 'booking_payment'
  | 'delivery_payment'
  | 'platform_commission'
  | 'driver_credit_pending'
  | 'driver_release_to_available'
  | 'refund'
  | 'refund_commission_reversal'
  | 'refund_driver_debit'
  | 'dispute_hold'
  | 'dispute_release'
  | 'payout'
  | 'payout_reversal'
  | 'adjustment';

export type ReferenceType = 'booking' | 'delivery' | 'refund' | 'payout' | 'payout_batch' | 'dispute' | 'system' | 'payment' | 'adjustment';

export interface LedgerEntry {
  walletId: bigint;
  userId: bigint;
  direction: 'credit' | 'debit';
  amountCents: number;
  txnType: TxnType;
  referenceType: ReferenceType;
  referenceId: bigint;
  snapshotJson?: string;
}

/**
 * Write multiple ledger entries atomically within a Prisma transaction.
 * Also updates wallet cache (pending_cents / available_cents).
 */
export async function writeLedgerEntries(
  entries: LedgerEntry[],
  walletUpdates: Array<{ walletId: bigint; pendingDelta: number; availableDelta: number }>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Insert all ledger entries (append-only)
    for (const entry of entries) {
      await tx.$executeRaw`
        INSERT INTO wallet_transactions
          (wallet_id, user_id, direction, amount_cents, amount, currency, status, txn_type, type, reference_type, reference_id, snapshot_json, balance_bucket, created_at)
        VALUES
          (${entry.walletId}, ${entry.userId}, ${entry.direction}, ${entry.amountCents},
           ${entry.amountCents / 100}, 'CAD', 'posted', ${entry.txnType}, ${entry.txnType},
           ${entry.referenceType}, ${entry.referenceId},
           ${entry.snapshotJson || null}, ${entry.direction === 'credit' ? 'pending' : 'available'},
           NOW())
      `;
    }

    // 2. Update wallet balances atomically
    // Use pending_balance/available_balance (Decimal columns) as source of truth
    // Also update _cents columns if they exist (for ledger queries)
    for (const wu of walletUpdates) {
      const pendingDeltaDollars = wu.pendingDelta / 100;
      const availableDeltaDollars = wu.availableDelta / 100;
      await tx.$executeRaw`
        UPDATE wallets SET
          pending_balance = pending_balance + ${pendingDeltaDollars},
          available_balance = available_balance + ${availableDeltaDollars},
          updated_at = NOW()
        WHERE id = ${wu.walletId}
      `;
      // Also update _cents columns (best effort, may not exist before migration)
      try {
        await tx.$executeRaw`
          UPDATE wallets SET
            pending_cents = ROUND(pending_balance * 100),
            available_cents = ROUND(available_balance * 100)
          WHERE id = ${wu.walletId}
        `;
      } catch {
        // _cents columns may not exist yet — that's OK
      }
    }
  });
}

/**
 * Ensure a wallet exists for a user. Returns wallet ID.
 */
export async function ensureWallet(userId: bigint): Promise<bigint> {
  let wallet = await prisma.wallets.findUnique({ where: { user_id: userId } });
  if (!wallet) {
    wallet = await prisma.wallets.create({
      data: {
        user_id: userId,
        pending_balance: 0,
        available_balance: 0,
        currency: 'CAD',
      },
    });
    // Initialize cents columns
    await prisma.$executeRaw`UPDATE wallets SET pending_cents = 0, available_cents = 0 WHERE id = ${wallet.id}`;
  }
  return wallet.id;
}

/**
 * Record a successful payment in the ledger with commission split.
 *
 * Creates 3 ledger entries:
 * 1. booking_payment/delivery_payment — CREDIT on platform (gross)
 * 2. platform_commission — CREDIT on platform (fee)
 * 3. driver_credit_pending — CREDIT on driver wallet (net)
 *
 * Updates driver wallet: pending_cents += driver_net_cents
 */
export async function recordPaymentWithFees(
  kind: 'booking' | 'delivery',
  referenceId: bigint,
  paymentId: bigint,
  driverId: bigint,
  fees: FeeBreakdown,
): Promise<void> {
  const driverWalletId = await ensureWallet(driverId);
  const snapshotStr = JSON.stringify(fees.snapshot);

  const txnTypePayment: TxnType = kind === 'booking' ? 'booking_payment' : 'delivery_payment';

  const entries: LedgerEntry[] = [
    // 1. Gross payment recorded (platform receives full amount from Stripe)
    {
      walletId: driverWalletId, // tracked on driver wallet for reference
      userId: PLATFORM_USER_ID,
      direction: 'credit',
      amountCents: fees.gross_cents,
      txnType: txnTypePayment,
      referenceType: kind,
      referenceId,
      snapshotJson: snapshotStr,
    },
    // 2. Platform commission
    {
      walletId: driverWalletId,
      userId: PLATFORM_USER_ID,
      direction: 'debit', // debit from gross = platform keeps this
      amountCents: fees.platform_fee_cents,
      txnType: 'platform_commission',
      referenceType: kind,
      referenceId,
      snapshotJson: snapshotStr,
    },
    // 3. Driver net credit (pending)
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'credit',
      amountCents: fees.driver_net_cents,
      txnType: 'driver_credit_pending',
      referenceType: kind,
      referenceId,
      snapshotJson: snapshotStr,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: fees.driver_net_cents,
      availableDelta: 0,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);

  logger.info(
    `Ledger: ${kind} ${referenceId} — gross=${fees.gross_cents}c, fee=${fees.platform_fee_cents}c, net=${fees.driver_net_cents}c → driver ${driverId}`,
  );
}

/**
 * Record release from pending to available.
 * Creates 1 ledger entry: driver_release_to_available
 * Updates wallet: pending -= amount, available += amount
 */
export async function recordRelease(
  driverWalletId: bigint,
  driverId: bigint,
  amountCents: number,
  referenceType: ReferenceType,
  referenceId: bigint,
): Promise<void> {
  const entries: LedgerEntry[] = [
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'credit',
      amountCents,
      txnType: 'driver_release_to_available',
      referenceType,
      referenceId,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: -amountCents,
      availableDelta: amountCents,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);
  logger.info(`Ledger: released ${amountCents}c pending→available for wallet ${driverWalletId}`);
}

/**
 * Record a refund in the ledger.
 * Reverses: driver_credit_pending (or available), platform_commission
 */
export async function recordRefund(
  kind: 'booking' | 'delivery',
  referenceId: bigint,
  refundId: bigint,
  driverId: bigint,
  refundAmountCents: number,
  fees: FeeBreakdown,
  isAlreadyAvailable: boolean,
): Promise<void> {
  const driverWalletId = await ensureWallet(driverId);
  const snapshotStr = JSON.stringify({
    refund_amount_cents: refundAmountCents,
    original_fees: fees.snapshot,
    is_already_available: isAlreadyAvailable,
  });

  // Calculate proportional reversal
  const refundRatio = refundAmountCents / fees.gross_cents;
  const commissionReversal = Math.round(fees.platform_fee_cents * refundRatio);
  const driverDebit = Math.round(fees.driver_net_cents * refundRatio);

  const entries: LedgerEntry[] = [
    // Refund entry
    {
      walletId: driverWalletId,
      userId: PLATFORM_USER_ID,
      direction: 'debit',
      amountCents: refundAmountCents,
      txnType: 'refund',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: snapshotStr,
    },
    // Commission reversal
    {
      walletId: driverWalletId,
      userId: PLATFORM_USER_ID,
      direction: 'credit',
      amountCents: commissionReversal,
      txnType: 'refund_commission_reversal',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: snapshotStr,
    },
    // Driver debit
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'debit',
      amountCents: driverDebit,
      txnType: 'refund_driver_debit',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: snapshotStr,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: isAlreadyAvailable ? 0 : -driverDebit,
      availableDelta: isAlreadyAvailable ? -driverDebit : 0,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);
  logger.info(`Ledger: refund ${refundId} — ${refundAmountCents}c, driver debit=${driverDebit}c, commission reversal=${commissionReversal}c`);
}

/**
 * Record a dispute hold in the ledger.
 */
export async function recordDisputeHold(
  driverWalletId: bigint,
  driverId: bigint,
  disputeId: bigint,
  holdAmountCents: number,
  fromAvailable: boolean,
): Promise<void> {
  const entries: LedgerEntry[] = [
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'debit',
      amountCents: holdAmountCents,
      txnType: 'dispute_hold',
      referenceType: 'dispute',
      referenceId: disputeId,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: fromAvailable ? 0 : -holdAmountCents,
      availableDelta: fromAvailable ? -holdAmountCents : 0,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);
  logger.info(`Ledger: dispute hold ${disputeId} — ${holdAmountCents}c from ${fromAvailable ? 'available' : 'pending'}`);
}

/**
 * Record a dispute release (driver wins).
 */
export async function recordDisputeRelease(
  driverWalletId: bigint,
  driverId: bigint,
  disputeId: bigint,
  releaseAmountCents: number,
  toAvailable: boolean,
): Promise<void> {
  const entries: LedgerEntry[] = [
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'credit',
      amountCents: releaseAmountCents,
      txnType: 'dispute_release',
      referenceType: 'dispute',
      referenceId: disputeId,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: toAvailable ? 0 : releaseAmountCents,
      availableDelta: toAvailable ? releaseAmountCents : 0,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);
  logger.info(`Ledger: dispute release ${disputeId} — ${releaseAmountCents}c to ${toAvailable ? 'available' : 'pending'}`);
}

/**
 * Record a payout debit in the ledger.
 */
export async function recordPayout(
  driverWalletId: bigint,
  driverId: bigint,
  payoutId: bigint,
  amountCents: number,
): Promise<void> {
  const entries: LedgerEntry[] = [
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'debit',
      amountCents,
      txnType: 'payout',
      referenceType: 'payout',
      referenceId: payoutId,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: 0,
      availableDelta: -amountCents,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);
  logger.info(`Ledger: payout ${payoutId} — ${amountCents}c debited from driver ${driverId}`);
}

/**
 * Record a payout reversal (failed payout — money back to available).
 */
export async function recordPayoutReversal(
  driverWalletId: bigint,
  driverId: bigint,
  payoutId: bigint,
  amountCents: number,
): Promise<void> {
  const entries: LedgerEntry[] = [
    {
      walletId: driverWalletId,
      userId: driverId,
      direction: 'credit',
      amountCents,
      txnType: 'payout_reversal',
      referenceType: 'payout',
      referenceId: payoutId,
    },
  ];

  const walletUpdates = [
    {
      walletId: driverWalletId,
      pendingDelta: 0,
      availableDelta: amountCents,
    },
  ];

  await writeLedgerEntries(entries, walletUpdates);
  logger.info(`Ledger: payout reversal ${payoutId} — ${amountCents}c returned to driver ${driverId}`);
}
