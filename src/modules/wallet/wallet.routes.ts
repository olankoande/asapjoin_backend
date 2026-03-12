import { Router } from 'express';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import * as walletService from './wallet.service';
import { Request, Response, NextFunction } from 'express';

const router = Router();

router.get('/', authenticate, checkNotBanned, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await walletService.getWallet(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/transactions', authenticate, checkNotBanned, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '50', 10);
    const result = await walletService.getTransactions(req.user!.userId, page, limit);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
