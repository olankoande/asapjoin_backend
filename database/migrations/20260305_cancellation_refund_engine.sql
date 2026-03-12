-- ============================================================
-- Migration: Cancellation & Refund Engine
-- Date: 2026-03-05
-- MySQL 5.6 compatible — no JSON columns
-- ============================================================

-- 1) refund_policies — paramétrable par acteur et type de ressource
CREATE TABLE IF NOT EXISTS refund_policies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  resource_type   ENUM('booking','delivery') NOT NULL,
  actor_role      ENUM('passenger','sender','driver','admin') NOT NULL,
  name            VARCHAR(120) NOT NULL,
  active          TINYINT(1) NOT NULL DEFAULT 1,

  -- Fenêtre d'annulation : heures min avant départ pour pouvoir annuler
  min_hours_before_departure INT NOT NULL DEFAULT 0,

  -- Délai max (heures) après l'événement pour demander un remboursement
  refund_request_deadline_hours INT NOT NULL DEFAULT 0,

  -- Frais d'annulation
  cancellation_fee_fixed_cents  INT NOT NULL DEFAULT 0,
  cancellation_fee_percent      DECIMAL(5,2) NOT NULL DEFAULT 0.00,

  -- Pourcentage remboursé au client
  refund_percent_to_customer    DECIMAL(5,2) NOT NULL DEFAULT 100.00,

  -- Compensation conducteur (% du net conducteur)
  driver_compensation_percent   DECIMAL(5,2) NOT NULL DEFAULT 0.00,

  -- Statuts autorisés pour cette policy (CSV, ex: 'pending,accepted,paid')
  applies_when_statuses         TEXT NOT NULL,

  -- Priorité (plus élevé = plus prioritaire quand plusieurs policies matchent)
  priority                      INT NOT NULL DEFAULT 0,

  notes       VARCHAR(500) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_refund_policies_lookup (resource_type, actor_role, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 2) cancellation_requests — demandes d'annulation / décisions
CREATE TABLE IF NOT EXISTS cancellation_requests (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  resource_type           ENUM('booking','delivery') NOT NULL,
  resource_id             BIGINT UNSIGNED NOT NULL,
  actor_user_id           BIGINT UNSIGNED NOT NULL,
  actor_role              ENUM('passenger','sender','driver','admin') NOT NULL,
  reason                  VARCHAR(255) NULL,

  -- Montants calculés (en cents)
  original_amount_cents   INT NOT NULL DEFAULT 0,
  calculated_refund_cents INT NOT NULL DEFAULT 0,
  calculated_fee_cents    INT NOT NULL DEFAULT 0,
  driver_reversal_cents   INT NOT NULL DEFAULT 0,
  commission_reversal_cents INT NOT NULL DEFAULT 0,
  driver_compensation_cents INT NOT NULL DEFAULT 0,

  policy_id               BIGINT UNSIGNED NULL,
  policy_snapshot         TEXT NULL,

  status                  ENUM('requested','approved','rejected','refunded','closed') NOT NULL DEFAULT 'requested',

  stripe_refund_id        VARCHAR(255) NULL,
  refund_id               BIGINT UNSIGNED NULL,

  is_admin_override       TINYINT(1) NOT NULL DEFAULT 0,

  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at            DATETIME NULL,

  INDEX idx_cancellation_req_resource (resource_type, resource_id),
  INDEX idx_cancellation_req_actor (actor_user_id),
  INDEX idx_cancellation_req_status (status, created_at),
  INDEX idx_cancellation_req_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- 3) Seed default refund policies

-- Passenger booking: >24h = 100%, 6-24h = 50%, <6h = 0%
INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
VALUES
  ('booking', 'passenger', 'Passager >24h avant départ', 1, 24, 48, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 30, 'Remboursement total si annulation >24h avant départ'),
  ('booking', 'passenger', 'Passager 6-24h avant départ', 1, 6, 48, 0, 0.00, 50.00, 25.00, 'pending,accepted,paid', 20, 'Remboursement 50% si annulation 6-24h avant départ'),
  ('booking', 'passenger', 'Passager <6h avant départ', 1, 0, 48, 0, 0.00, 0.00, 50.00, 'pending,accepted,paid', 10, 'Aucun remboursement si annulation <6h avant départ');

-- Driver booking
INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
VALUES
  ('booking', 'driver', 'Conducteur annule booking', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 10, 'Remboursement total passager si conducteur annule');

-- Sender delivery: >12h = 100%, <12h = 50%
INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
VALUES
  ('delivery', 'sender', 'Expéditeur >12h avant départ', 1, 12, 24, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 20, 'Remboursement total si annulation >12h avant départ'),
  ('delivery', 'sender', 'Expéditeur <12h avant départ', 1, 0, 24, 0, 0.00, 50.00, 25.00, 'pending,accepted,paid', 10, 'Remboursement 50% si annulation <12h avant départ');

-- Driver delivery
INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
VALUES
  ('delivery', 'driver', 'Conducteur annule delivery', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 10, 'Remboursement total expéditeur si conducteur annule');

-- Admin (override — toujours autorisé)
INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
VALUES
  ('booking', 'admin', 'Admin override booking', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid,completed', 100, 'Admin peut toujours annuler/rembourser'),
  ('delivery', 'admin', 'Admin override delivery', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid,in_transit,delivered', 100, 'Admin peut toujours annuler/rembourser');
