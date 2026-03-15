import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';

const createReviewSchema = z.object({
  target_user_id: z.string().uuid(),
  booking_id: z.string().optional(),
  delivery_id: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

const router = Router();

// POST /reviews
router.post('/', authenticate, checkNotBanned, validate({ body: createReviewSchema }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reviewerId = req.user!.userId;
    const { target_user_id, booking_id, delivery_id, rating, comment } = req.body;

    if (reviewerId === target_user_id) {
      throw Errors.badRequest('Cannot review yourself', 'CANNOT_REVIEW_SELF');
    }

    const review = await prisma.reviews.create({
      data: {
        author_id: BigInt(reviewerId),
        target_user_id: BigInt(target_user_id),
        booking_id: booking_id ? BigInt(booking_id) : null,
        delivery_id: delivery_id ? BigInt(delivery_id) : null,
        rating,
        comment: comment || null,
      },
      include: {
        users_reviews_author_idTousers: { select: { id: true, first_name: true, last_name: true } },
      },
    });

    res.status(201).json(review);
  } catch (err) { next(err); }
});

// GET /users/:id/reviews
router.get('/users/:id/reviews', async (req: Request, res: Response, next: NextFunction) => {
  try {
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

export default router;
