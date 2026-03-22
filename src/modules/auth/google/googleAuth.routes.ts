import { Router } from 'express';
import { validate } from '../../../middlewares/validate';
import { authLimiter } from '../../../middlewares/rateLimit';
import { googleAuthSchema } from '../auth.schemas';
import { googleAuthHandler } from './googleAuthController';

const router = Router();

router.post('/google', authLimiter, validate({ body: googleAuthSchema }), googleAuthHandler);

export default router;
