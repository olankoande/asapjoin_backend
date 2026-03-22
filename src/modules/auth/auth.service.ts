import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';
import { Errors } from '../../utils/errors';
import { RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput } from './auth.schemas';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../notifications/emailService';
import { getContractAcceptanceStatus } from '../contracts/contracts.service';

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

function serializeAuthenticatedUser(user: {
  id: bigint | string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  role: string;
  is_banned?: boolean;
  payout_email?: string | null;
  email_verified?: boolean;
  auth_provider?: string;
  google_sub?: string | null;
  terms_accepted_version?: string | null;
  terms_accepted_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}, contractStatus?: {
  currentContractVersion: string | null;
  acceptedContractVersion: string | null;
  contractAcceptedAt: string | null;
  contractAcceptanceRequired: boolean;
}) {
  return {
    id: user.id.toString(),
    email: user.email,
    first_name: user.first_name ?? '',
    last_name: user.last_name ?? '',
    phone_number: user.phone_number ?? null,
    avatar_url: user.avatar_url ?? null,
    role: user.role,
    is_banned: user.is_banned ?? false,
    payout_email: user.payout_email ?? null,
    email_verified: user.email_verified ?? false,
    auth_provider: user.auth_provider ?? 'local',
    google_linked: Boolean(user.google_sub),
    current_contract_version: contractStatus?.currentContractVersion ?? null,
    accepted_contract_version: contractStatus?.acceptedContractVersion ?? user.terms_accepted_version ?? null,
    contract_accepted_at: contractStatus?.contractAcceptedAt ?? user.terms_accepted_at?.toISOString() ?? null,
    contract_acceptance_required: contractStatus?.contractAcceptanceRequired ?? false,
    created_at: user.created_at?.toISOString() ?? new Date(0).toISOString(),
    updated_at: user.updated_at?.toISOString() ?? new Date(0).toISOString(),
  };
}

async function ensureUserWallet(userId: bigint) {
  const existingWallet = await prisma.wallets.findUnique({ where: { user_id: userId } });
  if (!existingWallet) {
    await prisma.wallets.create({
      data: {
        user_id: userId,
        pending_balance: 0,
        available_balance: 0,
        currency: 'CAD',
      },
    });
  }
}

async function getAuthenticatedUserRecord(userId: bigint) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      phone_number: true,
      avatar_url: true,
      role: true,
      is_banned: true,
      payout_email: true,
      email_verified: true,
      auth_provider: true,
      google_sub: true,
      terms_accepted_version: true,
      terms_accepted_at: true,
      created_at: true,
      updated_at: true,
    },
  });

  if (!user) {
    throw Errors.unauthorized('Authenticated user not found', 'USER_NOT_FOUND');
  }

  if (user.is_banned) {
    throw Errors.userBanned();
  }

  return user;
}

export async function createAuthenticatedSession(userId: bigint) {
  const user = await getAuthenticatedUserRecord(userId);
  const contractStatus = await getContractAcceptanceStatus(user.id);

  await ensureUserWallet(user.id);

  const accessToken = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id, user.role);

  await prisma.users.update({
    where: { id: user.id },
    data: { refresh_token: refreshToken },
  });

  return {
    user: serializeAuthenticatedUser(user, contractStatus),
    accessToken,
    refreshToken,
  };
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
      auth_provider: 'local',
    },
  });

  const session = await createAuthenticatedSession(user.id);

  // Send welcome email (fire & forget)
  sendWelcomeEmail(user.email, { firstName: input.first_name }).catch(() => {});

  return session;
}

export async function login(input: LoginInput) {
  const user = await prisma.users.findUnique({ where: { email: input.email } });
  if (!user) {
    throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  if (user.is_banned) {
    throw Errors.userBanned();
  }

  if (!user.password_hash) {
    throw Errors.unauthorized('Use Google sign-in for this account', 'PASSWORD_LOGIN_NOT_AVAILABLE');
  }

  const valid = await bcrypt.compare(input.password, user.password_hash);
  if (!valid) {
    throw Errors.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return createAuthenticatedSession(user.id);
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

export async function getAuthenticatedUser(userId: string) {
  const user = await getAuthenticatedUserRecord(BigInt(userId));
  const contractStatus = await getContractAcceptanceStatus(BigInt(userId));
  return { user: serializeAuthenticatedUser(user, contractStatus) };
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
