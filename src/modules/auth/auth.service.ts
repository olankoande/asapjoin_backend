import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { Errors } from '../../utils/errors';
import { RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput } from './auth.schemas';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../notifications/emailService';

function generateAccessToken(userId: bigint | string, role: string): string {
  return jwt.sign({ userId: userId.toString(), role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
  });
}

function generateRefreshToken(userId: bigint | string, role: string): string {
  return jwt.sign({ userId: userId.toString(), role }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
  });
}

export async function register(input: RegisterInput) {
  const existing = await prisma.users.findUnique({ where: { email: input.email } });
  if (existing) {
    throw Errors.conflict('Email already registered', 'EMAIL_ALREADY_EXISTS');
  }

  const password_hash = await bcrypt.hash(input.password, 12);

  const user = await prisma.users.create({
    data: {
      email: input.email,
      password_hash,
      first_name: input.first_name,
      last_name: input.last_name,
      display_name: `${input.first_name} ${input.last_name}`,
      phone_number: input.phone_number || null,
      role: 'user',
    },
  });

  // Create wallet for user
  await prisma.wallets.create({
    data: {
      user_id: user.id,
      pending_balance: 0,
      available_balance: 0,
      currency: 'CAD',
    },
  });

  const accessToken = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id, user.role);

  await prisma.users.update({
    where: { id: user.id },
    data: { refresh_token: refreshToken },
  });

  // Send welcome email (fire & forget)
  sendWelcomeEmail(user.email, { firstName: input.first_name }).catch(() => {});

  return {
    user: {
      id: user.id.toString(),
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.users.findUnique({ where: { email: input.email } });
  if (!user) {
    throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (user.is_banned) {
    throw Errors.userBanned();
  }

  const valid = await bcrypt.compare(input.password, user.password_hash);
  if (!valid) {
    throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const accessToken = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id, user.role);

  await prisma.users.update({
    where: { id: user.id },
    data: { refresh_token: refreshToken },
  });

  return {
    user: {
      id: user.id.toString(),
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
}

export async function refresh(refreshTokenInput: string) {
  let decoded: any;
  try {
    decoded = jwt.verify(refreshTokenInput, env.JWT_REFRESH_SECRET);
  } catch {
    throw Errors.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  // decoded.userId is a string; Prisma expects BigInt for the where clause
  const user = await prisma.users.findUnique({ where: { id: BigInt(decoded.userId) } });
  if (!user || user.refresh_token !== refreshTokenInput) {
    throw Errors.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  }

  if (user.is_banned) {
    throw Errors.userBanned();
  }

  const accessToken = generateAccessToken(user.id, user.role);
  const newRefreshToken = generateRefreshToken(user.id, user.role);

  await prisma.users.update({
    where: { id: user.id },
    data: { refresh_token: newRefreshToken },
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
}

export async function forgotPassword(input: ForgotPasswordInput) {
  const user = await prisma.users.findUnique({ where: { email: input.email } });
  // Always return success to prevent email enumeration
  if (!user) return { message: 'If the email exists, a reset link has been sent.' };

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.users.update({
    where: { id: user.id },
    data: {
      reset_token: resetToken,
      reset_token_expiry: resetTokenExpiry,
    },
  });

  const resetUrl = `${env.APP_URL}/reset-password?token=${resetToken}`;

  await sendPasswordResetEmail(user.email, {
    firstName: user.first_name || 'Utilisateur',
    resetUrl,
  });

  return { message: 'If the email exists, a reset link has been sent.' };
}

export async function resetPassword(input: ResetPasswordInput) {
  const user = await prisma.users.findFirst({
    where: {
      reset_token: input.token,
      reset_token_expiry: { gt: new Date() },
    },
  });

  if (!user) {
    throw Errors.badRequest('Invalid or expired reset token', 'INVALID_RESET_TOKEN');
  }

  const password_hash = await bcrypt.hash(input.password, 12);

  await prisma.users.update({
    where: { id: user.id },
    data: {
      password_hash,
      reset_token: null,
      reset_token_expiry: null,
      refresh_token: null, // Invalidate all sessions
    },
  });

  return { message: 'Password has been reset successfully.' };
}
