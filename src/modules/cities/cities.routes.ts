import { Router } from 'express';
import { authenticate, checkNotBanned, optionalAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import {
  cityIdParamSchema,
  createCityPointSchema,
  listCitiesQuerySchema,
  listCityPointsQuerySchema,
  searchCitiesQuerySchema,
} from './cities.schemas';
import * as ctrl from './cities.controller';

const router = Router();

router.get('/cities', optionalAuth, validate({ query: listCitiesQuerySchema }), ctrl.listCitiesHandler);
router.get('/cities/search', optionalAuth, validate({ query: searchCitiesQuerySchema }), ctrl.searchCitiesHandler);
router.get('/cities/:cityId/points', optionalAuth, validate({ params: cityIdParamSchema, query: listCityPointsQuerySchema }), ctrl.listCityPointsHandler);
router.post('/cities/:cityId/points', authenticate, checkNotBanned, validate({ params: cityIdParamSchema, body: createCityPointSchema }), ctrl.createCityPointHandler);

export default router;
