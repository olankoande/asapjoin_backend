-- ============================================================
-- Migration: Delivery Module V2
-- Date: 2026-03-03
-- Description:
--   1. Add delivery_mode to trips
--   2. Add timestamp columns to deliveries (accepted_at, in_transit_at, delivered_at)
--   3. Create platform_settings table
--   4. Add missing indexes
--   5. Seed default platform_settings row
-- ============================================================

-- A) Trips: add delivery_mode
ALTER TABLE `trips`
  ADD COLUMN `delivery_mode` ENUM('manual','instant') NOT NULL DEFAULT 'manual'
  AFTER `parcel_base_price`;

-- B) Deliveries: add timestamp columns
ALTER TABLE `deliveries`
  ADD COLUMN `accepted_at` DATETIME NULL AFTER `received_at`,
  ADD COLUMN `in_transit_at` DATETIME NULL AFTER `accepted_at`,
  ADD COLUMN `delivered_at` DATETIME NULL AFTER `in_transit_at`;

-- C) Platform Settings table
CREATE TABLE IF NOT EXISTS `platform_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deliveries_min_hours_before_departure` INT NOT NULL DEFAULT 2,
  `deliveries_min_minutes_before_departure` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- D) Seed default row (id=1)
INSERT INTO `platform_settings` (`id`, `deliveries_min_hours_before_departure`, `deliveries_min_minutes_before_departure`)
VALUES (1, 2, 0)
ON DUPLICATE KEY UPDATE `id` = `id`;

-- E) Indexes (IF NOT EXISTS not supported in MySQL 5.6 for indexes, use safe approach)
-- trips(delivery_mode)
CREATE INDEX `idx_trips_delivery_mode` ON `trips` (`delivery_mode`);
