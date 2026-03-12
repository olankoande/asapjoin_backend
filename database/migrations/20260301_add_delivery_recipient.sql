-- Migration: Add recipient_user_id and received_at to deliveries
-- Also add 'received' to deliveries_status enum

-- 1) Add recipient_user_id column
ALTER TABLE deliveries
  ADD COLUMN recipient_user_id BIGINT UNSIGNED NULL AFTER sender_id;

-- 2) Add received_at column
ALTER TABLE deliveries
  ADD COLUMN received_at DATETIME NULL AFTER cancel_reason;

-- 3) Add 'received' to the deliveries_status enum
ALTER TABLE deliveries
  MODIFY COLUMN status ENUM('pending','accepted','rejected','paid','in_transit','delivered','cancelled','disputed','received') NOT NULL DEFAULT 'pending';

-- 4) Add index for recipient queries
CREATE INDEX idx_deliveries_recipient ON deliveries (recipient_user_id, status, created_at);

-- 5) Add foreign key
ALTER TABLE deliveries
  ADD CONSTRAINT fk_deliveries_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id);
