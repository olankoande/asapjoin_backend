import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { assertCityExists, findOrCreateCityFromLegacyValue } from '../cities/cities.service';
import { getCityPointById, incrementPointUsage, pointBelongsToCity } from '../cityPoints/cityPoints.service';
import { geocodeAddress } from '../cityPoints/geocoding.service';
import { CreateTripInput, UpdateTripInput, SearchTripsQuery } from './trips.schemas';

const TRIP_INCLUDE = {
  driver: {
    select: { id: true, first_name: true, last_name: true, avatar_url: true, photo_url: true, created_at: true },
  },
  vehicle: true,
  stops: { orderBy: { stop_order: 'asc' as const } },
  departure_city: true,
  arrival_city: true,
  departure_point: true,
  arrival_point: true,
};

type TripLocationPayload = {
  point_id?: string | null;
  address?: string;
  lat?: number | null;
  lng?: number | null;
};

type StructuredTripPayload = {
  departure_city_id: string;
  arrival_city_id: string;
  departure: TripLocationPayload;
  arrival: TripLocationPayload;
};

type ResolvedTripLocation = {
  city: any;
  point: any | null;
  address: string;
  lat: number;
  lng: number;
};

export function hasCoordinates(
  location: { lat?: number | null; lng?: number | null },
): location is { lat: number; lng: number } {
  return location.lat !== null
    && location.lat !== undefined
    && location.lng !== null
    && location.lng !== undefined;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function formatCityLabel(city: any) {
  if (!city) return '';
  return [city.name, city.province].filter(Boolean).join(', ');
}

function formatLocationLabel(cityLabel: string, pointName: string | null, address: string | null) {
  if (pointName) return `${cityLabel} — ${pointName}`;
  if (address && address !== cityLabel) return `${cityLabel} — ${address}`;
  return cityLabel;
}

function transformTrip(trip: any) {
  if (!trip) return null;

  const departureCityLabel = trip.departure_city ? formatCityLabel(trip.departure_city) : trip.from_city;
  const arrivalCityLabel = trip.arrival_city ? formatCityLabel(trip.arrival_city) : trip.to_city;
  const departureAddress = trip.departure_address || trip.from_address || trip.from_city;
  const arrivalAddress = trip.arrival_address || trip.to_address || trip.to_city;

  return {
    id: trip.id.toString(),
    driver_id: trip.driver_id.toString(),
    vehicle_id: trip.vehicle_id.toString(),
    from_city: departureCityLabel,
    to_city: arrivalCityLabel,
    from_address: trip.from_address,
    to_address: trip.to_address,
    departure_city_id: trip.departure_city_id ? trip.departure_city_id.toString() : null,
    arrival_city_id: trip.arrival_city_id ? trip.arrival_city_id.toString() : null,
    departure_point_id: trip.departure_point_id ? trip.departure_point_id.toString() : null,
    arrival_point_id: trip.arrival_point_id ? trip.arrival_point_id.toString() : null,
    departure_address: departureAddress,
    departure_lat: toNumber(trip.departure_lat),
    departure_lng: toNumber(trip.departure_lng),
    arrival_address: arrivalAddress,
    arrival_lat: toNumber(trip.arrival_lat),
    arrival_lng: toNumber(trip.arrival_lng),
    departure_point_name: trip.departure_point?.name ?? null,
    arrival_point_name: trip.arrival_point?.name ?? null,
    departure_label: formatLocationLabel(departureCityLabel, trip.departure_point?.name ?? null, departureAddress),
    arrival_label: formatLocationLabel(arrivalCityLabel, trip.arrival_point?.name ?? null, arrivalAddress),
    origin_address: departureAddress,
    destination_address: arrivalAddress,
    departure_time: trip.departure_at ? trip.departure_at.toISOString() : new Date().toISOString(),
    departure_at: trip.departure_at ? trip.departure_at.toISOString() : new Date().toISOString(),
    estimated_arrival: null,
    available_seats: trip.seats_available,
    seats_available: trip.seats_available,
    seats_total: trip.seats_total,
    price_per_seat: Number(trip.price_per_seat),
    accepts_parcels: trip.accepts_parcels,
    parcel_price: trip.parcel_base_price ? Number(trip.parcel_base_price) : null,
    parcel_base_price: trip.parcel_base_price ? Number(trip.parcel_base_price) : null,
    status: trip.status,
    notes: trip.rules_json,
    rules_json: trip.rules_json,
    created_at: trip.created_at.toISOString(),
    origin_lat: toNumber(trip.departure_lat),
    origin_lng: toNumber(trip.departure_lng),
    destination_lat: toNumber(trip.arrival_lat),
    destination_lng: toNumber(trip.arrival_lng),
    departure_city: trip.departure_city ? {
      id: trip.departure_city.id.toString(),
      name: trip.departure_city.name,
      province: trip.departure_city.province,
      country: trip.departure_city.country,
    } : null,
    arrival_city: trip.arrival_city ? {
      id: trip.arrival_city.id.toString(),
      name: trip.arrival_city.name,
      province: trip.arrival_city.province,
      country: trip.arrival_city.country,
    } : null,
    departure_point: trip.departure_point ? {
      id: trip.departure_point.id.toString(),
      city_id: trip.departure_point.city_id.toString(),
      name: trip.departure_point.name,
      address: trip.departure_point.address,
      lat: Number(trip.departure_point.lat),
      lng: Number(trip.departure_point.lng),
      point_type: trip.departure_point.point_type,
    } : null,
    arrival_point: trip.arrival_point ? {
      id: trip.arrival_point.id.toString(),
      city_id: trip.arrival_point.city_id.toString(),
      name: trip.arrival_point.name,
      address: trip.arrival_point.address,
      lat: Number(trip.arrival_point.lat),
      lng: Number(trip.arrival_point.lng),
      point_type: trip.arrival_point.point_type,
    } : null,
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

function hasDepartureUpdate(input: UpdateTripInput) {
  return input.departure_city_id !== undefined
    || input.departure !== undefined
    || input.origin_address !== undefined
    || input.origin_lat !== undefined
    || input.origin_lng !== undefined;
}

function hasArrivalUpdate(input: UpdateTripInput) {
  return input.arrival_city_id !== undefined
    || input.arrival !== undefined
    || input.destination_address !== undefined
    || input.destination_lat !== undefined
    || input.destination_lng !== undefined;
}

function roundCoordinate(value: number) {
  return value.toFixed(6);
}

export function locationsMatch(
  departure: { lat: number; lng: number },
  arrival: { lat: number; lng: number },
) {
  return roundCoordinate(departure.lat) === roundCoordinate(arrival.lat)
    && roundCoordinate(departure.lng) === roundCoordinate(arrival.lng);
}

function assertDistinctLocations(departure: ResolvedTripLocation, arrival: ResolvedTripLocation) {
  if (locationsMatch(departure, arrival)) {
    throw Errors.badRequest(
      'Departure and arrival cannot match',
      'DEPARTURE_AND_ARRIVAL_CANNOT_MATCH',
    );
  }
}

async function normalizeCreateInput(input: CreateTripInput): Promise<StructuredTripPayload> {
  if (input.departure_city_id && input.arrival_city_id && input.departure && input.arrival) {
    return {
      departure_city_id: input.departure_city_id,
      arrival_city_id: input.arrival_city_id,
      departure: input.departure,
      arrival: input.arrival,
    };
  }

  const departureCity = await findOrCreateCityFromLegacyValue(input.origin_address as string);
  const arrivalCity = await findOrCreateCityFromLegacyValue(input.destination_address as string);

  return {
    departure_city_id: departureCity.id.toString(),
    arrival_city_id: arrivalCity.id.toString(),
    departure: {
      point_id: null,
      address: input.origin_address,
      lat: input.origin_lat,
      lng: input.origin_lng,
    },
    arrival: {
      point_id: null,
      address: input.destination_address,
      lat: input.destination_lat,
      lng: input.destination_lng,
    },
  };
}

function buildUpdatePayloadFromTrip(trip: any, input: UpdateTripInput): StructuredTripPayload {
  const departure = {
    point_id: trip.departure_point_id ? trip.departure_point_id.toString() : null,
    address: trip.departure_address || trip.from_address || trip.from_city,
    lat: toNumber(trip.departure_lat),
    lng: toNumber(trip.departure_lng),
  };

  const arrival = {
    point_id: trip.arrival_point_id ? trip.arrival_point_id.toString() : null,
    address: trip.arrival_address || trip.to_address || trip.to_city,
    lat: toNumber(trip.arrival_lat),
    lng: toNumber(trip.arrival_lng),
  };

  const nextDeparture = {
    point_id: input.departure?.point_id !== undefined
      ? input.departure.point_id
      : (input.origin_address !== undefined || input.origin_lat !== undefined || input.origin_lng !== undefined ? null : departure.point_id),
    address: input.departure?.address ?? input.origin_address ?? departure.address,
    lat: input.departure?.lat ?? input.origin_lat ?? departure.lat,
    lng: input.departure?.lng ?? input.origin_lng ?? departure.lng,
  };

  const nextArrival = {
    point_id: input.arrival?.point_id !== undefined
      ? input.arrival.point_id
      : (input.destination_address !== undefined || input.destination_lat !== undefined || input.destination_lng !== undefined ? null : arrival.point_id),
    address: input.arrival?.address ?? input.destination_address ?? arrival.address,
    lat: input.arrival?.lat ?? input.destination_lat ?? arrival.lat,
    lng: input.arrival?.lng ?? input.destination_lng ?? arrival.lng,
  };

  return {
    departure_city_id: input.departure_city_id ?? (trip.departure_city_id ? trip.departure_city_id.toString() : ''),
    arrival_city_id: input.arrival_city_id ?? (trip.arrival_city_id ? trip.arrival_city_id.toString() : ''),
    departure: nextDeparture,
    arrival: nextArrival,
  };
}

async function resolveTripLocation(
  cityId: string,
  payload: TripLocationPayload,
  invalidPointCode: 'INVALID_DEPARTURE_POINT' | 'INVALID_ARRIVAL_POINT',
  invalidCityCode: 'INVALID_DEPARTURE_CITY' | 'INVALID_ARRIVAL_CITY',
): Promise<ResolvedTripLocation> {
  const city = await assertCityExists(cityId, invalidCityCode);

  if (payload.point_id) {
    const point = await getCityPointById(payload.point_id);
    if (!pointBelongsToCity(point, city.id)) {
      throw Errors.badRequest(
        invalidPointCode === 'INVALID_DEPARTURE_POINT' ? 'Departure point does not belong to the selected city' : 'Arrival point does not belong to the selected city',
        invalidPointCode,
      );
    }

    return {
      city,
      point,
      address: point.address,
      lat: Number(point.lat),
      lng: Number(point.lng),
    };
  }

  const address = payload.address?.trim();
  if (!address) {
    throw Errors.badRequest(
      invalidPointCode === 'INVALID_DEPARTURE_POINT' ? 'Departure address is required' : 'Arrival address is required',
      invalidPointCode,
    );
  }

  let lat = payload.lat ?? null;
  let lng = payload.lng ?? null;

  if (!hasCoordinates({ lat, lng })) {
    const geocoded = await geocodeAddress(address, city.id);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
  }

  const coordinates = { lat, lng };

  if (!hasCoordinates(coordinates)) {
    throw Errors.badRequest(
      invalidPointCode === 'INVALID_DEPARTURE_POINT'
        ? 'Departure coordinates are required'
        : 'Arrival coordinates are required',
      invalidPointCode,
    );
  }

  return {
    city,
    point: null,
    address,
    lat: coordinates.lat,
    lng: coordinates.lng,
  };
}

async function resolveTripLocations(payload: StructuredTripPayload) {
  const departure = await resolveTripLocation(
    payload.departure_city_id,
    payload.departure,
    'INVALID_DEPARTURE_POINT',
    'INVALID_DEPARTURE_CITY',
  );
  const arrival = await resolveTripLocation(
    payload.arrival_city_id,
    payload.arrival,
    'INVALID_ARRIVAL_POINT',
    'INVALID_ARRIVAL_CITY',
  );

  assertDistinctLocations(departure, arrival);

  return { departure, arrival };
}

export async function createTrip(driverId: string, input: CreateTripInput) {
  const driverIdBig = BigInt(driverId);

  const vehicle = await prisma.vehicles.findUnique({ where: { id: BigInt(input.vehicle_id) } });
  if (!vehicle) throw Errors.notFound('Vehicle');
  if (vehicle.user_id !== driverIdBig) throw Errors.forbidden('You do not own this vehicle');

  const structuredInput = await normalizeCreateInput(input);
  const { departure, arrival } = await resolveTripLocations(structuredInput);

  const trip = await prisma.trips.create({
    data: {
      driver_id: driverIdBig,
      vehicle_id: BigInt(input.vehicle_id),
      from_city: formatCityLabel(departure.city),
      to_city: formatCityLabel(arrival.city),
      from_address: departure.address,
      to_address: arrival.address,
      departure_city_id: departure.city.id,
      arrival_city_id: arrival.city.id,
      departure_point_id: departure.point?.id ?? null,
      arrival_point_id: arrival.point?.id ?? null,
      departure_address: departure.address,
      departure_lat: departure.lat,
      departure_lng: departure.lng,
      arrival_address: arrival.address,
      arrival_lat: arrival.lat,
      arrival_lng: arrival.lng,
      departure_at: new Date(input.departure_time),
      seats_total: input.available_seats,
      seats_available: input.available_seats,
      price_per_seat: input.price_per_seat,
      accepts_parcels: input.accepts_parcels ?? false,
      parcel_base_price: input.parcel_price ?? null,
      rules_json: input.notes ?? null,
      status: 'draft',
    },
    include: TRIP_INCLUDE,
  });

  if (input.stops && input.stops.length > 0) {
    await prisma.trip_stops.createMany({
      data: input.stops.map((stop) => ({
        trip_id: trip.id,
        city: stop.address,
        address: stop.address,
        stop_order: stop.stop_order,
      })),
    });
  }

  if (departure.point?.id) await incrementPointUsage(departure.point.id);
  if (arrival.point?.id) await incrementPointUsage(arrival.point.id);

  const created = await prisma.trips.findUnique({ where: { id: trip.id }, include: TRIP_INCLUDE });
  return transformTrip(created);
}

export async function updateTrip(driverId: string, tripId: string, input: UpdateTripInput) {
  const trip = await prisma.trips.findUnique({
    where: { id: BigInt(tripId) },
    include: TRIP_INCLUDE,
  });
  if (!trip) throw Errors.notFound('Trip');
  if (trip.driver_id !== BigInt(driverId)) throw Errors.forbidden('You do not own this trip');
  if (trip.status !== 'draft') throw Errors.badRequest('Can only edit draft trips', 'TRIP_NOT_DRAFT');

  const data: any = {};

  if (hasDepartureUpdate(input) || hasArrivalUpdate(input)) {
    const structuredInput = buildUpdatePayloadFromTrip(trip, input);
    const { departure, arrival } = await resolveTripLocations(structuredInput);

    data.from_city = formatCityLabel(departure.city);
    data.to_city = formatCityLabel(arrival.city);
    data.from_address = departure.address;
    data.to_address = arrival.address;
    data.departure_city_id = departure.city.id;
    data.arrival_city_id = arrival.city.id;
    data.departure_point_id = departure.point?.id ?? null;
    data.arrival_point_id = arrival.point?.id ?? null;
    data.departure_address = departure.address;
    data.departure_lat = departure.lat;
    data.departure_lng = departure.lng;
    data.arrival_address = arrival.address;
    data.arrival_lat = arrival.lat;
    data.arrival_lng = arrival.lng;
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
      { departure_address: { contains: query.origin_address } },
    ];
  }

  if (query.destination_address) {
    const destConditions = [
      { to_city: { contains: query.destination_address } },
      { to_address: { contains: query.destination_address } },
      { arrival_address: { contains: query.destination_address } },
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
      orderBy: { created_at: 'desc' },
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
