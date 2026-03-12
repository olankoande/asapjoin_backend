import { Request, Response, NextFunction } from 'express';
import * as deliveriesService from './deliveries.service';

function getUserId(req: Request): string {
  return req.user!.userId;
}

function getParamId(req: Request): string {
  return req.params.id as string;
}

export async function preparePaymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await deliveriesService.prepareDeliveryPayment(getUserId(req), req.body);
    res.json(result);
  } catch (err) { next(err); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.createDelivery(getUserId(req), req.body);
    res.status(201).json(delivery);
  } catch (err) { next(err); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.getDelivery(getParamId(req));
    res.json(delivery);
  } catch (err) { next(err); }
}

export async function getMySentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const deliveries = await deliveriesService.getMyDeliveriesSent(getUserId(req));
    res.json(deliveries);
  } catch (err) { next(err); }
}

export async function getMyReceivedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const deliveries = await deliveriesService.getMyDeliveriesReceived(getUserId(req));
    res.json(deliveries);
  } catch (err) { next(err); }
}

export async function getDriverDeliveriesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const deliveries = await deliveriesService.getDriverDeliveries(getUserId(req));
    res.json(deliveries);
  } catch (err) { next(err); }
}

export async function acceptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.acceptDelivery(getUserId(req), getParamId(req));
    res.json(delivery);
  } catch (err) { next(err); }
}

export async function rejectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.rejectDelivery(getUserId(req), getParamId(req));
    res.json(delivery);
  } catch (err) { next(err); }
}

export async function markInTransitHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.markInTransit(getUserId(req), getParamId(req));
    res.json(delivery);
  } catch (err) { next(err); }
}

export async function markDeliveredHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.markDelivered(getUserId(req), getParamId(req));
    res.json(delivery);
  } catch (err) { next(err); }
}

export async function confirmReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const delivery = await deliveriesService.confirmReceipt(getUserId(req), getParamId(req));
    res.json(delivery);
  } catch (err) { next(err); }
}

export async function cancelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const reason = req.body?.reason;
    const delivery = await deliveriesService.cancelDelivery(getUserId(req), getParamId(req), reason);
    res.json(delivery);
  } catch (err) { next(err); }
}
