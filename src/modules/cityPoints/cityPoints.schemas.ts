import { z } from 'zod';

const idValue = z.union([z.string(), z.number(), z.bigint()]).transform((value) => String(value));

export const cityPointIdParamSchema = z.object({
  id: idValue,
});

export const updateCityPointSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  address: z.string().trim().min(1).max(255).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  point_type: z.enum(['station', 'airport', 'university', 'mall', 'downtown', 'custom']).optional(),
  popularity_score: z.number().int().min(0).max(100000).optional(),
  usage_count: z.number().int().min(0).max(100000).optional(),
  is_active: z.boolean().optional(),
});

export type UpdateCityPointInput = z.infer<typeof updateCityPointSchema>;
