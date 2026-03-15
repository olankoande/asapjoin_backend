/**
 * Refund Calculator — Computes all refund amounts based on policy.
 *
 * All amounts in CENTS (integer). No floats for financial calculations.
 * Deterministic rounding: Math.round() applied consistently.
 */

import type { RefundPolicy } from './refundPolicyService';

export interface RefundCalculationInput {
  gross_amount_cents: number;       // Total charged to customer
  platform_fee_cents: number;       // Platform commission
  driver_net_cents: number;         // Driver's net amount
  policy: RefundPolicy;
  actorRole: 'passenger' | 'sender' | 'driver' | 'admin';
  resourceType: 'booking' | 'delivery';
}

export interface RefundCalculationResult {
  /** Amount to refund to the customer via Stripe */
  refundable_to_customer_cents: number;
  /** Cancellation fee retained by platform */
  cancellation_fee_cents: number;
  /** Amount to reverse from driver wallet */
  driver_reversal_cents: number;
  /** Amount of platform commission to reverse */
  platform_commission_reversal_cents: number;
  /** Compensation to driver (e.g., when passenger cancels late) */
  driver_compensation_cents: number;
  /** Detailed snapshot for audit trail */
  snapshot: RefundSnapshot;
}

export interface RefundSnapshot {
  gross_amount_cents: number;
  platform_fee_cents: number;
  driver_net_cents: number;
  policy_id: string;
  policy_name: string;
  actor_role: string;
  resource_type: string;
  refund_percent_to_customer: number;
  cancellation_fee_fixed_cents: number;
  cancellation_fee_percent: number;
  driver_compensation_percent: number;
  calculated_refund_cents: number;
  calculated_fee_cents: number;
  driver_reversal_cents: number;
  commission_reversal_cents: number;
  driver_compensation_cents: number;
  computed_at: string;
}

/**
 * Compute all refund amounts based on policy and original payment breakdown.
 *
 * Logic:
 * 1. Calculate cancellation fee (fixed + percentage of gross)
 * 2. Calculate refundable amount = (gross - fee) * refund_percent / 100
 * 3. Calculate driver reversal proportionally
 * 4. Calculate commission reversal proportionally
 * 5. Calculate driver compensation if applicable
 *
 * All intermediate calculations use Math.round() for deterministic results.
 */
export function computeRefundAmounts(input: RefundCalculationInput): RefundCalculationResult {
  const {
    gross_amount_cents,
    platform_fee_cents,
    driver_net_cents,
    policy,
    actorRole,
    resourceType,
  } = input;

  // Step 1: Calculate cancellation fee
  const fixedFee = policy.cancellation_fee_fixed_cents;
  const percentFee = Math.round(gross_amount_cents * policy.cancellation_fee_percent / 100);
  let cancellation_fee_cents = fixedFee + percentFee;

  // Clamp fee to not exceed gross
  cancellation_fee_cents = Math.min(cancellation_fee_cents, gross_amount_cents);
  cancellation_fee_cents = Math.max(0, cancellation_fee_cents);

  // Step 2: Calculate refundable amount
  const afterFee = gross_amount_cents - cancellation_fee_cents;
  let refundable_to_customer_cents = Math.round(afterFee * policy.refund_percent_to_customer / 100);

  // Clamp refund
  refundable_to_customer_cents = Math.min(refundable_to_customer_cents, gross_amount_cents);
  refundable_to_customer_cents = Math.max(0, refundable_to_customer_cents);

  // Step 3: Calculate proportional reversals
  // The refund ratio relative to gross determines how much to reverse from each party
  const refundRatio = gross_amount_cents > 0
    ? refundable_to_customer_cents / gross_amount_cents
    : 0;

  let platform_commission_reversal_cents = Math.round(platform_fee_cents * refundRatio);
  let driver_reversal_cents = Math.round(driver_net_cents * refundRatio);

  // Step 4: Driver compensation (when passenger/sender cancels late, driver may keep some)
  let driver_compensation_cents = 0;
  if (policy.driver_compensation_percent > 0 && actorRole !== 'driver') {
    // Driver compensation = percentage of driver_net that driver keeps
    driver_compensation_cents = Math.round(driver_net_cents * policy.driver_compensation_percent / 100);

    // Reduce driver reversal by compensation amount
    driver_reversal_cents = Math.max(0, driver_reversal_cents - driver_compensation_cents);
  }

  // Step 5: When driver cancels, they lose their full net (no compensation)
  if (actorRole === 'driver') {
    driver_reversal_cents = Math.round(driver_net_cents * refundRatio);
    driver_compensation_cents = 0;
  }

  // Ensure all values are non-negative integers
  refundable_to_customer_cents = Math.max(0, Math.round(refundable_to_customer_cents));
  cancellation_fee_cents = Math.max(0, Math.round(cancellation_fee_cents));
  driver_reversal_cents = Math.max(0, Math.round(driver_reversal_cents));
  platform_commission_reversal_cents = Math.max(0, Math.round(platform_commission_reversal_cents));
  driver_compensation_cents = Math.max(0, Math.round(driver_compensation_cents));

  const snapshot: RefundSnapshot = {
    gross_amount_cents,
    platform_fee_cents,
    driver_net_cents,
    policy_id: policy.id.toString(),
    policy_name: policy.name,
    actor_role: actorRole,
    resource_type: resourceType,
    refund_percent_to_customer: policy.refund_percent_to_customer,
    cancellation_fee_fixed_cents: policy.cancellation_fee_fixed_cents,
    cancellation_fee_percent: policy.cancellation_fee_percent,
    driver_compensation_percent: policy.driver_compensation_percent,
    calculated_refund_cents: refundable_to_customer_cents,
    calculated_fee_cents: cancellation_fee_cents,
    driver_reversal_cents,
    commission_reversal_cents: platform_commission_reversal_cents,
    driver_compensation_cents,
    computed_at: new Date().toISOString(),
  };

  return {
    refundable_to_customer_cents,
    cancellation_fee_cents,
    driver_reversal_cents,
    platform_commission_reversal_cents,
    driver_compensation_cents,
    snapshot,
  };
}

/**
 * Compute refund for admin override (bypasses policy).
 * Admin specifies exact refund amount.
 */
export function computeAdminOverrideRefund(
  gross_amount_cents: number,
  platform_fee_cents: number,
  driver_net_cents: number,
  override_refund_cents: number,
): RefundCalculationResult {
  // Clamp override to gross
  const refundable_to_customer_cents = Math.min(
    Math.max(0, Math.round(override_refund_cents)),
    gross_amount_cents,
  );

  const refundRatio = gross_amount_cents > 0
    ? refundable_to_customer_cents / gross_amount_cents
    : 0;

  const platform_commission_reversal_cents = Math.round(platform_fee_cents * refundRatio);
  const driver_reversal_cents = Math.round(driver_net_cents * refundRatio);
  const cancellation_fee_cents = gross_amount_cents - refundable_to_customer_cents;

  const snapshot: RefundSnapshot = {
    gross_amount_cents,
    platform_fee_cents,
    driver_net_cents,
    policy_id: 'admin_override',
    policy_name: 'Admin Override',
    actor_role: 'admin',
    resource_type: 'booking',
    refund_percent_to_customer: gross_amount_cents > 0
      ? Math.round(refundable_to_customer_cents / gross_amount_cents * 10000) / 100
      : 0,
    cancellation_fee_fixed_cents: 0,
    cancellation_fee_percent: 0,
    driver_compensation_percent: 0,
    calculated_refund_cents: refundable_to_customer_cents,
    calculated_fee_cents: cancellation_fee_cents,
    driver_reversal_cents,
    commission_reversal_cents: platform_commission_reversal_cents,
    driver_compensation_cents: 0,
    computed_at: new Date().toISOString(),
  };

  return {
    refundable_to_customer_cents,
    cancellation_fee_cents,
    driver_reversal_cents,
    platform_commission_reversal_cents,
    driver_compensation_cents: 0,
    snapshot,
  };
}
