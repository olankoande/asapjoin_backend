import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Job: Check and log payout eligibility.
 * Lists users with available_balance >= MIN_PAYOUT_AMOUNT.
 * This is informational - actual payout is triggered by admin.
 */
export async function preparePayoutEligibility() {
  const minAmount = env.MIN_PAYOUT_AMOUNT;

  logger.info(`[JOB] preparePayoutEligibility: minAmount=${minAmount}`);

  const eligible = await prisma.wallets.findMany({
    where: { available_balance: { gte: minAmount } },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          phone_number: true,
          payout_email: true,
          is_banned: true,
        },
      },
    },
  });

  const ready = eligible.filter((w) => w.user.phone_number && w.user.payout_email && !w.user.is_banned);
  const blocked = eligible.filter((w) => !w.user.phone_number || !w.user.payout_email || w.user.is_banned);

  logger.info(`[JOB] preparePayoutEligibility: ${ready.length} ready, ${blocked.length} blocked (missing info or banned)`);

  for (const w of blocked) {
    const missing = [];
    if (!w.user.phone_number) missing.push('phone_number');
    if (!w.user.payout_email) missing.push('payout_email');
    if (w.user.is_banned) missing.push('banned');
    logger.warn(`[JOB] User ${w.user.id} (${w.user.email}) blocked from payout: missing ${missing.join(', ')}`);
  }

  return {
    total_eligible: eligible.length,
    ready: ready.length,
    blocked: blocked.length,
    total_amount: ready.reduce((sum, w) => sum + w.available_balance.toNumber(), 0),
  };
}

if (require.main === module) {
  preparePayoutEligibility()
    .then((result) => {
      console.log('Job completed:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Job failed:', err);
      process.exit(1);
    });
}
