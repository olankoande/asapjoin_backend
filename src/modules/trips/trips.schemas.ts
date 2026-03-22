import { z } from 'zod';

const idValue = z.union([z.string(), z.number(), z.bigint()]).transform((value) => String(value));
const optionalIdValue = z.union([z.string(), z.number(), z.bigint()]).transform((value) => String(value)).optional().nullable();

const tripLocationBaseSchema = z.object({
  point_id: optionalIdValue,
  address: z.string().trim().min(1).max(255).optional(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
});

const tripLocationSchema = tripLocationBaseSchema.superRefine((value, ctx) => {
  if (value.point_id) return;
  if (!value.address) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Address is required for custom locations', path: ['address'] });
  }
});

export const createTripSchema = z.object({
  vehicle_id: idValue,
  departure_city_id: optionalIdValue,
  arrival_city_id: optionalIdValue,
  departure: tripLocationSchema.optional(),
  arrival: tripLocationSchema.optional(),

  // Legacy payload compatibility
  origin_address: z.string().trim().min(1).max(500).optional(),
  origin_lat: z.number().min(-90).max(90).optional(),
  origin_lng: z.number().min(-180).max(180).optional(),
  destination_address: z.string().trim().min(1).max(500).optional(),
  destination_lat: z.number().min(-90).max(90).optional(),
  destination_lng: z.number().min(-180).max(180).optional(),

  departure_time: z.string().min(1),
  estimated_arrival: z.string().min(1).optional(),
  available_seats: z.number().int().min(1).max(50),
  price_per_seat: z.number().min(0),
  accepts_parcels: z.boolean().default(false),
  parcel_price: z.number().min(0).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  stops: z.array(z.object({
    address: z.string().min(1).max(500),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    stop_order: z.number().int().min(0),
  })).optional(),
}).superRefine((value, ctx) => {
  const structured = !!(value.departure_city_id && value.arrival_city_id && value.departure && value.arrival);
  const legacy = !!(value.origin_address && value.destination_address);

  if (!structured && !legacy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Trip requires either structured city/point fields or legacy origin/destination fields',
      path: ['departure_city_id'],
    });
  }
});

export const updateTripSchema = z.object({
  departure_city_id: optionalIdValue,
  arrival_city_id: optionalIdValue,
  departure: tripLocationBaseSchema.partial().optional(),
  arrival: tripLocationBaseSchema.partial().optional(),

  // Legacy payload compatibility
  origin_address: z.string().trim().min(1).max(500).optional(),
  origin_lat: z.number().min(-90).max(90).optional(),
  origin_lng: z.number().min(-180).max(180).optional(),
  destination_address: z.string().trim().min(1).max(500).optional(),
  destination_lat: z.number().min(-90).max(90).optional(),
  destination_lng: z.number().min(-180).max(180).optional(),

  departure_time: z.string().min(1).optional(),
  estimated_arrival: z.string().min(1).optional().nullable(),
  available_seats: z.number().int().min(1).max(50).optional(),
  price_per_seat: z.number().min(0).optional(),
  accepts_parcels: z.boolean().optional(),
  parcel_price: z.number().min(0).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const tripIdParam = z.object({
  id: z.string().min(1),
});

export const searchTripsQuery = z.object({
  origin_address: z.string().optional(),
  origin_lat: z.string().optional(),
  origin_lng: z.string().optional(),
  destination_address: z.string().optional(),
  destination_lat: z.string().optional(),
  destination_lng: z.string().optional(),
  date: z.string().optional(),
  seats: z.string().optional(),
  accepts_parcels: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type SearchTripsQuery = z.infer<typeof searchTripsQuery>;
