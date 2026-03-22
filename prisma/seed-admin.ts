import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedRbacData } from '../src/modules/rbac/rbac.service';
import { SYSTEM_ROLE_CODES } from '../src/modules/rbac/rbac.constants';

const prisma = new PrismaClient();

async function ensureSuperAdminRoleAssignment(userId: bigint) {
  const superAdminRole = await prisma.roles.findUnique({
    where: { code: SYSTEM_ROLE_CODES.superAdmin },
  });

  if (!superAdminRole) {
    return;
  }

  await prisma.user_roles.upsert({
    where: {
      user_id_role_id: {
        user_id: userId,
        role_id: superAdminRole.id,
      },
    },
    update: {},
    create: {
      user_id: userId,
      role_id: superAdminRole.id,
    },
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@asapjoin.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Admin';

  await seedRbacData();

  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'admin') {
      await prisma.users.update({
        where: { email },
        data: { role: 'admin' },
      });
    }

    await ensureSuperAdminRoleAssignment(existing.id);
    console.log(`Admin ready: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.users.create({
    data: {
      email,
      password_hash: passwordHash,
      display_name: displayName,
      role: 'admin',
      status: 'active',
    },
  });

  await ensureSuperAdminRoleAssignment(admin.id);

  console.log(`Admin created: ${admin.email}`);
  console.log(`Password: ${password}`);
}

main()
  .catch((error) => {
    console.error('Admin seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
