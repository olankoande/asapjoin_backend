import { z } from 'zod';

export const createTripSchema = z.object({
  vehicle_id: z.string().min(1),
  origin_address: z.string().min(1).max(500),
  origin_lat: z.number().min(-90).max(90),
  origin_lng: z.number().min(-180).max(180),
  destination_address: z.string().min(1).max(500),
  destination_lat: z.number().min(-90).max(90),
  destination_lng: z.number().min(-180).max(180),
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
});

export const updateTripSchema = z.object({
  origin_address: z.string().min(1).max(500).optional(),
  origin_lat: z.number().min(-90).max(90).optional(),
  origin_lng: z.number().min(-180).max(180).optional(),
  destination_address: z.string().min(1).max(500).optional(),
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
