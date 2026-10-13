import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  for (const role of [
    { name: 'ADMIN', description: 'Platform administrator' },
    { name: 'SUPER_ADMIN', description: 'System-level administrator' },
    { name: 'TREASURER', description: 'Financial records manager' },
    { name: 'AUDITOR', description: 'Read-only financial auditor' },
    { name: 'LOAN_OFFICER', description: 'Loan processing officer' },
    { name: 'GROUP_MANAGER', description: 'Community group manager' },
    { name: 'MEMBER', description: 'Community group member' },
  ]) {
    await prisma.role.upsert({ where: { name: role.name }, update: { description: role.description }, create: role });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
