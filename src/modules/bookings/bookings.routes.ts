import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { createBookingSchema, bookingIdParam, cancelBookingSchema } from './bookings.schemas';
import * as ctrl from './bookings.controller';

const router = Router();

router.post('/', authenticate, checkNotBanned, validate({ body: createBookingSchema }), ctrl.createHandler);
router.get('/:id', authenticate, checkNotBanned, validate({ params: bookingIdParam }), ctrl.getHandler);
router.patch('/:id/accept', authenticate, checkNotBanned, validate({ params: bookingIdParam }), ctrl.acceptHandler);
router.patch('/:id/reject', authenticate, checkNotBanned, validate({ params: bookingIdParam }), ctrl.rejectHandler);
router.patch('/:id/cancel', authenticate, checkNotBanned, validate({ params: bookingIdParam, body: cancelBookingSchema }), ctrl.cancelHandler);

export default router;
