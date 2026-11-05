const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('a completed member checkout automatically updates the open admin dashboard once', async ({ page, request }) => {
  test.setTimeout(240000);
  const root = path.resolve(__dirname, '../../..');
  const fixture = JSON.parse(fs.readFileSync(path.join(root, '.acceptance/fixture.json')));
  const authenticate = async (identifier) => {
    const response = await request.post(fixture.apiOrigin + '/api/auth/login', { data: { identifier, password: fixture.password } });
    expect(response.status()).toBe(201);
    return response.json();
  };
  const admin = await authenticate(fixture.administrator.identifier);
  const member = await authenticate(fixture.member.identifier);
  const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` };
  const memberHeaders = { Authorization: `Bearer ${member.accessToken}` };
  const before = await (await request.get(fixture.apiOrigin + '/api/admin/dashboard', { headers: adminHeaders })).json();
  const totals = before.metrics.totalSavings;
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: fixture.apiOrigin + url.pathname + url.search });
  });
  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Member ID, email address or phone number', { exact: true }).fill(fixture.administrator.identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage platform', exact: true })).toBeVisible({ timeout: 60000 });
  // Older fixture accounts have no member ID; use the current account profile after setting one.
  const { PrismaClient } = require('@prisma/client');
  const config = require('dotenv').parse(fs.readFileSync(path.join(root, 'apps/api/.env')));
  const url = new URL(config.DATABASE_URL);
  if (!/^rcm_ui_acceptance_\d+$/.test(fixture.databaseName) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('An isolated local test database is required');
  url.pathname = '/' + fixture.databaseName;
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const memberId = `LIVE-TEST-${Date.now()}`;
    await prisma.user.update({ where: { id: member.user.id }, data: { memberId } });
    const started = await request.post(fixture.apiOrigin + '/api/workflow/payments', {
      headers: memberHeaders, data: { requestId: `monime-${Date.now()}`, memberId, kind: 'CONTRIBUTION', amount: '12.50', receiptEmail: 'member@acceptance.test' },
    });
    expect(started.status()).toBe(201);
    const payment = await started.json();
    expect(payment.status).toBe('AWAITING_PAYMENT');
    const pendingTotal = await (await request.get(fixture.apiOrigin + '/api/admin/dashboard', { headers: adminHeaders })).json();
    expect(pendingTotal.metrics.totalSavings).toBe(totals);
    expect((await request.post(fixture.gatewayOrigin + '/__complete/' + payment.gatewayId, { data: {} })).status()).toBe(200);
    // Do not call member verification or staff review. The scheduled sync must credit it.
    await expect.poll(async () => (await prisma.paymentSubmission.findUnique({ where: { id: payment.id } })).status,
      { timeout: 120000, intervals: [1000, 3000] }).toBe('CONFIRMED');
    const expected = `SLE ${(Number(totals) + 12.5).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await expect(page.getByRole('button', { name: 'Total savings', exact: true })).toContainText(expected, { timeout: 60000 });
    const credited = await prisma.paymentSubmission.findUnique({ where: { id: payment.id } });
    expect(credited.reviewerId).toBeNull();
    expect(credited.receipt).toBeNull();
    const verifyAgain = await request.post(fixture.apiOrigin + `/api/workflow/payments/${payment.id}/verify`, { headers: memberHeaders, data: {} });
    expect(verifyAgain.status()).toBe(201);
    expect(await prisma.contribution.count({ where: { reference: payment.reference } })).toBe(1);
    expect(await prisma.transaction.count({ where: { reference: payment.reference } })).toBe(1);
    const after = await (await request.get(fixture.apiOrigin + '/api/admin/dashboard', { headers: adminHeaders })).json();
    expect(after.metrics.totalSavings).toBe(Number(totals) + 12.5);
    const summary = await (await request.get(fixture.apiOrigin + '/api/workflow/summary', { headers: memberHeaders })).json();
    expect(Number(summary.totalSavings)).toBe(12.5);
    // The same real accounting path must reject altered gateway amounts and
    // roll back credits while the savings account is frozen.
    const guardedStart = await request.post(fixture.apiOrigin + '/api/workflow/payments', {
      headers: memberHeaders, data: { requestId: `monime-guard-${Date.now()}`, memberId,
        kind: 'CONTRIBUTION', amount: '5.25', receiptEmail: 'member@acceptance.test' },
    });
    expect(guardedStart.status()).toBe(201);
    const guarded = await guardedStart.json();
    await request.post(fixture.gatewayOrigin + '/__complete/' + guarded.gatewayId, { data: { value: 1 } });
    const verify = () => request.post(fixture.apiOrigin + `/api/workflow/payments/${guarded.id}/verify`, { headers: memberHeaders, data: {} });
    expect((await verify()).status()).toBe(409);
    expect(await prisma.contribution.count({ where: { reference: guarded.reference } })).toBe(0);
    expect((await prisma.paymentSubmission.findUnique({ where: { id: guarded.id } })).status).toBe('AWAITING_PAYMENT');
    await prisma.savingsAccount.update({ where: { id: fixture.savingsId }, data: { status: 'FROZEN' } });
    await request.post(fixture.gatewayOrigin + '/__complete/' + guarded.gatewayId, { data: { value: 525 } });
    expect((await verify()).status()).toBe(409);
    expect((await prisma.paymentSubmission.findUnique({ where: { id: guarded.id } })).status).toBe('PAID');
    expect(await prisma.contribution.count({ where: { reference: guarded.reference } })).toBe(0);
    expect(Number((await prisma.savingsAccount.findUnique({ where: { id: fixture.savingsId } })).balance)).toBe(12.5);
    await prisma.savingsAccount.update({ where: { id: fixture.savingsId }, data: { status: 'ACTIVE' } });
    const races = await Promise.all([verify(), verify()]);
    expect(races.some((response) => response.status() === 201)).toBe(true);
    expect(races.every((response) => [201, 409].includes(response.status()))).toBe(true);
    expect((await verify()).status()).toBe(201);
    expect(await prisma.contribution.count({ where: { reference: guarded.reference } })).toBe(1);
    expect(await prisma.transaction.count({ where: { reference: guarded.reference } })).toBe(1);
    expect(Number((await prisma.savingsAccount.findUnique({ where: { id: fixture.savingsId } })).balance)).toBe(17.75);
  } finally { await prisma.$disconnect(); }
});
