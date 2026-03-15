/**
 * Disputes Service — Internal dispute management.
 *
 * Allows opening disputes on bookings/deliveries, applying holds,
 * and resolving with refund/release/split outcomes.
 */

import Stripe from 'stripe';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { Errors } from '../../utils/errors';
import { logger } from '../../config/logger';
import { computeBookingFees, computeDeliveryFees } from '../fees/feeCalculator';
import { recordDisputeHold, recordDisputeRelease, recordRefund, ensureWallet } from '../fees/ledgerWriter';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });

interface OpenDisputeInput {
  kind: 'booking' | 'delivery';
  reference_id: string;
  reason: string;
}

interface ResolveDisputeInput {
  outcome: 'refund_customer' | 'release_to_driver' | 'split';
  refund_amount_cents?: number;
  release_amount_cents?: number;
  note?: string;
}

/**
 * Open a dispute on a booking or delivery.
 */
export async function openDispute(userId: string, input: OpenDisputeInput) {
  const refId = BigInt(input.reference_id);

  // Verify the reference exists and user is involved
  let driverId: bigint;
  let grossCents: number;

  if (input.kind === 'booking') {
    const booking = await prisma.bookings.findUnique({
      where: { id: refId },
      include: { trip: true },
    });
    if (!booking) throw Errors.notFound('Booking');
    const userBig = BigInt(userId);
    if (booking.passenger_id !== userBig && booking.trip.driver_id !== userBig) {
      throw Errors.forbidden('Not involved in this booking');
    }
    if (!['paid', 'completed'].includes(booking.status)) {
      throw Errors.badRequest('Booking must be paid or completed to dispute', 'INVALID_STATUS');
    }
    driverId = booking.trip.driver_id;
    grossCents = Math.round(Number(booking.amount_total || 0) * 100);
  } else {
    const delivery = await prisma.deliveries.findUnique({
      where: { id: refId },
      include: { trip: true },
    });
    if (!delivery) throw Errors.notFound('Delivery');
    const userBig = BigInt(userId);
    if (delivery.sender_id !== userBig && delivery.trip.driver_id !== userBig) {
      throw Errors.forbidden('Not involved in this delivery');
    }
    if (!['paid', 'in_transit', 'delivered', 'received'].includes(delivery.status)) {
      throw Errors.badRequest('Delivery must be paid/in_transit/delivered/received to dispute', 'INVALID_STATUS');
    }
    driverId = delivery.trip.driver_id;
    grossCents = Math.round(Number(delivery.amount_total || 0) * 100);
  }

  // Check no existing open dispute
  const existing = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*) as cnt FROM disputes
    WHERE kind = ${input.kind} AND reference_id = ${refId}
      AND status IN ('open', 'investigating')
  `;
  if (existing[0]?.cnt > 0) {
    throw Errors.conflict('A dispute is already open for this reference', 'DISPUTE_ALREADY_OPEN');
  }

  // Create dispute
  const dispute = await prisma.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO disputes (kind, reference_id, opened_by, reason, status, hold_amount_cents, created_at, updated_at)
    VALUES (${input.kind}, ${refId}, ${BigInt(userId)}, ${input.reason}, 'open', ${grossCents}, NOW(), NOW())
  `;

  // Get the inserted ID
  const insertedId = await prisma.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() as id`;
  const disputeId = insertedId[0].id;

  // Apply hold on driver wallet
  const driverWalletId = await ensureWallet(driverId);

  // Determine if funds are in pending or available
  const wallet = await prisma.$queryRaw<Array<{ pending_cents: number; available_cents: number }>>`
    SELECT pending_cents, available_cents FROM wallets WHERE user_id = ${driverId}
  `;
  const pendingCents = Number(wallet[0]?.pending_cents || 0);
  const availableCents = Number(wallet[0]?.available_cents || 0);

  // Compute driver net for hold
  const fees = input.kind === 'booking'
    ? await computeBookingFees(grossCents)
    : await computeDeliveryFees(grossCents);

  const holdAmount = fees.driver_net_cents;

  // Hold from available first, then pending
  if (availableCents >= holdAmount) {
    await recordDisputeHold(driverWalletId, driverId, disputeId, holdAmount, true);
  } else if (pendingCents >= holdAmount) {
    await recordDisputeHold(driverWalletId, driverId, disputeId, holdAmount, false);
  } else {
    // Partial hold — hold whatever is available
    const totalHoldable = pendingCents + availableCents;
    if (totalHoldable > 0) {
      if (availableCents > 0) {
        await recordDisputeHold(driverWalletId, driverId, disputeId, Math.min(holdAmount, availableCents), true);
      }
      const remaining = holdAmount - availableCents;
      if (remaining > 0 && pendingCents > 0) {
        await recordDisputeHold(driverWalletId, driverId, disputeId, Math.min(remaining, pendingCents), false);
      }
    }
    logger.warn(`Dispute ${disputeId}: insufficient funds for full hold. Holdable=${totalHoldable}c, needed=${holdAmount}c`);
  }

  // Update booking/delivery status to disputed
  if (input.kind === 'booking') {
    await prisma.bookings.update({
      where: { id: refId },
      data: { status: 'disputed' as any },
    });
  } else {
    await prisma.deliveries.update({
      where: { id: refId },
      data: { status: 'disputed' },
    });
  }

  logger.info(`Dispute ${disputeId} opened on ${input.kind} ${refId} by user ${userId}`);

  return { id: disputeId.toString(), kind: input.kind, reference_id: input.reference_id, status: 'open', hold_amount_cents: holdAmount };
}

/**
 * Resolve a dispute (admin only).
 */
export async function resolveDispute(adminId: string, disputeId: string, input: ResolveDisputeInput) {
  const dId = BigInt(disputeId);

  const disputes = await prisma.$queryRaw<Array<{
    id: bigint;
    kind: string;
    reference_id: bigint;
    opened_by: bigint;
    status: string;
    hold_amount_cents: number;
  }>>`SELECT * FROM disputes WHERE id = ${dId} LIMIT 1`;

  if (disputes.length === 0) throw Errors.notFound('Dispute');
  const dispute = disputes[0];

  if (!['open', 'investigating'].includes(dispute.status)) {
    throw Errors.badRequest('Dispute is not open', 'DISPUTE_NOT_OPEN');
  }

  const kind = dispute.kind as 'booking' | 'delivery';
  const refId = dispute.reference_id;
  const holdAmountCents = Number(dispute.hold_amount_cents);

  // Find driver
  let driverId: bigint;
  let grossCents: number;
  let paymentId: bigint | null = null;

  if (kind === 'booking') {
    const booking = await prisma.bookings.findUnique({ where: { id: refId }, include: { trip: true, payments: true } });
    if (!booking) throw Errors.notFound('Booking');
    driverId = booking.trip.driver_id;
    grossCents = Math.round(Number(booking.amount_total || 0) * 100);
    const succeededPayment = booking.payments.find(p => p.status === 'succeeded');
    if (succeededPayment) paymentId = succeededPayment.id;
  } else {
    const delivery = await prisma.deliveries.findUnique({ where: { id: refId }, include: { trip: true, payments: true } });
    if (!delivery) throw Errors.notFound('Delivery');
    driverId = delivery.trip.driver_id;
    grossCents = Math.round(Number(delivery.amount_total || 0) * 100);
    const succeededPayment = delivery.payments.find(p => p.status === 'succeeded');
    if (succeededPayment) paymentId = succeededPayment.id;
  }

  const driverWalletId = await ensureWallet(driverId);
  const fees = kind === 'booking' ? await computeBookingFees(grossCents) : await computeDeliveryFees(grossCents);

  let resolvedStatus: string;

  switch (input.outcome) {
    case 'release_to_driver': {
      // Release hold back to driver (available)
      if (holdAmountCents > 0) {
        await recordDisputeRelease(driverWalletId, driverId, dId, holdAmountCents, true);
      }
      resolvedStatus = 'resolved_release';
      break;
    }

    case 'refund_customer': {
      // Refund customer via Stripe + ledger
      if (paymentId) {
        const payment = await prisma.payments.findUnique({ where: { id: paymentId } });
        if (payment && payment.stripe_payment_intent_id) {
          try {
            const stripeRefund = await stripe.refunds.create({
              payment_intent: payment.stripe_payment_intent_id,
              amount: grossCents, // full refund in cents
            });

            const refund = await prisma.refunds.create({
              data: {
                payment_id: paymentId,
                amount: grossCents / 100,
                currency: 'CAD',
                status: 'succeeded',
                stripe_refund_id: stripeRefund.id,
                reason: `Dispute resolved: refund to customer. ${input.note || ''}`,
              },
            });

            await recordRefund(kind, refId, refund.id, driverId, grossCents, fees, false);
          } catch (err: any) {
            logger.error(`Failed to process Stripe refund for dispute ${disputeId}: ${err.message}`);
            throw Errors.internal('Failed to process refund');
          }
        }
      }
      resolvedStatus = 'resolved_refund';
      break;
    }

    case 'split': {
      const refundCents = input.refund_amount_cents || 0;
      const releaseCents = input.release_amount_cents || 0;

      // Partial refund
      if (refundCents > 0 && paymentId) {
        const payment = await prisma.payments.findUnique({ where: { id: paymentId } });
        if (payment && payment.stripe_payment_intent_id) {
          try {
            const stripeRefund = await stripe.refunds.create({
              payment_intent: payment.stripe_payment_intent_id,
              amount: refundCents,
            });

            const refund = await prisma.refunds.create({
              data: {
                payment_id: paymentId,
                amount: refundCents / 100,
                currency: 'CAD',
                status: 'succeeded',
                stripe_refund_id: stripeRefund.id,
                reason: `Dispute split: partial refund. ${input.note || ''}`,
              },
            });

            await recordRefund(kind, refId, refund.id, driverId, refundCents, fees, false);
          } catch (err: any) {
            logger.error(`Failed to process partial Stripe refund for dispute ${disputeId}: ${err.message}`);
          }
        }
      }

      // Release remaining to driver
      if (releaseCents > 0) {
        await recordDisputeRelease(driverWalletId, driverId, dId, releaseCents, true);
      }

      resolvedStatus = 'resolved_split';
      break;
    }

    default:
      throw Errors.badRequest('Invalid outcome', 'INVALID_OUTCOME');
  }

  // Update dispute status
  await prisma.$executeRaw`
    UPDATE disputes SET status = ${resolvedStatus}, resolved_by = ${BigInt(adminId)},
      resolved_at = NOW(), resolution_note = ${input.note || null}, updated_at = NOW()
    WHERE id = ${dId}
  `;

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'DISPUTE_RESOLVED',
      entity_type: 'dispute',
      entity_id: dId,
      details_json: JSON.stringify(input),
    },
  });

  logger.info(`Dispute ${disputeId} resolved: ${input.outcome} by admin ${adminId}`);

  return { id: disputeId, status: resolvedStatus, outcome: input.outcome };
}

/**
 * List disputes (admin).
 */
export async function listDisputes(status?: string) {
  let rows: any[];
  if (status) {
    rows = await prisma.$queryRaw<any[]>`
      SELECT d.*, u.first_name as opener_first_name, u.last_name as opener_last_name, u.email as opener_email
      FROM disputes d
      LEFT JOIN users u ON u.id = d.opened_by
      WHERE d.status = ${status}
      ORDER BY d.created_at DESC LIMIT 100
    `;
  } else {
    rows = await prisma.$queryRaw<any[]>`
      SELECT d.*, u.first_name as opener_first_name, u.last_name as opener_last_name, u.email as opener_email
      FROM disputes d
      LEFT JOIN users u ON u.id = d.opened_by
      ORDER BY d.created_at DESC LIMIT 100
    `;
  }
  return rows.map(serializeDispute);
}

/**
 * Get a single dispute (admin — full details with replies).
 */
export async function getDispute(disputeId: string) {
  const dId = BigInt(disputeId);
  const disputes = await prisma.$queryRaw<Array<any>>`
    SELECT d.*, u.first_name as opener_first_name, u.last_name as opener_last_name, u.email as opener_email
    FROM disputes d
    LEFT JOIN users u ON u.id = d.opened_by
    WHERE d.id = ${dId} LIMIT 1
  `;
  if (disputes.length === 0) throw Errors.notFound('Dispute');

  const replies = await getDisputeReplies(disputeId);

  const dispute = serializeDispute(disputes[0]);
  return { ...dispute, replies };
}

/**
 * Get a single dispute for a user (must be participant).
 */
export async function getDisputeForUser(disputeId: string, userId: string) {
  const dId = BigInt(disputeId);
  const userBig = BigInt(userId);

  const disputes = await prisma.$queryRaw<Array<any>>`
    SELECT * FROM disputes WHERE id = ${dId} LIMIT 1
  `;
  if (disputes.length === 0) throw Errors.notFound('Dispute');

  const dispute = disputes[0];

  // Verify user is participant (opened_by or involved in the referenced resource)
  const isOpener = BigInt(dispute.opened_by) === userBig;
  if (!isOpener) {
    // Check if user is involved in the referenced resource
    const involved = await isUserInvolvedInDispute(dispute, userBig);
    if (!involved) {
      throw Errors.forbidden('Vous n\'êtes pas impliqué dans ce litige');
    }
  }

  const replies = await getDisputeReplies(disputeId);
  const serialized = serializeDispute(dispute);
  return { ...serialized, replies };
}

/**
 * List disputes for the current user (opened by them or involving them).
 */
export async function listMyDisputes(userId: string) {
  const userBig = BigInt(userId);

  // Get disputes opened by user
  const openedByUser = await prisma.$queryRaw<Array<any>>`
    SELECT * FROM disputes WHERE opened_by = ${userBig}
    ORDER BY created_at DESC LIMIT 50
  `;

  // Get disputes where user is involved via booking/delivery (as driver or other party)
  const bookingDisputes = await prisma.$queryRaw<Array<any>>`
    SELECT d.* FROM disputes d
    INNER JOIN bookings b ON d.kind = 'booking' AND d.reference_id = b.id
    INNER JOIN trips t ON b.trip_id = t.id
    WHERE (b.passenger_id = ${userBig} OR t.driver_id = ${userBig})
      AND d.opened_by != ${userBig}
    ORDER BY d.created_at DESC LIMIT 50
  `;

  const deliveryDisputes = await prisma.$queryRaw<Array<any>>`
    SELECT d.* FROM disputes d
    INNER JOIN deliveries del ON d.kind = 'delivery' AND d.reference_id = del.id
    INNER JOIN trips t ON del.trip_id = t.id
    WHERE (del.sender_id = ${userBig} OR t.driver_id = ${userBig})
      AND d.opened_by != ${userBig}
    ORDER BY d.created_at DESC LIMIT 50
  `;

  // Merge and deduplicate
  const allDisputes = [...openedByUser, ...bookingDisputes, ...deliveryDisputes];
  const seen = new Set<string>();
  const unique = allDisputes.filter((d) => {
    const key = String(d.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by created_at DESC
  unique.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return unique.map(serializeDispute);
}

/**
 * Reply to a dispute (add information).
 */
export async function replyToDispute(disputeId: string, userId: string, userRole: string, message: string) {
  const dId = BigInt(disputeId);
  const userBig = BigInt(userId);

  // Verify dispute exists and is still open
  const disputes = await prisma.$queryRaw<Array<any>>`
    SELECT * FROM disputes WHERE id = ${dId} LIMIT 1
  `;
  if (disputes.length === 0) throw Errors.notFound('Dispute');

  const dispute = disputes[0];
  if (!['open', 'investigating'].includes(dispute.status)) {
    throw Errors.badRequest('Ce litige n\'est plus ouvert aux réponses', 'DISPUTE_CLOSED');
  }

  // Verify user is participant (unless admin)
  if (userRole !== 'admin' && userRole !== 'support') {
    const isOpener = BigInt(dispute.opened_by) === userBig;
    if (!isOpener) {
      const involved = await isUserInvolvedInDispute(dispute, userBig);
      if (!involved) {
        throw Errors.forbidden('Vous n\'êtes pas impliqué dans ce litige');
      }
    }
  }

  const role = (userRole === 'admin' || userRole === 'support') ? userRole : 'user';

  await prisma.$executeRaw`
    INSERT INTO dispute_replies (dispute_id, user_id, user_role, message, created_at)
    VALUES (${dId}, ${userBig}, ${role}, ${message}, NOW())
  `;

  const insertedId = await prisma.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() as id`;

  // Update dispute updated_at
  await prisma.$executeRaw`UPDATE disputes SET updated_at = NOW() WHERE id = ${dId}`;

  logger.info(`Dispute ${disputeId}: reply by user ${userId} (${role})`);

  return {
    id: insertedId[0].id.toString(),
    dispute_id: disputeId,
    user_id: userId,
    user_role: role,
    message,
    created_at: new Date().toISOString(),
  };
}

/**
 * Update dispute status (admin — e.g., open → investigating).
 */
export async function updateDisputeStatus(adminId: string, disputeId: string, newStatus: string) {
  const dId = BigInt(disputeId);
  const validStatuses = ['open', 'investigating', 'closed'];
  if (!validStatuses.includes(newStatus)) {
    throw Errors.badRequest('Statut invalide. Valeurs autorisées: open, investigating, closed', 'INVALID_STATUS');
  }

  const disputes = await prisma.$queryRaw<Array<any>>`
    SELECT * FROM disputes WHERE id = ${dId} LIMIT 1
  `;
  if (disputes.length === 0) throw Errors.notFound('Dispute');

  await prisma.$executeRaw`
    UPDATE disputes SET status = ${newStatus}, updated_at = NOW() WHERE id = ${dId}
  `;

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: BigInt(adminId),
      action: 'DISPUTE_STATUS_UPDATED',
      entity_type: 'dispute',
      entity_id: dId,
      details_json: JSON.stringify({ new_status: newStatus }),
    },
  });

  logger.info(`Dispute ${disputeId} status updated to ${newStatus} by admin ${adminId}`);

  return { id: disputeId, status: newStatus };
}

/**
 * Get replies for a dispute.
 */
async function getDisputeReplies(disputeId: string) {
  const dId = BigInt(disputeId);
  const rows = await prisma.$queryRaw<Array<any>>`
    SELECT dr.*, u.first_name, u.last_name, u.avatar_url
    FROM dispute_replies dr
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE dr.dispute_id = ${dId}
    ORDER BY dr.created_at ASC
  `;

  return rows.map((r: any) => ({
    id: r.id?.toString(),
    dispute_id: disputeId,
    user_id: r.user_id?.toString(),
    user_role: r.user_role,
    message: r.message,
    created_at: r.created_at,
    user: {
      first_name: r.first_name,
      last_name: r.last_name,
      avatar_url: r.avatar_url,
    },
  }));
}

/**
 * Check if a user is involved in a dispute's referenced resource.
 */
async function isUserInvolvedInDispute(dispute: any, userId: bigint): Promise<boolean> {
  const kind = dispute.kind;
  const refId = BigInt(dispute.reference_id);

  if (kind === 'booking') {
    const bookings = await prisma.$queryRaw<Array<any>>`
      SELECT b.passenger_id, t.driver_id FROM bookings b
      INNER JOIN trips t ON b.trip_id = t.id
      WHERE b.id = ${refId} LIMIT 1
    `;
    if (bookings.length === 0) return false;
    return BigInt(bookings[0].passenger_id) === userId || BigInt(bookings[0].driver_id) === userId;
  } else {
    const deliveries = await prisma.$queryRaw<Array<any>>`
      SELECT del.sender_id, t.driver_id FROM deliveries del
      INNER JOIN trips t ON del.trip_id = t.id
      WHERE del.id = ${refId} LIMIT 1
    `;
    if (deliveries.length === 0) return false;
    return BigInt(deliveries[0].sender_id) === userId || BigInt(deliveries[0].driver_id) === userId;
  }
}

/**
 * Serialize a dispute row for JSON response (BigInt → string).
 */
function serializeDispute(row: any) {
  return {
    id: row.id?.toString(),
    kind: row.kind,
    reference_id: row.reference_id?.toString(),
    opened_by: row.opened_by?.toString(),
    reason: row.reason,
    status: row.status,
    hold_amount_cents: Number(row.hold_amount_cents || 0),
    resolution_note: row.resolution_note || null,
    resolved_by: row.resolved_by?.toString() || null,
    resolved_at: row.resolved_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Joined user info (if available)
    ...(row.opener_first_name ? {
      opener: {
        first_name: row.opener_first_name,
        last_name: row.opener_last_name,
        email: row.opener_email,
      },
    } : {}),
  };
}
