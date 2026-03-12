import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Delivery Business Rules Tests
 * These tests validate the business logic for the delivery module.
 * They mock Prisma and test the service layer directly.
 */

// Mock prisma
vi.mock('../src/db/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    platform_settings: {
      findFirst: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    trips: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    users: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    parcels: {
      create: vi.fn(),
    },
    deliveries: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
  },
}));

// Mock email service
vi.mock('../src/modules/notifications/emailService', () => ({
  sendDeliveryAcceptedEmail: vi.fn().mockResolvedValue(undefined),
  sendDeliveryDeliveredEmail: vi.fn().mockResolvedValue(undefined),
  sendDeliveryReceivedEmail: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/db/prisma';
import { isDeliveryAllowedBeforeDeparture, getPlatformSettings, updatePlatformSettings } from '../src/modules/settings/settings.service';

describe('Platform Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default settings when row exists', async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{
      deliveries_min_hours_before_departure: 2,
      deliveries_min_minutes_before_departure: 0,
    }]);

    const settings = await getPlatformSettings();
    expect(settings.deliveries_min_hours_before_departure).toBe(2);
    expect(settings.deliveries_min_minutes_before_departure).toBe(0);
  });

  it('should create default row if not found', async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const settings = await getPlatformSettings();
    expect(settings.deliveries_min_hours_before_departure).toBe(2);
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('should reject invalid minutes (> 59)', async () => {
    await expect(
      updatePlatformSettings({
        deliveries_min_hours_before_departure: 1,
        deliveries_min_minutes_before_departure: 60,
      })
    ).rejects.toThrow();
  });

  it('should reject negative hours', async () => {
    await expect(
      updatePlatformSettings({
        deliveries_min_hours_before_departure: -1,
        deliveries_min_minutes_before_departure: 0,
      })
    ).rejects.toThrow();
  });

  it('should update settings successfully', async () => {
    (prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const result = await updatePlatformSettings({
      deliveries_min_hours_before_departure: 3,
      deliveries_min_minutes_before_departure: 30,
    });
    expect(result.deliveries_min_hours_before_departure).toBe(3);
    expect(result.deliveries_min_minutes_before_departure).toBe(30);
  });
});

describe('RB-DEL-0: Delivery allowed before departure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow delivery when departure is far enough', async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{
      deliveries_min_hours_before_departure: 2,
      deliveries_min_minutes_before_departure: 0,
    }]);

    // Departure in 5 hours
    const departureAt = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const allowed = await isDeliveryAllowedBeforeDeparture(departureAt);
    expect(allowed).toBe(true);
  });

  it('should reject delivery when departure is too close', async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{
      deliveries_min_hours_before_departure: 2,
      deliveries_min_minutes_before_departure: 0,
    }]);

    // Departure in 1 hour (less than 2h minimum)
    const departureAt = new Date(Date.now() + 1 * 60 * 60 * 1000);
    const allowed = await isDeliveryAllowedBeforeDeparture(departureAt);
    expect(allowed).toBe(false);
  });

  it('should handle minutes in the delay calculation', async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{
      deliveries_min_hours_before_departure: 1,
      deliveries_min_minutes_before_departure: 30,
    }]);

    // Departure in 2 hours (more than 1h30 minimum)
    const departureAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const allowed = await isDeliveryAllowedBeforeDeparture(departureAt);
    expect(allowed).toBe(true);

    // Departure in 1 hour (less than 1h30 minimum)
    const departureAt2 = new Date(Date.now() + 1 * 60 * 60 * 1000);
    const allowed2 = await isDeliveryAllowedBeforeDeparture(departureAt2);
    expect(allowed2).toBe(false);
  });
});

describe('Delivery Business Rules (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RB-DEL-1: Trip must accept parcels
  it('RB-DEL-1: should reject if trip does not accept parcels', async () => {
    const { createDelivery } = await import('../src/modules/deliveries/deliveries.service');

    (prisma.users.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: BigInt(2) });
    (prisma.trips.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      driver_id: BigInt(99),
      accepts_parcels: false,
      status: 'published',
      departure_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await expect(
      createDelivery('2', {
        trip_id: '1',
        parcel: { size_category: 'S' },
      })
    ).rejects.toThrow('does not accept parcels');
  });

  // RB-DEL-2: Cannot request delivery on own trip
  it('RB-DEL-2: should reject if sender is the driver', async () => {
    const { createDelivery } = await import('../src/modules/deliveries/deliveries.service');

    (prisma.trips.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(1),
      driver_id: BigInt(5),
      accepts_parcels: true,
      status: 'published',
      departure_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await expect(
      createDelivery('5', {
        trip_id: '1',
        parcel: { size_category: 'S' },
      })
    ).rejects.toThrow('cannot request a delivery on your own trip');
  });

  // RB-DEL-8: Only recipient can confirm receipt
  it('RB-DEL-8: should reject receipt confirmation by wrong user', async () => {
    const { confirmReceipt } = await import('../src/modules/deliveries/deliveries.service');

    (prisma.deliveries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(10),
      recipient_user_id: BigInt(20),
      sender_id: BigInt(30),
      status: 'delivered',
      trip: { driver_id: BigInt(40), from_city: 'A', to_city: 'B' },
    });

    await expect(confirmReceipt('99', '10')).rejects.toThrow('Only the recipient can confirm receipt');
  });

  // RB-DEL-8: Must be delivered status
  it('RB-DEL-8: should reject receipt if not delivered yet', async () => {
    const { confirmReceipt } = await import('../src/modules/deliveries/deliveries.service');

    (prisma.deliveries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(10),
      recipient_user_id: BigInt(20),
      sender_id: BigInt(30),
      status: 'in_transit',
      trip: { driver_id: BigInt(40), from_city: 'A', to_city: 'B' },
    });

    await expect(confirmReceipt('20', '10')).rejects.toThrow('delivered status before confirming');
  });

  // RB-DEL-7: Only driver can accept
  it('RB-DEL-7: should reject accept by non-driver', async () => {
    const { acceptDelivery } = await import('../src/modules/deliveries/deliveries.service');

    (prisma.deliveries.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BigInt(10),
      status: 'pending',
      sender_id: BigInt(30),
      trip: {
        driver_id: BigInt(40),
        departure_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        driver: { first_name: 'John', last_name: 'Doe' },
        from_city: 'A',
        to_city: 'B',
      },
    });

    await expect(acceptDelivery('99', '10')).rejects.toThrow('Only the trip driver');
  });
});
