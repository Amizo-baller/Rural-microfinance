const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('existing Group Manager becomes Admin without a new account or changed group ownership', async ({ request }) => {
  test.setTimeout(180000);
  const { PrismaClient } = require('@prisma/client');
  const bcrypt = require('bcrypt');
  const dotenv = require('dotenv');
  const root = path.resolve(__dirname, '../../..');
  const fixture = JSON.parse(fs.readFileSync(path.join(root, '.acceptance/fixture.json')));
  if (!/^rcm_ui_acceptance_\d+$/.test(fixture.databaseName)) throw new Error('An isolated acceptance database is required');
  const configuration = dotenv.parse(fs.readFileSync(path.join(root, 'apps/api/.env')));
  const databaseUrl = new URL(configuration.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)) throw new Error('Local test database required');
  databaseUrl.pathname = '/' + fixture.databaseName;
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
  try {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'GROUP_MANAGER' } });
    const existing = await prisma.user.create({ data: {
      memberId: `OLD-ADMIN-${Date.now()}`, firstName: 'Existing', lastName: 'Manager',
      email: `existing-manager-${Date.now()}@acceptance.test`,
      passwordHash: await bcrypt.hash(fixture.password, 4), roleId: role.id, status: 'ACTIVE',
    } });
    const group = await prisma.communityGroup.create({ data: {
      name: 'Existing managed community', registrationNo: `MIGRATION-${Date.now()}`,
      location: 'Test village', managerId: existing.id,
    } });
    const countsBefore = await Promise.all([prisma.user.count(), prisma.savingsAccount.count(), prisma.transaction.count()]);
    const sql = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations/20261020150000_group_manager_to_admin/migration.sql'), 'utf8');
    const statements = sql.replace(/--[^\n]*/g, '').split(';').map((s) => s.trim()).filter((s) => s && !['BEGIN', 'COMMIT'].includes(s));
    await prisma.$transaction(async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
    });
    const migrated = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, include: { role: true } });
    expect(migrated).toMatchObject({ id: existing.id, memberId: existing.memberId, email: existing.email,
      passwordHash: existing.passwordHash, status: existing.status, role: { name: 'ADMIN' } });
    expect(await prisma.communityGroup.findUniqueOrThrow({ where: { id: group.id } })).toEqual(group);
    expect(await Promise.all([prisma.user.count(), prisma.savingsAccount.count(), prisma.transaction.count()])).toEqual(countsBefore);
    expect(await prisma.auditLog.count({ where: { entityId: existing.id, action: 'GROUP_MANAGER_REPLACED_BY_ADMIN' } })).toBe(1);
    const login = await request.post(fixture.apiOrigin + '/api/auth/login', { data: { identifier: existing.memberId, password: fixture.password } });
    expect(login.status()).toBe(201);
    const session = await login.json();
    expect(session.user).toMatchObject({ id: existing.id, role: 'ADMIN' });
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    for (const route of ['/users', '/admin/dashboard', '/system/settings', '/groups']) {
      expect((await request.get(fixture.apiOrigin + '/api' + route, { headers })).status()).toBe(200);
    }
  } finally { await prisma.$disconnect(); }
});

for (const [role, label, workspace] of [
  ['ADMIN', 'Admin', 'Manage platform'],
  ['TREASURER', 'Treasurer', 'Treasurer workspace'],
  ['MEMBER', 'Member', 'Member workspace'],
]) {
  test(`${label} dropdown registration reaches the correct workspace with enforced approval`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180000);
    const fixture = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')),
    );
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      return route.continue({ url: fixture.apiOrigin + url.pathname + url.search });
    });
    const id = `DROP-${role}-${Date.now()}`;
    const email = `${id.toLowerCase()}@acceptance.test`;
    await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
    await page.getByRole('button', { name: 'Role: Member', exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Admin', 'Treasurer', 'Member']);
    await expect(page.getByRole('menuitem', { name: 'Group manager', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Role: ${label}`, exact: true })).toBeVisible();
    await page.getByLabel('Member ID (required, e.g. 2026001)', { exact: true }).fill(id);
    await page.getByLabel('First name', { exact: true }).fill('Dropdown');
    await page.getByLabel('Last name', { exact: true }).fill(label);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByLabel('Confirm password', { exact: true }).fill(fixture.password);
    const registrationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/register' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    const response = await registrationResponse;
    expect(response.status()).toBe(201);
    const result = await response.json();
    expect(result.user.role).toBe(role);
    if (role !== 'MEMBER') {
      expect(result.pendingApproval).toBe(true);
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
      await expect(page.getByText('Account awaiting approval', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem('auth_session_v2'))).toBeNull();
      const login = await request.post(fixture.apiOrigin + '/api/auth/login', {
        data: { identifier: id, password: fixture.password },
      });
      expect(login.status()).toBe(403);
      const administrator = await (
        await request.post(fixture.apiOrigin + '/api/auth/login', {
          data: { identifier: fixture.administrator.identifier, password: fixture.password },
        })
      ).json();
      const activated = await request.patch(
        fixture.apiOrigin + `/api/users/${result.user.id}/status`,
        {
          headers: { Authorization: `Bearer ${administrator.accessToken}` },
          data: { status: 'ACTIVE' },
        },
      );
      expect(activated.status()).toBe(200);
      await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
      await page.getByLabel('Password', { exact: true }).fill(fixture.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: workspace, exact: true })).toBeVisible({
      timeout: 60000,
    });
    const token =
      role === 'MEMBER'
        ? result.accessToken
        : (
            await (
              await request.post(fixture.apiOrigin + '/api/auth/login', {
                data: { identifier: id, password: fixture.password },
              })
            ).json()
          ).accessToken;
    const headers = { Authorization: `Bearer ${token}` };
    expect((await request.get(fixture.apiOrigin + '/api/users', { headers })).status()).toBe(role === 'ADMIN' ? 200 : 403);
    if (role === 'ADMIN') {
      await expect(page.getByText('Admin', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Manage platform', exact: true }).click();
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await page.getByRole('button', { name: 'Create new', exact: true }).click();
      await page.getByRole('button', { name: 'Role: Member', exact: true }).click();
      await expect(page.getByRole('menuitem')).toHaveText(['Admin', 'Treasurer', 'Member']);
    }
    expect(errors).toEqual([]);
  });
}
