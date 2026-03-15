import { prisma } from '../db/prisma';

/**
 * Check if a Stripe event has already been processed (idempotency).
 * Returns true if already processed, false otherwise.
 */
export async function isStripeEventProcessed(stripeEventId: string): Promise<boolean> {
  const existing = await prisma.stripe_events.findUnique({
    where: { stripe_event_id: stripeEventId },
  });
  return !!existing;
}

/**
 * Record a Stripe event as processed.
 */
export async function recordStripeEvent(
  stripeEventId: string,
  eventType: string,
  payload: unknown
): Promise<void> {
  await prisma.stripe_events.create({
    data: {
      stripe_event_id: stripeEventId,
      type: eventType,
      payload_json: payload ? JSON.stringify(payload) : null,
    },
  });
}
