import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';

export type CurrentContract = {
  id: string;
  title: string;
  version: string;
  content: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function serializeContract(contract: {
  id: bigint;
  title: string;
  version: string;
  content: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: contract.id.toString(),
    title: contract.title,
    version: contract.version,
    content: contract.content,
    is_active: contract.is_active,
    created_at: contract.created_at.toISOString(),
    updated_at: contract.updated_at.toISOString(),
  };
}

export async function getCurrentContract(): Promise<CurrentContract | null> {
  const contract = await prisma.contracts.findFirst({
    where: { is_active: true },
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
  });

  return contract ? serializeContract(contract) : null;
}

export async function listContracts(): Promise<CurrentContract[]> {
  const contracts = await prisma.contracts.findMany({
    orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
    take: 20,
  });

  return contracts.map(serializeContract);
}

export async function saveCurrentContract(adminId: string, input: { title: string; version: string; content: string }) {
  const title = input.title.trim();
  const version = input.version.trim();
  const content = input.content.trim();

  if (!title || !version || !content) {
    throw Errors.badRequest('Contract title, version and content are required', 'INVALID_CONTRACT');
  }

  await prisma.$transaction(async (tx) => {
    await tx.contracts.updateMany({
      where: { is_active: true },
      data: { is_active: false },
    });

    const existing = await tx.contracts.findFirst({ where: { version } });
    if (existing) {
      await tx.contracts.update({
        where: { id: existing.id },
        data: {
          title,
          version,
          content,
          is_active: true,
          published_by_admin_id: BigInt(adminId),
        },
      });
      return;
    }

    await tx.contracts.create({
      data: {
        title,
        version,
        content,
        is_active: true,
        published_by_admin_id: BigInt(adminId),
      },
    });
  });

  const contract = await getCurrentContract();
  if (!contract) {
    throw Errors.internal('Failed to save contract');
  }

  return contract;
}

export async function acceptCurrentContract(userId: string, inputVersion: string) {
  const current = await getCurrentContract();
  if (!current) {
    throw Errors.badRequest('No active contract is configured', 'CONTRACT_NOT_AVAILABLE');
  }

  if (current.version !== inputVersion) {
    throw Errors.conflict('Contract version is outdated. Please reload and try again.', 'CONTRACT_VERSION_MISMATCH');
  }

  await prisma.users.update({
    where: { id: BigInt(userId) },
    data: {
      terms_accepted_version: current.version,
      terms_accepted_at: new Date(),
    },
  });

  return {
    accepted: true,
    version: current.version,
  };
}

export async function getContractAcceptanceStatus(userId: bigint) {
  const [user, current] = await Promise.all([
    prisma.users.findUnique({
      where: { id: userId },
      select: {
        terms_accepted_version: true,
        terms_accepted_at: true,
      },
    }),
    getCurrentContract(),
  ]);

  if (!user) {
    throw Errors.unauthorized('Authenticated user not found', 'USER_NOT_FOUND');
  }

  const currentVersion = current?.version ?? null;
  const acceptedVersion = user.terms_accepted_version ?? null;
  const acceptanceRequired = Boolean(currentVersion && acceptedVersion !== currentVersion);

  return {
    currentContractVersion: currentVersion,
    acceptedContractVersion: acceptedVersion,
    contractAcceptedAt: user.terms_accepted_at?.toISOString() ?? null,
    contractAcceptanceRequired: acceptanceRequired,
  };
}
