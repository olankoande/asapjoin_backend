import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  booking_id: z.string().min(1).optional(),
  delivery_id: z.string().min(1).optional(),
}).refine((data) => data.booking_id || data.delivery_id, {
  message: 'Either booking_id or delivery_id must be provided',
});

export const paymentIdParam = z.object({
  id: z.string().min(1),
});

export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
