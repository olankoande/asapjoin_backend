import { Request, Response, NextFunction } from 'express';
import { type ZodType, ZodError } from 'zod';
import { AppError } from '../utils/errors';

// Extend Express Request to hold validated data
declare global {
  namespace Express {
    interface Request {
      validated?: {
        body?: any;
        query?: any;
        params?: any;
      };
    }
  }
}

/**
 * Validation middleware using Zod schemas.
 * Validates body, query, and/or params.
 *
 * In Express 5, req.query and req.params are read-only getters.
 * Validated query/params are stored in req.validated.query / req.validated.params.
 * For body, req.body is still writable so we reassign it directly.
 */
export function validate(schema: {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.validated) {
        req.validated = {};
      }

      if (schema.body) {
        req.body = schema.body.parse(req.body);
        req.validated.body = req.body;
      }
      if (schema.query) {
        const parsed = schema.query.parse(req.query);
        req.validated.query = parsed;
        // In Express 5, req.query is a read-only getter on the prototype.
        // Override it on the instance with a writable data property.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schema.params) {
        const parsed = schema.params.parse(req.params);
        req.validated.params = parsed;
        // Same approach for params if needed
        Object.defineProperty(req, 'params', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((e: any) => ({
          field: (e.path as any[]).map(String).join('.'),
          message: e.message as string,
        }));
        next(new AppError(400, 'VALIDATION_ERROR', 'Validation failed', details));
      } else {
        next(err);
      }
    }
  };
}
