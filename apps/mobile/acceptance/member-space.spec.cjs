const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('member joins a group and uses obligations, withdrawals, payouts and verification with private records', async ({ page, request }) => {
  test.setTimeout(240000);
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: fixture.apiOrigin + url.pathname + url.search });
  });
  async function call(route, token, method = 'GET', data, status) {
    const response = await request.fetch(fixture.apiOrigin + '/api' + route, {
      method, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), ...(data ? { data } : {}),
    });
    if (status) expect(response.status(), route).toBe(status);
    else expect(response.ok(), `${route}: ${await response.text()}`).toBe(true);
    return response.json();
  }
  const admin = await call('/auth/login', null, 'POST', { identifier: fixture.administrator.identifier, password: fixture.password });
  const member = await call('/auth/login', null, 'POST', { identifier: fixture.member.identifier, password: fixture.password });
  await call('/groups/' + fixture.group.id, admin.accessToken, 'PATCH', { weeklyContributionAmount: '25', withdrawalsAllowed: true });
  await call('/member-space', admin.accessToken, 'GET', undefined, 403);
  const initial = await call('/member-space', member.accessToken);
  expect(initial.membership.group.id).toBe(fixture.group.id);
  const account = initial.accounts.find((row) => row.status === 'ACTIVE' && row.currency === 'SLE');
  expect(account).toBeTruthy();
  const unique = Date.now();
  await call('/savings/contributions', admin.accessToken, 'POST', {
    savingsAccountId: account.id, amount: '10', reference: `MEMBER-FUND-${unique}`, paymentMethod: 'CASH', description: 'Member workspace test funding',
  });
  await call(`/savings/accounts/${account.id}/status`, member.accessToken, 'PATCH', { status: 'ACTIVE' }, 403);
  await call('/member-space/groups/' + fixture.group.id + '/join', member.accessToken, 'POST', {}, 409);

  const newcomer = await call('/auth/register', null, 'POST', {
    memberId: `JOIN-${unique}`, firstName: 'Joining', lastName: 'Member', email: `join-${unique}@acceptance.test`, password: fixture.password, passwordConfirmation: fixture.password, role: 'MEMBER',
  });
  expect((await call('/member-space', newcomer.accessToken)).membership).toBeNull();
  await call(`/savings/accounts/${account.id}`, newcomer.accessToken, 'GET', undefined, 403);
  await call('/member-space/groups/' + fixture.group.id + '/join', newcomer.accessToken, 'POST', {});
  const joined = await call('/member-space', newcomer.accessToken);
  expect(joined.membership.group.id).toBe(fixture.group.id);
  expect(joined.obligations.weeklyAmount).toBe('25.00');
  expect((await call('/notifications', newcomer.accessToken)).items.some((row) => row.title === 'Group membership active')).toBe(true);

  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/).fill(fixture.member.identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Member workspace', exact: true }).click({ timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'Member workspace', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pay contribution', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply for loan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repay loan', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Obligations', exact: true }).click();
  await expect(page.getByText('Weekly contribution: SLE 25.00', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Withdrawals', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('radio').first().click();
  await page.getByRole('button', { name: 'Submit withdrawal request', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('positive amount');
  await page.getByLabel('Withdrawal amount', { exact: true }).fill('5');
  await page.getByLabel('Withdrawal reason', { exact: true }).fill('School fees for family');
  await page.getByRole('button', { name: 'Submit withdrawal request', exact: true }).click();
  await expect(page.getByText('Withdrawal requested. An administrator will review it.', { exact: true })).toBeVisible();
  const withdrawals = await call('/member-space/withdrawals', member.accessToken);
  expect(withdrawals.items.some((row) => row.reason === 'School fees for family' && row.status === 'PENDING')).toBe(true);
  await page.getByRole('tab', { name: 'Payout status', exact: true }).click();
  await expect(page.getByText('Loan payout status', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Verification records', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: /^Verify / }).first().click();
  await expect(page.getByText(/^Result: (VERIFIED|NOT_VERIFIED|PENDING)$/)).toBeVisible();
  expect(errors).toEqual([]);
});
