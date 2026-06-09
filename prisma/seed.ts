// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { UserRole } from '../src/shared/enums';
import * as dotenv from 'dotenv';
import Helper from '../src/shared/utils/helpers';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const password = process.env.SUPER_ADMIN_PASSWORD;
  const email = process.env.SUPER_ADMIN_EMAIL;

  if (!password) {
    throw new Error('SUPER_ADMIN_PASSWORD not found in env');
  }

  const hashedPassword = await Helper.hashText(password);

  const superAdmin = await prisma.user.upsert({
    where: { email }, // must be a unique field in your schema
    update: {}, // leave empty so existing admin isn't modified
    create: {
      email,
      firstName: process.env.SUPER_ADMIN_FIRSTNAME,
      lastName: process.env.SUPER_ADMIN_LASTNAME,
      password: hashedPassword,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      isVerified: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      verifiedAt: new Date(),
    },
  });

  console.log('Super admin ensured:', superAdmin.email);
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
