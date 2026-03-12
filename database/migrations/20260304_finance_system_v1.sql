-- ============================================================
-- Migration: Finance System V1 — Commissions, Ledger, Disputes, Payouts
-- Date: 2026-03-04
-- MySQL 5.6 compatible
-- ============================================================

-- ─── A) platform_fee_settings ───
CREATE TABLE IF NOT EXISTS platform_fee_settings (
  id                      INT UNSIGNED NOT NULL DEFAULT 1,
  booking_fee_pct         DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  booking_fee_fixed_cents INT NOT NULL DEFAULT 0,
  delivery_fee_pct        DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  delivery_fee_fixed_cents INT NOT NULL DEFAULT 0,
  hold_days_before_available INT NOT NULL DEFAULT 7,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insert default row
INSERT IGNORE INTO platform_fee_settings (id) VALUES (1);

-- ─── B) Alter wallets: rename columns to _cents for clarity ───
-- Add _cents columns if they don't exist (keep old columns for backward compat)
ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS pending_cents BIGINT NOT NULL DEFAULT 0 AFTER currency,
  ADD COLUMN IF NOT EXISTS available_cents BIGINT NOT NULL DEFAULT 0 AFTER pending_cents;

-- Migrate existing data (Decimal dollars -> cents)
UPDATE wallets SET
  pending_cents = ROUND(pending_balance * 100),
  available_cents = ROUND(available_balance * 100)
WHERE pending_cents = 0 AND (pending_balance > 0 OR available_balance > 0);

-- ─── C) Alter wallet_transactions: add direction, status, txn_type, snapshot_json ───
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS direction ENUM('credit','debit') NOT NULL DEFAULT 'credit' AFTER wallet_id,
  ADD COLUMN IF NOT EXISTS amount_cents BIGINT NOT NULL DEFAULT 0 AFTER direction,
  ADD COLUMN IF NOT EXISTS status ENUM('pending','posted','reversed') NOT NULL DEFAULT 'posted' AFTER amount_cents,
  ADD COLUMN IF NOT EXISTS txn_type VARCHAR(60) NOT NULL DEFAULT 'adjustment' AFTER status,
  ADD COLUMN IF NOT EXISTS snapshot_json TEXT NULL AFTER reference_id,
  ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL AFTER wallet_id;

-- Migrate existing amount (Decimal dollars -> cents)
UPDATE wallet_transactions SET amount_cents = ROUND(amount * 100) WHERE amount_cents = 0 AND amount > 0;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_wt_user_created ON wallet_transactions (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wt_txn_type ON wallet_transactions (txn_type);

-- ─── D) Alter payments: add kind column ───
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS kind ENUM('booking','delivery') NULL AFTER id,
  ADD COLUMN IF NOT EXISTS amount_cents BIGINT NOT NULL DEFAULT 0 AFTER amount;

-- Populate kind from existing data
UPDATE payments SET kind = 'booking' WHERE booking_id IS NOT NULL AND kind IS NULL;
UPDATE payments SET kind = 'delivery' WHERE delivery_id IS NOT NULL AND kind IS NULL;
UPDATE payments SET amount_cents = ROUND(amount * 100) WHERE amount_cents = 0 AND amount > 0;

-- ─── E) Alter refunds: add amount_cents ───
ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS amount_cents BIGINT NOT NULL DEFAULT 0 AFTER amount;

UPDATE refunds SET amount_cents = ROUND(amount * 100) WHERE amount_cents = 0 AND amount > 0;

-- ─── F) Disputes table ───
CREATE TABLE IF NOT EXISTS disputes (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind            ENUM('booking','delivery') NOT NULL,
  reference_id    BIGINT UNSIGNED NOT NULL,
  opened_by       BIGINT UNSIGNED NOT NULL,
  reason          VARCHAR(500) NOT NULL,
  status          ENUM('open','investigating','resolved_refund','resolved_release','resolved_split','closed') NOT NULL DEFAULT 'open',
  hold_amount_cents BIGINT NOT NULL DEFAULT 0,
  resolution_note TEXT NULL,
  resolved_by     BIGINT UNSIGNED NULL,
  resolved_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_disputes_kind_ref (kind, reference_id),
  INDEX idx_disputes_status (status, created_at),
  INDEX idx_disputes_opened_by (opened_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── G) Alter payout_batches: add provider column ───
ALTER TABLE payout_batches
  ADD COLUMN IF NOT EXISTS provider ENUM('interac','bank_transfer','wise','manual') NOT NULL DEFAULT 'manual' AFTER status,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL;

-- ─── H) Alter payouts: add provider_reference, payout_email, payout_phone ───
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS payout_email VARCHAR(255) NULL AFTER destination,
  ADD COLUMN IF NOT EXISTS payout_phone VARCHAR(50) NULL AFTER payout_email,
  ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(255) NULL AFTER payout_phone,
  ADD COLUMN IF NOT EXISTS paid_at DATETIME NULL;

-- ─── I) Alter users: add payout_phone if not exists ───
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_phone VARCHAR(50) NULL AFTER payout_email;

-- ─── J) Add reference_type values for wallet_transactions ───
-- MySQL 5.6: ALTER ENUM by modifying column
-- We need to support: booking, delivery, refund, payout, adjustment, payment, payout_batch, dispute, system
ALTER TABLE wallet_transactions
  MODIFY COLUMN reference_type ENUM('booking','delivery','refund','payout','adjustment','payment','payout_batch','dispute','system') NOT NULL DEFAULT 'payment';


