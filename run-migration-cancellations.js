/**
 * Run the cancellation_refund_engine migration (20260305)
 * Creates: refund_policies, cancellation_requests tables + seed data
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  const statements = [
    // 1) refund_policies table
    `CREATE TABLE IF NOT EXISTS refund_policies (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      resource_type   ENUM('booking','delivery') NOT NULL,
      actor_role      ENUM('passenger','sender','driver','admin') NOT NULL,
      name            VARCHAR(120) NOT NULL,
      active          TINYINT(1) NOT NULL DEFAULT 1,
      min_hours_before_departure INT NOT NULL DEFAULT 0,
      refund_request_deadline_hours INT NOT NULL DEFAULT 0,
      cancellation_fee_fixed_cents  INT NOT NULL DEFAULT 0,
      cancellation_fee_percent      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      refund_percent_to_customer    DECIMAL(5,2) NOT NULL DEFAULT 100.00,
      driver_compensation_percent   DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      applies_when_statuses         TEXT NOT NULL,
      priority                      INT NOT NULL DEFAULT 0,
      notes       VARCHAR(500) NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_refund_policies_lookup (resource_type, actor_role, active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // 2) cancellation_requests table
    `CREATE TABLE IF NOT EXISTS cancellation_requests (
      id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      resource_type           ENUM('booking','delivery') NOT NULL,
      resource_id             BIGINT UNSIGNED NOT NULL,
      actor_user_id           BIGINT UNSIGNED NOT NULL,
      actor_role              ENUM('passenger','sender','driver','admin') NOT NULL,
      reason                  VARCHAR(255) NULL,
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // 3) Seed default refund policies (only if table is empty)
    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'booking', 'passenger', 'Passager >24h avant départ', 1, 24, 48, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 30, 'Remboursement total si annulation >24h avant départ'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'booking', 'passenger', 'Passager 6-24h avant départ', 1, 6, 48, 0, 0.00, 50.00, 25.00, 'pending,accepted,paid', 20, 'Remboursement 50% si annulation 6-24h avant départ'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Passager 6-24h avant départ' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'booking', 'passenger', 'Passager <6h avant départ', 1, 0, 48, 0, 0.00, 0.00, 50.00, 'pending,accepted,paid', 10, 'Aucun remboursement si annulation <6h avant départ'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Passager <6h avant départ' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'booking', 'driver', 'Conducteur annule booking', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 10, 'Remboursement total passager si conducteur annule'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Conducteur annule booking' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'delivery', 'sender', 'Expéditeur >12h avant départ', 1, 12, 24, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 20, 'Remboursement total si annulation >12h avant départ'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Expéditeur >12h avant départ' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'delivery', 'sender', 'Expéditeur <12h avant départ', 1, 0, 24, 0, 0.00, 50.00, 25.00, 'pending,accepted,paid', 10, 'Remboursement 50% si annulation <12h avant départ'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Expéditeur <12h avant départ' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'delivery', 'driver', 'Conducteur annule delivery', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid', 10, 'Remboursement total expéditeur si conducteur annule'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Conducteur annule delivery' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'booking', 'admin', 'Admin override booking', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid,completed', 100, 'Admin peut toujours annuler/rembourser'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Admin override booking' LIMIT 1)`,

    `INSERT INTO refund_policies (resource_type, actor_role, name, active, min_hours_before_departure, refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent, refund_percent_to_customer, driver_compensation_percent, applies_when_statuses, priority, notes)
    SELECT 'delivery', 'admin', 'Admin override delivery', 1, 0, 0, 0, 0.00, 100.00, 0.00, 'pending,accepted,paid,in_transit,delivered', 100, 'Admin peut toujours annuler/rembourser'
    FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM refund_policies WHERE name = 'Admin override delivery' LIMIT 1)`,
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
  console.log('\n✅ Cancellation/Refund migration complete!');
}

main().catch(console.error);
