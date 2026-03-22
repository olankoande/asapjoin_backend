import { Request, Response, NextFunction } from 'express';
import * as googleAuthService from './googleAuthService';

export async function googleAuthHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await googleAuthService.authenticateWithGoogle(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
