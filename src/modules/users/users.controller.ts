import { Request, Response, NextFunction } from 'express';
import * as usersService from './users.service';

export async function getMeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.getProfile(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateMeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await usersService.updateProfile(req.user!.userId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
