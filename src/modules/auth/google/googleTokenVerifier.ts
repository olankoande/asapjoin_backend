import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { env } from '../../../config/env';
import { Errors } from '../../../utils/errors';

export interface VerifiedGoogleUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string | null;
  picture: string | null;
  given_name: string | null;
  family_name: string | null;
}

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID || undefined);

function normalizeGooglePayload(payload: TokenPayload | undefined): VerifiedGoogleUser {
  if (!payload?.sub || !payload.email) {
    throw Errors.invalidGoogleToken();
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    email_verified: Boolean(payload.email_verified),
    name: payload.name ?? null,
    picture: payload.picture ?? null,
    given_name: payload.given_name ?? null,
    family_name: payload.family_name ?? null,
  };
}

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleUser> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw Errors.googleAuthDisabled();
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw Errors.invalidGoogleToken();
    }

    if (!env.GOOGLE_ALLOWED_ISSUERS.includes(payload.iss)) {
      throw Errors.invalidGoogleToken();
    }

    if (!payload.exp || payload.exp * 1000 <= Date.now()) {
      throw Errors.invalidGoogleToken();
    }

    return normalizeGooglePayload(payload);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'GOOGLE_AUTH_DISABLED') {
      throw error;
    }

    throw Errors.invalidGoogleToken();
  }
}
