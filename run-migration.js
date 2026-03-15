const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  const statements = [
    // 1) Add columns to conversations
    `ALTER TABLE conversations ADD COLUMN \`type\` ENUM('booking','delivery') NOT NULL DEFAULT 'booking' AFTER id`,
    `ALTER TABLE conversations ADD COLUMN \`status\` ENUM('open','closed','archived') NOT NULL DEFAULT 'open' AFTER delivery_id`,
    `ALTER TABLE conversations ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER \`status\``,
    `ALTER TABLE conversations ADD COLUMN last_message_at DATETIME NULL AFTER created_by`,
    `ALTER TABLE conversations ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`,

    // 2) Create conversation_participants table
    `CREATE TABLE IF NOT EXISTS conversation_participants (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // 3) Add columns to messages
    `ALTER TABLE messages ADD COLUMN message_type ENUM('text','system') NOT NULL DEFAULT 'text' AFTER sender_id`,
    `ALTER TABLE messages ADD COLUMN deleted_at DATETIME NULL AFTER created_at`,
    `ALTER TABLE messages MODIFY COLUMN sender_id BIGINT UNSIGNED NULL`,

    // 4) Populate conversation_participants from existing data
    `INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
     SELECT c.id, b.passenger_id, 'passenger', c.created_at
     FROM conversations c JOIN bookings b ON c.booking_id = b.id WHERE c.booking_id IS NOT NULL`,

    `INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
     SELECT c.id, t.driver_id, 'driver', c.created_at
     FROM conversations c JOIN bookings b ON c.booking_id = b.id JOIN trips t ON b.trip_id = t.id WHERE c.booking_id IS NOT NULL`,

    `INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
     SELECT c.id, d.sender_id, 'sender', c.created_at
     FROM conversations c JOIN deliveries d ON c.delivery_id = d.id WHERE c.delivery_id IS NOT NULL`,

    `INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
     SELECT c.id, t.driver_id, 'driver', c.created_at
     FROM conversations c JOIN deliveries d ON c.delivery_id = d.id JOIN trips t ON d.trip_id = t.id WHERE c.delivery_id IS NOT NULL`,

    `INSERT IGNORE INTO conversation_participants (conversation_id, user_id, role, created_at)
     SELECT c.id, d.recipient_user_id, 'recipient', c.created_at
     FROM conversations c JOIN deliveries d ON c.delivery_id = d.id WHERE c.delivery_id IS NOT NULL AND d.recipient_user_id IS NOT NULL`,

    // 5) Set type column
    `UPDATE conversations SET \`type\` = 'booking' WHERE booking_id IS NOT NULL`,
    `UPDATE conversations SET \`type\` = 'delivery' WHERE delivery_id IS NOT NULL`,

    // 6) Set last_message_at
    `UPDATE conversations c SET last_message_at = (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id)`,
  ];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      console.log(`[${i+1}/${statements.length}] ${stmt.substring(0, 80).replace(/\n/g,' ')}...`);
      await prisma.$executeRawUnsafe(stmt);
      console.log('  ✓ OK');
    } catch (err) {
      if (err.message && (err.message.includes('Duplicate column') || err.message.includes('already exists') || err.message.includes('1060'))) {
        console.log(`  ⚠ Skipped (already exists)`);
      } else {
        console.error(`  ✗ Error: ${err.message}`);
      }
    }
  }

  await prisma.$disconnect();
  console.log('\n✅ Migration complete!');
}

main().catch(console.error);
