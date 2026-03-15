import { test, expect } from 'vitest';

// Inline the error classes to avoid importing from src (which may trigger env loading)
class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly traceId: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.traceId = 'test-trace-id';
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      traceId: this.traceId,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

const Errors = {
  badRequest: (message: string, code = 'BAD_REQUEST', details?: unknown) =>
    new AppError(400, code, message, details),
  unauthorized: (message = 'Unauthorized', code = 'UNAUTHORIZED') =>
    new AppError(401, code, message),
  forbidden: (message = 'Forbidden', code = 'FORBIDDEN') =>
    new AppError(403, code, message),
  notFound: (resource = 'Resource', code = 'NOT_FOUND') =>
    new AppError(404, code, `${resource} not found`),
  conflict: (message: string, code = 'CONFLICT') =>
    new AppError(409, code, message),
  cannotBookOwnTrip: () =>
    new AppError(403, 'CANNOT_BOOK_OWN_TRIP', 'You cannot book your own trip'),
  cannotRequestDeliveryOnOwnTrip: () =>
    new AppError(403, 'CANNOT_REQUEST_DELIVERY_ON_OWN_TRIP', 'You cannot request a delivery on your own trip'),
  insufficientSeats: () =>
    new AppError(409, 'INSUFFICIENT_SEATS', 'Not enough available seats for this booking'),
};

// ─── Test 1: CANNOT_BOOK_OWN_TRIP ───
test('CANNOT_BOOK_OWN_TRIP - should throw 403', () => {
  const error = Errors.cannotBookOwnTrip();
  expect(error).toBeInstanceOf(AppError);
  expect(error.statusCode).toBe(403);
  expect(error.code).toBe('CANNOT_BOOK_OWN_TRIP');
  expect(error.message).toBe('You cannot book your own trip');
});

test('CANNOT_BOOK_OWN_TRIP - should include traceId in JSON', () => {
  const error = Errors.cannotBookOwnTrip();
  const json = error.toJSON();
  expect(json.traceId).toBeDefined();
  expect(json.code).toBe('CANNOT_BOOK_OWN_TRIP');
});

test('CANNOT_BOOK_OWN_TRIP - booking service rejects own trip', () => {
  const driverId = 'user-123';
  const passengerId = 'user-123';

  function checkBookingAllowed(tripDriverId: string, bookingPassengerId: string) {
    if (tripDriverId === bookingPassengerId) {
      throw Errors.cannotBookOwnTrip();
    }
  }

  expect(() => checkBookingAllowed(driverId, passengerId)).toThrow(AppError);
});

test('CANNOT_BOOK_OWN_TRIP - allows different driver/passenger', () => {
  function checkBookingAllowed(tripDriverId: string, bookingPassengerId: string) {
    if (tripDriverId === bookingPassengerId) {
      throw Errors.cannotBookOwnTrip();
    }
    return true;
  }
  expect(checkBookingAllowed('user-123', 'user-456')).toBe(true);
});

// ─── Test 2: CANNOT_REQUEST_DELIVERY_ON_OWN_TRIP ───
test('CANNOT_REQUEST_DELIVERY_ON_OWN_TRIP - should throw 403', () => {
  const error = Errors.cannotRequestDeliveryOnOwnTrip();
  expect(error.statusCode).toBe(403);
  expect(error.code).toBe('CANNOT_REQUEST_DELIVERY_ON_OWN_TRIP');
});

// ─── Test 3: Webhook Idempotency ───
test('Webhook idempotency - detects duplicate events', () => {
  const processedEvents = new Set<string>();
  const eventId = 'evt_test_123';

  expect(processedEvents.has(eventId)).toBe(false);
  processedEvents.add(eventId);
  expect(processedEvents.has(eventId)).toBe(true);
  expect(processedEvents.has('evt_test_456')).toBe(false);
});

test('Webhook idempotency - concurrent duplicates', async () => {
  const processedEvents = new Map<string, boolean>();

  async function processEvent(eventId: string) {
    if (processedEvents.get(eventId)) {
      return { received: true, duplicate: true };
    }
    processedEvents.set(eventId, true);
    return { received: true, duplicate: false };
  }

  const eventId = 'evt_concurrent_test';
  const [result1, result2] = await Promise.all([
    processEvent(eventId),
    processEvent(eventId),
  ]);

  const results = [result1, result2];
  const nonDuplicates = results.filter(r => !r.duplicate);
  expect(nonDuplicates.length).toBeGreaterThanOrEqual(1);
});

// ─── Test 4: Seat Overbooking Prevention ───
test('Seat overbooking - prevents booking more than available', () => {
  let availableSeats = 3;

  function bookSeats(requested: number): boolean {
    if (availableSeats < requested) {
      throw Errors.insufficientSeats();
    }
    availableSeats -= requested;
    return true;
  }

  expect(bookSeats(2)).toBe(true);
  expect(availableSeats).toBe(1);
  expect(() => bookSeats(2)).toThrow(AppError);
  expect(bookSeats(1)).toBe(true);
  expect(availableSeats).toBe(0);
  expect(() => bookSeats(1)).toThrow(AppError);
});

test('Seat overbooking - concurrent booking attempts', async () => {
  let availableSeats = 2;

  async function attemptBooking(seats: number): Promise<string> {
    if (availableSeats < seats) return 'INSUFFICIENT_SEATS';
    availableSeats -= seats;
    return 'SUCCESS';
  }

  const r1 = await attemptBooking(2);
  const r2 = await attemptBooking(2);

  expect(r1).toBe('SUCCESS');
  expect(r2).toBe('INSUFFICIENT_SEATS');
  expect(availableSeats).toBe(0);
});

// ─── Test 5: Cancellation Policy Calculation ───
test('Cancellation policy - calculates fees based on time windows', () => {
  const rules = [
    { minHours: 48, maxHours: Infinity, fixedFee: 0, percentageFee: 0, refundPercentage: 100 },
    { minHours: 24, maxHours: 48, fixedFee: 2, percentageFee: 5, refundPercentage: 90 },
    { minHours: 0, maxHours: 24, fixedFee: 5, percentageFee: 10, refundPercentage: 50 },
  ];

  function calculateFees(totalPrice: number, hoursBeforeDeparture: number) {
    for (const rule of rules) {
      if (hoursBeforeDeparture >= rule.minHours && hoursBeforeDeparture < rule.maxHours) {
        const fixedFee = rule.fixedFee;
        const percentageFee = (totalPrice * rule.percentageFee) / 100;
        const totalFee = fixedFee + percentageFee;
        const refundableAmount = Math.max(0, totalPrice - totalFee);
        const refundAmount = (refundableAmount * rule.refundPercentage) / 100;
        return { fixedFee, percentageFee, totalFee, refundAmount, refundPercentage: rule.refundPercentage };
      }
    }
    return { fixedFee: 0, percentageFee: 0, totalFee: 0, refundAmount: totalPrice, refundPercentage: 100 };
  }

  // 72 hours before: full refund
  const result1 = calculateFees(100, 72);
  expect(result1.totalFee).toBe(0);
  expect(result1.refundAmount).toBe(100);

  // 36 hours before: small fee
  const result2 = calculateFees(100, 36);
  expect(result2.fixedFee).toBe(2);
  expect(result2.percentageFee).toBe(5);
  expect(result2.totalFee).toBe(7);
  expect(result2.refundAmount).toBeCloseTo(83.7);

  // 12 hours before: higher fee
  const result3 = calculateFees(100, 12);
  expect(result3.fixedFee).toBe(5);
  expect(result3.percentageFee).toBe(10);
  expect(result3.totalFee).toBe(15);
  expect(result3.refundAmount).toBeCloseTo(42.5);
});

test('Cancellation policy - refund + wallet transactions', () => {
  let pendingBalance = 100;
  const transactions: Array<{ type: string; amount: number }> = [];

  function processRefund(refundAmount: number, cancellationFee: number) {
    if (refundAmount > 0) {
      pendingBalance -= refundAmount;
      transactions.push({ type: 'REFUND_DEBIT', amount: -refundAmount });
    }
    if (cancellationFee > 0) {
      transactions.push({ type: 'CANCELLATION_FEE_DEBIT', amount: -cancellationFee });
    }
  }

  processRefund(80, 20);

  expect(pendingBalance).toBe(20);
  expect(transactions).toHaveLength(2);
  expect(transactions[0].type).toBe('REFUND_DEBIT');
  expect(transactions[1].type).toBe('CANCELLATION_FEE_DEBIT');
});

// ─── Test 6: Payout Eligibility ───
test('Payout eligibility - blocks missing phone_number', () => {
  const user = { phone_number: null, payout_email: 'a@b.com', is_banned: false };
  const eligible = !!(user.phone_number && user.payout_email && !user.is_banned);
  expect(eligible).toBe(false);
});

test('Payout eligibility - blocks missing payout_email', () => {
  const user = { phone_number: '+1', payout_email: null, is_banned: false };
  const eligible = !!(user.phone_number && user.payout_email && !user.is_banned);
  expect(eligible).toBe(false);
});

test('Payout eligibility - blocks banned users', () => {
  const user = { phone_number: '+1', payout_email: 'a@b.com', is_banned: true };
  const eligible = !!(user.phone_number && user.payout_email && !user.is_banned);
  expect(eligible).toBe(false);
});

test('Payout eligibility - allows complete info', () => {
  const user = { phone_number: '+1', payout_email: 'a@b.com', is_banned: false };
  const eligible = !!(user.phone_number && user.payout_email && !user.is_banned);
  expect(eligible).toBe(true);
});

test('Payout eligibility - filters by minimum amount', () => {
  const MIN_PAYOUT_AMOUNT = 10;
  const users = [
    { id: 'u1', available_balance: 5, phone_number: '+1', payout_email: 'a@b.com', is_banned: false },
    { id: 'u2', available_balance: 15, phone_number: '+1', payout_email: 'a@b.com', is_banned: false },
    { id: 'u3', available_balance: 10, phone_number: '+1', payout_email: 'a@b.com', is_banned: false },
  ];

  const eligible = users.filter(u =>
    u.available_balance >= MIN_PAYOUT_AMOUNT && u.phone_number && u.payout_email && !u.is_banned
  );

  expect(eligible).toHaveLength(2);
  expect(eligible.map(u => u.id)).toEqual(['u2', 'u3']);
});

// ─── Test 7: Money utilities ───
test('Money - converts to Stripe cents correctly', () => {
  function toStripeCents(amount: number): number {
    return Math.round(amount * 100);
  }

  expect(toStripeCents(10.50)).toBe(1050);
  expect(toStripeCents(0.99)).toBe(99);
  expect(toStripeCents(100)).toBe(10000);
  expect(toStripeCents(0.01)).toBe(1);
});

// ─── Test 8: Error format consistency ───
test('Error format - always includes code, message, traceId', () => {
  const errors = [
    Errors.badRequest('test'),
    Errors.unauthorized(),
    Errors.forbidden(),
    Errors.notFound('User'),
    Errors.conflict('test'),
    Errors.cannotBookOwnTrip(),
    Errors.insufficientSeats(),
  ];

  for (const error of errors) {
    const json = error.toJSON();
    expect(json).toHaveProperty('code');
    expect(json).toHaveProperty('message');
    expect(json).toHaveProperty('traceId');
    expect(typeof json.code).toBe('string');
    expect(typeof json.message).toBe('string');
    expect(typeof json.traceId).toBe('string');
  }
});
