import { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { isStripeEventProcessed, recordStripeEvent } from '../utils/idempotency';
import { handlePaymentSucceeded, handlePaymentFailed } from '../modules/payments/payments.service';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-04-30.basil' as any });

const router = Router();

/**
 * Stripe webhook endpoint.
 * IMPORTANT: This route must receive raw body (not parsed JSON).
 * The raw body middleware is configured in app.ts for this route.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  if (!sig) {
    logger.warn('Stripe webhook: missing signature');
    return res.status(400).json({ code: 'MISSING_SIGNATURE', message: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    logger.error('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).json({ code: 'INVALID_SIGNATURE', message: 'Invalid signature' });
  }

  // Idempotency check
  const alreadyProcessed = await isStripeEventProcessed(event.id);
  if (alreadyProcessed) {
    logger.info(`Stripe webhook: event ${event.id} already processed (idempotent)`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  logger.info(`Stripe webhook: processing event ${event.id} type=${event.type}`);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSucceeded(paymentIntent.id);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailed(paymentIntent.id);
        break;
      }

      default:
        logger.info(`Stripe webhook: unhandled event type ${event.type}`);
    }

    // Record event as processed (idempotency)
    await recordStripeEvent(event.id, event.type, event.data.object);

    return res.status(200).json({ received: true });
  } catch (err: any) {
    logger.error('Stripe webhook processing error', { error: err.message, eventId: event.id });
    // Still return 200 to prevent Stripe from retrying (we logged the error)
    // In production, you might want to return 500 for retries
    return res.status(500).json({ code: 'WEBHOOK_PROCESSING_ERROR', message: 'Error processing webhook' });
  }
});

export default router;
