import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { Errors } from '../utils/errors';
import { prisma } from '../db/prisma';

export interface JwtPayload {
  userId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
        email: string;
      };
    }
  }
}

/**
 * Middleware to authenticate JWT access token.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw Errors.unauthorized('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      email: '',
    };

    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      next(Errors.unauthorized('Token expired', 'TOKEN_EXPIRED'));
    } else if (err.name === 'JsonWebTokenError') {
      next(Errors.unauthorized('Invalid token', 'INVALID_TOKEN'));
    } else {
      next(err);
    }
  }
}

/**
 * Optional authentication - doesn't fail if no token.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
      email: '',
    };

    next();
  } catch {
    next();
  }
}

/**
 * Middleware to check if user is banned.
 */
export async function checkNotBanned(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) return next();

    const user = await prisma.users.findUnique({
      where: { id: BigInt(req.user.userId) },
      select: { is_banned: true },
    });

    if (user?.is_banned) {
      throw Errors.userBanned();
    }

    next();
  } catch (err) {
    next(err);
  }
}
