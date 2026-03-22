import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { cityPointIdParamSchema, updateCityPointSchema } from './cityPoints.schemas';
import * as ctrl from './cityPoints.controller';

const router = Router();

router.patch('/city-points/:id', authenticate, checkNotBanned, validate({ params: cityPointIdParamSchema, body: updateCityPointSchema }), ctrl.updateCityPointHandler);
router.delete('/city-points/:id', authenticate, checkNotBanned, validate({ params: cityPointIdParamSchema }), ctrl.deleteCityPointHandler);

export default router;
