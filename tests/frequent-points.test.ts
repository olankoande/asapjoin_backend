import { describe, expect, test } from 'vitest';
import { hasCoordinates, locationsMatch } from '../src/modules/trips/trips.service';
import {
  nextPointUsageStats,
  pointBelongsToCity,
  sortPointsByPopularity,
} from '../src/modules/cityPoints/cityPoints.service';

describe('Frequent points business rules', () => {
  test('rejects a point assigned to a different city', () => {
    expect(pointBelongsToCity({ city_id: '2' }, '1')).toBe(false);
    expect(pointBelongsToCity({ city_id: '2' }, '2')).toBe(true);
  });

  test('detects missing coordinates for custom locations', () => {
    expect(hasCoordinates({ lat: null, lng: null })).toBe(false);
    expect(hasCoordinates({ lat: 45.5, lng: null })).toBe(false);
    expect(hasCoordinates({ lat: 45.5, lng: -73.56 })).toBe(true);
  });

  test('rejects identical departure and arrival coordinates', () => {
    expect(locationsMatch({ lat: 45.5017, lng: -73.5673 }, { lat: 45.5017, lng: -73.5673 })).toBe(true);
    expect(locationsMatch({ lat: 45.5017, lng: -73.5673 }, { lat: 46.8139, lng: -71.2082 })).toBe(false);
  });

  test('increments usage_count and popularity_score together', () => {
    expect(nextPointUsageStats(7, 42)).toEqual({
      usage_count: 8,
      popularity_score: 52,
    });
  });

  test('sorts frequent points by popularity then usage count', () => {
    const sorted = sortPointsByPopularity([
      { name: 'Point C', popularity_score: 20, usage_count: 4 },
      { name: 'Point A', popularity_score: 50, usage_count: 1 },
      { name: 'Point B', popularity_score: 50, usage_count: 7 },
    ]);

    expect(sorted.map((point) => point.name)).toEqual(['Point B', 'Point A', 'Point C']);
  });
});
