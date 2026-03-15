import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { UpdateProfileInput } from './users.schemas';

const USER_SELECT = {
  id: true,
  email: true,
  first_name: true,
  last_name: true,
  phone_number: true,
  avatar_url: true,
  bio: true,
  role: true,
  email_verified: true,
  payout_email: true,
  created_at: true,
  updated_at: true,
};

export async function getProfile(userId: string) {
  const user = await prisma.users.findUnique({
    where: { id: BigInt(userId) },
    select: USER_SELECT,
  });

  if (!user) throw Errors.notFound('User');
  return user;
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.users.findUnique({ where: { id: BigInt(userId) } });
  if (!user) throw Errors.notFound('User');

  const updated = await prisma.users.update({
    where: { id: BigInt(userId) },
    data: {
      ...(input.first_name !== undefined && { first_name: input.first_name }),
      ...(input.last_name !== undefined && { last_name: input.last_name }),
      ...(input.phone_number !== undefined && { phone_number: input.phone_number }),
      ...(input.avatar_url !== undefined && { avatar_url: input.avatar_url }),
      ...(input.bio !== undefined && { bio: input.bio }),
      ...(input.payout_email !== undefined && { payout_email: input.payout_email }),
    },
    select: USER_SELECT,
  });

  return updated;
}
