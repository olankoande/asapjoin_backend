import app from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import cron from 'node-cron';
import { releasePendingToAvailable } from './jobs/releasePendingToAvailable';
import { preparePayoutEligibility } from './jobs/preparePayoutEligibility';

const PORT = env.PORT;

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📚 Swagger docs: ${env.API_URL}/docs`);
  logger.info(`📄 OpenAPI JSON: ${env.API_URL}/openapi.json`);
  logger.info(`🏥 Health check: ${env.API_URL}/health`);
  logger.info(`🌍 Environment: ${env.NODE_ENV}`);

  // Schedule cron jobs in development
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'production') {
    // Daily at 2:00 AM - release pending to available
    cron.schedule('0 2 * * *', async () => {
      logger.info('[CRON] Running releasePendingToAvailable...');
      try {
        const result = await releasePendingToAvailable();
        logger.info('[CRON] releasePendingToAvailable completed', result as any);
      } catch (err: any) {
        logger.error('[CRON] releasePendingToAvailable failed', { error: err?.message });
      }
    });

    // Daily at 3:00 AM - prepare payout eligibility
    cron.schedule('0 3 * * *', async () => {
      logger.info('[CRON] Running preparePayoutEligibility...');
      try {
        const result = await preparePayoutEligibility();
        logger.info('[CRON] preparePayoutEligibility completed', result as any);
      } catch (err: any) {
        logger.error('[CRON] preparePayoutEligibility failed', { error: err?.message });
      }
    });

    logger.info('⏰ Cron jobs scheduled');
  }
});
