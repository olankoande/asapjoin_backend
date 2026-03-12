/**
 * Job: Release pending_balance to available_balance after hold period.
 *
 * Rules:
 * - Release only if booking.status in ('completed') OR delivery.status in ('received')
 * - now >= completed_at/received_at + hold_days_before_available
 * - No active dispute_hold on the reference
 *
 * Uses the ledger writer for immutable entries.
 */

import { prisma } from '../db/prisma';
import { logger } from '../config/logger';
import { getFeeSettings } from '../modules/fees/feeCalculator';
import { recordRelease } from '../modules/fees/ledgerWriter';

export async function releasePendingToAvailable() {
  const settings = await getFeeSettings();
  const holdDays = settings.hold_days_before_available;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - holdDays);

  logger.info(`[JOB] releasePendingToAvailable: cutoff=${cutoffDate.toISOString()}, holdDays=${holdDays}`);

  let released = 0;

  // ─── 1. Find completed bookings eligible for release ───
  try {
    const eligibleBookings = await prisma.$queryRaw<Array<{
      id: bigint;
      trip_driver_id: bigint;
      amount_total: number;
      updated_at: Date;
    }>>`
      SELECT b.id, t.driver_id AS trip_driver_id, b.amount_total, b.updated_at
      FROM bookings b
      JOIN trips t ON t.id = b.trip_id
      WHERE b.status = 'completed'
        AND b.updated_at <= ${cutoffDate}
        AND b.amount_total > 0
    `;

    for (const booking of eligibleBookings) {
      // Check if already released
      const alreadyReleased = await prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*) as cnt FROM wallet_transactions
        WHERE txn_type = 'driver_release_to_available'
          AND reference_type = 'booking'
          AND reference_id = ${booking.id}
      `;
      if (alreadyReleased[0]?.cnt > 0) continue;

      // Check no active dispute
      const activeDispute = await prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*) as cnt FROM disputes
        WHERE kind = 'booking' AND reference_id = ${booking.id}
          AND status IN ('open', 'investigating')
      `;
      if (activeDispute[0]?.cnt > 0) {
        logger.info(`[JOB] Skipping booking ${booking.id}: active dispute`);
        continue;
      }

      // Find driver wallet and the original credit amount
      const wallet = await prisma.wallets.findUnique({ where: { user_id: booking.trip_driver_id } });
      if (!wallet) continue;

      // Find the driver_credit_pending entry for this booking
      const creditEntries = await prisma.$queryRaw<Array<{ amount_cents: number }>>`
        SELECT amount_cents FROM wallet_transactions
        WHERE txn_type = 'driver_credit_pending'
          AND reference_type = 'booking'
          AND reference_id = ${booking.id}
          AND wallet_id = ${wallet.id}
      `;

      const totalCreditCents = creditEntries.reduce((sum, e) => sum + Number(e.amount_cents), 0);
      if (totalCreditCents <= 0) continue;

      // Check wallet has enough pending
      const pendingCents = await prisma.$queryRaw<Array<{ pending_cents: number }>>`
        SELECT pending_cents FROM wallets WHERE id = ${wallet.id}
      `;
      const currentPending = Number(pendingCents[0]?.pending_cents || 0);
      const releaseAmount = Math.min(totalCreditCents, currentPending);
      if (releaseAmount <= 0) continue;

      await recordRelease(wallet.id, booking.trip_driver_id, releaseAmount, 'booking', booking.id);
      released++;
      logger.info(`[JOB] Released ${releaseAmount}c for booking ${booking.id} → driver ${booking.trip_driver_id}`);
    }
  } catch (err: any) {
    logger.error(`[JOB] Error processing bookings: ${err.message}`);
  }

  // ─── 2. Find received deliveries eligible for release ───
  try {
    const eligibleDeliveries = await prisma.$queryRaw<Array<{
      id: bigint;
      trip_driver_id: bigint;
      amount_total: number;
      received_at: Date;
    }>>`
      SELECT d.id, t.driver_id AS trip_driver_id, d.amount_total, d.received_at
      FROM deliveries d
      JOIN trips t ON t.id = d.trip_id
      WHERE d.status = 'received'
        AND d.received_at IS NOT NULL
        AND d.received_at <= ${cutoffDate}
        AND d.amount_total > 0
    `;

    for (const delivery of eligibleDeliveries) {
      // Check if already released
      const alreadyReleased = await prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*) as cnt FROM wallet_transactions
        WHERE txn_type = 'driver_release_to_available'
          AND reference_type = 'delivery'
          AND reference_id = ${delivery.id}
      `;
      if (alreadyReleased[0]?.cnt > 0) continue;

      // Check no active dispute
      const activeDispute = await prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*) as cnt FROM disputes
        WHERE kind = 'delivery' AND reference_id = ${delivery.id}
          AND status IN ('open', 'investigating')
      `;
      if (activeDispute[0]?.cnt > 0) {
        logger.info(`[JOB] Skipping delivery ${delivery.id}: active dispute`);
        continue;
      }

      const wallet = await prisma.wallets.findUnique({ where: { user_id: delivery.trip_driver_id } });
      if (!wallet) continue;

      const creditEntries = await prisma.$queryRaw<Array<{ amount_cents: number }>>`
        SELECT amount_cents FROM wallet_transactions
        WHERE txn_type = 'driver_credit_pending'
          AND reference_type = 'delivery'
          AND reference_id = ${delivery.id}
          AND wallet_id = ${wallet.id}
      `;

      const totalCreditCents = creditEntries.reduce((sum, e) => sum + Number(e.amount_cents), 0);
      if (totalCreditCents <= 0) continue;

      const pendingCents = await prisma.$queryRaw<Array<{ pending_cents: number }>>`
        SELECT pending_cents FROM wallets WHERE id = ${wallet.id}
      `;
      const currentPending = Number(pendingCents[0]?.pending_cents || 0);
      const releaseAmount = Math.min(totalCreditCents, currentPending);
      if (releaseAmount <= 0) continue;

      await recordRelease(wallet.id, delivery.trip_driver_id, releaseAmount, 'delivery', delivery.id);
      released++;
      logger.info(`[JOB] Released ${releaseAmount}c for delivery ${delivery.id} → driver ${delivery.trip_driver_id}`);
    }
  } catch (err: any) {
    logger.error(`[JOB] Error processing deliveries: ${err.message}`);
  }

  logger.info(`[JOB] releasePendingToAvailable: released ${released} entries`);
  return { released };
}

// Allow running as standalone script
if (require.main === module) {
  releasePendingToAvailable()
    .then((result) => {
      console.log('Job completed:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Job failed:', err);
      process.exit(1);
    });
}
