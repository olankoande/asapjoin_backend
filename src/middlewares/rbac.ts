import { Request, Response, NextFunction } from 'express';
import { Errors } from '../utils/errors';

/**
 * Role-based access control middleware.
 * Usage: requireRole('admin', 'support')
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(Errors.unauthorized());
    }

    if (!roles.includes(req.user.role)) {
      return next(Errors.forbidden(`Role '${req.user.role}' is not authorized. Required: ${roles.join(', ')}`));
    }

    next();
  };
}
