import { prisma } from '../../../db/prisma';
import { Errors } from '../../../utils/errors';
import { createAuthenticatedSession } from '../auth.service';
import type { GoogleAuthInput } from '../auth.schemas';
import { verifyGoogleIdToken } from './googleTokenVerifier';

function splitNameParts(verifiedUser: {
  name: string | null;
  given_name: string | null;
  family_name: string | null;
}) {
  const firstName = verifiedUser.given_name?.trim() || verifiedUser.name?.split(' ')[0]?.trim() || 'Google';
  const lastName = verifiedUser.family_name?.trim() || verifiedUser.name?.split(' ').slice(1).join(' ').trim() || 'User';

  return { firstName, lastName };
}

export async function authenticateWithGoogle(input: GoogleAuthInput) {
  const verifiedUser = await verifyGoogleIdToken(input.credential);

  const byGoogleSub = await prisma.users.findUnique({
    where: { google_sub: verifiedUser.sub },
  });

  if (byGoogleSub) {
    return createAuthenticatedSession(byGoogleSub.id);
  }

  const byEmail = await prisma.users.findUnique({
    where: { email: verifiedUser.email },
  });

  if (byEmail) {
    if (byEmail.google_sub && byEmail.google_sub !== verifiedUser.sub) {
      throw Errors.googleAuthEmailConflict();
    }

    const linkedUser = await prisma.users.update({
      where: { id: byEmail.id },
      data: {
        google_sub: verifiedUser.sub,
        avatar_url: byEmail.avatar_url || verifiedUser.picture,
        email_verified: byEmail.email_verified || verifiedUser.email_verified,
      },
    });

    return createAuthenticatedSession(linkedUser.id);
  }

  const { firstName, lastName } = splitNameParts(verifiedUser);
  const createdUser = await prisma.users.create({
    data: {
      email: verifiedUser.email,
      password_hash: null,
      first_name: firstName,
      last_name: lastName,
      display_name: verifiedUser.name || `${firstName} ${lastName}`.trim(),
      avatar_url: verifiedUser.picture,
      google_sub: verifiedUser.sub,
      auth_provider: 'google',
      email_verified: verifiedUser.email_verified,
      role: 'user',
    },
  });

  return createAuthenticatedSession(createdUser.id);
}
