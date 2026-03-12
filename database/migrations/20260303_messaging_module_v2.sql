-- ============================================================
-- Migration: Messaging Module V2
-- Date: 2026-03-03
-- Description: Add conversation_participants, enhance conversations & messages
-- ============================================================

-- 1) Add missing columns to conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS `type` ENUM('booking','delivery') NOT NULL DEFAULT 'booking' AFTER id,
  ADD COLUMN IF NOT EXISTS `status` ENUM('open','closed','archived') NOT NULL DEFAULT 'open' AFTER delivery_id,
  ADD COLUMN IF NOT EXISTS `created_by` BIGINT UNSIGNED NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `last_message_at` DATETIME NULL AFTER created_by,
  ADD COLUMN IF NOT EXISTS `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- 2) Create conversation_participants table
CREATE TABLE IF NOT EXISTS conversation_participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('driver','passenger','sender','recipient','admin_viewer') NOT NULL DEFAULT 'passenger',
  last_read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_cp_conversation (conversation_id),
  INDEX idx_cp_user (user_id),
  UNIQUE INDEX uq_cp_conv_user (conversation_id, user_id),
  CONSTRAINT fk_cp_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Add missing columns to messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS `message_type` ENUM('text','system') NOT NULL DEFAULT 'text' AFTER sender_id,
  ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME NULL AFTER created_at;

-- Make sender_id nullable (for system messages)
ALTER TABLE messages MODIFY COLUMN sender_id BIGINT UNSIGNED NULL;

-- 4) Populate conversation_participants from existing conversations
-- For booking conversations: add driver + passenger
INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
SELECT c.id, b.passenger_id, 'passenger', c.created_at
FROM conversations c
JOIN bookings b ON c.booking_id = b.id
WHERE c.booking_id IS NOT NULL;

INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
SELECT c.id, t.driver_id, 'driver', c.created_at
FROM conversations c
JOIN bookings b ON c.booking_id = b.id
JOIN trips t ON b.trip_id = t.id
WHERE c.booking_id IS NOT NULL;

-- For delivery conversations: add driver + sender
INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
SELECT c.id, d.sender_id, 'sender', c.created_at
FROM conversations c
JOIN deliveries d ON c.delivery_id = d.id
WHERE c.delivery_id IS NOT NULL;

INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
SELECT c.id, t.driver_id, 'driver', c.created_at
FROM conversations c
JOIN deliveries d ON c.delivery_id = d.id
JOIN trips t ON d.trip_id = t.id
WHERE c.delivery_id IS NOT NULL;

-- Add recipient for delivery conversations (if exists)
INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
SELECT c.id, d.recipient_user_id, 'recipient', c.created_at
FROM conversations c
JOIN deliveries d ON c.delivery_id = d.id
WHERE c.delivery_id IS NOT NULL AND d.recipient_user_id IS NOT NULL;

-- 5) Set type column based on existing data
UPDATE conversations SET `type` = 'booking' WHERE booking_id IS NOT NULL;
UPDATE conversations SET `type` = 'delivery' WHERE delivery_id IS NOT NULL;

-- 6) Set last_message_at from existing messages
UPDATE conversations c
SET last_message_at = (
  SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id
);
