import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { CreateBookingInput, CancelBookingInput } from './bookings.schemas';
import { createPaymentIntentForBooking } from '../payments/payments.service';
import { getOrCreateBookingConversation, addBookingSystemMessage } from '../messaging/messaging.service';
import { logger } from '../../config/logger';
import { sendCancellationEmail } from '../notifications/emailService';
import { computeBookingFeesAdditive } from '../fees/feeCalculator';

const BOOKING_INCLUDE = {
  trip: {
    include: {
      driver: { select: { id: true, first_name: true, last_name: true } },
    },
  },
  passenger: { select: { id: true, first_name: true, last_name: true } },
  payments: true,
};

/**
 * Create a booking with immediate payment.
 * The booking is created with status 'pending_payment' and a Stripe PaymentIntent
 * is created simultaneously. The booking is only confirmed when payment succeeds (via webhook).
 */
export async function createBooking(passengerId: string, input: CreateBookingInput) {
  const tripIdBig = BigInt(input.trip_id);
  const passengerIdBig = BigInt(passengerId);
  const seatsRequested = input.seats_booked ?? 1;

  // Step 1: Create booking + lock seats in a transaction
  const booking = await prisma.$transaction(async (tx) => {
    // Lock the trip row with FOR UPDATE to prevent concurrent overbooking
    const trips: any[] = await tx.$queryRawUnsafe(
      'SELECT * FROM trips WHERE id = ? FOR UPDATE',
      tripIdBig
    );

    if (trips.length === 0) throw Errors.notFound('Trip');
    const trip = trips[0];

    // Business rule: cannot book own trip
    if (trip.driver_id === passengerIdBig) {
      throw Errors.cannotBookOwnTrip();
    }

    // Trip must be published
    if (trip.status !== 'published') {
      throw Errors.tripNotPublished();
    }

    // Check available seats (column is seats_available in DB)
    if (trip.seats_available < seatsRequested) {
      throw Errors.insufficientSeats();
    }

    // Calculate total price with platform fees
    const pricePerSeat = Number(trip.price_per_seat);
    const driverPrice = pricePerSeat * seatsRequested;
    const driverPriceCents = Math.round(driverPrice * 100);

    // Compute additive fees: client pays driver_price + platform_fee
    const feesBreakdown = await computeBookingFeesAdditive(driverPriceCents);
    const totalClientDollars = feesBreakdown.total_client_cents / 100;

    // Decrement available seats (reserved while payment is pending)
    await tx.$executeRawUnsafe(
      'UPDATE trips SET seats_available = seats_available - ? WHERE id = ?',
      seatsRequested,
      tripIdBig
    );

    // Create booking with amount_total = total charged to client (driver price + platform fee)
    const newBooking = await tx.bookings.create({
      data: {
        trip_id: tripIdBig,
        passenger_id: passengerIdBig,
        seats_requested: seatsRequested,
        amount_total: totalClientDollars,
        status: 'pending',
      },
      include: {
        ...BOOKING_INCLUDE,
        trip: {
          include: {
            driver: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });

    return newBooking;
  }, {
    isolationLevel: 'Serializable',
    timeout: 10000,
  });

  // Step 2: Create Stripe PaymentIntent for this booking
  try {
    const paymentResult = await createPaymentIntentForBooking(
      passengerId,
      booking.id,
      booking.trip.driver_id,
      Number(booking.amount_total),
    );

    logger.info(`Booking ${booking.id} created with PaymentIntent ${paymentResult.stripe_payment_intent_id}`);

    // Step 3: Create conversation between driver and passenger (fire & forget)
    try {
      await getOrCreateBookingConversation(
        booking.id,
        booking.trip.driver_id,
        passengerIdBig,
        passengerIdBig,
      );
      await addBookingSystemMessage(booking.id, `Nouvelle réservation de ${booking.seats_requested} place(s) créée.`);
    } catch (convErr: any) {
      logger.error(`Failed to create conversation for booking ${booking.id}: ${convErr.message}`);
    }

    return {
      ...booking,
      client_secret: paymentResult.client_secret,
      payment_id: paymentResult.payment_id,
    };
  } catch (err: any) {
    // If PaymentIntent creation fails, restore seats and cancel booking
    logger.error(`Failed to create PaymentIntent for booking ${booking.id}`, { error: err?.message });
    await prisma.$transaction(async (tx) => {
      await tx.trips.update({
        where: { id: booking.trip_id },
        data: { seats_available: { increment: booking.seats_requested } },
      });
      await tx.bookings.update({
        where: { id: booking.id },
        data: { status: 'cancelled', cancel_reason: 'Payment initialization failed' },
      });
    });
    throw err;
  }
}

export async function getBooking(bookingId: string, userId: string) {
  const booking = await prisma.bookings.findUnique({
    where: { id: BigInt(bookingId) },
    include: BOOKING_INCLUDE,
  });

  if (!booking) throw Errors.notFound('Booking');

  const userIdBig = BigInt(userId);
  if (booking.passenger_id !== userIdBig && booking.trip.driver_id !== userIdBig) {
    throw Errors.forbidden('You are not authorized to view this booking');
  }

  return booking;
}

export async function getMyBookings(passengerId: string) {
  return prisma.bookings.findMany({
    where: { passenger_id: BigInt(passengerId) },
    include: BOOKING_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
}

export async function getDriverBookings(driverId: string) {
  return prisma.bookings.findMany({
    where: { trip: { driver_id: BigInt(driverId) } },
    include: BOOKING_INCLUDE,
    orderBy: { created_at: 'desc' },
  });
}

export async function acceptBooking(driverId: string, bookingId: string) {
  const booking = await prisma.bookings.findUnique({
    where: { id: BigInt(bookingId) },
    include: { trip: true },
  });

  if (!booking) throw Errors.notFound('Booking');
  if (booking.trip.driver_id !== BigInt(driverId)) throw Errors.forbidden('You are not the driver of this trip');
  if (booking.status !== 'pending') throw Errors.badRequest('Booking is not pending', 'BOOKING_NOT_PENDING');

  return prisma.bookings.update({
    where: { id: BigInt(bookingId) },
    data: { status: 'accepted' },
    include: BOOKING_INCLUDE,
  });
}

export async function rejectBooking(driverId: string, bookingId: string) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.bookings.findUnique({
      where: { id: BigInt(bookingId) },
      include: { trip: true },
    });

    if (!booking) throw Errors.notFound('Booking');
    if (booking.trip.driver_id !== BigInt(driverId)) throw Errors.forbidden('You are not the driver of this trip');
    if (booking.status !== 'pending') throw Errors.badRequest('Booking is not pending', 'BOOKING_NOT_PENDING');

    // Restore seats
    await tx.trips.update({
      where: { id: booking.trip_id },
      data: { seats_available: { increment: booking.seats_requested } },
    });

    return tx.bookings.update({
      where: { id: BigInt(bookingId) },
      data: { status: 'rejected' },
      include: BOOKING_INCLUDE,
    });
  });
}

export async function cancelBooking(userId: string, bookingId: string, input?: CancelBookingInput) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.bookings.findUnique({
      where: { id: BigInt(bookingId) },
      include: { trip: true, payments: true },
    });

    if (!booking) throw Errors.notFound('Booking');

    const userIdBig = BigInt(userId);
    const isPassenger = booking.passenger_id === userIdBig;
    const isDriver = booking.trip.driver_id === userIdBig;

    if (!isPassenger && !isDriver) {
      throw Errors.forbidden('You are not authorized to cancel this booking');
    }

    if (['cancelled', 'rejected', 'completed'].includes(booking.status)) {
      throw Errors.alreadyCancelled();
    }

    // Restore seats
    await tx.trips.update({
      where: { id: booking.trip_id },
      data: { seats_available: { increment: booking.seats_requested } },
    });

    const updated = await tx.bookings.update({
      where: { id: BigInt(bookingId) },
      data: {
        status: 'cancelled',
        cancel_reason: input?.reason || null,
      },
      include: BOOKING_INCLUDE,
    });

    // Send cancellation email (fire & forget, outside transaction)
    const bookingData = updated;
    setTimeout(async () => {
      try {
        const passenger = await prisma.users.findUnique({ where: { id: bookingData.passenger_id } });
        if (passenger) {
          const departureDate = bookingData.trip.departure_at.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
          sendCancellationEmail(passenger.email, {
            name: `${passenger.first_name || ''} ${passenger.last_name || ''}`.trim(),
            tripFrom: bookingData.trip.from_city,
            tripTo: bookingData.trip.to_city,
            departureDate,
            reason: input?.reason || undefined,
          }).catch(e => logger.error('Failed to send cancellation email', { error: e.message }));
        }
      } catch (e: any) { logger.error('Email error in cancelBooking', { error: e.message }); }
    }, 0);

    return updated;
  });
}
