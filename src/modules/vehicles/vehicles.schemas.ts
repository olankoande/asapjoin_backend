import { z } from 'zod';

export const createVehicleSchema = z.object({
  make: z.string().min(1).max(80),
  model: z.string().min(1).max(80),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  color: z.string().min(1).max(40).optional().nullable(),
  plate: z.string().min(1).max(40).optional().nullable(),
  seats_count: z.number().int().min(1).max(50).default(4),
  has_ac: z.boolean().default(false),
  notes: z.string().max(255).optional().nullable(),
});

export const updateVehicleSchema = createVehicleSchema.partial();

export const vehicleIdParam = z.object({
  id: z.string().min(1),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
