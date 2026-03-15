import { z } from 'zod';

/**
 * Body schema for POST /deliveries/prepare-payment
 * Validates all business rules and creates a Stripe PaymentIntent WITHOUT creating the delivery.
 */
export const prepareDeliveryPaymentBody = z.object({
  trip_id: z.string(),
  recipient_user_id: z.string().optional(),
  recipient_email: z.string().email().optional(),
  pickup_notes: z.string().max(500).optional(),
  dropoff_notes: z.string().max(500).optional(),
  parcel: z.object({
    size_category: z.enum(['XS', 'S', 'M', 'L']),
    weight_kg: z.number().positive().optional(),
    declared_value: z.number().nonnegative().optional(),
    instructions: z.string().max(500).optional(),
  }),
});

/**
 * Body schema for POST /deliveries
 * Creates the delivery. Requires stripe_payment_intent_id if trip has a parcel price > 0.
 */
export const createDeliveryBody = z.object({
  trip_id: z.string(),
  recipient_user_id: z.string().optional(),
  recipient_email: z.string().email().optional(),
  pickup_notes: z.string().max(500).optional(),
  dropoff_notes: z.string().max(500).optional(),
  stripe_payment_intent_id: z.string().optional(),
  parcel: z.object({
    size_category: z.enum(['XS', 'S', 'M', 'L']),
    weight_kg: z.number().positive().optional(),
    declared_value: z.number().nonnegative().optional(),
    instructions: z.string().max(500).optional(),
  }),
});

export const deliveryIdParam = z.object({
  id: z.string(),
});

export const cancelDeliveryBody = z.object({
  reason: z.string().max(255).optional(),
});

// Keep backward-compatible aliases for the old wrapped schemas
export const prepareDeliveryPaymentSchema = z.object({ body: prepareDeliveryPaymentBody });
export const createDeliverySchema = z.object({ body: createDeliveryBody });
export const updateDeliveryStatusSchema = z.object({ params: deliveryIdParam });
export const cancelDeliverySchema = z.object({ params: deliveryIdParam, body: cancelDeliveryBody });
export const confirmReceiptSchema = z.object({ params: deliveryIdParam });

export type CreateDeliveryInput = z.infer<typeof createDeliveryBody>;
export type CancelDeliveryInput = z.infer<typeof cancelDeliveryBody>;
