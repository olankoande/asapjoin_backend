import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const { prismaMock, verifyGoogleIdTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    users: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    wallets: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
  verifyGoogleIdTokenMock: vi.fn(),
}));

vi.mock('../src/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('../src/modules/auth/google/googleTokenVerifier', () => ({
  verifyGoogleIdToken: verifyGoogleIdTokenMock,
}));

import { env } from '../src/config/env';
import { AppError } from '../src/utils/errors';
import { createAuthenticatedSession } from '../src/modules/auth/auth.service';
import { authenticateWithGoogle } from '../src/modules/auth/google/googleAuthService';

describe('Google auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.wallets.findUnique.mockResolvedValue({ id: 1n, user_id: 1n });
  });

  it('rejects an invalid Google token', async () => {
    verifyGoogleIdTokenMock.mockRejectedValue(new AppError(401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token'));

    await expect(authenticateWithGoogle({ credential: 'bad-token' })).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('logs in an existing user matched by google_sub', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({
      sub: 'google-sub-1',
      email: 'existing@example.com',
      email_verified: true,
      name: 'Existing User',
      picture: 'https://cdn.example.com/avatar.png',
      given_name: 'Existing',
      family_name: 'User',
    });

    prismaMock.users.findUnique
      .mockResolvedValueOnce({
        id: 1n,
        email: 'existing@example.com',
        google_sub: 'google-sub-1',
      })
      .mockResolvedValueOnce({
        id: 1n,
        email: 'existing@example.com',
        first_name: 'Existing',
        last_name: 'User',
        phone_number: null,
        avatar_url: 'https://cdn.example.com/avatar.png',
        role: 'user',
        is_banned: false,
        payout_email: null,
        email_verified: true,
        auth_provider: 'google',
        google_sub: 'google-sub-1',
        created_at: new Date('2026-03-21T00:00:00.000Z'),
        updated_at: new Date('2026-03-21T00:00:00.000Z'),
      });
    prismaMock.users.update.mockResolvedValue({});

    const session = await authenticateWithGoogle({ credential: 'valid-token' });

    expect(session.user.email).toBe('existing@example.com');
    expect(prismaMock.users.create).not.toHaveBeenCalled();
  });

  it('creates a new user when the email does not exist', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({
      sub: 'google-sub-2',
      email: 'new@example.com',
      email_verified: true,
      name: 'New Person',
      picture: 'https://cdn.example.com/new.png',
      given_name: 'New',
      family_name: 'Person',
    });

    prismaMock.users.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 2n,
        email: 'new@example.com',
        first_name: 'New',
        last_name: 'Person',
        phone_number: null,
        avatar_url: 'https://cdn.example.com/new.png',
        role: 'user',
        is_banned: false,
        payout_email: null,
        email_verified: true,
        auth_provider: 'google',
        google_sub: 'google-sub-2',
        created_at: new Date('2026-03-21T00:00:00.000Z'),
        updated_at: new Date('2026-03-21T00:00:00.000Z'),
      });
    prismaMock.users.create.mockResolvedValue({
      id: 2n,
      email: 'new@example.com',
    });
    prismaMock.users.update.mockResolvedValue({});

    const session = await authenticateWithGoogle({ credential: 'valid-token' });

    expect(prismaMock.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          google_sub: 'google-sub-2',
          auth_provider: 'google',
          password_hash: null,
        }),
      }),
    );
    expect(session.user.auth_provider).toBe('google');
  });

  it('links an existing local user matched by email', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({
      sub: 'google-sub-3',
      email: 'local@example.com',
      email_verified: true,
      name: 'Local User',
      picture: 'https://cdn.example.com/local.png',
      given_name: 'Local',
      family_name: 'User',
    });

    prismaMock.users.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 3n,
        email: 'local@example.com',
        google_sub: null,
        avatar_url: null,
        email_verified: false,
      })
      .mockResolvedValueOnce({
        id: 3n,
        email: 'local@example.com',
        first_name: 'Local',
        last_name: 'User',
        phone_number: null,
        avatar_url: 'https://cdn.example.com/local.png',
        role: 'user',
        is_banned: false,
        payout_email: null,
        email_verified: true,
        auth_provider: 'local',
        google_sub: 'google-sub-3',
        created_at: new Date('2026-03-21T00:00:00.000Z'),
        updated_at: new Date('2026-03-21T00:00:00.000Z'),
      });
    prismaMock.users.update
      .mockResolvedValueOnce({
        id: 3n,
        email: 'local@example.com',
      })
      .mockResolvedValueOnce({});

    const session = await authenticateWithGoogle({ credential: 'valid-token' });

    expect(prismaMock.users.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          google_sub: 'google-sub-3',
          email_verified: true,
        }),
      }),
    );
    expect(session.user.google_linked).toBe(true);
    expect(session.user.auth_provider).toBe('local');
  });
});

describe('Authenticated session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates the application JWT tokens and persists the refresh token', async () => {
    prismaMock.users.findUnique.mockResolvedValue({
      id: 99n,
      email: 'session@example.com',
      first_name: 'Session',
      last_name: 'User',
      phone_number: null,
      avatar_url: null,
      role: 'user',
      is_banned: false,
      payout_email: null,
      email_verified: true,
      auth_provider: 'google',
      google_sub: 'google-sub-99',
      created_at: new Date('2026-03-21T00:00:00.000Z'),
      updated_at: new Date('2026-03-21T00:00:00.000Z'),
    });
    prismaMock.wallets.findUnique.mockResolvedValue(null);
    prismaMock.wallets.create.mockResolvedValue({ id: 10n, user_id: 99n });
    prismaMock.users.update.mockResolvedValue({});

    const session = await createAuthenticatedSession(99n);
    const decodedAccess = jwt.verify(session.accessToken, env.JWT_ACCESS_SECRET) as { userId: string; role: string };
    const decodedRefresh = jwt.verify(session.refreshToken, env.JWT_REFRESH_SECRET) as { userId: string; role: string };

    expect(decodedAccess.userId).toBe('99');
    expect(decodedRefresh.userId).toBe('99');
    expect(prismaMock.wallets.create).toHaveBeenCalled();
    expect(prismaMock.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refresh_token: session.refreshToken,
        }),
      }),
    );
  });
});
