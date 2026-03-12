import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { updateProfileSchema } from './users.schemas';
import * as ctrl from './users.controller';

const router = Router();

router.get('/me', authenticate, checkNotBanned, ctrl.getMeHandler);
router.patch('/me', authenticate, checkNotBanned, validate({ body: updateProfileSchema }), ctrl.updateMeHandler);

export default router;
