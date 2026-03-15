import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';

// ─── Serialization helper (BigInt → string for JSON) ───

function serializePolicy(p: any) {
  return {
    id: p.id.toString(),
    name: p.name,
    scope: p.scope,
    active: p.active,
    created_by_admin_id: p.created_by_admin_id?.toString() || null,
    updated_by_admin_id: p.updated_by_admin_id?.toString() || null,
    created_at: p.created_at,
    updated_at: p.updated_at,
    rules: (p.rules || []).map((r: any) => ({
      id: r.id.toString(),
      policy_id: r.policy_id.toString(),
      min_hours_before_departure: r.min_hours_before_departure,
      cancellation_fee_fixed: Number(r.cancellation_fee_fixed),
      cancellation_fee_percent: Number(r.cancellation_fee_percent),
      refund_percent_to_payer: Number(r.refund_percent_to_payer),
      debit_driver_percent: Number(r.debit_driver_percent),
      apply_after_min_delay_hours: r.apply_after_min_delay_hours,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}

// ─── List ───

export async function listPolicies() {
  const policies = await prisma.cancellation_policies.findMany({
    include: { rules: { orderBy: { min_hours_before_departure: 'desc' } } },
    orderBy: { created_at: 'desc' },
  });
  return policies.map(serializePolicy);
}

// ─── Create ───

export async function createPolicy(input: {
  name: string;
  scope?: 'booking' | 'delivery';
  rules?: Array<{
    min_hours_before_departure: number;
    cancellation_fee_fixed?: number;
    cancellation_fee_percent?: number;
    refund_percent_to_payer?: number;
    debit_driver_percent?: number;
    apply_after_min_delay_hours?: number;
  }>;
}) {
  const policy = await prisma.cancellation_policies.create({
    data: {
      name: input.name,
      scope: (input.scope as any) || 'booking',
      active: false,
      rules: input.rules ? {
        create: input.rules.map((r) => ({
          min_hours_before_departure: r.min_hours_before_departure,
          cancellation_fee_fixed: r.cancellation_fee_fixed ?? 0,
          cancellation_fee_percent: r.cancellation_fee_percent ?? 0,
          refund_percent_to_payer: r.refund_percent_to_payer ?? 100,
          debit_driver_percent: r.debit_driver_percent ?? 0,
          apply_after_min_delay_hours: r.apply_after_min_delay_hours ?? 0,
        })),
      } : undefined,
    },
    include: { rules: true },
  });
  return serializePolicy(policy);
}

// ─── Update ───

export async function updatePolicy(policyId: string, input: {
  name?: string;
  scope?: string;
}) {
  const id = BigInt(policyId);
  const policy = await prisma.cancellation_policies.findUnique({ where: { id } });
  if (!policy) throw Errors.notFound('Policy');

  const updated = await prisma.cancellation_policies.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.scope !== undefined && { scope: input.scope as any }),
    },
    include: { rules: { orderBy: { min_hours_before_departure: 'desc' } } },
  });
  return serializePolicy(updated);
}

// ─── Add Rule ───

export async function addRule(policyId: string, input: {
  min_hours_before_departure: number;
  cancellation_fee_fixed?: number;
  cancellation_fee_percent?: number;
  refund_percent_to_payer?: number;
  debit_driver_percent?: number;
  apply_after_min_delay_hours?: number;
}) {
  const id = BigInt(policyId);
  const policy = await prisma.cancellation_policies.findUnique({ where: { id } });
  if (!policy) throw Errors.notFound('Policy');

  await prisma.cancellation_policy_rules.create({
    data: {
      policy_id: id,
      min_hours_before_departure: input.min_hours_before_departure,
      cancellation_fee_fixed: input.cancellation_fee_fixed ?? 0,
      cancellation_fee_percent: input.cancellation_fee_percent ?? 0,
      refund_percent_to_payer: input.refund_percent_to_payer ?? 100,
      debit_driver_percent: input.debit_driver_percent ?? 0,
      apply_after_min_delay_hours: input.apply_after_min_delay_hours ?? 0,
    },
  });

  const updated = await prisma.cancellation_policies.findUnique({
    where: { id },
    include: { rules: { orderBy: { min_hours_before_departure: 'desc' } } },
  });
  return serializePolicy(updated);
}

// ─── Update Rule ───

export async function updateRule(policyId: string, ruleId: string, input: {
  min_hours_before_departure?: number;
  cancellation_fee_fixed?: number;
  cancellation_fee_percent?: number;
  refund_percent_to_payer?: number;
  debit_driver_percent?: number;
  apply_after_min_delay_hours?: number;
}) {
  const pId = BigInt(policyId);
  const rId = BigInt(ruleId);

  const rule = await prisma.cancellation_policy_rules.findFirst({
    where: { id: rId, policy_id: pId },
  });
  if (!rule) throw Errors.notFound('Rule');

  await prisma.cancellation_policy_rules.update({
    where: { id: rId },
    data: {
      ...(input.min_hours_before_departure !== undefined && { min_hours_before_departure: input.min_hours_before_departure }),
      ...(input.cancellation_fee_fixed !== undefined && { cancellation_fee_fixed: input.cancellation_fee_fixed }),
      ...(input.cancellation_fee_percent !== undefined && { cancellation_fee_percent: input.cancellation_fee_percent }),
      ...(input.refund_percent_to_payer !== undefined && { refund_percent_to_payer: input.refund_percent_to_payer }),
      ...(input.debit_driver_percent !== undefined && { debit_driver_percent: input.debit_driver_percent }),
      ...(input.apply_after_min_delay_hours !== undefined && { apply_after_min_delay_hours: input.apply_after_min_delay_hours }),
    },
  });

  const updated = await prisma.cancellation_policies.findUnique({
    where: { id: pId },
    include: { rules: { orderBy: { min_hours_before_departure: 'desc' } } },
  });
  return serializePolicy(updated);
}

// ─── Delete Rule ───

export async function deleteRule(policyId: string, ruleId: string) {
  const pId = BigInt(policyId);
  const rId = BigInt(ruleId);

  const rule = await prisma.cancellation_policy_rules.findFirst({
    where: { id: rId, policy_id: pId },
  });
  if (!rule) throw Errors.notFound('Rule');

  await prisma.cancellation_policy_rules.delete({ where: { id: rId } });
}

// ─── Activate ───

export async function activatePolicy(policyId: string) {
  const id = BigInt(policyId);
  const policy = await prisma.cancellation_policies.findUnique({ where: { id } });
  if (!policy) throw Errors.notFound('Policy');

  // Deactivate all policies with same scope, activate this one
  await prisma.$transaction([
    prisma.cancellation_policies.updateMany({
      where: { scope: policy.scope },
      data: { active: false },
    }),
    prisma.cancellation_policies.update({
      where: { id },
      data: { active: true },
    }),
  ]);

  const updated = await prisma.cancellation_policies.findUnique({
    where: { id },
    include: { rules: { orderBy: { min_hours_before_departure: 'desc' } } },
  });
  return serializePolicy(updated);
}

// ─── Calculate cancellation fees (used by booking cancellation flow) ───

export async function calculateCancellationFees(
  totalPrice: Decimal,
  departureTime: Date,
  bookingCreatedAt: Date,
  scope: 'booking' | 'delivery' = 'booking',
) {
  const activePolicy = await prisma.cancellation_policies.findFirst({
    where: { active: true, scope },
    include: { rules: { orderBy: { min_hours_before_departure: 'desc' } } },
  });

  // No active policy => full refund, no fees
  if (!activePolicy || activePolicy.rules.length === 0) {
    return {
      fixedFee: new Decimal(0),
      percentageFee: new Decimal(0),
      totalFee: new Decimal(0),
      refundAmount: totalPrice,
      refundPercentage: new Decimal(100),
      policyId: null,
      ruleId: null,
    };
  }

  const hoursBeforeDeparture = (departureTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const hoursSinceBooking = (Date.now() - bookingCreatedAt.getTime()) / (1000 * 60 * 60);

  // Find matching rule (rules ordered by min_hours DESC)
  let matchedRule = null;
  for (const rule of activePolicy.rules) {
    const minHours = rule.min_hours_before_departure;
    const minDelay = rule.apply_after_min_delay_hours;

    if (hoursBeforeDeparture >= minHours) {
      if (hoursSinceBooking >= minDelay) {
        matchedRule = rule;
        break;
      }
    }
  }

  if (!matchedRule) {
    return {
      fixedFee: new Decimal(0),
      percentageFee: new Decimal(0),
      totalFee: new Decimal(0),
      refundAmount: totalPrice,
      refundPercentage: new Decimal(100),
      policyId: activePolicy.id.toString(),
      ruleId: null,
    };
  }

  const fixedFee = new Decimal(matchedRule.cancellation_fee_fixed);
  const percentageFee = totalPrice.mul(matchedRule.cancellation_fee_percent).div(100);
  const totalFee = fixedFee.add(percentageFee);
  const refundPercentage = matchedRule.refund_percent_to_payer;
  const refundableAmount = totalPrice.sub(totalFee);
  const refundAmount = refundableAmount.gt(0)
    ? refundableAmount.mul(refundPercentage).div(100)
    : new Decimal(0);

  return {
    fixedFee,
    percentageFee,
    totalFee,
    refundAmount: refundAmount.gt(0) ? refundAmount : new Decimal(0),
    refundPercentage,
    policyId: activePolicy.id.toString(),
    ruleId: matchedRule.id.toString(),
  };
}
