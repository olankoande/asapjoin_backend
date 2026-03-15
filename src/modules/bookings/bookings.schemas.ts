import { z } from 'zod';

export const createBookingSchema = z.object({
  trip_id: z.string().min(1),
  seats_booked: z.number().int().min(1).max(50).default(1),
});

export const bookingIdParam = z.object({
  id: z.string().min(1),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;
