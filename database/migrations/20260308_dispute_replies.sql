-- ============================================================
-- Migration: Dispute Replies — User/admin messages on disputes
-- Date: 2026-03-08
-- MySQL 5.6 compatible
-- ============================================================

CREATE TABLE IF NOT EXISTS dispute_replies (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dispute_id      BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  user_role       ENUM('user','admin','support','system') NOT NULL DEFAULT 'user',
  message         TEXT NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_dr_dispute (dispute_id, created_at),
  INDEX idx_dr_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
