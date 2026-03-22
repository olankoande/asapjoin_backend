import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { authLimiter } from '../../middlewares/rateLimit';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } from './auth.schemas';
import * as ctrl from './auth.controller';
import googleAuthRoutes from './google/googleAuth.routes';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), ctrl.registerHandler);
router.post('/login', authLimiter, validate({ body: loginSchema }), ctrl.loginHandler);
router.use('/', googleAuthRoutes);
router.post('/refresh', validate({ body: refreshSchema }), ctrl.refreshHandler);
router.get('/me', authenticate, checkNotBanned, ctrl.meHandler);
router.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), ctrl.forgotPasswordHandler);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), ctrl.resetPasswordHandler);

export default router;
