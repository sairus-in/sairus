import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@college.edu';
  const plainPassword = 'password123';
  
  const passwordHash = bcrypt.hashSync(plainPassword, 12);

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'TRANSPORT_OFFICER'
    },
    create: {
      name: 'Super Admin',
      email,
      passwordHash,
      role: 'TRANSPORT_OFFICER',
      isActive: true,
      mfaEnabled: false
    }
  });

  console.log(`✅ Admin account created/updated:`);
  console.log(`Email:    ${admin.email}`);
  console.log(`Password: ${plainPassword}`);
  console.log(`Role:     ${admin.role}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
