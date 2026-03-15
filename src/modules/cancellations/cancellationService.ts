/**
 * Cancellation Service — Orchestrates the full cancellation + refund workflow.
 *
 * Handles:
 * - Cancel preview (dry-run calculation)
 * - Cancel execution (status update + Stripe refund + ledger correction)
 * - Admin override
 *
 * Uses raw SQL for MySQL 5.6 compatibility.
 * All amounts in CENTS (integer).
 */

import Stripe from 'stripe';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Errors } from '../../utils/errors';
import {
  resolveApplicableRefundPolicy,
  validateCancellationWindow,
  validateRefundRequestWindow,
  type RefundPolicy,
} from './refundPolicyService';
import {
  computeRefundAmounts,
  computeAdminOverrideRefund,
  type RefundCalculationResult,
} from './refundCalculator';
import {
  computeBookingFeesAdditive,
  computeDeliveryFeesAdditive,
} from '../fees/feeCalculator';
import {
  writeLedgerEntries,
  ensureWallet,
  type LedgerEntry,
} from '../fees/ledgerWriter';
import { sendCancellationEmail } from '../notifications/emailService';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });

// ─── Types ───

export interface CancelPreviewResult {
  allowed: boolean;
  policy_id: string | null;
  policy_name: string | null;
  refund_amount_cents: number;
  cancellation_fee_cents: number;
  driver_reversal_cents: number;
  driver_compensation_cents: number;
  original_amount_cents: number;
  message: string;
  reason_code?: string;
}

export interface CancelResult {
  cancellation_request_id: string;
  status: string;
  refund_amount_cents: number;
  cancellation_fee_cents: number;
  stripe_refund_id: string | null;
  message: string;
}

// ─── Helpers ───

/**
 * Determine actor role from user context and resource ownership.
 */
function determineActorRole(
  userId: bigint,
  resourceType: 'booking' | 'delivery',
  resource: any,
  userRole: string,
): 'passenger' | 'sender' | 'driver' | 'admin' {
  if (userRole === 'admin') return 'admin';

  if (resourceType === 'booking') {
    if (resource.passenger_id === userId) return 'passenger';
    if (resource.trip?.driver_id === userId) return 'driver';
  } else {
    if (resource.sender_id === userId) return 'sender';
    if (resource.trip?.driver_id === userId) return 'driver';
  }

  throw Errors.forbidden('Vous n\'êtes pas autorisé à annuler cette ressource');
}

/**
 * Load the original fee breakdown for a payment.
 * Reconstructs from the additive fee calculator using the original amounts.
 */
async function getOriginalFeeBreakdown(
  resourceType: 'booking' | 'delivery',
  resource: any,
) {
  let driverPriceCents: number;

  if (resourceType === 'booking') {
    const pricePerSeat = Number(resource.trip.price_per_seat);
    const seats = resource.seats_requested;
    driverPriceCents = Math.round(pricePerSeat * seats * 100);
  } else {
    driverPriceCents = Math.round(Number(resource.amount_total || 0) * 100);
  }

  const fees = resourceType === 'booking'
    ? await computeBookingFeesAdditive(driverPriceCents)
    : await computeDeliveryFeesAdditive(driverPriceCents);

  return fees;
}

/**
 * Find the succeeded payment for a resource.
 */
async function findSucceededPayment(
  resourceType: 'booking' | 'delivery',
  resourceId: bigint,
) {
  const where = resourceType === 'booking'
    ? { booking_id: resourceId, status: 'succeeded' as const }
    : { delivery_id: resourceId, status: 'succeeded' as const };

  return prisma.payments.findFirst({ where });
}

/**
 * Check if driver funds are already in available (released from pending).
 */
async function isDriverFundsAvailable(
  driverId: bigint,
  resourceType: 'booking' | 'delivery',
  resourceId: bigint,
): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
      `SELECT COUNT(*) as cnt FROM wallet_transactions
       WHERE reference_type = ? AND reference_id = ?
       AND txn_type = 'driver_release_to_available'`,
      resourceType,
      resourceId,
    );
    return Number(rows[0]?.cnt || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Create a cancellation_request record.
 */
async function createCancellationRequest(data: {
  resource_type: string;
  resource_id: bigint;
  actor_user_id: bigint;
  actor_role: string;
  reason: string | null;
  original_amount_cents: number;
  calculated_refund_cents: number;
  calculated_fee_cents: number;
  driver_reversal_cents: number;
  commission_reversal_cents: number;
  driver_compensation_cents: number;
  policy_id: bigint | null;
  policy_snapshot: string | null;
  status: string;
  stripe_refund_id: string | null;
  refund_id: bigint | null;
  is_admin_override: boolean;
}): Promise<bigint> {
  await prisma.$executeRaw`
    INSERT INTO cancellation_requests
      (resource_type, resource_id, actor_user_id, actor_role, reason,
       original_amount_cents, calculated_refund_cents, calculated_fee_cents,
       driver_reversal_cents, commission_reversal_cents, driver_compensation_cents,
       policy_id, policy_snapshot, status, stripe_refund_id, refund_id,
       is_admin_override, created_at, processed_at)
    VALUES
      (${data.resource_type}, ${data.resource_id}, ${data.actor_user_id},
       ${data.actor_role}, ${data.reason},
       ${data.original_amount_cents}, ${data.calculated_refund_cents},
       ${data.calculated_fee_cents}, ${data.driver_reversal_cents},
       ${data.commission_reversal_cents}, ${data.driver_compensation_cents},
       ${data.policy_id}, ${data.policy_snapshot}, ${data.status},
       ${data.stripe_refund_id}, ${data.refund_id},
       ${data.is_admin_override ? 1 : 0}, NOW(),
       ${data.status === 'refunded' || data.status === 'approved' ? new Date() : null})
  `;

  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() as id`;
  return BigInt(rows[0].id);
}

// ─── Cancel Preview ───

/**
 * Preview cancellation for a booking.
 */
export async function previewBookingCancellation(
  bookingId: string,
  userId: string,
  userRole: string,
): Promise<CancelPreviewResult> {
  const booking = await prisma.bookings.findUnique({
    where: { id: BigInt(bookingId) },
    include: { trip: true, payments: true },
  });
  if (!booking) throw Errors.notFound('Booking');

  const userIdBig = BigInt(userId);
  const actorRole = determineActorRole(userIdBig, 'booking', booking, userRole);

  return previewCancellation('booking', booking, actorRole, booking.trip.departure_at);
}

/**
 * Preview cancellation for a delivery.
 */
export async function previewDeliveryCancellation(
  deliveryId: string,
  userId: string,
  userRole: string,
): Promise<CancelPreviewResult> {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: true, payments: true },
  });
  if (!delivery) throw Errors.notFound('Delivery');

  const userIdBig = BigInt(userId);
  const actorRole = determineActorRole(userIdBig, 'delivery', delivery, userRole);

  return previewCancellation('delivery', delivery, actorRole, delivery.trip.departure_at);
}

/**
 * Generic preview cancellation logic.
 */
async function previewCancellation(
  resourceType: 'booking' | 'delivery',
  resource: any,
  actorRole: 'passenger' | 'sender' | 'driver' | 'admin',
  departureAt: Date,
): Promise<CancelPreviewResult> {
  const now = new Date();

  // Check if already cancelled
  if (['cancelled', 'rejected', 'completed'].includes(resource.status)) {
    return {
      allowed: false,
      policy_id: null,
      policy_name: null,
      refund_amount_cents: 0,
      cancellation_fee_cents: 0,
      driver_reversal_cents: 0,
      driver_compensation_cents: 0,
      original_amount_cents: 0,
      message: 'Cette ressource ne peut plus être annulée.',
      reason_code: 'CANCELLATION_NOT_ALLOWED',
    };
  }

  // Resolve policy
  const policy = await resolveApplicableRefundPolicy(
    resourceType,
    actorRole,
    resource.status,
    departureAt,
    now,
  );

  if (!policy) {
    return {
      allowed: false,
      policy_id: null,
      policy_name: null,
      refund_amount_cents: 0,
      cancellation_fee_cents: 0,
      driver_reversal_cents: 0,
      driver_compensation_cents: 0,
      original_amount_cents: 0,
      message: 'Aucune politique d\'annulation applicable trouvée.',
      reason_code: 'INVALID_REFUND_POLICY',
    };
  }

  // Check refund request window
  try {
    validateRefundRequestWindow(policy, departureAt, now);
  } catch (err: any) {
    if (err.code === 'REFUND_REQUEST_WINDOW_EXPIRED') {
      return {
        allowed: false,
        policy_id: policy.id.toString(),
        policy_name: policy.name,
        refund_amount_cents: 0,
        cancellation_fee_cents: 0,
        driver_reversal_cents: 0,
        driver_compensation_cents: 0,
        original_amount_cents: 0,
        message: err.message,
        reason_code: 'REFUND_REQUEST_WINDOW_EXPIRED',
      };
    }
    throw err;
  }

  // Check if payment exists
  const payment = await findSucceededPayment(resourceType, resource.id);
  if (!payment) {
    // No payment — cancellation allowed but no refund
    return {
      allowed: true,
      policy_id: policy.id.toString(),
      policy_name: policy.name,
      refund_amount_cents: 0,
      cancellation_fee_cents: 0,
      driver_reversal_cents: 0,
      driver_compensation_cents: 0,
      original_amount_cents: 0,
      message: 'Annulation autorisée. Aucun paiement à rembourser.',
    };
  }

  // Compute fee breakdown
  const fees = await getOriginalFeeBreakdown(resourceType, resource);

  // Compute refund amounts
  const calc = computeRefundAmounts({
    gross_amount_cents: fees.gross_cents,
    platform_fee_cents: fees.platform_fee_cents,
    driver_net_cents: fees.driver_net_cents,
    policy,
    actorRole,
    resourceType,
  });

  let message = '';
  if (calc.refundable_to_customer_cents === 0) {
    message = 'Annulation autorisée mais aucun remboursement selon la politique en vigueur.';
  } else if (calc.refundable_to_customer_cents === fees.gross_cents) {
    message = 'Annulation autorisée avec remboursement total.';
  } else {
    message = `Annulation autorisée avec remboursement partiel de ${(calc.refundable_to_customer_cents / 100).toFixed(2)} $.`;
  }

  if (calc.cancellation_fee_cents > 0) {
    message += ` Frais d'annulation : ${(calc.cancellation_fee_cents / 100).toFixed(2)} $.`;
  }

  return {
    allowed: true,
    policy_id: policy.id.toString(),
    policy_name: policy.name,
    refund_amount_cents: calc.refundable_to_customer_cents,
    cancellation_fee_cents: calc.cancellation_fee_cents,
    driver_reversal_cents: calc.driver_reversal_cents,
    driver_compensation_cents: calc.driver_compensation_cents,
    original_amount_cents: fees.gross_cents,
    message,
  };
}

// ─── Cancel Execution ───

/**
 * Execute booking cancellation.
 */
export async function executeBookingCancellation(
  bookingId: string,
  userId: string,
  userRole: string,
  reason?: string,
): Promise<CancelResult> {
  const booking = await prisma.bookings.findUnique({
    where: { id: BigInt(bookingId) },
    include: { trip: true, payments: true, passenger: true },
  });
  if (!booking) throw Errors.notFound('Booking');

  const userIdBig = BigInt(userId);
  const actorRole = determineActorRole(userIdBig, 'booking', booking, userRole);

  // Validate status
  if (['cancelled', 'rejected', 'completed'].includes(booking.status)) {
    throw Errors.alreadyCancelled();
  }

  const now = new Date();

  // Resolve policy
  const policy = await resolveApplicableRefundPolicy(
    'booking', actorRole, booking.status, booking.trip.departure_at, now,
  );
  if (!policy) {
    throw Errors.badRequest('Aucune politique d\'annulation applicable.', 'INVALID_REFUND_POLICY');
  }

  // Validate windows
  validateCancellationWindow(policy, booking.trip.departure_at, now);
  validateRefundRequestWindow(policy, booking.trip.departure_at, now);

  // Find payment
  const payment = await findSucceededPayment('booking', booking.id);

  let calc: RefundCalculationResult | null = null;
  let stripeRefundId: string | null = null;
  let refundDbId: bigint | null = null;

  if (payment) {
    // Compute fees and refund
    const fees = await getOriginalFeeBreakdown('booking', booking);
    calc = computeRefundAmounts({
      gross_amount_cents: fees.gross_cents,
      platform_fee_cents: fees.platform_fee_cents,
      driver_net_cents: fees.driver_net_cents,
      policy,
      actorRole,
      resourceType: 'booking',
    });

    // Execute Stripe refund if amount > 0
    if (calc.refundable_to_customer_cents > 0 && payment.stripe_payment_intent_id) {
      const stripeResult = await executeStripeRefund(
        payment.stripe_payment_intent_id,
        calc.refundable_to_customer_cents,
        `Booking ${bookingId} cancelled by ${actorRole}`,
      );
      stripeRefundId = stripeResult.id;
    }

    // Create refund record in DB
    if (calc.refundable_to_customer_cents > 0) {
      const refund = await prisma.refunds.create({
        data: {
          payment_id: payment.id,
          amount: calc.refundable_to_customer_cents / 100,
          currency: payment.currency,
          reason: reason || `Cancelled by ${actorRole}`,
          status: stripeRefundId ? 'succeeded' : 'pending',
          stripe_refund_id: stripeRefundId,
        },
      });
      refundDbId = refund.id;

      // Update payment status
      await prisma.payments.update({
        where: { id: payment.id },
        data: { status: calc.refundable_to_customer_cents >= fees.gross_cents ? 'refunded' : 'succeeded' },
      });
    }

    // Write ledger corrections
    await writeCancellationLedger(
      'booking',
      booking.id,
      refundDbId || BigInt(0),
      booking.trip.driver_id,
      calc,
      fees,
    );
  }

  // Update booking status
  await prisma.$transaction(async (tx) => {
    await tx.bookings.update({
      where: { id: booking.id },
      data: {
        status: 'cancelled',
        cancel_reason: reason || null,
      },
    });

    // Restore seats
    await tx.trips.update({
      where: { id: booking.trip_id },
      data: { seats_available: { increment: booking.seats_requested } },
    });
  });

  // Create cancellation request record
  const crId = await createCancellationRequest({
    resource_type: 'booking',
    resource_id: booking.id,
    actor_user_id: userIdBig,
    actor_role: actorRole,
    reason: reason || null,
    original_amount_cents: calc ? calc.snapshot.gross_amount_cents : 0,
    calculated_refund_cents: calc ? calc.refundable_to_customer_cents : 0,
    calculated_fee_cents: calc ? calc.cancellation_fee_cents : 0,
    driver_reversal_cents: calc ? calc.driver_reversal_cents : 0,
    commission_reversal_cents: calc ? calc.platform_commission_reversal_cents : 0,
    driver_compensation_cents: calc ? calc.driver_compensation_cents : 0,
    policy_id: policy.id,
    policy_snapshot: calc ? JSON.stringify(calc.snapshot) : null,
    status: calc && calc.refundable_to_customer_cents > 0 ? 'refunded' : 'approved',
    stripe_refund_id: stripeRefundId,
    refund_id: refundDbId,
    is_admin_override: false,
  });

  logger.info(`Booking ${bookingId} cancelled by ${actorRole} (user ${userId}). Refund: ${calc?.refundable_to_customer_cents || 0}c`);

  // Send cancellation email (fire & forget)
  const passenger = booking.passenger;
  if (passenger?.email) {
    sendCancellationEmail(passenger.email, {
      name: passenger.display_name || passenger.first_name || 'Passager',
      tripFrom: booking.trip.from_city,
      tripTo: booking.trip.to_city,
      departureDate: booking.trip.departure_at.toLocaleDateString('fr-CA'),
      cancellationFee: calc && calc.cancellation_fee_cents > 0
        ? `${(calc.cancellation_fee_cents / 100).toFixed(2)} $`
        : undefined,
      refundAmount: calc && calc.refundable_to_customer_cents > 0
        ? `${(calc.refundable_to_customer_cents / 100).toFixed(2)} $`
        : undefined,
      reason: reason || undefined,
    }).catch((err: any) => logger.error(`Failed to send cancellation email for booking ${bookingId}: ${err.message}`));
  }

  return {
    cancellation_request_id: crId.toString(),
    status: calc && calc.refundable_to_customer_cents > 0 ? 'refunded' : 'approved',
    refund_amount_cents: calc?.refundable_to_customer_cents || 0,
    cancellation_fee_cents: calc?.cancellation_fee_cents || 0,
    stripe_refund_id: stripeRefundId,
    message: calc && calc.refundable_to_customer_cents > 0
      ? `Réservation annulée. Remboursement de ${(calc.refundable_to_customer_cents / 100).toFixed(2)} $ en cours.`
      : 'Réservation annulée.',
  };
}

/**
 * Execute delivery cancellation.
 */
export async function executeDeliveryCancellation(
  deliveryId: string,
  userId: string,
  userRole: string,
  reason?: string,
): Promise<CancelResult> {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: true, payments: true, sender: true },
  });
  if (!delivery) throw Errors.notFound('Delivery');

  const userIdBig = BigInt(userId);
  const actorRole = determineActorRole(userIdBig, 'delivery', delivery, userRole);

  // Validate status
  if (['cancelled', 'rejected', 'received'].includes(delivery.status)) {
    throw Errors.alreadyCancelled();
  }

  // Additional status checks per actor
  if (actorRole === 'sender' && !['pending', 'accepted', 'paid'].includes(delivery.status)) {
    throw Errors.badRequest('Impossible d\'annuler la livraison dans son statut actuel.', 'CANCELLATION_NOT_ALLOWED');
  }
  if (actorRole === 'driver' && !['pending', 'accepted', 'paid'].includes(delivery.status)) {
    throw Errors.badRequest('Impossible d\'annuler la livraison dans son statut actuel.', 'CANCELLATION_NOT_ALLOWED');
  }

  const now = new Date();

  // Resolve policy
  const policy = await resolveApplicableRefundPolicy(
    'delivery', actorRole, delivery.status, delivery.trip.departure_at, now,
  );
  if (!policy) {
    throw Errors.badRequest('Aucune politique d\'annulation applicable.', 'INVALID_REFUND_POLICY');
  }

  // Validate windows
  validateCancellationWindow(policy, delivery.trip.departure_at, now);

  // For refund request window, use delivered_at if available, otherwise departure_at
  const eventDate = (delivery as any).delivered_at
    ? new Date((delivery as any).delivered_at)
    : delivery.trip.departure_at;
  validateRefundRequestWindow(policy, eventDate, now);

  // Find payment
  const payment = await findSucceededPayment('delivery', delivery.id);

  let calc: RefundCalculationResult | null = null;
  let stripeRefundId: string | null = null;
  let refundDbId: bigint | null = null;

  if (payment) {
    const fees = await getOriginalFeeBreakdown('delivery', delivery);
    calc = computeRefundAmounts({
      gross_amount_cents: fees.gross_cents,
      platform_fee_cents: fees.platform_fee_cents,
      driver_net_cents: fees.driver_net_cents,
      policy,
      actorRole,
      resourceType: 'delivery',
    });

    // Execute Stripe refund
    if (calc.refundable_to_customer_cents > 0 && payment.stripe_payment_intent_id) {
      const stripeResult = await executeStripeRefund(
        payment.stripe_payment_intent_id,
        calc.refundable_to_customer_cents,
        `Delivery ${deliveryId} cancelled by ${actorRole}`,
      );
      stripeRefundId = stripeResult.id;
    }

    // Create refund record
    if (calc.refundable_to_customer_cents > 0) {
      const refund = await prisma.refunds.create({
        data: {
          payment_id: payment.id,
          amount: calc.refundable_to_customer_cents / 100,
          currency: payment.currency,
          reason: reason || `Cancelled by ${actorRole}`,
          status: stripeRefundId ? 'succeeded' : 'pending',
          stripe_refund_id: stripeRefundId,
        },
      });
      refundDbId = refund.id;

      await prisma.payments.update({
        where: { id: payment.id },
        data: { status: calc.refundable_to_customer_cents >= fees.gross_cents ? 'refunded' : 'succeeded' },
      });
    }

    // Write ledger corrections
    await writeCancellationLedger(
      'delivery',
      delivery.id,
      refundDbId || BigInt(0),
      delivery.trip.driver_id,
      calc,
      fees,
    );
  }

  // Update delivery status
  await prisma.deliveries.update({
    where: { id: delivery.id },
    data: {
      status: 'cancelled' as any,
      cancel_reason: reason || null,
    },
  });

  // Create cancellation request record
  const crId = await createCancellationRequest({
    resource_type: 'delivery',
    resource_id: delivery.id,
    actor_user_id: userIdBig,
    actor_role: actorRole,
    reason: reason || null,
    original_amount_cents: calc ? calc.snapshot.gross_amount_cents : 0,
    calculated_refund_cents: calc ? calc.refundable_to_customer_cents : 0,
    calculated_fee_cents: calc ? calc.cancellation_fee_cents : 0,
    driver_reversal_cents: calc ? calc.driver_reversal_cents : 0,
    commission_reversal_cents: calc ? calc.platform_commission_reversal_cents : 0,
    driver_compensation_cents: calc ? calc.driver_compensation_cents : 0,
    policy_id: policy.id,
    policy_snapshot: calc ? JSON.stringify(calc.snapshot) : null,
    status: calc && calc.refundable_to_customer_cents > 0 ? 'refunded' : 'approved',
    stripe_refund_id: stripeRefundId,
    refund_id: refundDbId,
    is_admin_override: false,
  });

  logger.info(`Delivery ${deliveryId} cancelled by ${actorRole} (user ${userId}). Refund: ${calc?.refundable_to_customer_cents || 0}c`);

  // Send cancellation email (fire & forget)
  const sender = delivery.sender;
  if (sender?.email) {
    sendCancellationEmail(sender.email, {
      name: sender.display_name || sender.first_name || 'Expéditeur',
      tripFrom: delivery.trip.from_city,
      tripTo: delivery.trip.to_city,
      departureDate: delivery.trip.departure_at.toLocaleDateString('fr-CA'),
      cancellationFee: calc && calc.cancellation_fee_cents > 0
        ? `${(calc.cancellation_fee_cents / 100).toFixed(2)} $`
        : undefined,
      refundAmount: calc && calc.refundable_to_customer_cents > 0
        ? `${(calc.refundable_to_customer_cents / 100).toFixed(2)} $`
        : undefined,
      reason: reason || undefined,
    }).catch((err: any) => logger.error(`Failed to send cancellation email for delivery ${deliveryId}: ${err.message}`));
  }

  return {
    cancellation_request_id: crId.toString(),
    status: calc && calc.refundable_to_customer_cents > 0 ? 'refunded' : 'approved',
    refund_amount_cents: calc?.refundable_to_customer_cents || 0,
    cancellation_fee_cents: calc?.cancellation_fee_cents || 0,
    stripe_refund_id: stripeRefundId,
    message: calc && calc.refundable_to_customer_cents > 0
      ? `Livraison annulée. Remboursement de ${(calc.refundable_to_customer_cents / 100).toFixed(2)} $ en cours.`
      : 'Livraison annulée.',
  };
}

// ─── Admin Override ───

/**
 * Admin override: force a refund on any booking or delivery.
 */
export async function adminOverrideRefund(
  adminUserId: string,
  input: {
    resource_type: 'booking' | 'delivery';
    resource_id: string;
    refund_amount_cents: number;
    reason?: string;
    override_policy?: boolean;
  },
): Promise<CancelResult> {
  const resourceId = BigInt(input.resource_id);
  const adminId = BigInt(adminUserId);

  // Load resource
  let resource: any;
  let driverId: bigint;

  if (input.resource_type === 'booking') {
    resource = await prisma.bookings.findUnique({
      where: { id: resourceId },
      include: { trip: true, payments: true },
    });
    if (!resource) throw Errors.notFound('Booking');
    driverId = resource.trip.driver_id;
  } else {
    resource = await prisma.deliveries.findUnique({
      where: { id: resourceId },
      include: { trip: true, payments: true },
    });
    if (!resource) throw Errors.notFound('Delivery');
    driverId = resource.trip.driver_id;
  }

  // Find payment
  const payment = await findSucceededPayment(input.resource_type, resourceId);
  if (!payment) {
    throw Errors.badRequest('Aucun paiement réussi trouvé pour cette ressource.', 'NO_PAYMENT_FOUND');
  }

  // Check if already fully refunded
  const existingRefunds = await prisma.refunds.findMany({
    where: { payment_id: payment.id, status: 'succeeded' },
  });
  const totalRefunded = existingRefunds.reduce((sum, r) => sum + Math.round(Number(r.amount) * 100), 0);
  const grossCents = Math.round(Number(payment.amount) * 100);
  const remainingRefundable = grossCents - totalRefunded;

  if (remainingRefundable <= 0) {
    throw Errors.badRequest('Cette ressource a déjà été entièrement remboursée.', 'REFUND_ALREADY_PROCESSED');
  }

  const actualRefundCents = Math.min(input.refund_amount_cents, remainingRefundable);

  // Compute fee breakdown
  const fees = await getOriginalFeeBreakdown(input.resource_type, resource);
  const calc = computeAdminOverrideRefund(
    fees.gross_cents,
    fees.platform_fee_cents,
    fees.driver_net_cents,
    actualRefundCents,
  );

  // Execute Stripe refund
  let stripeRefundId: string | null = null;
  if (actualRefundCents > 0 && payment.stripe_payment_intent_id) {
    const stripeResult = await executeStripeRefund(
      payment.stripe_payment_intent_id,
      actualRefundCents,
      `Admin override: ${input.reason || 'No reason'}`,
    );
    stripeRefundId = stripeResult.id;
  }

  // Create refund record
  let refundDbId: bigint | null = null;
  if (actualRefundCents > 0) {
    const refund = await prisma.refunds.create({
      data: {
        payment_id: payment.id,
        amount: actualRefundCents / 100,
        currency: payment.currency,
        reason: `Admin override: ${input.reason || 'No reason'}`,
        status: stripeRefundId ? 'succeeded' : 'pending',
        stripe_refund_id: stripeRefundId,
      },
    });
    refundDbId = refund.id;
  }

  // Write ledger corrections
  await writeCancellationLedger(
    input.resource_type,
    resourceId,
    refundDbId || BigInt(0),
    driverId,
    calc,
    fees,
  );

  // Optionally cancel the resource
  if (input.resource_type === 'booking' && !['cancelled', 'completed'].includes(resource.status)) {
    await prisma.$transaction(async (tx) => {
      await tx.bookings.update({
        where: { id: resourceId },
        data: { status: 'cancelled', cancel_reason: `Admin override: ${input.reason || ''}` },
      });
      await tx.trips.update({
        where: { id: resource.trip_id },
        data: { seats_available: { increment: resource.seats_requested } },
      });
    });
  } else if (input.resource_type === 'delivery' && !['cancelled', 'received'].includes(resource.status)) {
    await prisma.deliveries.update({
      where: { id: resourceId },
      data: { status: 'cancelled' as any, cancel_reason: `Admin override: ${input.reason || ''}` },
    });
  }

  // Create cancellation request record
  const crId = await createCancellationRequest({
    resource_type: input.resource_type,
    resource_id: resourceId,
    actor_user_id: adminId,
    actor_role: 'admin',
    reason: input.reason || 'Admin override',
    original_amount_cents: fees.gross_cents,
    calculated_refund_cents: actualRefundCents,
    calculated_fee_cents: calc.cancellation_fee_cents,
    driver_reversal_cents: calc.driver_reversal_cents,
    commission_reversal_cents: calc.platform_commission_reversal_cents,
    driver_compensation_cents: 0,
    policy_id: null,
    policy_snapshot: JSON.stringify(calc.snapshot),
    status: 'refunded',
    stripe_refund_id: stripeRefundId,
    refund_id: refundDbId,
    is_admin_override: true,
  });

  // Audit log
  await prisma.admin_audit_logs.create({
    data: {
      admin_id: adminId,
      action: 'REFUND_OVERRIDE',
      entity_type: input.resource_type,
      entity_id: resourceId,
      details_json: JSON.stringify({
        refund_amount_cents: actualRefundCents,
        reason: input.reason,
        stripe_refund_id: stripeRefundId,
        cancellation_request_id: crId.toString(),
      }),
    },
  });

  logger.info(`Admin ${adminUserId} override refund on ${input.resource_type} ${input.resource_id}: ${actualRefundCents}c`);

  return {
    cancellation_request_id: crId.toString(),
    status: 'refunded',
    refund_amount_cents: actualRefundCents,
    cancellation_fee_cents: calc.cancellation_fee_cents,
    stripe_refund_id: stripeRefundId,
    message: `Remboursement admin de ${(actualRefundCents / 100).toFixed(2)} $ effectué.`,
  };
}

// ─── Stripe Refund ───

/**
 * Execute a Stripe refund. Idempotent via Stripe's built-in idempotency.
 */
async function executeStripeRefund(
  paymentIntentId: string,
  amountCents: number,
  reason: string,
): Promise<Stripe.Refund> {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amountCents,
      reason: 'requested_by_customer',
      metadata: { internal_reason: reason },
    });

    logger.info(`Stripe refund created: ${refund.id} for PI ${paymentIntentId}, amount=${amountCents}c`);
    return refund;
  } catch (err: any) {
    // Handle already refunded
    if (err.code === 'charge_already_refunded') {
      logger.warn(`Stripe: charge already refunded for PI ${paymentIntentId}`);
      throw Errors.badRequest('Ce paiement a déjà été remboursé.', 'REFUND_ALREADY_PROCESSED');
    }
    logger.error(`Stripe refund failed for PI ${paymentIntentId}: ${err.message}`);
    throw Errors.internal(`Erreur Stripe lors du remboursement: ${err.message}`);
  }
}

// ─── Ledger Corrections ───

/**
 * Write cancellation/refund ledger entries (append-only).
 *
 * Creates entries for:
 * - refund (debit platform)
 * - refund_commission_reversal (credit platform commission back)
 * - refund_driver_debit (debit driver wallet)
 * - driver_compensation (credit driver if applicable)
 */
async function writeCancellationLedger(
  resourceType: 'booking' | 'delivery',
  resourceId: bigint,
  refundId: bigint,
  driverId: bigint,
  calc: RefundCalculationResult,
  originalFees: { gross_cents: number; platform_fee_cents: number; driver_net_cents: number },
): Promise<void> {
  if (calc.refundable_to_customer_cents === 0 && calc.driver_reversal_cents === 0) {
    return; // Nothing to write
  }

  const driverWalletId = await ensureWallet(driverId);
  const snapshotStr = JSON.stringify(calc.snapshot);

  // Check if driver funds are already available (released from pending)
  const isAvailable = await isDriverFundsAvailable(driverId, resourceType, resourceId);

  const entries: LedgerEntry[] = [];
  let pendingDelta = 0;
  let availableDelta = 0;

  // 1. Refund entry (platform debit — money going back to customer)
  if (calc.refundable_to_customer_cents > 0) {
    entries.push({
      walletId: driverWalletId,
      userId: BigInt(0), // platform
      direction: 'debit',
      amountCents: calc.refundable_to_customer_cents,
      txnType: 'refund',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: snapshotStr,
    });
  }

  // 2. Commission reversal (platform gives back its commission proportionally)
  if (calc.platform_commission_reversal_cents > 0) {
    entries.push({
      walletId: driverWalletId,
      userId: BigInt(0),
      direction: 'credit',
      amountCents: calc.platform_commission_reversal_cents,
      txnType: 'refund_commission_reversal',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: snapshotStr,
    });
  }

  // 3. Driver debit (reverse driver's earnings)
  if (calc.driver_reversal_cents > 0) {
    entries.push({
      walletId: driverWalletId,
      userId: driverId,
      direction: 'debit',
      amountCents: calc.driver_reversal_cents,
      txnType: 'refund_driver_debit',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: snapshotStr,
    });

    // Debit from appropriate bucket
    if (isAvailable) {
      availableDelta -= calc.driver_reversal_cents;
    } else {
      pendingDelta -= calc.driver_reversal_cents;
    }
  }

  // 4. Driver compensation (if passenger/sender cancels late)
  if (calc.driver_compensation_cents > 0) {
    entries.push({
      walletId: driverWalletId,
      userId: driverId,
      direction: 'credit',
      amountCents: calc.driver_compensation_cents,
      txnType: 'adjustment',
      referenceType: 'refund',
      referenceId: refundId,
      snapshotJson: JSON.stringify({
        ...calc.snapshot,
        note: 'Driver compensation for late cancellation',
      }),
    });

    // Compensation goes to available immediately
    availableDelta += calc.driver_compensation_cents;
  }

  if (entries.length > 0) {
    await writeLedgerEntries(entries, [
      { walletId: driverWalletId, pendingDelta, availableDelta },
    ]);
  }

  // Log if driver balance goes negative (debt)
  try {
    const wallet = await prisma.wallets.findUnique({ where: { id: driverWalletId } });
    if (wallet) {
      const totalBalance = Number(wallet.pending_balance) + Number(wallet.available_balance);
      if (totalBalance < 0) {
        logger.warn(
          `Driver ${driverId} wallet has negative balance after cancellation: pending=${wallet.pending_balance}, available=${wallet.available_balance}. ` +
          `This creates an internal debt that will be deducted from future payouts.`,
        );
      }
    }
  } catch { /* best effort */ }
}
