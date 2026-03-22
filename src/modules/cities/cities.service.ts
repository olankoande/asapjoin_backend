import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { DEFAULT_CITY_CATALOG } from './cities.catalog';
import { ListCitiesQuery, SearchCitiesQuery } from './cities.schemas';

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseLegacyCity(value: string) {
  const [namePart, provincePart] = value.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    name: namePart || value.trim(),
    province: provincePart || null,
    country: 'Canada',
  };
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

function transformCatalogCity(city: { name: string; province: string | null; country: string }) {
  const timestamp = new Date(0).toISOString();
  return {
    id: catalogCityId(city),
    name: city.name,
    province: city.province,
    country: city.country,
    is_active: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function listCatalogCities() {
  return DEFAULT_CITY_CATALOG
    .map(transformCatalogCity)
    .sort((left, right) =>
      left.name.localeCompare(right.name) || (left.province || '').localeCompare(right.province || ''));
}

function findCatalogCityById(cityId: string) {
  return listCatalogCities().find((city) => city.id === cityId) || null;
}

function searchCatalogCities(query: SearchCitiesQuery) {
  const needle = normalizeLabel(query.q);
  return listCatalogCities()
    .filter((city) => normalizeLabel(`${city.name} ${city.province || ''} ${city.country}`).includes(needle))
    .slice(0, query.limit ?? 20);
}

function missingCatalogTablesError() {
  return Errors.badRequest(
    'City catalog tables are missing from the current database. Run `npx prisma db push` in `backend` to create them.',
    'CITY_CATALOG_TABLES_MISSING',
  );
}

async function hasTable(tableName: 'cities' | 'city_points') {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    tableName,
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function ensureDefaultCitiesSeeded() {
  try {
    if (!(await hasTable('cities'))) return 'catalog' as const;

    const count = await prisma.cities.count();
    if (count > 0) return 'database' as const;

    for (const city of DEFAULT_CITY_CATALOG) {
      const existing = await prisma.cities.findFirst({
        where: {
          name: city.name,
          province: city.province,
          country: city.country,
        },
      });

      if (existing) {
        await prisma.cities.update({
          where: { id: existing.id },
          data: { is_active: true },
        });
      } else {
        await prisma.cities.create({
          data: {
            name: city.name,
            province: city.province,
            country: city.country,
            is_active: true,
          },
        });
      }
    }

    const tripCities = await prisma.trips.findMany({
      where: { deleted_at: null },
      select: { from_city: true, to_city: true },
    });

    const seen = new Set<string>();
    for (const trip of tripCities) {
      for (const rawValue of [trip.from_city, trip.to_city]) {
        if (!rawValue?.trim()) continue;
        const parsed = parseLegacyCity(rawValue);
        const key = `${normalizeLabel(parsed.name)}|${normalizeLabel(parsed.province || '')}|${normalizeLabel(parsed.country)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = await prisma.cities.findFirst({
          where: {
            name: parsed.name,
            province: parsed.province,
            country: parsed.country,
          },
        });

        if (existing) {
          await prisma.cities.update({
            where: { id: existing.id },
            data: { is_active: true },
          });
        } else {
          await prisma.cities.create({
            data: {
              name: parsed.name,
              province: parsed.province,
              country: parsed.country,
              is_active: true,
            },
          });
        }
      }
    }

    return 'database' as const;
  } catch (error) {
    if (isPrismaMissingTableError(error)) return 'catalog' as const;
    throw error;
  }
}

export async function ensurePointCatalogSeeded() {
  const cityStorage = await ensureDefaultCitiesSeeded();
  if (cityStorage === 'catalog') return 'catalog' as const;

  try {
    if (!(await hasTable('city_points'))) return 'catalog' as const;

    for (const city of DEFAULT_CITY_CATALOG) {
      const existingCity = await prisma.cities.findFirst({
        where: {
          name: city.name,
          province: city.province,
          country: city.country,
        },
      });

      if (!existingCity) continue;

      for (const point of city.points) {
        const existingPoint = await prisma.city_points.findFirst({
          where: {
            city_id: existingCity.id,
            name: point.name,
            address: point.address,
          },
        });

        if (existingPoint) continue;

        await prisma.city_points.create({
          data: {
            city_id: existingCity.id,
            name: point.name,
            address: point.address,
            lat: point.lat,
            lng: point.lng,
            point_type: point.point_type,
            popularity_score: point.popularity_score,
            usage_count: point.usage_count,
            is_active: true,
          },
        });
      }
    }

    return 'database' as const;
  } catch (error) {
    if (isPrismaMissingTableError(error)) return 'catalog' as const;
    throw error;
  }
}

function transformCity(city: any) {
  return {
    id: city.id.toString(),
    name: city.name,
    province: city.province,
    country: city.country,
    is_active: city.is_active,
    created_at: city.created_at.toISOString(),
    updated_at: city.updated_at.toISOString(),
  };
}

export async function listCities(query: ListCitiesQuery = {}) {
  const storage = await ensureDefaultCitiesSeeded();
  if (storage === 'catalog') return listCatalogCities().slice(0, query.limit ?? 100);

  try {
    const cities = await prisma.cities.findMany({
      where: { is_active: true },
      orderBy: [{ name: 'asc' }, { province: 'asc' }],
      take: query.limit ?? 100,
    });
    return cities.map(transformCity);
  } catch (error) {
    if (isPrismaMissingTableError(error)) return listCatalogCities().slice(0, query.limit ?? 100);
    throw error;
  }
}

export async function searchCities(query: SearchCitiesQuery) {
  const storage = await ensureDefaultCitiesSeeded();
  if (storage === 'catalog') return searchCatalogCities(query);

  try {
    const cities = await prisma.cities.findMany({
      where: {
        is_active: true,
        name: { contains: query.q },
      },
      orderBy: [{ name: 'asc' }, { province: 'asc' }],
      take: query.limit ?? 20,
    });
    return cities.map(transformCity);
  } catch (error) {
    if (isPrismaMissingTableError(error)) return searchCatalogCities(query);
    throw error;
  }
}

export async function getCityById(cityId: string | bigint) {
  const storage = await ensureDefaultCitiesSeeded();
  if (storage === 'catalog') {
    const city = findCatalogCityById(String(cityId));
    if (!city) throw Errors.badRequest('Departure or arrival city is invalid', 'INVALID_CITY');
    return city;
  }

  try {
    const city = await prisma.cities.findUnique({
      where: { id: BigInt(cityId) },
    });
    if (!city || !city.is_active) {
      throw Errors.badRequest('Departure or arrival city is invalid', 'INVALID_CITY');
    }
    return city;
  } catch (error) {
    if (isPrismaMissingTableError(error)) {
      const city = findCatalogCityById(String(cityId));
      if (!city) throw Errors.badRequest('Departure or arrival city is invalid', 'INVALID_CITY');
      return city;
    }
    throw error;
  }
}

export async function findOrCreateCityFromLegacyValue(value: string) {
  const storage = await ensureDefaultCitiesSeeded();
  if (storage === 'catalog') throw missingCatalogTablesError();
  const parsed = parseLegacyCity(value);

  try {
    const existing = await prisma.cities.findFirst({
      where: {
        is_active: true,
        name: parsed.name,
        province: parsed.province,
        country: parsed.country,
      },
    });
    if (existing) return existing;

    return prisma.cities.create({
      data: {
        name: parsed.name,
        province: parsed.province,
        country: parsed.country,
        is_active: true,
      },
    });
  } catch (error) {
    if (isPrismaMissingTableError(error)) throw missingCatalogTablesError();
    throw error;
  }
}

export async function assertCityExists(cityId: string | bigint, errorCode: 'INVALID_DEPARTURE_CITY' | 'INVALID_ARRIVAL_CITY') {
  const storage = await ensureDefaultCitiesSeeded();
  if (storage === 'catalog') throw missingCatalogTablesError();

  try {
    const city = await prisma.cities.findUnique({
      where: { id: BigInt(cityId) },
    });
    if (!city || !city.is_active) {
      throw Errors.badRequest(
        errorCode === 'INVALID_DEPARTURE_CITY' ? 'Departure city is invalid' : 'Arrival city is invalid',
        errorCode,
      );
    }
    return city;
  } catch (error) {
    if (isPrismaMissingTableError(error)) throw missingCatalogTablesError();
    throw error;
  }
}
