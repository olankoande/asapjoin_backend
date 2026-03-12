import app from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import cron from 'node-cron';
import { releasePendingToAvailable } from './jobs/releasePendingToAvailable';
import { preparePayoutEligibility } from './jobs/preparePayoutEligibility';

const PORT = Number(env.PORT || 3000);

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📚 Swagger docs: ${env.API_URL}/docs`);
  logger.info(`📄 OpenAPI JSON: ${env.API_URL}/openapi.json`);
  logger.info(`🏥 Health check: ${env.API_URL}/health`);
  logger.info(`🌍 Environment: ${env.NODE_ENV}`);

  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'production') {
    cron.schedule('0 2 * * *', async () => {
      logger.info('[CRON] Running releasePendingToAvailable...');
      try {
        const result = await releasePendingToAvailable();
        logger.info('[CRON] releasePendingToAvailable completed', result as any);
      } catch (err: any) {
        logger.error('[CRON] releasePendingToAvailable failed', { error: err?.message });
      }
    });

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