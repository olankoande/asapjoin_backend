import { prisma } from '../../db/prisma';
import { Errors } from '../../utils/errors';

export async function getWallet(userId: string) {
  const userIdBig = BigInt(userId);
  let wallet = await prisma.wallets.findUnique({
    where: { user_id: userIdBig },
  });
  if (!wallet) {
    // Auto-create wallet for user (so the page always works)
    wallet = await prisma.wallets.create({
      data: {
        user_id: userIdBig,
        pending_balance: 0,
        available_balance: 0,
        currency: 'CAD',
      },
    });
    // Initialize cents columns
    try {
      await prisma.$executeRaw`UPDATE wallets SET pending_cents = 0, available_cents = 0 WHERE id = ${wallet.id}`;
    } catch { /* cents columns may not exist yet */ }
  }
  return wallet;
}

export async function getTransactions(userId: string, page = 1, limit = 50) {
  const wallet = await prisma.wallets.findUnique({ where: { user_id: BigInt(userId) } });
  if (!wallet) throw Errors.notFound('Wallet');

  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    prisma.wallet_transactions.findMany({
      where: { wallet_id: wallet.id },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.wallet_transactions.count({ where: { wallet_id: wallet.id } }),
  ]);

  return {
    data: transactions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
