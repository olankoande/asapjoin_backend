import { Request, Response, NextFunction } from 'express';
import * as tripsService from './trips.service';

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tripsService.createTrip(req.user!.userId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tripsService.updateTrip(req.user!.userId, req.params.id as string, req.body);
    res.json(result);
  } catch (err) { next(err); }
}

export async function publishHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tripsService.publishTrip(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}

export async function unpublishHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tripsService.unpublishTrip(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tripsService.getTrip(req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}

export async function searchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tripsService.searchTrips(req.query as any);
    res.json(result);
  } catch (err) { next(err); }
}
