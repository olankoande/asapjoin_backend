/**
 * Script de création d'un utilisateur admin.
 *
 * Usage :
 *   npx tsx prisma/seed-admin.ts
 *
 * Variables d'environnement optionnelles :
 *   ADMIN_EMAIL       (défaut : admin@asapjoin.com)
 *   ADMIN_PASSWORD    (défaut : Admin123!)
 *   ADMIN_DISPLAY_NAME (défaut : Admin)
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@asapjoin.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Admin';

  // Vérifier si l'admin existe déjà
  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) {
    console.log(`⚠️  Un utilisateur avec l'email "${email}" existe déjà (id=${existing.id}, role=${existing.role}).`);
    if (existing.role !== 'admin') {
      // Promouvoir en admin
      await prisma.users.update({
        where: { email },
        data: { role: 'admin' },
      });
      console.log(`✅ L'utilisateur a été promu au rôle "admin".`);
    } else {
      console.log(`ℹ️  L'utilisateur est déjà admin. Rien à faire.`);
    }
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

  console.log(`✅ Utilisateur admin créé avec succès !`);
  console.log(`   ID    : ${admin.id}`);
  console.log(`   Email : ${admin.email}`);
  console.log(`   Nom   : ${admin.display_name}`);
  console.log(`   Rôle  : ${admin.role}`);
  console.log(`   Mot de passe : ${password}`);
  console.log('');
  console.log(`⚠️  Pensez à changer le mot de passe par défaut en production !`);
}

main()
  .catch((e) => {
    console.error('❌ Erreur lors de la création de l\'admin :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
