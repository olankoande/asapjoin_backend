/**
 * Refund Policy Service — Resolves and manages paramétrable refund policies.
 *
 * Uses raw SQL for MySQL 5.6 compatibility.
 * Policies are stored in refund_policies table and queried by:
 *   - resource_type (booking | delivery)
 *   - actor_role (passenger | sender | driver | admin)
 *   - active status
 *   - applies_when_statuses (CSV match)
 *   - min_hours_before_departure (window matching)
 */

import { prisma } from '../../db/prisma';
import { logger } from '../../config/logger';
import { Errors } from '../../utils/errors';

export interface RefundPolicy {
  id: bigint;
  resource_type: 'booking' | 'delivery';
  actor_role: 'passenger' | 'sender' | 'driver' | 'admin';
  name: string;
  active: boolean;
  min_hours_before_departure: number;
  refund_request_deadline_hours: number;
  cancellation_fee_fixed_cents: number;
  cancellation_fee_percent: number;
  refund_percent_to_customer: number;
  driver_compensation_percent: number;
  applies_when_statuses: string;
  priority: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Parse applies_when_statuses CSV into an array.
 */
export function parseStatuses(csv: string): string[] {
  return csv.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Resolve the best applicable refund policy for a given context.
 *
 * Selection logic:
 * 1. Filter by resource_type, actor_role, active=1
 * 2. Filter by status match (CSV contains current status)
 * 3. Filter by min_hours_before_departure <= hoursBeforeDeparture
 * 4. Order by priority DESC, min_hours_before_departure DESC
 * 5. Return the first (highest priority, most specific window)
 */
export async function resolveApplicableRefundPolicy(
  resourceType: 'booking' | 'delivery',
  actorRole: 'passenger' | 'sender' | 'driver' | 'admin',
  currentStatus: string,
  departureAt: Date,
  now: Date = new Date(),
): Promise<RefundPolicy | null> {
  const hoursBeforeDeparture = (departureAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Fetch all active policies for this resource_type + actor_role
  const rows = await prisma.$queryRaw<RefundPolicy[]>`
    SELECT * FROM refund_policies
    WHERE resource_type = ${resourceType}
      AND actor_role = ${actorRole}
      AND active = 1
    ORDER BY priority DESC, min_hours_before_departure DESC
  `;

  if (!rows || rows.length === 0) {
    logger.debug(`No refund policy found for ${resourceType}/${actorRole}`);
    return null;
  }

  // Find the best matching policy
  for (const policy of rows) {
    // Check status match
    const allowedStatuses = parseStatuses(policy.applies_when_statuses);
    if (!allowedStatuses.includes(currentStatus)) {
      continue;
    }

    // Check time window: policy.min_hours_before_departure is the MINIMUM hours
    // before departure that this policy applies. So if hoursBeforeDeparture >= min_hours,
    // this policy is applicable.
    const minHours = Number(policy.min_hours_before_departure);
    if (hoursBeforeDeparture >= minHours) {
      return {
        ...policy,
        id: BigInt(policy.id),
        min_hours_before_departure: Number(policy.min_hours_before_departure),
        refund_request_deadline_hours: Number(policy.refund_request_deadline_hours),
        cancellation_fee_fixed_cents: Number(policy.cancellation_fee_fixed_cents),
        cancellation_fee_percent: Number(policy.cancellation_fee_percent),
        refund_percent_to_customer: Number(policy.refund_percent_to_customer),
        driver_compensation_percent: Number(policy.driver_compensation_percent),
        priority: Number(policy.priority),
        active: Boolean(policy.active),
      };
    }
  }

  // If departure is in the past and we have a 0-hour policy, use it
  // (already handled above since hoursBeforeDeparture can be negative and >= 0 won't match,
  //  but we want the lowest min_hours policy for past departures)
  if (hoursBeforeDeparture < 0) {
    // Find the policy with min_hours = 0 that matches status
    for (const policy of rows) {
      const allowedStatuses = parseStatuses(policy.applies_when_statuses);
      if (!allowedStatuses.includes(currentStatus)) continue;
      if (Number(policy.min_hours_before_departure) === 0) {
        return {
          ...policy,
          id: BigInt(policy.id),
          min_hours_before_departure: Number(policy.min_hours_before_departure),
          refund_request_deadline_hours: Number(policy.refund_request_deadline_hours),
          cancellation_fee_fixed_cents: Number(policy.cancellation_fee_fixed_cents),
          cancellation_fee_percent: Number(policy.cancellation_fee_percent),
          refund_percent_to_customer: Number(policy.refund_percent_to_customer),
          driver_compensation_percent: Number(policy.driver_compensation_percent),
          priority: Number(policy.priority),
          active: Boolean(policy.active),
        };
      }
    }
  }

  logger.debug(`No matching refund policy for ${resourceType}/${actorRole} status=${currentStatus} hours=${hoursBeforeDeparture.toFixed(1)}`);
  return null;
}

/**
 * Validate that cancellation is still within the allowed time window.
 * Throws CANCELLATION_NOT_ALLOWED if the departure is too close.
 */
export function validateCancellationWindow(
  policy: RefundPolicy,
  departureAt: Date,
  now: Date = new Date(),
): void {
  // Admin can always cancel
  if (policy.actor_role === 'admin') return;

  const hoursBeforeDeparture = (departureAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  const minHours = policy.min_hours_before_departure;

  // The policy already matched based on min_hours, so this is a secondary check
  // for edge cases where the policy was resolved but time has passed
  if (hoursBeforeDeparture < minHours && minHours > 0) {
    throw Errors.badRequest(
      `L'annulation n'est plus autorisée. Minimum ${minHours}h avant le départ requis.`,
      'CANCELLATION_NOT_ALLOWED',
    );
  }
}

/**
 * Validate that the refund request is within the allowed deadline.
 * Throws REFUND_REQUEST_WINDOW_EXPIRED if the deadline has passed.
 *
 * @param policy - The applicable refund policy
 * @param eventDate - The date of the event (departure_at for bookings, delivered_at for deliveries)
 * @param now - Current time
 */
export function validateRefundRequestWindow(
  policy: RefundPolicy,
  eventDate: Date,
  now: Date = new Date(),
): void {
  // Admin can always request
  if (policy.actor_role === 'admin') return;

  const deadlineHours = policy.refund_request_deadline_hours;
  if (deadlineHours <= 0) return; // 0 = no deadline

  const hoursSinceEvent = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60);

  if (hoursSinceEvent > deadlineHours) {
    throw Errors.badRequest(
      `Le délai de demande de remboursement est dépassé (${deadlineHours}h après l'événement).`,
      'REFUND_REQUEST_WINDOW_EXPIRED',
    );
  }
}

// ─── Admin CRUD ───

/**
 * List all refund policies (admin).
 */
export async function listRefundPolicies(filters?: {
  resource_type?: string;
  actor_role?: string;
  active?: boolean;
}): Promise<RefundPolicy[]> {
  let query = 'SELECT * FROM refund_policies WHERE 1=1';
  const params: any[] = [];

  if (filters?.resource_type) {
    query += ' AND resource_type = ?';
    params.push(filters.resource_type);
  }
  if (filters?.actor_role) {
    query += ' AND actor_role = ?';
    params.push(filters.actor_role);
  }
  if (filters?.active !== undefined) {
    query += ' AND active = ?';
    params.push(filters.active ? 1 : 0);
  }

  query += ' ORDER BY resource_type, actor_role, priority DESC';

  const rows = await prisma.$queryRawUnsafe<RefundPolicy[]>(query, ...params);
  return rows.map(normalizePolicy);
}

/**
 * Create a new refund policy (admin).
 */
export async function createRefundPolicy(input: {
  resource_type: string;
  actor_role: string;
  name: string;
  min_hours_before_departure?: number;
  refund_request_deadline_hours?: number;
  cancellation_fee_fixed_cents?: number;
  cancellation_fee_percent?: number;
  refund_percent_to_customer?: number;
  driver_compensation_percent?: number;
  applies_when_statuses: string;
  priority?: number;
  notes?: string;
}): Promise<RefundPolicy> {
  await prisma.$executeRaw`
    INSERT INTO refund_policies
      (resource_type, actor_role, name, active, min_hours_before_departure,
       refund_request_deadline_hours, cancellation_fee_fixed_cents, cancellation_fee_percent,
       refund_percent_to_customer, driver_compensation_percent, applies_when_statuses,
       priority, notes, created_at, updated_at)
    VALUES
      (${input.resource_type}, ${input.actor_role}, ${input.name}, 1,
       ${input.min_hours_before_departure ?? 0},
       ${input.refund_request_deadline_hours ?? 0},
       ${input.cancellation_fee_fixed_cents ?? 0},
       ${input.cancellation_fee_percent ?? 0},
       ${input.refund_percent_to_customer ?? 100},
       ${input.driver_compensation_percent ?? 0},
       ${input.applies_when_statuses},
       ${input.priority ?? 0},
       ${input.notes ?? null},
       NOW(), NOW())
  `;

  // Get the last inserted ID
  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`SELECT LAST_INSERT_ID() as id`;
  const newId = rows[0].id;

  const result = await prisma.$queryRaw<RefundPolicy[]>`
    SELECT * FROM refund_policies WHERE id = ${newId}
  `;
  return normalizePolicy(result[0]);
}

/**
 * Update a refund policy (admin).
 */
export async function updateRefundPolicy(
  policyId: bigint,
  input: Partial<{
    name: string;
    min_hours_before_departure: number;
    refund_request_deadline_hours: number;
    cancellation_fee_fixed_cents: number;
    cancellation_fee_percent: number;
    refund_percent_to_customer: number;
    driver_compensation_percent: number;
    applies_when_statuses: string;
    priority: number;
    notes: string | null;
  }>,
): Promise<RefundPolicy> {
  // Build SET clause dynamically
  const setClauses: string[] = [];
  const params: any[] = [];

  if (input.name !== undefined) { setClauses.push('name = ?'); params.push(input.name); }
  if (input.min_hours_before_departure !== undefined) { setClauses.push('min_hours_before_departure = ?'); params.push(input.min_hours_before_departure); }
  if (input.refund_request_deadline_hours !== undefined) { setClauses.push('refund_request_deadline_hours = ?'); params.push(input.refund_request_deadline_hours); }
  if (input.cancellation_fee_fixed_cents !== undefined) { setClauses.push('cancellation_fee_fixed_cents = ?'); params.push(input.cancellation_fee_fixed_cents); }
  if (input.cancellation_fee_percent !== undefined) { setClauses.push('cancellation_fee_percent = ?'); params.push(input.cancellation_fee_percent); }
  if (input.refund_percent_to_customer !== undefined) { setClauses.push('refund_percent_to_customer = ?'); params.push(input.refund_percent_to_customer); }
  if (input.driver_compensation_percent !== undefined) { setClauses.push('driver_compensation_percent = ?'); params.push(input.driver_compensation_percent); }
  if (input.applies_when_statuses !== undefined) { setClauses.push('applies_when_statuses = ?'); params.push(input.applies_when_statuses); }
  if (input.priority !== undefined) { setClauses.push('priority = ?'); params.push(input.priority); }
  if (input.notes !== undefined) { setClauses.push('notes = ?'); params.push(input.notes); }

  if (setClauses.length === 0) {
    throw Errors.badRequest('No fields to update');
  }

  setClauses.push('updated_at = NOW()');
  params.push(policyId);

  await prisma.$executeRawUnsafe(
    `UPDATE refund_policies SET ${setClauses.join(', ')} WHERE id = ?`,
    ...params,
  );

  const result = await prisma.$queryRaw<RefundPolicy[]>`
    SELECT * FROM refund_policies WHERE id = ${policyId}
  `;
  if (!result || result.length === 0) throw Errors.notFound('RefundPolicy');
  return normalizePolicy(result[0]);
}

/**
 * Activate a refund policy.
 */
export async function activateRefundPolicy(policyId: bigint): Promise<RefundPolicy> {
  await prisma.$executeRaw`
    UPDATE refund_policies SET active = 1, updated_at = NOW() WHERE id = ${policyId}
  `;
  const result = await prisma.$queryRaw<RefundPolicy[]>`
    SELECT * FROM refund_policies WHERE id = ${policyId}
  `;
  if (!result || result.length === 0) throw Errors.notFound('RefundPolicy');
  return normalizePolicy(result[0]);
}

/**
 * Deactivate a refund policy.
 */
export async function deactivateRefundPolicy(policyId: bigint): Promise<RefundPolicy> {
  await prisma.$executeRaw`
    UPDATE refund_policies SET active = 0, updated_at = NOW() WHERE id = ${policyId}
  `;
  const result = await prisma.$queryRaw<RefundPolicy[]>`
    SELECT * FROM refund_policies WHERE id = ${policyId}
  `;
  if (!result || result.length === 0) throw Errors.notFound('RefundPolicy');
  return normalizePolicy(result[0]);
}

/**
 * Normalize raw DB row to typed RefundPolicy.
 */
function normalizePolicy(row: any): RefundPolicy {
  return {
    id: BigInt(row.id),
    resource_type: row.resource_type,
    actor_role: row.actor_role,
    name: row.name,
    active: Boolean(row.active),
    min_hours_before_departure: Number(row.min_hours_before_departure),
    refund_request_deadline_hours: Number(row.refund_request_deadline_hours),
    cancellation_fee_fixed_cents: Number(row.cancellation_fee_fixed_cents),
    cancellation_fee_percent: Number(row.cancellation_fee_percent),
    refund_percent_to_customer: Number(row.refund_percent_to_customer),
    driver_compensation_percent: Number(row.driver_compensation_percent),
    applies_when_statuses: row.applies_when_statuses,
    priority: Number(row.priority),
    notes: row.notes || null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}
