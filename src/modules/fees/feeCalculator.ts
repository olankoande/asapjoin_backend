/**
 * Fee Calculator — Computes platform commissions for bookings and deliveries.
 *
 * All amounts are in CENTS (integer). No floats for financial calculations.
 * Reads fee settings from platform_fee_settings table (row id=1).
 */

import { prisma } from '../../db/prisma';
import { logger } from '../../config/logger';

export interface FeeSettings {
  booking_fee_pct: number;       // e.g. 10.00 = 10%
  booking_fee_fixed_cents: number;
  delivery_fee_pct: number;
  delivery_fee_fixed_cents: number;
  hold_days_before_available: number;
}

export interface FeeBreakdown {
  gross_cents: number;
  platform_fee_cents: number;
  driver_net_cents: number;
  snapshot: FeeSnapshot;
}

export interface FeeSnapshot {
  fee_pct: number;
  fee_fixed_cents: number;
  gross_cents: number;
  platform_fee_cents: number;
  driver_net_cents: number;
  kind: 'booking' | 'delivery';
  computed_at: string;
}

const DEFAULT_SETTINGS: FeeSettings = {
  booking_fee_pct: 10.00,
  booking_fee_fixed_cents: 0,
  delivery_fee_pct: 10.00,
  delivery_fee_fixed_cents: 0,
  hold_days_before_available: 7,
};

let cachedSettings: FeeSettings | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Load fee settings from DB (with 1-minute cache).
 */
export async function getFeeSettings(): Promise<FeeSettings> {
  if (cachedSettings && Date.now() < cacheExpiry) {
    return cachedSettings;
  }

  try {
    const rows = await prisma.$queryRaw<Array<{
      booking_fee_pct: number;
      booking_fee_fixed_cents: number;
      delivery_fee_pct: number;
      delivery_fee_fixed_cents: number;
      hold_days_before_available: number;
    }>>`SELECT booking_fee_pct, booking_fee_fixed_cents, delivery_fee_pct, delivery_fee_fixed_cents, hold_days_before_available FROM platform_fee_settings WHERE id = 1 LIMIT 1`;

    if (rows.length > 0) {
      cachedSettings = {
        booking_fee_pct: Number(rows[0].booking_fee_pct),
        booking_fee_fixed_cents: Number(rows[0].booking_fee_fixed_cents),
        delivery_fee_pct: Number(rows[0].delivery_fee_pct),
        delivery_fee_fixed_cents: Number(rows[0].delivery_fee_fixed_cents),
        hold_days_before_available: Number(rows[0].hold_days_before_available),
      };
    } else {
      cachedSettings = DEFAULT_SETTINGS;
    }
  } catch (err: any) {
    logger.warn(`Failed to load fee settings: ${err.message}. Using defaults.`);
    cachedSettings = DEFAULT_SETTINGS;
  }

  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedSettings;
}

/**
 * Invalidate the fee settings cache (call after admin updates settings).
 */
export function invalidateFeeSettingsCache(): void {
  cachedSettings = null;
  cacheExpiry = 0;
}

/**
 * Compute booking fees.
 * @param grossCents - Total booking amount in cents (e.g. seats * price_per_seat * 100)
 */
export async function computeBookingFees(grossCents: number): Promise<FeeBreakdown> {
  const settings = await getFeeSettings();
  return computeFees(grossCents, settings.booking_fee_pct, settings.booking_fee_fixed_cents, 'booking');
}

/**
 * Compute delivery fees.
 * @param grossCents - Total delivery amount in cents
 */
export async function computeDeliveryFees(grossCents: number): Promise<FeeBreakdown> {
  const settings = await getFeeSettings();
  return computeFees(grossCents, settings.delivery_fee_pct, settings.delivery_fee_fixed_cents, 'delivery');
}

/**
 * Core fee computation. All in cents, no floats.
 * In this model, the driver price IS the gross. The platform fee is taken FROM the gross.
 * So: driver_net = gross - fee, client pays = gross.
 */
function computeFees(
  grossCents: number,
  feePct: number,
  feeFixedCents: number,
  kind: 'booking' | 'delivery',
): FeeBreakdown {
  // platform_fee = round(gross * pct / 100) + fixed
  const pctFee = Math.round(grossCents * feePct / 100);
  let platformFeeCents = pctFee + feeFixedCents;

  // Clamp: platform_fee >= 0 and <= gross
  platformFeeCents = Math.max(0, Math.min(platformFeeCents, grossCents));

  // driver_net = gross - platform_fee
  const driverNetCents = Math.max(0, grossCents - platformFeeCents);

  const snapshot: FeeSnapshot = {
    fee_pct: feePct,
    fee_fixed_cents: feeFixedCents,
    gross_cents: grossCents,
    platform_fee_cents: platformFeeCents,
    driver_net_cents: driverNetCents,
    kind,
    computed_at: new Date().toISOString(),
  };

  return {
    gross_cents: grossCents,
    platform_fee_cents: platformFeeCents,
    driver_net_cents: driverNetCents,
    snapshot,
  };
}

/**
 * Additive fee computation: fees are ADDED ON TOP of the driver price.
 * The driver receives 100% of their price. The client pays driver_price + platform_fee.
 *
 * @param driverPriceCents - The driver's price in cents (what the driver set)
 * @returns FeeBreakdown where:
 *   - gross_cents = total charged to client (driver_price + platform_fee)
 *   - platform_fee_cents = the platform's commission
 *   - driver_net_cents = the driver's full price (unchanged)
 */
export interface AdditiveFeeBreakdown extends FeeBreakdown {
  /** The driver's original price in cents */
  driver_price_cents: number;
  /** Total charged to the client (driver_price + platform_fee) */
  total_client_cents: number;
}

function computeAdditiveFees(
  driverPriceCents: number,
  feePct: number,
  feeFixedCents: number,
  kind: 'booking' | 'delivery',
): AdditiveFeeBreakdown {
  // platform_fee = round(driver_price * pct / 100) + fixed
  const pctFee = Math.round(driverPriceCents * feePct / 100);
  let platformFeeCents = pctFee + feeFixedCents;
  platformFeeCents = Math.max(0, platformFeeCents);

  // Total charged to client = driver_price + platform_fee
  const totalClientCents = driverPriceCents + platformFeeCents;

  // Driver receives 100% of their price
  const driverNetCents = driverPriceCents;

  const snapshot: FeeSnapshot = {
    fee_pct: feePct,
    fee_fixed_cents: feeFixedCents,
    gross_cents: totalClientCents,
    platform_fee_cents: platformFeeCents,
    driver_net_cents: driverNetCents,
    kind,
    computed_at: new Date().toISOString(),
  };

  return {
    gross_cents: totalClientCents,
    platform_fee_cents: platformFeeCents,
    driver_net_cents: driverNetCents,
    driver_price_cents: driverPriceCents,
    total_client_cents: totalClientCents,
    snapshot,
  };
}

/**
 * Compute additive booking fees (fees added on top of driver price).
 * @param driverPriceCents - The driver's price in cents
 */
export async function computeBookingFeesAdditive(driverPriceCents: number): Promise<AdditiveFeeBreakdown> {
  const settings = await getFeeSettings();
  return computeAdditiveFees(driverPriceCents, settings.booking_fee_pct, settings.booking_fee_fixed_cents, 'booking');
}

/**
 * Compute additive delivery fees (fees added on top of driver price).
 * @param driverPriceCents - The driver's price in cents
 */
export async function computeDeliveryFeesAdditive(driverPriceCents: number): Promise<AdditiveFeeBreakdown> {
  const settings = await getFeeSettings();
  return computeAdditiveFees(driverPriceCents, settings.delivery_fee_pct, settings.delivery_fee_fixed_cents, 'delivery');
}

/**
 * Update fee settings (admin only).
 */
export async function updateFeeSettings(input: Partial<FeeSettings>): Promise<FeeSettings> {
  const current = await getFeeSettings();
  const updated = { ...current, ...input };

  await prisma.$executeRaw`
    INSERT INTO platform_fee_settings (id, booking_fee_pct, booking_fee_fixed_cents, delivery_fee_pct, delivery_fee_fixed_cents, hold_days_before_available, created_at, updated_at)
    VALUES (1, ${updated.booking_fee_pct}, ${updated.booking_fee_fixed_cents}, ${updated.delivery_fee_pct}, ${updated.delivery_fee_fixed_cents}, ${updated.hold_days_before_available}, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      booking_fee_pct = ${updated.booking_fee_pct},
      booking_fee_fixed_cents = ${updated.booking_fee_fixed_cents},
      delivery_fee_pct = ${updated.delivery_fee_pct},
      delivery_fee_fixed_cents = ${updated.delivery_fee_fixed_cents},
      hold_days_before_available = ${updated.hold_days_before_available},
      updated_at = NOW()
  `;

  invalidateFeeSettingsCache();
  return updated;
}
