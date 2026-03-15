import { Request, Response, NextFunction } from 'express';
import * as bookingsService from './bookings.service';

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.createBooking(req.user!.userId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.getBooking(req.params.id as string, req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getMyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.getMyBookings(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getDriverHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.getDriverBookings(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function acceptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.acceptBooking(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}

export async function rejectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.rejectBooking(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}

export async function cancelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await bookingsService.cancelBooking(req.user!.userId, req.params.id as string, req.body);
    res.json(result);
  } catch (err) { next(err); }
}
