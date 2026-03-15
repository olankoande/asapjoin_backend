import { Request, Response, NextFunction } from 'express';
import * as vehiclesService from './vehicles.service';

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await vehiclesService.listVehicles(req.user!.userId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await vehiclesService.createVehicle(req.user!.userId, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await vehiclesService.updateVehicle(req.user!.userId, req.params.id as string, req.body);
    res.json(result);
  } catch (err) { next(err); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await vehiclesService.deleteVehicle(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) { next(err); }
}
