import { Router } from 'express';
import { authenticate, checkNotBanned, optionalAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { createTripSchema, updateTripSchema, tripIdParam, searchTripsQuery } from './trips.schemas';
import * as ctrl from './trips.controller';

const router = Router();

router.post('/', authenticate, checkNotBanned, validate({ body: createTripSchema }), ctrl.createHandler);
router.patch('/:id', authenticate, checkNotBanned, validate({ params: tripIdParam, body: updateTripSchema }), ctrl.updateHandler);
router.patch('/:id/publish', authenticate, checkNotBanned, validate({ params: tripIdParam }), ctrl.publishHandler);
router.patch('/:id/unpublish', authenticate, checkNotBanned, validate({ params: tripIdParam }), ctrl.unpublishHandler);
router.get('/search', validate({ query: searchTripsQuery }), ctrl.searchHandler);
router.get('/:id', validate({ params: tripIdParam }), ctrl.getHandler);

export default router;
