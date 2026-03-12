import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'js-yaml';
import fs from 'fs';

import { env } from './config/env';
import { generalLimiter } from './middlewares/rateLimit';
import { errorHandler } from './middlewares/errorHandler';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import vehiclesRoutes from './modules/vehicles/vehicles.routes';
import tripsRoutes from './modules/trips/trips.routes';
import bookingsRoutes from './modules/bookings/bookings.routes';
import deliveriesRoutes from './modules/deliveries/deliveries.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import walletRoutes from './modules/wallet/wallet.routes';
import policiesRoutes from './modules/policies/policies.routes';
import payoutsRoutes from './modules/payouts/payouts.routes';
import messagingRoutes from './modules/messaging/messaging.routes';
import reviewsRoutes from './modules/reviews/reviews.routes';
import disputesRoutes from './modules/disputes/disputes.routes';
import adminRoutes from './modules/admin/admin.routes';
import cancellationsRoutes from './modules/cancellations/cancellations.routes';
import stripeWebhook from './webhooks/stripeWebhook';

// Bookings extra routes (me/bookings, me/driver/bookings)
import { authenticate, checkNotBanned } from './middlewares/auth';
import * as bookingsCtrl from './modules/bookings/bookings.controller';
import * as deliveriesCtrl from './modules/deliveries/deliveries.controller';

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

// Stripe webhook needs raw body - MUST be before json parser
app.use('/api/v1/stripe', express.raw({ type: 'application/json' }), stripeWebhook);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static assets (logo for emails, etc.)
app.use('/static', express.static(path.resolve(__dirname, '../public')));

// Rate limiting
app.use(generalLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
const v1 = '/api/v1';

app.use(`${v1}/auth`, authRoutes);
app.use(`${v1}`, usersRoutes);
app.use(`${v1}/vehicles`, vehiclesRoutes);
app.use(`${v1}/trips`, tripsRoutes);
app.use(`${v1}/bookings`, bookingsRoutes);
app.use(`${v1}/deliveries`, deliveriesRoutes);
app.use(`${v1}/payments`, paymentsRoutes);
app.use(`${v1}/me/wallet`, walletRoutes);
app.use(`${v1}/admin/policies/cancellation`, policiesRoutes);
app.use(`${v1}/admin`, payoutsRoutes);
app.use(`${v1}/conversations`, messagingRoutes);
app.use(`${v1}/reviews`, reviewsRoutes);
app.use(`${v1}/disputes`, disputesRoutes);
app.use(`${v1}`, adminRoutes); // /reports and /admin/reports
app.use(`${v1}`, cancellationsRoutes); // /bookings/:id/cancel-preview, /cancel, /admin/refund-policies, etc.

// Extra routes for me/bookings and me/driver/bookings
app.get(`${v1}/me/bookings`, authenticate, checkNotBanned, bookingsCtrl.getMyHandler);
app.get(`${v1}/me/driver/bookings`, authenticate, checkNotBanned, bookingsCtrl.getDriverHandler);
app.get(`${v1}/me/deliveries/sent`, authenticate, checkNotBanned, deliveriesCtrl.getMySentHandler);
app.get(`${v1}/me/deliveries/received`, authenticate, checkNotBanned, deliveriesCtrl.getMyReceivedHandler);
app.get(`${v1}/me/driver/deliveries`, authenticate, checkNotBanned, deliveriesCtrl.getDriverDeliveriesHandler);
app.post(`${v1}/deliveries/:id/confirm-receipt`, authenticate, checkNotBanned, deliveriesCtrl.confirmReceiptHandler);

// My disputes route
app.get(`${v1}/me/disputes`, authenticate, checkNotBanned, async (req, res, next) => {
  try {
    const { listMyDisputes } = await import('./modules/disputes/disputes.service');
    const disputes = await listMyDisputes(req.user!.userId);
    res.json(disputes);
  } catch (err) { next(err); }
});

// User reviews route
app.get(`${v1}/users/:id/reviews`, async (req, res, next) => {
  try {
    const { prisma } = await import('./db/prisma');
    const userId = req.params.id as string;
    const reviews = await prisma.reviews.findMany({
      where: { target_user_id: BigInt(userId) },
      include: {
        users_reviews_author_idTousers: { select: { id: true, first_name: true, last_name: true, avatar_url: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;
    res.json({ reviews, average_rating: Math.round(avgRating * 10) / 10, total: reviews.length });
  } catch (err) { next(err); }
});

// Swagger / OpenAPI
try {
  const openapiPath = path.resolve(__dirname, 'openapi/openapi.yaml');
  if (fs.existsSync(openapiPath)) {
    const openapiDoc = YAML.load(fs.readFileSync(openapiPath, 'utf8')) as Record<string, unknown>;
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));
    app.get('/openapi.json', (_req, res) => res.json(openapiDoc));
  }
} catch {
  // OpenAPI file not found, skip
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
