import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, checkNotBanned } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as contractsService from './contracts.service';

const router = Router();

const acceptContractSchema = z.object({
  version: z.string().trim().min(1),
});

router.get('/current', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await contractsService.getCurrentContract());
  } catch (err) {
    next(err);
  }
});

router.post('/accept', authenticate, checkNotBanned, validate({ body: acceptContractSchema }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await contractsService.acceptCurrentContract(req.user!.userId, req.body.version));
  } catch (err) {
    next(err);
  }
});

export default router;
