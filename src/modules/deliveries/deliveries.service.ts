import Stripe from 'stripe';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { Errors } from '../../utils/errors';
import type { CreateDeliveryInput } from './deliveries.schemas';
import { isDeliveryAllowedBeforeDeparture } from '../settings/settings.service';
import { sendDeliveryAcceptedEmail, sendDeliveryDeliveredEmail, sendDeliveryReceivedEmail, sendDeliveryPaymentReceipt } from '../notifications/emailService';
import { generateDeliveryInvoicePdf } from '../notifications/invoiceGenerator';
import { logger } from '../../config/logger';
import { createPaymentIntentForDelivery } from '../payments/payments.service';
import { getOrCreateDeliveryConversation, addDeliverySystemMessage } from '../messaging/messaging.service';
import { toStripeCents } from '../../utils/money';
import { computeDeliveryFeesAdditive } from '../fees/feeCalculator';
import { recordPaymentWithFees } from '../fees/ledgerWriter';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });

const DELIVERY_INCLUDE = {
  trip: {
    include: {
      driver: { select: { id: true, first_name: true, last_name: true } },
    },
  },
  sender: { select: { id: true, first_name: true, last_name: true } },
  recipient: { select: { id: true, first_name: true, last_name: true } },
  parcels: true,
  payments: true,
};

/**
 * Helper: get trip delivery_mode via raw SQL (works even if Prisma client not regenerated).
 */
async function getTripDeliveryMode(tripId: bigint): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<Array<{ delivery_mode: string }>>`
      SELECT delivery_mode FROM trips WHERE id = ${tripId} LIMIT 1
    `;
    return rows.length > 0 ? rows[0].delivery_mode : 'manual';
  } catch {
    return 'manual';
  }
}

/**
 * Helper: update delivery timestamp fields via raw SQL (works even if Prisma client not regenerated).
 */
async function setDeliveryTimestamp(deliveryId: bigint, field: string, value: Date | null): Promise<void> {
  const allowedFields = ['accepted_at', 'in_transit_at', 'delivered_at', 'received_at'];
  if (!allowedFields.includes(field)) return;
  try {
    if (value) {
      const dateStr = value.toISOString().slice(0, 19).replace('T', ' ');
      await prisma.$executeRawUnsafe(
        `UPDATE deliveries SET ${field} = ? WHERE id = ?`,
        dateStr,
        deliveryId,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE deliveries SET ${field} = NULL WHERE id = ?`,
        deliveryId,
      );
    }
  } catch (err: any) {
    logger.warn(`Failed to set ${field} on delivery ${deliveryId}: ${err.message}`);
  }
}

/**
 * Validate parcel against trip rules (RB-DEL-4).
 */
function validateParcelAgainstTrip(
  parcel: { size_category: string; weight_kg?: number | null },
  trip: { parcel_max_size?: string | null; parcel_max_weight_kg?: any; parcel_prohibited_items?: string | null },
) {
  if (trip.parcel_max_size) {
    const sizeOrder = ['XS', 'S', 'M', 'L'];
    const parcelIdx = sizeOrder.indexOf(parcel.size_category);
    const maxIdx = sizeOrder.indexOf(trip.parcel_max_size);
    if (parcelIdx > maxIdx) {
      throw Errors.parcelNotAllowed(`Parcel size ${parcel.size_category} exceeds max allowed ${trip.parcel_max_size}`);
    }
  }

  if (trip.parcel_max_weight_kg && parcel.weight_kg) {
    const maxWeight = Number(trip.parcel_max_weight_kg);
    if (parcel.weight_kg > maxWeight) {
      throw Errors.parcelNotAllowed(`Parcel weight ${parcel.weight_kg}kg exceeds max allowed ${maxWeight}kg`);
    }
  }
}

/**
 * Shared validation logic for delivery creation (RB-DEL-0 to RB-DEL-4).
 * Returns validated trip, recipientId, and amountTotal.
 */
async function validateDeliveryRequest(senderId: string, input: { trip_id: string; recipient_user_id?: string; recipient_email?: string; parcel: { size_category: string; weight_kg?: number | null } }) {
  const senderIdBig = BigInt(senderId);
  const tripIdBig = BigInt(input.trip_id);

  // Resolve recipient
  let recipientIdBig: bigint | null = null;
  if (input.recipient_user_id) {
    recipientIdBig = BigInt(input.recipient_user_id);
    const recipientUser = await prisma.users.findUnique({ where: { id: recipientIdBig } });
    if (!recipientUser) throw Errors.invalidRecipient();
  } else if (input.recipient_email) {
    const recipientUser = await prisma.users.findFirst({ where: { email: input.recipient_email } });
    if (recipientUser) recipientIdBig = recipientUser.id;
  }

  // Load trip
  const trip = await prisma.trips.findUnique({ where: { id: tripIdBig } });
  if (!trip) throw Errors.notFound('Trip');

  // RB-DEL-1
  if (!trip.accepts_parcels) throw Errors.tripDoesNotAcceptParcels();

  // RB-DEL-2
  if (trip.driver_id === senderIdBig) throw Errors.cannotRequestDeliveryOnOwnTrip();

  // Trip must be published
  if (trip.status !== 'published') throw Errors.tripNotPublished();

  // RB-DEL-0
  const allowed = await isDeliveryAllowedBeforeDeparture(trip.departure_at);
  if (!allowed) throw Errors.deliveryTooLateBeforeDeparture();

  // RB-DEL-4
  validateParcelAgainstTrip(
    { size_category: input.parcel.size_category, weight_kg: input.parcel.weight_kg ?? null },
    trip,
  );

  const amountTotal = trip.parcel_base_price ? Number(trip.parcel_base_price) : 0;

  return { trip, recipientIdBig, amountTotal, senderIdBig, tripIdBig };
}

/**
 * Step 1: Prepare payment for a delivery.
 * Validates all business rules (RB-DEL-0 to RB-DEL-4), calculates price,
 * creates a Stripe PaymentIntent, but does NOT create the delivery.
 * Returns client_secret for the frontend to complete payment.
 */
export async function prepareDeliveryPayment(senderId: string, input: CreateDeliveryInput) {
  const { trip, amountTotal } = await validateDeliveryRequest(senderId, {
    trip_id: input.trip_id,
    recipient_user_id: input.recipient_user_id,
    recipient_email: input.recipient_email,
    parcel: { size_category: input.parcel.size_category, weight_kg: input.parcel.weight_kg ?? null },
  });

  if (amountTotal <= 0) {
    // No payment needed — frontend should call createDelivery directly
    return {
      requires_payment: false,
      amount: 0,
      driver_price: 0,
      platform_fee: 0,
      currency: trip.currency || 'CAD',
      client_secret: null,
      stripe_payment_intent_id: null,
    };
  }

  // Compute additive fees: client pays driver_price + platform_fee
  const driverPriceCents = Math.round(amountTotal * 100);
  const fees = await computeDeliveryFeesAdditive(driverPriceCents);
  const totalClientDollars = fees.total_client_cents / 100;
  const amount = fees.total_client_cents; // in cents for Stripe

  // Create Stripe PaymentIntent with total (driver price + platform fee)
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: (env.STRIPE_CURRENCY || 'CAD').toLowerCase(),
    metadata: {
      type: 'delivery_prepayment',
      trip_id: input.trip_id,
      payer_id: senderId,
      driver_price_cents: String(fees.driver_price_cents),
      platform_fee_cents: String(fees.platform_fee_cents),
    },
  });

  logger.info(`Delivery prepayment PI created: ${paymentIntent.id} for trip ${input.trip_id}, total=${totalClientDollars} (driver=${amountTotal}, fee=${fees.platform_fee_cents / 100})`);

  return {
    requires_payment: true,
    amount: totalClientDollars,
    driver_price: amountTotal,
    platform_fee: fees.platform_fee_cents / 100,
    currency: trip.currency || 'CAD',
    client_secret: paymentIntent.client_secret!,
    stripe_payment_intent_id: paymentIntent.id,
  };
}

/**
 * Step 2: Create a delivery request.
 * If amount > 0, requires stripe_payment_intent_id and verifies payment is succeeded.
 * RB-DEL-0 to RB-DEL-6
 */
export async function createDelivery(senderId: string, input: CreateDeliveryInput) {
  const { trip, recipientIdBig, amountTotal, senderIdBig, tripIdBig } = await validateDeliveryRequest(senderId, {
    trip_id: input.trip_id,
    recipient_user_id: input.recipient_user_id,
    recipient_email: input.recipient_email,
    parcel: { size_category: input.parcel.size_category, weight_kg: input.parcel.weight_kg ?? null },
  });

  // ── Payment verification: must be paid BEFORE delivery creation ──
  if (amountTotal > 0) {
    const stripePaymentIntentId = input.stripe_payment_intent_id;
    if (!stripePaymentIntentId) {
      throw Errors.badRequest('Payment is required before creating a delivery. Use POST /deliveries/prepare-payment first.', 'PAYMENT_REQUIRED');
    }

    // Verify payment succeeded on Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      throw Errors.badRequest(`Payment not completed. Current status: ${paymentIntent.status}`, 'PAYMENT_NOT_SUCCEEDED');
    }

    // Verify amount matches
    const expectedAmount = toStripeCents(amountTotal);
    if (paymentIntent.amount < expectedAmount) {
      throw Errors.badRequest('Payment amount does not match delivery price', 'PAYMENT_AMOUNT_MISMATCH');
    }
  }

  // Create parcel
  const parcel = await prisma.parcels.create({
    data: {
      size_category: input.parcel.size_category as any,
      weight_kg: input.parcel.weight_kg ?? null,
      declared_value: input.parcel.declared_value ?? null,
      instructions: input.parcel.instructions ?? null,
    },
  });

  // RB-DEL-5 / RB-DEL-6: Determine initial status based on delivery_mode
  const deliveryMode = await getTripDeliveryMode(tripIdBig);
  const isInstant = deliveryMode === 'instant';
  // If paid, start as 'paid'; otherwise follow manual/instant logic
  const initialStatus = amountTotal > 0 ? 'paid' : (isInstant ? 'accepted' : 'pending');

  // Create delivery
  const delivery = await prisma.deliveries.create({
    data: {
      trip_id: tripIdBig,
      sender_id: senderIdBig,
      recipient_user_id: recipientIdBig,
      parcel_id: parcel.id,
      pickup_notes: input.pickup_notes ?? null,
      dropoff_notes: input.dropoff_notes ?? null,
      amount_total: amountTotal,
      status: initialStatus as any,
    },
    include: DELIVERY_INCLUDE,
  });

  // If instant mode (and free), set accepted_at
  if (isInstant && amountTotal <= 0) {
    await setDeliveryTimestamp(delivery.id, 'accepted_at', new Date());
  }

  // Create conversation between driver and sender (fire & forget)
  try {
    await getOrCreateDeliveryConversation(
      delivery.id,
      trip.driver_id,
      senderIdBig,
      recipientIdBig,
      senderIdBig,
    );
    await addDeliverySystemMessage(delivery.id, `Nouvelle demande de livraison créée.`);
  } catch (convErr: any) {
    logger.error(`Failed to create conversation for delivery ${delivery.id}: ${convErr.message}`);
  }

  // If paid, create payment record in DB and credit driver wallet via ledger
  if (amountTotal > 0 && input.stripe_payment_intent_id) {
    try {
      const payment = await prisma.payments.create({
        data: {
          payer_id: senderIdBig,
          payee_id: trip.driver_id,
          delivery_id: delivery.id,
          stripe_payment_intent_id: input.stripe_payment_intent_id,
          amount: amountTotal,
          currency: env.STRIPE_CURRENCY || 'CAD',
          status: 'succeeded',
          provider: 'stripe',
        },
      });

      // Compute fees (commission split) and write to immutable ledger
      const driverPriceCents = Math.round(amountTotal * 100);
      const fees = await computeDeliveryFeesAdditive(driverPriceCents);

      // Record in ledger: 3 entries (gross, commission, driver_net) + update wallet pending_cents
      await recordPaymentWithFees('delivery', delivery.id, payment.id, trip.driver_id, fees);

      logger.info(
        `Delivery ${delivery.id} created with pre-payment ${input.stripe_payment_intent_id} — gross=${fees.gross_cents}c, fee=${fees.platform_fee_cents}c, net=${fees.driver_net_cents}c`,
      );

      // ── Send payment receipt email with PDF invoice (fire & forget) ──
      try {
        const sender = await prisma.users.findUnique({ where: { id: senderIdBig } });
        if (sender) {
          const senderName = `${sender.first_name || ''} ${sender.last_name || ''}`.trim();
          const currency = env.STRIPE_CURRENCY || 'CAD';
          const formattedAmount = new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(amountTotal);
          const now = new Date();
          const formattedDate = now.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
          const departureDate = trip.departure_at.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
          const reference = `DEL-${delivery.id}`;

          // Generate PDF receipt
          const invoicePdf = await generateDeliveryInvoicePdf({
            invoiceNumber: reference,
            date: formattedDate,
            customerName: senderName,
            customerEmail: sender.email,
            tripFrom: trip.from_city,
            tripTo: trip.to_city,
            departureDate,
            parcelSize: input.parcel.size_category,
            parcelWeight: input.parcel.weight_kg ?? null,
            totalAmount: amountTotal,
            currency,
            paymentMethod: 'Carte bancaire (Stripe)',
            stripePaymentIntentId: input.stripe_payment_intent_id,
          });

          // Send email with PDF attached
          sendDeliveryPaymentReceipt(sender.email, {
            name: senderName,
            amount: formattedAmount,
            reference,
            tripFrom: trip.from_city,
            tripTo: trip.to_city,
            date: formattedDate,
            parcelSize: input.parcel.size_category,
            deliveryId: String(delivery.id),
          }, invoicePdf).catch(e => logger.error('Failed to send delivery payment receipt email', { error: e.message }));

          logger.info(`Delivery payment receipt email queued for ${sender.email}`);
        }
      } catch (emailErr: any) {
        logger.error(`Failed to generate/send delivery receipt: ${emailErr.message}`);
      }
    } catch (err: any) {
      logger.error(`Failed to record payment for delivery ${delivery.id}: ${err.message}`);
    }
  }

  return delivery;
}

export async function getDelivery(deliveryId: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: DELIVERY_INCLUDE,
  });
  if (!delivery) throw Errors.notFound('Delivery');
  return delivery;
}

export async function getMyDeliveriesSent(senderId: string) {
  return prisma.deliveries.findMany({
    where: { sender_id: BigInt(senderId) },
    include: DELIVERY_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
}

export async function getMyDeliveriesReceived(recipientId: string) {
  return prisma.deliveries.findMany({
    where: { recipient_user_id: BigInt(recipientId) },
    include: DELIVERY_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
}

export async function getDriverDeliveries(driverId: string) {
  const driverIdBig = BigInt(driverId);
  const trips = await prisma.trips.findMany({
    where: { driver_id: driverIdBig },
    select: { id: true },
  });
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length === 0) return [];

  return prisma.deliveries.findMany({
    where: { trip_id: { in: tripIds } },
    include: DELIVERY_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
}

/**
 * RB-DEL-7: Only the trip driver can accept a delivery
 * RB-DEL-0: Check min time before departure on accept
 */
export async function acceptDelivery(driverId: string, deliveryId: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: { include: { driver: { select: { first_name: true, last_name: true } } } } },
  });
  if (!delivery) throw Errors.notFound('Delivery');
  if (delivery.trip.driver_id !== BigInt(driverId)) throw Errors.notTripDriver();
  if (delivery.status !== 'pending') throw Errors.badRequest('Delivery is not pending', 'DELIVERY_NOT_PENDING');

  // RB-DEL-0
  const allowed = await isDeliveryAllowedBeforeDeparture(delivery.trip.departure_at);
  if (!allowed) {
    throw Errors.deliveryTooLateBeforeDeparture();
  }

  // Update status only (without accepted_at which may not be in Prisma client)
  const updated = await prisma.deliveries.update({
    where: { id: BigInt(deliveryId) },
    data: { status: 'accepted' as any },
    include: DELIVERY_INCLUDE,
  });

  // Set accepted_at via raw SQL
  await setDeliveryTimestamp(BigInt(deliveryId), 'accepted_at', new Date());

  // Send email (fire & forget)
  try {
    const sender = await prisma.users.findUnique({ where: { id: delivery.sender_id } });
    if (sender) {
      const driverName = `${delivery.trip.driver.first_name || ''} ${delivery.trip.driver.last_name || ''}`.trim();
      const departureDate = delivery.trip.departure_at.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
      sendDeliveryAcceptedEmail(sender.email, {
        senderName: `${sender.first_name || ''} ${sender.last_name || ''}`.trim(),
        tripFrom: delivery.trip.from_city,
        tripTo: delivery.trip.to_city,
        driverName,
        departureDate,
      }).catch(e => logger.error('Failed to send delivery accepted email', { error: e.message }));
    }
  } catch (e: any) { logger.error('Email error in acceptDelivery', { error: e.message }); }

  return updated;
}

/**
 * RB-DEL-7: Only the trip driver can reject a delivery
 */
export async function rejectDelivery(driverId: string, deliveryId: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: true },
  });
  if (!delivery) throw Errors.notFound('Delivery');
  if (delivery.trip.driver_id !== BigInt(driverId)) throw Errors.notTripDriver();
  if (delivery.status !== 'pending') throw Errors.badRequest('Delivery is not pending', 'DELIVERY_NOT_PENDING');

  return prisma.deliveries.update({
    where: { id: BigInt(deliveryId) },
    data: { status: 'rejected' as any },
    include: DELIVERY_INCLUDE,
  });
}

/**
 * RB-DEL-7: Only the trip driver can mark in_transit
 */
export async function markInTransit(driverId: string, deliveryId: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: true, payments: true },
  });
  if (!delivery) throw Errors.notFound('Delivery');
  if (delivery.trip.driver_id !== BigInt(driverId)) throw Errors.notTripDriver();

  if (delivery.status !== 'accepted' && delivery.status !== 'paid') {
    throw Errors.badRequest('Delivery must be accepted or paid to mark in transit', 'INVALID_STATUS');
  }

  const amountTotal = delivery.amount_total ? Number(delivery.amount_total) : 0;
  if (amountTotal > 0 && delivery.status !== 'paid') {
    throw Errors.paymentRequired();
  }

  const updated = await prisma.deliveries.update({
    where: { id: BigInt(deliveryId) },
    data: { status: 'in_transit' as any },
    include: DELIVERY_INCLUDE,
  });

  await setDeliveryTimestamp(BigInt(deliveryId), 'in_transit_at', new Date());

  return updated;
}

/**
 * RB-DEL-7: Only the trip driver can mark delivered
 */
export async function markDelivered(driverId: string, deliveryId: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: true },
  });
  if (!delivery) throw Errors.notFound('Delivery');
  if (delivery.trip.driver_id !== BigInt(driverId)) throw Errors.notTripDriver();
  if (delivery.status !== 'in_transit') {
    throw Errors.badRequest('Delivery must be in transit to mark delivered', 'INVALID_STATUS');
  }

  const updated = await prisma.deliveries.update({
    where: { id: BigInt(deliveryId) },
    data: { status: 'delivered' as any },
    include: DELIVERY_INCLUDE,
  });

  await setDeliveryTimestamp(BigInt(deliveryId), 'delivered_at', new Date());

  // Send email (fire & forget)
  try {
    if (delivery.recipient_user_id) {
      const recipient = await prisma.users.findUnique({ where: { id: delivery.recipient_user_id } });
      if (recipient) {
        sendDeliveryDeliveredEmail(recipient.email, {
          recipientName: `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim(),
          tripFrom: delivery.trip.from_city,
          tripTo: delivery.trip.to_city,
          deliveryCode: (delivery as any).delivery_code || undefined,
        }).catch(e => logger.error('Failed to send delivery delivered email', { error: e.message }));
      }
    }
  } catch (e: any) { logger.error('Email error in markDelivered', { error: e.message }); }

  return updated;
}

/**
 * RB-DEL-8: Only the recipient can confirm receipt
 */
export async function confirmReceipt(userId: string, deliveryId: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: DELIVERY_INCLUDE,
  });
  if (!delivery) throw Errors.notFound('Delivery');

  if (delivery.recipient_user_id !== BigInt(userId)) {
    throw Errors.notDeliveryRecipient();
  }

  if (delivery.status !== 'delivered') {
    throw Errors.deliveryNotDeliveredYet();
  }

  const updated = await prisma.deliveries.update({
    where: { id: BigInt(deliveryId) },
    data: { status: 'received' as any },
    include: DELIVERY_INCLUDE,
  });

  await setDeliveryTimestamp(BigInt(deliveryId), 'received_at', new Date());

  // Send email (fire & forget)
  try {
    const sender = await prisma.users.findUnique({ where: { id: delivery.sender_id } });
    const recipient = await prisma.users.findUnique({ where: { id: BigInt(userId) } });
    if (sender && recipient) {
      sendDeliveryReceivedEmail(sender.email, {
        senderName: `${sender.first_name || ''} ${sender.last_name || ''}`.trim(),
        tripFrom: delivery.trip.from_city,
        tripTo: delivery.trip.to_city,
        recipientName: `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim(),
      }).catch(e => logger.error('Failed to send delivery received email', { error: e.message }));
    }
  } catch (e: any) { logger.error('Email error in confirmReceipt', { error: e.message }); }

  return updated;
}

/**
 * RB-DEL-9: Cancel delivery
 */
export async function cancelDelivery(userId: string, deliveryId: string, reason?: string) {
  const delivery = await prisma.deliveries.findUnique({
    where: { id: BigInt(deliveryId) },
    include: { trip: true, payments: true },
  });
  if (!delivery) throw Errors.notFound('Delivery');

  const userIdBig = BigInt(userId);
  const isSender = delivery.sender_id === userIdBig;
  const isDriver = delivery.trip.driver_id === userIdBig;

  if (!isSender && !isDriver) {
    throw Errors.forbidden('You are not authorized to cancel this delivery');
  }

  const driverAllowed = ['pending', 'accepted', 'paid'];
  const senderAllowed = ['pending', 'accepted'];

  if (isDriver && !driverAllowed.includes(delivery.status)) {
    throw Errors.badRequest('Cannot cancel delivery in current status', 'INVALID_STATUS');
  }
  if (isSender && !isDriver && !senderAllowed.includes(delivery.status)) {
    throw Errors.badRequest('Cannot cancel delivery in current status', 'INVALID_STATUS');
  }

  // If paid, trigger refund
  if (delivery.status === 'paid' && delivery.payments.length > 0) {
    const succeededPayment = delivery.payments.find(p => p.status === 'succeeded');
    if (succeededPayment) {
      await prisma.refunds.create({
        data: {
          payment_id: succeededPayment.id,
          amount: succeededPayment.amount,
          currency: succeededPayment.currency,
          reason: `Delivery cancelled: ${reason || 'No reason provided'}`,
          status: 'pending',
        },
      });
      logger.info(`Refund created for delivery ${deliveryId} payment ${succeededPayment.id}`);
    }
  }

  return prisma.deliveries.update({
    where: { id: BigInt(deliveryId) },
    data: {
      status: 'cancelled' as any,
      cancel_reason: reason || null,
    },
    include: DELIVERY_INCLUDE,
  });
}
