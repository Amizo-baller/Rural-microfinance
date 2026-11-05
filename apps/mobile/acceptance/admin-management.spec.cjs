const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixture = () =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')));

test('admin console manages accounts, groups, cycles, withdrawals, settings and announcements', async ({
  page,
  request,
}) => {
  test.setTimeout(300000);
  const setup = fixture();
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: setup.apiOrigin + url.pathname + url.search });
  });
  const authenticate = async (account) => {
    const response = await request.post(setup.apiOrigin + '/api/auth/login', {
      data: { identifier: account.identifier, password: setup.password },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const admin = await authenticate(setup.administrator);
  const member = await authenticate(setup.member);
  const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` };
  const memberHeaders = { Authorization: `Bearer ${member.accessToken}` };
  for (const endpoint of [
    '/admin/audit-logs',
    '/admin/cycles',
    '/admin/blockchain',
    '/system/settings',
  ]) {
    expect(
      (await request.get(setup.apiOrigin + '/api' + endpoint, { headers: memberHeaders })).status(),
    ).toBe(403);
  }

  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
  await page
    .getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/)
    .fill(setup.administrator.identifier);
  await page.getByLabel('Password', { exact: true }).fill(setup.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Manage platform', exact: true })
    .click({ timeout: 60000 });
  const tab = async (name) => {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  };
  const save = async () => {
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved successfully.', { exact: true })).toBeVisible();
  };
  const unique = Date.now().toString();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page.getByLabel('First name', { exact: true }).fill('AdminCreated');
  await page.getByLabel('Last name', { exact: true }).fill(unique);
  await page.getByLabel('Email', { exact: true }).fill(`admin-created-${unique}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('AdminTest123!');
  await save();
  await page.getByLabel('Search users').fill(`admin-created-${unique}@example.com`);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const userCard = page.getByText(`AdminCreated ${unique}`, { exact: true }).locator('..');
  await userCard.getByRole('button', { name: 'Suspend account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(userCard).toContainText('SUSPENDED');
  await userCard.getByRole('button', { name: 'Activate account', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(userCard).toContainText('ACTIVE');

  await tab('Groups');
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill(`Admin community ${unique}`);
  await page.getByLabel('Registration number').fill(`ADM-${unique}`);
  await page.getByLabel('Location', { exact: true }).fill('Freetown');
  await page.getByLabel('Contact information').fill('+23276123456');
  await save();
  const groupResponse = await request.get(setup.apiOrigin + `/api/groups?search=${unique}`, {
    headers: adminHeaders,
  });
  const group = (await groupResponse.json()).items[0];
  expect(group.name).toBe(`Admin community ${unique}`);
  const cycleResponse = await request.post(setup.apiOrigin + '/api/admin/cycles', {
    headers: adminHeaders,
    data: {
      groupId: group.id,
      name: `Cycle ${unique}`,
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      targetAmount: '500',
    },
  });
  expect(cycleResponse.ok()).toBeTruthy();
  await tab('Savings cycles');
  const cycleCard = page.getByText(`Cycle ${unique}`, { exact: true }).locator('..');
  await cycleCard.getByRole('button', { name: 'Activate cycle', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(cycleCard).toContainText('ACTIVE');
  await cycleCard.getByRole('button', { name: 'Complete cycle', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm action', exact: true }).click();
  await expect(cycleCard).toContainText('COMPLETED');

  const savings = await (
    await request.get(setup.apiOrigin + '/api/savings/dashboard', { headers: memberHeaders })
  ).json();
  const account = savings.accounts.find((a) => a.currency === 'SLE' && a.status === 'ACTIVE');
  const funding = await request.post(setup.apiOrigin + '/api/savings/contributions', {
    headers: adminHeaders,
    data: {
      savingsAccountId: account.id,
      amount: '10',
      reference: `ADMIN-UI-FUND-${unique}`,
      paymentMethod: 'CASH',
      description: 'Fund isolated withdrawal acceptance test',
    },
  });
  expect(funding.ok()).toBeTruthy();
  const startingBalance = Number(account.balance) + 10;
  const withdrawalReference = `WD-UI-${unique}`;
  const withdrawal = await request.post(setup.apiOrigin + '/api/admin/withdrawals', {
    headers: memberHeaders,
    data: {
      savingsAccountId: account.id,
      amount: '1',
      reference: withdrawalReference,
      reason: 'Admin acceptance verification',
    },
  });
  expect(withdrawal.ok()).toBeTruthy();
  const withdrawalId = (await withdrawal.json()).id;
  await tab('Withdrawals');
  const withdrawalCard = page.getByText(withdrawalReference, { exact: true }).locator('..');
  await withdrawalCard.getByRole('button', { name: 'Approve withdrawal', exact: true }).click();
  await page.getByLabel('Notes', { exact: true }).fill('Approved after checking account');
  await save();
  await expect(withdrawalCard).toContainText('APPROVED');
  const after = await (
    await request.get(setup.apiOrigin + `/api/savings/accounts/${account.id}`, {
      headers: memberHeaders,
    })
  ).json();
  expect(Number(after.balance)).toBe(startingBalance - 1);
  expect(
    (
      await request.post(setup.apiOrigin + `/api/admin/withdrawals/${withdrawalId}/review`, {
        headers: adminHeaders,
        data: { decision: 'APPROVED', notes: 'Duplicate approval must fail' },
      })
    ).status(),
  ).toBe(409);

  const rejectedReference = `WD-REJECT-${unique}`;
  const rejected = await request.post(setup.apiOrigin + '/api/admin/withdrawals', {
    headers: memberHeaders,
    data: {
      savingsAccountId: account.id,
      amount: '1',
      reference: rejectedReference,
      reason: 'Request to reject in admin review',
    },
  });
  expect(rejected.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const rejectedCard = page.getByText(rejectedReference, { exact: true }).locator('..');
  await rejectedCard.getByRole('button', { name: 'Reject withdrawal', exact: true }).click();
  await page
    .getByLabel('Notes', { exact: true })
    .fill('Rejected because supporting evidence is missing');
  await save();
  await expect(rejectedCard).toContainText('REJECTED');
  const afterRejection = await (
    await request.get(setup.apiOrigin + `/api/savings/accounts/${account.id}`, {
      headers: memberHeaders,
    })
  ).json();
  expect(Number(afterRejection.balance)).toBe(Number(after.balance));

  await tab('Announcements');
  await page.getByRole('button', { name: 'New announcement', exact: true }).click();
  await page.getByRole('radio', { name: `○ Admin community ${unique}`, exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Cycle notice');
  await page.getByLabel('Message', { exact: true }).fill('The new savings cycle is ready.');
  await save();

  await tab('System settings');
  await page.getByRole('button', { name: 'Create new', exact: true }).click();
  await page.getByLabel('Key', { exact: true }).fill(`admin.test.${unique}`);
  await page.getByLabel('Value (JSON object)', { exact: true }).fill('{"enabled":true}');
  await save();
  await expect(page.getByText(`admin.test.${unique}`, { exact: true })).toBeVisible();
  await tab('Audit logs');
  await page.getByLabel('Search audit logs').fill('WITHDRAWAL_APPROVED');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('WITHDRAWAL_APPROVED', { exact: true }).first()).toBeVisible();
  await tab('Blockchain');
  const blockchain = await request.get(setup.apiOrigin + '/api/admin/blockchain', { headers: adminHeaders });
  expect(blockchain.ok()).toBeTruthy();
  expect(Array.isArray((await blockchain.json()).items)).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(failures).toEqual([]);
});
