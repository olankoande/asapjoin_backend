import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { CreateTripInput, UpdateTripInput, SearchTripsQuery } from './trips.schemas';

const TRIP_INCLUDE = {
  driver: {
    select: { id: true, first_name: true, last_name: true, avatar_url: true, photo_url: true, created_at: true },
  },
  vehicle: true,
  stops: { orderBy: { stop_order: 'asc' as const } },
};

function transformTrip(trip: any) {
  if (!trip) return null;
  return {
    id: trip.id.toString(),
    driver_id: trip.driver_id.toString(),
    vehicle_id: trip.vehicle_id.toString(),
    origin_address: trip.from_address || trip.from_city,
    destination_address: trip.to_address || trip.to_city,
    departure_time: trip.departure_at ? trip.departure_at.toISOString() : new Date().toISOString(),
    estimated_arrival: null,
    available_seats: trip.seats_available,
    price_per_seat: Number(trip.price_per_seat),
    accepts_parcels: trip.accepts_parcels,
    parcel_price: trip.parcel_base_price ? Number(trip.parcel_base_price) : null,
    status: trip.status,
    notes: trip.rules_json,
    created_at: trip.created_at.toISOString(),
    origin_lat: 0,
    origin_lng: 0,
    destination_lat: 0,
    destination_lng: 0,
    driver: trip.driver ? {
      id: trip.driver.id.toString(),
      first_name: trip.driver.first_name,
      last_name: trip.driver.last_name,
      avatar_url: trip.driver.avatar_url || trip.driver.photo_url,
      created_at: trip.driver.created_at ? trip.driver.created_at.toISOString() : '',
    } : undefined,
    vehicle: trip.vehicle ? {
      id: trip.vehicle.id.toString(),
      make: trip.vehicle.make,
      model: trip.vehicle.model,
      color: trip.vehicle.color,
      plate: trip.vehicle.plate,
      year: trip.vehicle.year,
      seats_count: trip.vehicle.seats_count,
      has_ac: trip.vehicle.has_ac,
      notes: trip.vehicle.notes,
      created_at: trip.vehicle.created_at ? trip.vehicle.created_at.toISOString() : '',
    } : undefined,
  };
}

export async function createTrip(driverId: string, input: CreateTripInput) {
  const driverIdBig = BigInt(driverId);

  const vehicle = await prisma.vehicles.findUnique({ where: { id: BigInt(input.vehicle_id) } });
  if (!vehicle) throw Errors.notFound('Vehicle');
  if (vehicle.user_id !== driverIdBig) throw Errors.forbidden('You do not own this vehicle');

  const trip = await prisma.trips.create({
    data: {
      driver_id: driverIdBig,
      vehicle_id: BigInt(input.vehicle_id),
      from_city: input.origin_address,
      to_city: input.destination_address,
      from_address: input.origin_address,
      to_address: input.destination_address,
      departure_at: new Date(input.departure_time),
      seats_total: input.available_seats,
      seats_available: input.available_seats,
      price_per_seat: input.price_per_seat,
      accepts_parcels: input.accepts_parcels ?? false,
      parcel_base_price: input.parcel_price ?? null,
      status: 'draft',
    },
    include: TRIP_INCLUDE,
  });

  if (input.stops && input.stops.length > 0) {
    await prisma.trip_stops.createMany({
      data: input.stops.map((s) => ({
        trip_id: trip.id,
        city: s.address,
        address: s.address,
        stop_order: s.stop_order,
      })),
    });
  }

  const created = await prisma.trips.findUnique({ where: { id: trip.id }, include: TRIP_INCLUDE });
  return transformTrip(created);
}

export async function updateTrip(driverId: string, tripId: string, input: UpdateTripInput) {
  const trip = await prisma.trips.findUnique({ where: { id: BigInt(tripId) } });
  if (!trip) throw Errors.notFound('Trip');
  if (trip.driver_id !== BigInt(driverId)) throw Errors.forbidden('You do not own this trip');
  if (trip.status !== 'draft') throw Errors.badRequest('Can only edit draft trips', 'TRIP_NOT_DRAFT');

  const data: any = {};
  if (input.origin_address !== undefined) {
    data.from_city = input.origin_address;
    data.from_address = input.origin_address;
  }
  if (input.destination_address !== undefined) {
    data.to_city = input.destination_address;
    data.to_address = input.destination_address;
  }
  if (input.departure_time !== undefined) data.departure_at = new Date(input.departure_time);
  if (input.available_seats !== undefined) {
    data.seats_total = input.available_seats;
    data.seats_available = input.available_seats;
  }
  if (input.price_per_seat !== undefined) data.price_per_seat = input.price_per_seat;
  if (input.accepts_parcels !== undefined) data.accepts_parcels = input.accepts_parcels;
  if (input.parcel_price !== undefined) data.parcel_base_price = input.parcel_price;
  if (input.notes !== undefined) data.rules_json = input.notes;

  const updated = await prisma.trips.update({
    where: { id: BigInt(tripId) },
    data,
    include: TRIP_INCLUDE,
  });
  return transformTrip(updated);
}

export async function publishTrip(driverId: string, tripId: string) {
  const trip = await prisma.trips.findUnique({ where: { id: BigInt(tripId) } });
  if (!trip) throw Errors.notFound('Trip');
  if (trip.driver_id !== BigInt(driverId)) throw Errors.forbidden('You do not own this trip');
  if (trip.status !== 'draft') throw Errors.badRequest('Can only publish draft trips', 'TRIP_NOT_DRAFT');

  const published = await prisma.trips.update({
    where: { id: BigInt(tripId) },
    data: { status: 'published' },
    include: TRIP_INCLUDE,
  });
  return transformTrip(published);
}

export async function unpublishTrip(driverId: string, tripId: string) {
  const trip = await prisma.trips.findUnique({ where: { id: BigInt(tripId) } });
  if (!trip) throw Errors.notFound('Trip');
  if (trip.driver_id !== BigInt(driverId)) throw Errors.forbidden('You do not own this trip');
  if (trip.status !== 'published') throw Errors.badRequest('Can only unpublish published trips', 'TRIP_NOT_PUBLISHED');

  const unpublished = await prisma.trips.update({
    where: { id: BigInt(tripId) },
    data: { status: 'draft' },
    include: TRIP_INCLUDE,
  });
  return transformTrip(unpublished);
}

export async function getTrip(tripId: string) {
  const trip = await prisma.trips.findUnique({
    where: { id: BigInt(tripId) },
    include: TRIP_INCLUDE,
  });
  if (!trip) throw Errors.notFound('Trip');
  return transformTrip(trip);
}

export async function searchTrips(query: SearchTripsQuery) {
  const page = parseInt(query.page || '1', 10);
  const limit = Math.min(parseInt(query.limit || '20', 10), 100);
  const skip = (page - 1) * limit;

  const where: Prisma.tripsWhereInput = {
    status: 'published',
    departure_at: { gt: new Date() },
  };

  if (query.seats) {
    where.seats_available = { gte: parseInt(query.seats, 10) };
  }

  if (query.accepts_parcels === 'true') {
    where.accepts_parcels = true;
  }

  if (query.origin_address) {
    where.OR = [
      { from_city: { contains: query.origin_address } },
      { from_address: { contains: query.origin_address } },
    ];
  }

  if (query.destination_address) {
    const destConditions = [
      { to_city: { contains: query.destination_address } },
      { to_address: { contains: query.destination_address } },
    ];
    if (where.OR) {
      where.AND = [
        { OR: where.OR },
        { OR: destConditions },
      ];
      delete where.OR;
    } else {
      where.OR = destConditions;
    }
  }

  if (query.date) {
    const dateStart = new Date(query.date);
    const dateEnd = new Date(query.date);
    dateEnd.setDate(dateEnd.getDate() + 1);
    where.departure_at = { gte: dateStart, lt: dateEnd };
  }

  const [trips, total] = await Promise.all([
    prisma.trips.findMany({
      where,
      include: TRIP_INCLUDE,
      orderBy: { departure_at: 'asc' },
      skip,
      take: limit,
    }),
    prisma.trips.count({ where }),
  ]);

  const transformedTrips = trips.map(transformTrip);

  return {
    data: transformedTrips,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
