import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { strictLimiter } from '../../middlewares/rateLimit';
import { createPaymentIntentSchema, paymentIdParam } from './payments.schemas';
import * as ctrl from './payments.controller';

const router = Router();

router.post('/intent', authenticate, checkNotBanned, strictLimiter, validate({ body: createPaymentIntentSchema }), ctrl.createIntentHandler);
router.post('/:id/confirm', authenticate, checkNotBanned, validate({ params: paymentIdParam }), ctrl.confirmHandler);
router.get('/:id', authenticate, checkNotBanned, validate({ params: paymentIdParam }), ctrl.getHandler);

export default router;
