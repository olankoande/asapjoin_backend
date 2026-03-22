import { Request, Response, NextFunction } from 'express';
import * as cityPointsService from './cityPoints.service';

export async function updateCityPointHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await cityPointsService.updateCityPoint(req.params.id as string, req.body);
    res.json(result);
  } catch (err) { next(err); }
}

export async function deleteCityPointHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await cityPointsService.deactivateCityPoint(req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}
