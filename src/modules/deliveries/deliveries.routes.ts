import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { prepareDeliveryPaymentBody, createDeliveryBody, deliveryIdParam, cancelDeliveryBody } from './deliveries.schemas';
import * as ctrl from './deliveries.controller';

const router = Router();

// List my sent deliveries
router.get('/sent', authenticate, checkNotBanned, ctrl.getMySentHandler);

// List my received deliveries
router.get('/received', authenticate, checkNotBanned, ctrl.getMyReceivedHandler);

// List deliveries for my trips (driver)
router.get('/driver', authenticate, checkNotBanned, ctrl.getDriverDeliveriesHandler);

// Step 1: Prepare payment (validates rules, creates Stripe PaymentIntent, does NOT create delivery)
router.post('/prepare-payment', authenticate, checkNotBanned, validate({ body: prepareDeliveryPaymentBody }), ctrl.preparePaymentHandler);

// Step 2: Create delivery (requires stripe_payment_intent_id if amount > 0)
router.post('/', authenticate, checkNotBanned, validate({ body: createDeliveryBody }), ctrl.createHandler);

// Get delivery by id
router.get('/:id', authenticate, checkNotBanned, validate({ params: deliveryIdParam }), ctrl.getHandler);

// Driver actions
router.post('/:id/accept', authenticate, checkNotBanned, validate({ params: deliveryIdParam }), ctrl.acceptHandler);
router.post('/:id/reject', authenticate, checkNotBanned, validate({ params: deliveryIdParam }), ctrl.rejectHandler);
router.post('/:id/in-transit', authenticate, checkNotBanned, validate({ params: deliveryIdParam }), ctrl.markInTransitHandler);
router.post('/:id/delivered', authenticate, checkNotBanned, validate({ params: deliveryIdParam }), ctrl.markDeliveredHandler);

// Recipient confirms receipt
router.post('/:id/confirm-receipt', authenticate, checkNotBanned, validate({ params: deliveryIdParam }), ctrl.confirmReceiptHandler);

// Cancel delivery
router.post('/:id/cancel', authenticate, checkNotBanned, validate({ params: deliveryIdParam, body: cancelDeliveryBody }), ctrl.cancelHandler);

export default router;
