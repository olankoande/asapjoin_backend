import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middlewares/auth';
import { requireRole } from '../../middlewares/rbac';
import * as payoutsService from './payouts.service';

const router = Router();

router.get('/eligible', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.getEligible(req.query.asOfDate as string)); } catch (err) { next(err); }
});

router.post('/payout-batches', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await payoutsService.createBatch(req.user!.userId, req.body.user_ids)); } catch (err) { next(err); }
});

router.get('/payout-batches/:id', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.getBatch(req.params.id as string)); } catch (err) { next(err); }
});

router.post('/payout-batches/:id/execute', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.executeBatch(req.user!.userId, req.params.id as string)); } catch (err) { next(err); }
});

router.post('/payouts/:id/retry', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.retryPayout(req.user!.userId, req.params.id as string)); } catch (err) { next(err); }
});

router.post('/payouts/:id/mark-paid', authenticate, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.markPaid(req.user!.userId, req.params.id as string)); } catch (err) { next(err); }
});

export default router;
