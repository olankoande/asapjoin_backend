import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Global error handler middleware.
 * Returns uniform error response: { code, message, traceId, details? }
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { code: err.code, traceId: err.traceId, stack: err.stack });
    } else {
      logger.warn(err.message, { code: err.code, traceId: err.traceId });
    }

    return res.status(err.statusCode).json(err.toJSON());
  }

  // Unexpected errors
  const traceId = uuidv4();
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    traceId,
  });

  return res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    traceId,
  });
}
