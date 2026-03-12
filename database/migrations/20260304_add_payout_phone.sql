-- Migration: Add payout_phone column to users table
-- Date: 2026-03-04
-- Fixes: Unknown column 'u.payout_phone' in payouts.service.ts
-- Note: IF NOT EXISTS is MariaDB only; MySQL will error if column already exists (safe to ignore 1060)

ALTER TABLE users
  ADD COLUMN payout_phone VARCHAR(50) NULL AFTER payout_email;
