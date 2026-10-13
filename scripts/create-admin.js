require('dotenv').config({ path: 'apps/api/.env' });
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const adminEmail = 'ibz@gmail.com';
const firstName = 'Ibrahimz';
const lastName = 'Kamara';
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!password || password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
  throw new Error('BOOTSTRAP_ADMIN_PASSWORD missing or invalid.');
}

async function ensureRole(name) {
  const existing = await prisma.role.findUnique({ where: { name } });
  if (existing) return existing;
  return prisma.role.create({
    data: {
      name,
      description: name === 'SUPER_ADMIN' ? 'Full system administrator' : 'Platform administrator',
    },
  });
}

async function ensureAdminAccount() {
  await ensureRole('ADMIN');
  await ensureRole('SUPER_ADMIN');

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!superAdminRole) throw new Error('SUPER_ADMIN role missing after bootstrap.');

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        firstName,
        lastName,
        roleId: superAdminRole.id,
        status: 'ACTIVE',
        passwordHash: await bcrypt.hash(password, 12),
      },
    });

    console.log(JSON.stringify({ status: 'ADMIN_READY', email: updated.email, role: 'SUPER_ADMIN' }));
    return { user: updated, role: superAdminRole };
  }

  const created = await prisma.user.create({
    data: {
      firstName,
      lastName,
      email: adminEmail,
      passwordHash: await bcrypt.hash(password, 12),
      roleId: superAdminRole.id,
      status: 'ACTIVE',
    },
  });

  console.log(JSON.stringify({ status: 'ADMIN_CREATED', email: created.email, role: 'SUPER_ADMIN' }));
  return { user: created, role: superAdminRole };
}

async function verifyAdminAccess() {
  const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: adminEmail, password }),
  });

  if (!loginResponse.ok) {
    const body = await loginResponse.text();
    throw new Error(`LOGIN_FAILED:${loginResponse.status}:${body}`);
  }

  const session = await loginResponse.json();
  const dashboardResponse = await fetch('http://localhost:3000/api/admin/dashboard', {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });

  if (!dashboardResponse.ok) {
    const body = await dashboardResponse.text();
    throw new Error(`DASHBOARD_FAILED:${dashboardResponse.status}:${body}`);
  }

  console.log(JSON.stringify({ status: 'VERIFIED', role: session.user?.role, dashboardStatus: dashboardResponse.status }));
}

(async () => {
  await ensureAdminAccount();
  await verifyAdminAccess();
})()
  .catch((error) => {
    console.error(`ADMIN_BOOTSTRAP_FAILED:${error.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
