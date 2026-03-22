import { z } from 'zod';

const idValue = z.union([z.string(), z.number(), z.bigint()]).transform((value) => String(value));

export const listCitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const searchCitiesQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const cityIdParamSchema = z.object({
  cityId: idValue,
});

export const listCityPointsQuerySchema = z.object({
  q: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  type: z.enum(['station', 'airport', 'university', 'mall', 'downtown', 'custom']).optional(),
});

export const createCityPointSchema = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(255),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  point_type: z.enum(['station', 'airport', 'university', 'mall', 'downtown', 'custom']).default('custom'),
  popularity_score: z.number().int().min(0).max(100000).optional(),
  usage_count: z.number().int().min(0).max(100000).optional(),
});

export type ListCitiesQuery = z.infer<typeof listCitiesQuerySchema>;
export type SearchCitiesQuery = z.infer<typeof searchCitiesQuerySchema>;
export type ListCityPointsQuery = z.infer<typeof listCityPointsQuerySchema>;
export type CreateCityPointInput = z.infer<typeof createCityPointSchema>;
