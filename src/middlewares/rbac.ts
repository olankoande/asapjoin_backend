import { Request, Response, NextFunction } from 'express';
import { Errors } from '../utils/errors';
import { resolveUserAuthorization } from '../modules/rbac/rbac.service';

async function ensureAuthorizationLoaded(req: Request) {
  if (!req.user) {
    throw Errors.unauthorized();
  }

  if (!req.user.roleCodes || !req.user.permissionCodes) {
    const authz = await resolveUserAuthorization(req.user.userId, req.user.role);
    req.user.roleCodes = authz.roleCodes;
    req.user.permissionCodes = authz.permissionCodes;
    req.user.isSuperAdmin = authz.isSuperAdmin;
  }

  return req.user;
}

/**
 * Role-based access control middleware.
 * Usage: requireRole('admin', 'support')
 */
export function requireRole(...roles: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = await ensureAuthorizationLoaded(req);
      const matchesLegacyRole = roles.includes(user.role);
      const matchesRbacRole = user.roleCodes!.some((roleCode) => roles.includes(roleCode));

      if (!user.isSuperAdmin && !matchesLegacyRole && !matchesRbacRole) {
        return next(Errors.forbidden(`Role '${user.role}' is not authorized. Required: ${roles.join(', ')}`));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(...permissionCodes: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = await ensureAuthorizationLoaded(req);
      if (user.isSuperAdmin) {
        return next();
      }

      const missing = permissionCodes.filter((permissionCode) => !user.permissionCodes!.includes(permissionCode));
      if (missing.length > 0) {
        return next(Errors.forbidden(`Missing required permission(s): ${missing.join(', ')}`, 'MISSING_PERMISSION'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
