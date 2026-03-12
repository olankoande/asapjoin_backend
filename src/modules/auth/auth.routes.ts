import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { authLimiter } from '../../middlewares/rateLimit';
import { registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schemas';
import * as ctrl from './auth.controller';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), ctrl.registerHandler);
router.post('/login', authLimiter, validate({ body: loginSchema }), ctrl.loginHandler);
router.post('/refresh', validate({ body: refreshSchema }), ctrl.refreshHandler);
router.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), ctrl.forgotPasswordHandler);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), ctrl.resetPasswordHandler);

export default router;
