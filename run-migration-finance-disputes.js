/**
 * Run the finance_system_v1 + dispute_replies migrations
 * Creates: platform_fee_settings, disputes, dispute_replies tables
 * Alters: wallets (pending_cents, available_cents), wallet_transactions, payments, refunds, payouts, users
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  const statements = [
    // A) platform_fee_settings
    `CREATE TABLE IF NOT EXISTS platform_fee_settings (
      id                      INT UNSIGNED NOT NULL DEFAULT 1,
      booking_fee_pct         DECIMAL(5,2) NOT NULL DEFAULT 10.00,
      booking_fee_fixed_cents INT NOT NULL DEFAULT 0,
      delivery_fee_pct        DECIMAL(5,2) NOT NULL DEFAULT 10.00,
      delivery_fee_fixed_cents INT NOT NULL DEFAULT 0,
      hold_days_before_available INT NOT NULL DEFAULT 7,
      created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `INSERT IGNORE INTO platform_fee_settings (id) VALUES (1)`,

    // B) Alter wallets: add _cents columns
    `ALTER TABLE wallets ADD COLUMN pending_cents BIGINT NOT NULL DEFAULT 0 AFTER currency`,
    `ALTER TABLE wallets ADD COLUMN available_cents BIGINT NOT NULL DEFAULT 0 AFTER pending_cents`,

    // Migrate existing data
    `UPDATE wallets SET pending_cents = ROUND(pending_balance * 100), available_cents = ROUND(available_balance * 100) WHERE pending_cents = 0 AND (pending_balance > 0 OR available_balance > 0)`,

    // C) Alter wallet_transactions
    `ALTER TABLE wallet_transactions ADD COLUMN direction ENUM('credit','debit') NOT NULL DEFAULT 'credit' AFTER wallet_id`,
    `ALTER TABLE wallet_transactions ADD COLUMN amount_cents BIGINT NOT NULL DEFAULT 0 AFTER direction`,
    `ALTER TABLE wallet_transactions ADD COLUMN status ENUM('pending','posted','reversed') NOT NULL DEFAULT 'posted' AFTER amount_cents`,
    `ALTER TABLE wallet_transactions ADD COLUMN txn_type VARCHAR(60) NOT NULL DEFAULT 'adjustment' AFTER status`,
    `ALTER TABLE wallet_transactions ADD COLUMN snapshot_json TEXT NULL AFTER reference_id`,
    `ALTER TABLE wallet_transactions ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER wallet_id`,

    // Migrate existing amount
    `UPDATE wallet_transactions SET amount_cents = ROUND(amount * 100) WHERE amount_cents = 0 AND amount > 0`,

    // D) Alter payments
    `ALTER TABLE payments ADD COLUMN kind ENUM('booking','delivery') NULL AFTER id`,
    `ALTER TABLE payments ADD COLUMN amount_cents BIGINT NOT NULL DEFAULT 0 AFTER amount`,

    `UPDATE payments SET kind = 'booking' WHERE booking_id IS NOT NULL AND kind IS NULL`,
    `UPDATE payments SET kind = 'delivery' WHERE delivery_id IS NOT NULL AND kind IS NULL`,
    `UPDATE payments SET amount_cents = ROUND(amount * 100) WHERE amount_cents = 0 AND amount > 0`,

    // E) Alter refunds
    `ALTER TABLE refunds ADD COLUMN amount_cents BIGINT NOT NULL DEFAULT 0 AFTER amount`,
    `UPDATE refunds SET amount_cents = ROUND(amount * 100) WHERE amount_cents = 0 AND amount > 0`,

    // F) Disputes table
    `CREATE TABLE IF NOT EXISTS disputes (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // G) Alter payout_batches
    `ALTER TABLE payout_batches ADD COLUMN provider ENUM('interac','bank_transfer','wise','manual') NOT NULL DEFAULT 'manual' AFTER status`,
    `ALTER TABLE payout_batches ADD COLUMN notes TEXT NULL`,

    // H) Alter payouts
    `ALTER TABLE payouts ADD COLUMN payout_email VARCHAR(255) NULL AFTER destination`,
    `ALTER TABLE payouts ADD COLUMN payout_phone VARCHAR(50) NULL AFTER payout_email`,
    `ALTER TABLE payouts ADD COLUMN provider_reference VARCHAR(255) NULL AFTER payout_phone`,
    `ALTER TABLE payouts ADD COLUMN paid_at DATETIME NULL`,

    // I) Alter users
    `ALTER TABLE users ADD COLUMN payout_phone VARCHAR(50) NULL AFTER payout_email`,

    // J) dispute_replies table
    `CREATE TABLE IF NOT EXISTS dispute_replies (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dispute_id      BIGINT UNSIGNED NOT NULL,
      user_id         BIGINT UNSIGNED NOT NULL,
      user_role       ENUM('user','admin','support','system') NOT NULL DEFAULT 'user',
      message         TEXT NOT NULL,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_dr_dispute (dispute_id, created_at),
      INDEX idx_dr_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      const preview = stmt.substring(0, 80).replace(/\n/g, ' ').trim();
      console.log(`[${i + 1}/${statements.length}] ${preview}...`);
      await prisma.$executeRawUnsafe(stmt);
      console.log('  ✓ OK');
    } catch (err) {
      if (
        err.message &&
        (err.message.includes('already exists') ||
          err.message.includes('Duplicate column') ||
          err.message.includes('1060') ||
          err.message.includes('Duplicate'))
      ) {
        console.log(`  ⚠ Skipped (already exists)`);
      } else {
        console.error(`  ✗ Error: ${err.message}`);
      }
    }
  }

  await prisma.$disconnect();
  console.log('\n✅ Finance + Disputes migration complete!');
}

main().catch(console.error);
