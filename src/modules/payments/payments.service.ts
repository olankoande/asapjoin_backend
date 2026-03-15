import Stripe from 'stripe';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { Errors } from '../../utils/errors';
import { toStripeCents } from '../../utils/money';
import { CreatePaymentIntentInput } from './payments.schemas';
import { logger } from '../../config/logger';
import { sendBookingConfirmation, sendPaymentReceipt, sendDeliveryPaymentReceipt } from '../notifications/emailService';
import { generateInvoicePdf, generateDeliveryInvoicePdf } from '../notifications/invoiceGenerator';
import { computeBookingFees, computeDeliveryFees, computeBookingFeesAdditive, computeDeliveryFeesAdditive } from '../fees/feeCalculator';
import { recordPaymentWithFees } from '../fees/ledgerWriter';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });

/**
 * Create a Stripe PaymentIntent directly for a delivery (called from deliveries.service).
 * Used when delivery creation requires immediate payment.
 */
export async function createPaymentIntentForDelivery(
  payerId: string,
  deliveryId: bigint,
  driverId: bigint,
  amountDollars: number,
) {
  const payerIdBig = BigInt(payerId);
  const amount = toStripeCents(amountDollars);

  if (amount <= 0) {
    return null; // No payment needed for free deliveries
  }

  // Create Stripe PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: env.STRIPE_CURRENCY.toLowerCase(),
    metadata: {
      delivery_id: deliveryId.toString(),
      payer_id: payerId,
    },
  });

  // Create payment record in DB
  const payment = await prisma.payments.create({
    data: {
      payer_id: payerIdBig,
      payee_id: driverId,
      delivery_id: deliveryId,
      stripe_payment_intent_id: paymentIntent.id,
      amount: amountDollars,
      currency: env.STRIPE_CURRENCY,
      status: 'requires_payment',
      provider: 'stripe',
    },
  });

  logger.info(`PaymentIntent created (delivery flow): ${paymentIntent.id} for delivery ${deliveryId}`);

  return {
    payment_id: payment.id.toString(),
    client_secret: paymentIntent.client_secret!,
    stripe_payment_intent_id: paymentIntent.id,
  };
}

/**
 * Create a Stripe PaymentIntent directly for a booking (called from bookings.service).
 * Used when booking creation requires immediate payment.
 */
export async function createPaymentIntentForBooking(
  payerId: string,
  bookingId: bigint,
  driverId: bigint,
  amountDollars: number,
) {
  const payerIdBig = BigInt(payerId);
  const amount = toStripeCents(amountDollars);

  if (amount <= 0) {
    throw Errors.badRequest('Amount must be greater than zero', 'INVALID_AMOUNT');
  }

  // Create Stripe PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: env.STRIPE_CURRENCY.toLowerCase(),
    metadata: {
      booking_id: bookingId.toString(),
      payer_id: payerId,
    },
  });

  // Create payment record in DB
  const payment = await prisma.payments.create({
    data: {
      payer_id: payerIdBig,
      payee_id: driverId,
      booking_id: bookingId,
      stripe_payment_intent_id: paymentIntent.id,
      amount: amountDollars,
      currency: env.STRIPE_CURRENCY,
      status: 'requires_payment',
      provider: 'stripe',
    },
  });

  logger.info(`PaymentIntent created (booking flow): ${paymentIntent.id} for booking ${bookingId}`);

  return {
    payment_id: payment.id.toString(),
    client_secret: paymentIntent.client_secret!,
    stripe_payment_intent_id: paymentIntent.id,
  };
}

/**
 * Create a Stripe PaymentIntent for a booking or delivery (standalone endpoint).
 * Returns the client_secret needed by the frontend to confirm payment.
 */
export async function createPaymentIntent(payerId: string, input: CreatePaymentIntentInput) {
  const payerIdBig = BigInt(payerId);
  let amount: number;
  let bookingId: bigint | null = null;
  let deliveryId: bigint | null = null;
  let payeeId: bigint; // the driver

  if (input.booking_id) {
    const booking = await prisma.bookings.findUnique({
      where: { id: BigInt(input.booking_id) },
      include: { trip: true },
    });
    if (!booking) throw Errors.notFound('Booking');
    if (booking.passenger_id !== payerIdBig) throw Errors.forbidden('You are not the passenger');
    if (!['pending', 'accepted'].includes(booking.status)) {
      throw Errors.badRequest('Booking is not in a payable state', 'BOOKING_NOT_PAYABLE');
    }

    // Check if already paid
    const existingPayment = await prisma.payments.findFirst({
      where: { booking_id: booking.id, status: 'succeeded' },
    });
    if (existingPayment) throw Errors.conflict('Booking already paid', 'ALREADY_PAID');

    amount = toStripeCents(booking.amount_total ?? 0);
    bookingId = booking.id;
    payeeId = booking.trip.driver_id;
  } else if (input.delivery_id) {
    const delivery = await prisma.deliveries.findUnique({
      where: { id: BigInt(input.delivery_id) },
      include: { trip: true },
    });
    if (!delivery) throw Errors.notFound('Delivery');
    if (delivery.sender_id !== payerIdBig) throw Errors.forbidden('You are not the sender');
    if (!['pending', 'accepted'].includes(delivery.status)) {
      throw Errors.badRequest('Delivery is not in a payable state', 'DELIVERY_NOT_PAYABLE');
    }

    const existingPayment = await prisma.payments.findFirst({
      where: { delivery_id: delivery.id, status: 'succeeded' },
    });
    if (existingPayment) throw Errors.conflict('Delivery already paid', 'ALREADY_PAID');

    amount = toStripeCents(delivery.amount_total ?? 0);
    deliveryId = delivery.id;
    payeeId = delivery.trip.driver_id;
  } else {
    throw Errors.badRequest('Either booking_id or delivery_id required');
  }

  if (amount <= 0) {
    throw Errors.badRequest('Amount must be greater than zero', 'INVALID_AMOUNT');
  }

  // Create Stripe PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: env.STRIPE_CURRENCY.toLowerCase(),
    metadata: {
      ...(bookingId && { booking_id: bookingId.toString() }),
      ...(deliveryId && { delivery_id: deliveryId.toString() }),
      payer_id: payerId,
    },
  });

  // Create payment record in DB
  const payment = await prisma.payments.create({
    data: {
      payer_id: payerIdBig,
      payee_id: payeeId,
      booking_id: bookingId,
      delivery_id: deliveryId,
      stripe_payment_intent_id: paymentIntent.id,
      amount: amount / 100, // Store in dollars
      currency: env.STRIPE_CURRENCY,
      status: 'requires_payment',
      provider: 'stripe',
    },
  });

  logger.info(`PaymentIntent created: ${paymentIntent.id} for payment ${payment.id}`);

  return {
    payment_id: payment.id.toString(),
    client_secret: paymentIntent.client_secret,
    stripe_payment_intent_id: paymentIntent.id,
  };
}

/**
 * Get a payment by ID.
 */
export async function getPayment(paymentId: string, userId: string) {
  const payment = await prisma.payments.findUnique({
    where: { id: BigInt(paymentId) },
    include: {
      booking: true,
      delivery: true,
      refunds: true,
    },
  });

  if (!payment) throw Errors.notFound('Payment');

  const userIdBig = BigInt(userId);
  if (payment.payer_id !== userIdBig && payment.payee_id !== userIdBig) {
    throw Errors.forbidden('Not authorized');
  }

  return payment;
}

/**
 * Process a successful payment (called from Stripe webhook).
 * - Updates payment status to 'succeeded'
 * - Updates booking/delivery status to 'paid'
 * - Credits the driver's wallet with pending_balance
 */
export async function handlePaymentSucceeded(stripePaymentIntentId: string) {
  const payment = await prisma.payments.findUnique({
    where: { stripe_payment_intent_id: stripePaymentIntentId },
    include: {
      booking: { include: { trip: true } },
      delivery: { include: { trip: true } },
    },
  });

  if (!payment) {
    logger.warn(`Payment not found for PaymentIntent: ${stripePaymentIntentId}`);
    return;
  }

  if (payment.status === 'succeeded') {
    logger.info(`Payment ${payment.id} already succeeded, skipping`);
    return;
  }

  // 1. Update payment status to succeeded
  await prisma.payments.update({
    where: { id: payment.id },
    data: { status: 'succeeded' },
  });

  // 2. Determine driver and update booking/delivery status
  let driverId: bigint;
  let referenceId: bigint;
  let kind: 'booking' | 'delivery';

  if (payment.booking) {
    driverId = payment.booking.trip.driver_id;
    referenceId = payment.booking.id;
    kind = 'booking';

    await prisma.bookings.update({
      where: { id: payment.booking.id },
      data: { status: 'paid' },
    });
  } else if (payment.delivery) {
    driverId = payment.delivery.trip.driver_id;
    referenceId = payment.delivery.id;
    kind = 'delivery';

    await prisma.deliveries.update({
      where: { id: payment.delivery.id },
      data: { status: 'paid' },
    });
  } else {
    logger.warn(`Payment ${payment.id} has no booking or delivery`);
    return;
  }

  // 3. Compute fees using additive model:
  //    payment.amount = total charged to client (driver_price + platform_fee)
  //    We need to reverse-compute the driver price from the total.
  //    Since total = driver_price + fee(driver_price), we use the additive calculator
  //    which takes driver_price as input. We need to find driver_price from the booking/delivery.
  let driverPriceCents: number;

  if (kind === 'booking' && payment.booking) {
    // For bookings: driver price = seats * price_per_seat
    const pricePerSeat = Number(payment.booking.trip.price_per_seat);
    const seats = payment.booking.seats_requested;
    driverPriceCents = Math.round(pricePerSeat * seats * 100);
  } else if (kind === 'delivery' && payment.delivery) {
    // For deliveries: driver price = trip.parcel_base_price (amount_total on delivery before fees)
    // The delivery.amount_total stores the driver's base price
    driverPriceCents = Math.round(Number(payment.delivery.amount_total || 0) * 100);
  } else {
    // Fallback: use payment amount as gross (old behavior)
    driverPriceCents = Math.round(payment.amount.toNumber() * 100);
  }

  const fees = kind === 'booking'
    ? await computeBookingFeesAdditive(driverPriceCents)
    : await computeDeliveryFeesAdditive(driverPriceCents);

  // 4. Record in immutable ledger with commission split + update wallet cache
  // The driver receives driver_net_cents (= driver_price_cents, their full price)
  await recordPaymentWithFees(kind, referenceId, payment.id, driverId, fees);

  logger.info(
    `Payment ${payment.id} succeeded: total_client=${fees.gross_cents}c, fee=${fees.platform_fee_cents}c, driver_net=${fees.driver_net_cents}c → driver ${driverId}`,
  );

  // ─── Post-transaction: Send emails, invoice, create conversation (fire & forget) ───
  try {
    const payer = await prisma.users.findUnique({ where: { id: payment.payer_id } });
    if (!payer) return;

    const payerName = `${payer.first_name || ''} ${payer.last_name || ''}`.trim() || 'Client';
    const amountStr = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: payment.currency }).format(payment.amount.toNumber());
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });

    if (payment.booking) {
      const trip = payment.booking.trip;
      const departureDate = trip.departure_at.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      // Generate invoice PDF with fee breakdown
      const serviceFee = fees.platform_fee_cents / 100;
      const driverPrice = fees.driver_net_cents / 100;
      const invoicePdf = await generateInvoicePdf({
        invoiceNumber: `INV-${payment.id.toString().padStart(6, '0')}`,
        date: dateStr,
        customerName: payerName,
        customerEmail: payer.email,
        tripFrom: trip.from_city,
        tripTo: trip.to_city,
        departureDate,
        seats: payment.booking.seats_requested,
        pricePerSeat: Number(trip.price_per_seat),
        totalAmount: payment.amount.toNumber(),
        currency: payment.currency,
        paymentMethod: 'Carte bancaire (Stripe)',
        stripePaymentIntentId: payment.stripe_payment_intent_id || undefined,
        serviceFee,
        driverPrice,
      });

      // Send booking confirmation email
      sendBookingConfirmation(payer.email, {
        passengerName: payerName,
        tripFrom: trip.from_city,
        tripTo: trip.to_city,
        departureDate,
        seats: payment.booking.seats_requested,
        total: amountStr,
        bookingId: payment.booking.id.toString(),
      }).catch(e => logger.error('Failed to send booking confirmation email', { error: e.message }));

      // Send payment receipt with invoice
      sendPaymentReceipt(payer.email, {
        name: payerName,
        amount: amountStr,
        reference: `PAY-${payment.id.toString().padStart(6, '0')}`,
        tripFrom: trip.from_city,
        tripTo: trip.to_city,
        date: dateStr,
      }, invoicePdf).catch(e => logger.error('Failed to send payment receipt email', { error: e.message }));

      // Auto-create conversation for booking if not exists
      const existingConv = await prisma.conversations.findUnique({ where: { booking_id: payment.booking.id } });
      if (!existingConv) {
        await prisma.conversations.create({
          data: { booking_id: payment.booking.id },
        });
        logger.info(`Conversation created for booking ${payment.booking.id}`);
      }

    } else if (payment.delivery) {
      const trip = payment.delivery.trip;
      const departureDate = trip.departure_at.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      // Determine parcel size from the delivery's parcel (if available)
      let parcelSize = 'M';
      let parcelWeight: number | null = null;
      try {
        const parcel = await prisma.parcels.findFirst({ where: { id: payment.delivery.parcel_id } });
        if (parcel) {
          parcelSize = parcel.size_category;
          parcelWeight = parcel.weight_kg ? Number(parcel.weight_kg) : null;
        }
      } catch { /* ignore */ }

      const reference = `DEL-${payment.delivery.id}`;

      // Generate delivery-specific invoice PDF with fee breakdown
      const invoicePdf = await generateDeliveryInvoicePdf({
        invoiceNumber: reference,
        date: dateStr,
        customerName: payerName,
        customerEmail: payer.email,
        tripFrom: trip.from_city,
        tripTo: trip.to_city,
        departureDate,
        parcelSize,
        parcelWeight,
        totalAmount: payment.amount.toNumber(),
        currency: payment.currency,
        paymentMethod: 'Carte bancaire (Stripe)',
        stripePaymentIntentId: payment.stripe_payment_intent_id || undefined,
      });

      // Send delivery-specific payment receipt with invoice
      sendDeliveryPaymentReceipt(payer.email, {
        name: payerName,
        amount: amountStr,
        reference,
        tripFrom: trip.from_city,
        tripTo: trip.to_city,
        date: dateStr,
        parcelSize,
        deliveryId: payment.delivery.id.toString(),
      }, invoicePdf).catch(e => logger.error('Failed to send delivery payment receipt email', { error: e.message }));

      // Auto-create conversation for delivery if not exists
      const existingConv = await prisma.conversations.findUnique({ where: { delivery_id: payment.delivery.id } });
      if (!existingConv) {
        await prisma.conversations.create({
          data: { delivery_id: payment.delivery.id },
        });
        logger.info(`Conversation created for delivery ${payment.delivery.id}`);
      }
    }
  } catch (emailErr: any) {
    logger.error('Failed to send post-payment emails/invoice', { error: emailErr.message });
  }
}

/**
 * Confirm a payment by checking its status with Stripe.
 * Called by the frontend after stripe.confirmPayment() succeeds.
 * This ensures the DB is updated immediately without waiting for the webhook.
 */
export async function confirmPaymentByUser(paymentId: string, userId: string) {
  const payment = await prisma.payments.findUnique({
    where: { id: BigInt(paymentId) },
  });

  if (!payment) throw Errors.notFound('Payment');

  const userIdBig = BigInt(userId);
  if (payment.payer_id !== userIdBig) {
    throw Errors.forbidden('Not authorized');
  }

  // Already succeeded? Return early
  if (payment.status === 'succeeded') {
    return { status: 'succeeded', already_confirmed: true };
  }

  if (!payment.stripe_payment_intent_id) {
    throw Errors.badRequest('No Stripe PaymentIntent associated', 'NO_PAYMENT_INTENT');
  }

  // Check with Stripe
  const paymentIntent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);

  if (paymentIntent.status === 'succeeded') {
    // Trigger the same logic as the webhook
    await handlePaymentSucceeded(payment.stripe_payment_intent_id);
    return { status: 'succeeded', already_confirmed: false };
  } else if (paymentIntent.status === 'processing') {
    return { status: 'processing' };
  } else if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled') {
    await handlePaymentFailed(payment.stripe_payment_intent_id);
    return { status: 'failed' };
  }

  return { status: paymentIntent.status };
}

/**
 * Handle a failed payment (called from Stripe webhook).
 */
export async function handlePaymentFailed(stripePaymentIntentId: string) {
  const result = await prisma.payments.updateMany({
    where: {
      stripe_payment_intent_id: stripePaymentIntentId,
      status: { in: ['requires_payment', 'processing'] },
    },
    data: { status: 'failed' },
  });

  logger.info(`Payment failed for PI ${stripePaymentIntentId}, updated ${result.count} records`);
}
