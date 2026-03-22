import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middlewares/auth';
import { requirePermission } from '../../middlewares/rbac';
import * as payoutsService from './payouts.service';

const router = Router();

router.get('/eligible', authenticate, requirePermission('payouts.read'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.getEligible(req.query.asOfDate as string)); } catch (err) { next(err); }
});

router.get('/payout-batches', authenticate, requirePermission('payouts.read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await payoutsService.listBatches({
      scheduled_for: req.query.scheduledFor as string | undefined,
      status: req.query.status as string | undefined,
    }));
  } catch (err) { next(err); }
});

router.get('/payouts', authenticate, requirePermission('payouts.read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await payoutsService.listPayouts({
      scheduled_for: req.query.scheduledFor as string | undefined,
      status: req.query.status as string | undefined,
    }));
  } catch (err) { next(err); }
});

router.post('/payout-batches', authenticate, requirePermission('payouts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.status(201).json(await payoutsService.createBatch(req.user!.userId, req.body)); } catch (err) { next(err); }
});

router.get('/payout-batches/:id', authenticate, requirePermission('payouts.read'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.getBatch(req.params.id as string)); } catch (err) { next(err); }
});

router.post('/payout-batches/:id/execute', authenticate, requirePermission('payouts.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.executeBatch(req.user!.userId, req.params.id as string)); } catch (err) { next(err); }
});

router.post('/payouts/:id/retry', authenticate, requirePermission('payouts.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.retryPayout(req.user!.userId, req.params.id as string)); } catch (err) { next(err); }
});

router.post('/payouts/:id/mark-paid', authenticate, requirePermission('payouts.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.markPaid(req.user!.userId, req.params.id as string, req.body?.providerReference)); } catch (err) { next(err); }
});

router.post('/payouts/:id/mark-failed', authenticate, requirePermission('payouts.execute'), async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await payoutsService.markFailed(req.user!.userId, req.params.id as string, req.body?.reason)); } catch (err) { next(err); }
});

export default router;
