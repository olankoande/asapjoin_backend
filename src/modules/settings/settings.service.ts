import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { logger } from '../../config/logger';

export interface PlatformDeliverySettings {
  deliveries_min_hours_before_departure: number;
  deliveries_min_minutes_before_departure: number;
}

const DEFAULT_SETTINGS: PlatformDeliverySettings = {
  deliveries_min_hours_before_departure: 2,
  deliveries_min_minutes_before_departure: 0,
};

/**
 * Get platform settings (row id=1).
 * Uses raw SQL to avoid dependency on Prisma client regeneration.
 * Falls back to defaults if table doesn't exist yet.
 */
export async function getPlatformSettings(): Promise<PlatformDeliverySettings> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      deliveries_min_hours_before_departure: number;
      deliveries_min_minutes_before_departure: number;
    }>>`SELECT deliveries_min_hours_before_departure, deliveries_min_minutes_before_departure FROM platform_settings WHERE id = 1 LIMIT 1`;

    if (rows.length === 0) {
      // Auto-create default row
      await prisma.$executeRaw`INSERT INTO platform_settings (id, deliveries_min_hours_before_departure, deliveries_min_minutes_before_departure, created_at, updated_at) VALUES (1, ${DEFAULT_SETTINGS.deliveries_min_hours_before_departure}, ${DEFAULT_SETTINGS.deliveries_min_minutes_before_departure}, NOW(), NOW()) ON DUPLICATE KEY UPDATE id = id`;
      logger.info('Created default platform_settings row');
      return DEFAULT_SETTINGS;
    }

    return {
      deliveries_min_hours_before_departure: Number(rows[0].deliveries_min_hours_before_departure),
      deliveries_min_minutes_before_departure: Number(rows[0].deliveries_min_minutes_before_departure),
    };
  } catch (err: any) {
    // Table might not exist yet (migration not run)
    logger.warn(`Failed to read platform_settings: ${err.message}. Using defaults.`);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Update platform settings (admin only).
 */
export async function updatePlatformSettings(input: PlatformDeliverySettings): Promise<PlatformDeliverySettings> {
  // Validation
  if (input.deliveries_min_hours_before_departure < 0) {
    throw Errors.badRequest('Hours must be >= 0', 'INVALID_SETTINGS');
  }
  if (input.deliveries_min_minutes_before_departure < 0 || input.deliveries_min_minutes_before_departure > 59) {
    throw Errors.badRequest('Minutes must be between 0 and 59', 'INVALID_SETTINGS');
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO platform_settings (id, deliveries_min_hours_before_departure, deliveries_min_minutes_before_departure, created_at, updated_at)
      VALUES (1, ${input.deliveries_min_hours_before_departure}, ${input.deliveries_min_minutes_before_departure}, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        deliveries_min_hours_before_departure = ${input.deliveries_min_hours_before_departure},
        deliveries_min_minutes_before_departure = ${input.deliveries_min_minutes_before_departure},
        updated_at = NOW()
    `;
  } catch (err: any) {
    logger.error(`Failed to update platform_settings: ${err.message}`);
    throw Errors.internal('Failed to update platform settings');
  }

  return {
    deliveries_min_hours_before_departure: input.deliveries_min_hours_before_departure,
    deliveries_min_minutes_before_departure: input.deliveries_min_minutes_before_departure,
  };
}

/**
 * Check if NOW() is within the allowed window before departure.
 * Returns true if delivery is allowed, false if too late.
 */
export async function isDeliveryAllowedBeforeDeparture(departureAt: Date): Promise<boolean> {
  const settings = await getPlatformSettings();
  const minMs =
    (settings.deliveries_min_hours_before_departure * 60 + settings.deliveries_min_minutes_before_departure) * 60 * 1000;
  const deadline = new Date(departureAt.getTime() - minMs);
  return new Date() <= deadline;
}
