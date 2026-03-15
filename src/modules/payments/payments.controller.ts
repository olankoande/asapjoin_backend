import { Request, Response, NextFunction } from 'express';
import * as paymentsService from './payments.service';

export async function createIntentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await paymentsService.createPaymentIntent(req.user!.userId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await paymentsService.getPayment(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function confirmHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await paymentsService.confirmPaymentByUser(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
}
