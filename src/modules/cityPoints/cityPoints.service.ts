import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { ensurePointCatalogSeeded } from '../cities/cities.service';
import { DEFAULT_CITY_CATALOG } from '../cities/cities.catalog';
import { CreateCityPointInput, ListCityPointsQuery } from '../cities/cities.schemas';
import { UpdateCityPointInput } from './cityPoints.schemas';

function transformPoint(point: any) {
  return {
    id: point.id.toString(),
    city_id: point.city_id.toString(),
    name: point.name,
    address: point.address,
    lat: Number(point.lat),
    lng: Number(point.lng),
    point_type: point.point_type,
    popularity_score: point.popularity_score,
    usage_count: point.usage_count,
    is_active: point.is_active,
    created_at: point.created_at.toISOString(),
    updated_at: point.updated_at.toISOString(),
  };
}

export function pointBelongsToCity(point: { city_id: string | bigint | number }, cityId: string | bigint | number) {
  return BigInt(point.city_id) === BigInt(cityId);
}

export function sortPointsByPopularity<T extends { popularity_score: number; usage_count: number; name: string }>(points: T[]) {
  return [...points].sort((left, right) => {
    if (right.popularity_score !== left.popularity_score) return right.popularity_score - left.popularity_score;
    if (right.usage_count !== left.usage_count) return right.usage_count - left.usage_count;
    return left.name.localeCompare(right.name);
  });
}

export function nextPointUsageStats(currentUsage: number, currentPopularity: number) {
  return {
    usage_count: currentUsage + 1,
    popularity_score: currentPopularity + 10,
  };
}

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isPrismaMissingTableError(error: unknown) {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'P2021';
}

function catalogCityId(city: { name: string; province: string | null; country: string }) {
  return `catalog:${normalizeLabel(city.name)}:${normalizeLabel(city.province || '')}:${normalizeLabel(city.country)}`;
}

function catalogPointId(city: { name: string; province: string | null; country: string }, point: { name: string }) {
  return `${catalogCityId(city)}:point:${normalizeLabel(point.name)}`;
}

function missingCatalogTablesError() {
  return Errors.badRequest(
    'City catalog tables are missing from the current database. Run `npx prisma db push` in `backend` to create them.',
    'CITY_CATALOG_TABLES_MISSING',
  );
}

function listCatalogPoints(cityId: string, filters: ListCityPointsQuery = {}) {
  const city = DEFAULT_CITY_CATALOG.find((entry) => catalogCityId(entry) === cityId);
  if (!city) throw Errors.badRequest('Selected city is invalid', 'INVALID_CITY');

  const points = city.points.map((point) => ({
    id: catalogPointId(city, point),
    city_id: cityId,
    name: point.name,
    address: point.address,
    lat: point.lat,
    lng: point.lng,
    point_type: point.point_type,
    popularity_score: point.popularity_score,
    usage_count: point.usage_count,
    is_active: true,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }));

  const filtered = points.filter((point) => {
    const matchesQuery = !filters.q
      || normalizeLabel(`${point.name} ${point.address}`).includes(normalizeLabel(filters.q));
    const matchesType = !filters.type || point.point_type === filters.type;
    return matchesQuery && matchesType;
  });

  return sortPointsByPopularity(filtered).slice(0, filters.limit ?? 12);
}

export async function listCityPoints(cityId: string, filters: ListCityPointsQuery = {}) {
  const storage = await ensurePointCatalogSeeded();
  if (storage === 'catalog') return listCatalogPoints(cityId, filters);

  try {
    const city = await prisma.cities.findUnique({ where: { id: BigInt(cityId) } });
    if (!city || !city.is_active) {
      throw Errors.badRequest('Selected city is invalid', 'INVALID_CITY');
    }

    const points = await prisma.city_points.findMany({
      where: {
        city_id: BigInt(cityId),
        is_active: true,
        ...(filters.q ? {
          OR: [
            { name: { contains: filters.q } },
            { address: { contains: filters.q } },
          ],
        } : {}),
        ...(filters.type ? { point_type: filters.type } : {}),
      },
      orderBy: [
        { popularity_score: 'desc' },
        { usage_count: 'desc' },
        { name: 'asc' },
      ],
      take: filters.limit ?? 12,
    });

    return sortPointsByPopularity(points.map(transformPoint));
  } catch (error) {
    if (isPrismaMissingTableError(error)) return listCatalogPoints(cityId, filters);
    throw error;
  }
}

export async function createCityPoint(cityId: string, input: CreateCityPointInput) {
  const storage = await ensurePointCatalogSeeded();
  if (storage === 'catalog') throw missingCatalogTablesError();

  try {
    const city = await prisma.cities.findUnique({ where: { id: BigInt(cityId) } });
    if (!city || !city.is_active) {
      throw Errors.badRequest('Selected city is invalid', 'INVALID_CITY');
    }

    const point = await prisma.city_points.create({
      data: {
        city_id: BigInt(cityId),
        name: input.name,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        point_type: input.point_type,
        popularity_score: input.popularity_score ?? 0,
        usage_count: input.usage_count ?? 0,
        is_active: true,
      },
    });

    return transformPoint(point);
  } catch (error) {
    if (isPrismaMissingTableError(error)) throw missingCatalogTablesError();
    throw error;
  }
}

export async function getCityPointById(pointId: string | bigint) {
  const storage = await ensurePointCatalogSeeded();
  if (storage === 'catalog') throw missingCatalogTablesError();

  try {
    const point = await prisma.city_points.findUnique({
      where: { id: BigInt(pointId) },
    });
    if (!point || !point.is_active) {
      throw Errors.notFound('City point');
    }
    return point;
  } catch (error) {
    if (isPrismaMissingTableError(error)) throw missingCatalogTablesError();
    throw error;
  }
}

export async function updateCityPoint(pointId: string, input: UpdateCityPointInput) {
  try {
    const point = await prisma.city_points.findUnique({ where: { id: BigInt(pointId) } });
    if (!point) throw Errors.notFound('City point');

    const updated = await prisma.city_points.update({
      where: { id: BigInt(pointId) },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.lat !== undefined && { lat: input.lat }),
        ...(input.lng !== undefined && { lng: input.lng }),
        ...(input.point_type !== undefined && { point_type: input.point_type }),
        ...(input.popularity_score !== undefined && { popularity_score: input.popularity_score }),
        ...(input.usage_count !== undefined && { usage_count: input.usage_count }),
        ...(input.is_active !== undefined && { is_active: input.is_active }),
      },
    });

    return transformPoint(updated);
  } catch (error) {
    if (isPrismaMissingTableError(error)) throw missingCatalogTablesError();
    throw error;
  }
}

export async function deactivateCityPoint(pointId: string) {
  try {
    const point = await prisma.city_points.findUnique({ where: { id: BigInt(pointId) } });
    if (!point) throw Errors.notFound('City point');

    await prisma.city_points.update({
      where: { id: BigInt(pointId) },
      data: { is_active: false },
    });

    return { message: 'City point deactivated' };
  } catch (error) {
    if (isPrismaMissingTableError(error)) throw missingCatalogTablesError();
    throw error;
  }
}

export async function incrementPointUsage(pointId: string | bigint) {
  try {
    const point = await prisma.city_points.findUnique({ where: { id: BigInt(pointId) } });
    if (!point || !point.is_active) return;

    const nextStats = nextPointUsageStats(point.usage_count, point.popularity_score);

    await prisma.city_points.update({
      where: { id: BigInt(pointId) },
      data: {
        usage_count: nextStats.usage_count,
        popularity_score: nextStats.popularity_score,
      },
    });
  } catch (error) {
    if (isPrismaMissingTableError(error)) return;
    throw error;
  }
}
