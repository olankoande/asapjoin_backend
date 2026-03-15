import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { createVehicleSchema, updateVehicleSchema, vehicleIdParam } from './vehicles.schemas';
import * as ctrl from './vehicles.controller';

const router = Router();

router.get('/', authenticate, checkNotBanned, ctrl.listHandler);
router.post('/', authenticate, checkNotBanned, validate({ body: createVehicleSchema }), ctrl.createHandler);
router.patch('/:id', authenticate, checkNotBanned, validate({ params: vehicleIdParam, body: updateVehicleSchema }), ctrl.updateHandler);
router.delete('/:id', authenticate, checkNotBanned, validate({ params: vehicleIdParam }), ctrl.deleteHandler);

export default router;
