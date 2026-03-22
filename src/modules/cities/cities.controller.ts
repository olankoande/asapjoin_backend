import { Request, Response, NextFunction } from 'express';
import * as citiesService from './cities.service';
import * as cityPointsService from '../cityPoints/cityPoints.service';

export async function listCitiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await citiesService.listCities(req.query as any);
    res.json(result);
  } catch (err) { next(err); }
}

export async function searchCitiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await citiesService.searchCities(req.query as any);
    res.json(result);
  } catch (err) { next(err); }
}

export async function listCityPointsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await cityPointsService.listCityPoints(req.params.cityId as string, req.query as any);
    res.json(result);
  } catch (err) { next(err); }
}

export async function createCityPointHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await cityPointsService.createCityPoint(req.params.cityId as string, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
}
