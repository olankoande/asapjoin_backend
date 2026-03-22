import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';
import { UpdateProfileInput } from './users.schemas';
import { getContractAcceptanceStatus } from '../contracts/contracts.service';

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
  auth_provider: true,
  google_sub: true,
  payout_email: true,
  terms_accepted_version: true,
  terms_accepted_at: true,
  created_at: true,
  updated_at: true,
};

function serializeUserProfile(
  user: any,
  contractStatus?: {
    currentContractVersion: string | null;
    acceptedContractVersion: string | null;
    contractAcceptedAt: string | null;
    contractAcceptanceRequired: boolean;
  },
) {
  return {
    ...user,
    id: user.id.toString(),
    current_contract_version: contractStatus?.currentContractVersion ?? null,
    accepted_contract_version: contractStatus?.acceptedContractVersion ?? user.terms_accepted_version ?? null,
    contract_accepted_at: contractStatus?.contractAcceptedAt ?? user.terms_accepted_at?.toISOString() ?? null,
    contract_acceptance_required: contractStatus?.contractAcceptanceRequired ?? false,
  };
}

export async function getProfile(userId: string) {
  const user = await prisma.users.findUnique({
    where: { id: BigInt(userId) },
    select: USER_SELECT,
  });

  if (!user) throw Errors.notFound('User');
  const contractStatus = await getContractAcceptanceStatus(BigInt(userId));
  return serializeUserProfile(user, contractStatus);
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

  const contractStatus = await getContractAcceptanceStatus(BigInt(userId));
  return serializeUserProfile(updated, contractStatus);
}
