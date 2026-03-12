import { v4 as uuidv4 } from 'uuid';

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly traceId: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.traceId = uuidv4();
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

// Common errors
export const Errors = {
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
  tooMany: (message = 'Too many requests', code = 'RATE_LIMIT_EXCEEDED') =>
    new AppError(429, code, message),
  internal: (message = 'Internal server error', code = 'INTERNAL_ERROR') =>
    new AppError(500, code, message),

  // Business errors
  cannotBookOwnTrip: () =>
    new AppError(403, 'CANNOT_BOOK_OWN_TRIP', 'You cannot book your own trip'),
  cannotRequestDeliveryOnOwnTrip: () =>
    new AppError(403, 'CANNOT_REQUEST_DELIVERY_ON_OWN_TRIP', 'You cannot request a delivery on your own trip'),
  tripDoesNotAcceptParcels: () =>
    new AppError(400, 'TRIP_DOES_NOT_ACCEPT_PARCELS', 'This trip does not accept parcels'),
  insufficientSeats: () =>
    new AppError(409, 'INSUFFICIENT_SEATS', 'Not enough available seats for this booking'),
  tripNotPublished: () =>
    new AppError(400, 'TRIP_NOT_PUBLISHED', 'Trip is not published'),
  alreadyCancelled: () =>
    new AppError(400, 'ALREADY_CANCELLED', 'This item has already been cancelled'),
  paymentRequired: () =>
    new AppError(402, 'PAYMENT_REQUIRED', 'Payment is required'),
  webhookAlreadyProcessed: () =>
    new AppError(200, 'WEBHOOK_ALREADY_PROCESSED', 'This webhook event has already been processed'),
  missingPayoutInfo: () =>
    new AppError(400, 'MISSING_PAYOUT_INFO', 'User is missing phone_number or payout_email'),
  userBanned: () =>
    new AppError(403, 'USER_BANNED', 'This account has been banned'),
  notDeliveryRecipient: () =>
    new AppError(403, 'NOT_DELIVERY_RECIPIENT', 'Only the recipient can confirm receipt'),
  deliveryNotDeliveredYet: () =>
    new AppError(409, 'DELIVERY_NOT_DELIVERED_YET', 'Delivery must be in delivered status before confirming receipt'),
  invalidRecipient: () =>
    new AppError(400, 'INVALID_RECIPIENT', 'A valid recipient user is required'),
  notTripDriver: () =>
    new AppError(403, 'NOT_TRIP_DRIVER', 'Only the trip driver can perform this action'),
  deliveryTooLateBeforeDeparture: () =>
    new AppError(409, 'DELIVERY_TOO_LATE_BEFORE_DEPARTURE', 'Too close to departure time to create or accept this delivery'),
  parcelNotAllowed: (reason?: string) =>
    new AppError(409, 'PARCEL_NOT_ALLOWED', reason || 'This parcel does not meet the trip requirements'),
};
