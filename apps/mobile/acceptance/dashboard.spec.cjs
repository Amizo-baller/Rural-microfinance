const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');

const fixture = () =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')));
test.use({ navigationTimeout: 90000 });
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: fixture().apiOrigin + url.pathname + url.search });
  });
});

async function login(page, account, endpoint) {
  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
  await page
    .getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/)
    .fill(fixture()[account].identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture().password);
  const actualSummary = page.waitForResponse(
    (response) => new URL(response.url()).pathname === endpoint && response.status() === 200,
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const data = await (await actualSummary).json();
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 60000 });
  return data;
}

async function audit(page, info, name) {
  await page.screenshot({ path: info.outputPath(name + '.png') });
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    result.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('reference dashboard shows genuine SLE savings and keeps existing navigation', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const actual = await login(page, 'member', '/api/savings/dashboard');
  const expected =
    'SLE ' +
    Number(actual.totalBalance).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  await expect(page.getByRole('button', { name: 'Total savings', exact: true })).toContainText(
    expected,
  );
  for (const label of ['Save', 'Pay loan', 'History', 'Home', 'Savings', 'Loans', 'Activity']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('button', { name: 'My community, Acceptance community', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Blockchain synced', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add member', exact: true })).toHaveCount(0);
  await audit(page, info, 'member-dashboard-reference');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('UI-SAVINGS-001', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Pay loan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply for a loan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply filters', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Total savings', exact: true })).toContainText(
    expected,
  );
});

test('admin can add a member using the existing API and the group label is presentation only', async ({
  page,
  request,
}, info) => {
  test.setTimeout(240000);
  const setup = fixture();
  const signedIn = await request.post(setup.apiOrigin + '/api/auth/login', {
    data: { identifier: setup.administrator.identifier, password: setup.password },
    timeout: 60000,
  });
  expect(signedIn.ok()).toBe(true);
  const headers = { Authorization: 'Bearer ' + (await signedIn.json()).accessToken };
  const created = await request.post(setup.apiOrigin + '/api/users', {
    headers,
    data: {
      firstName: 'Dashboard',
      lastName: 'Newmember',
      role: 'MEMBER',
      email: `dashboard-member-${Date.now()}@acceptance.test`,
      password: setup.password,
    },
  });
  expect(created.status()).toBe(201);
  const account = await created.json();
  const groupUrl = setup.apiOrigin + '/api/groups/' + setup.group.id;
  const renamed = await request.patch(groupUrl, {
    headers,
    data: { name: 'Module 6 Validation Group 659125' },
  });
  expect(renamed.ok()).toBe(true);
  try {
    await login(page, 'administrator', '/api/admin/dashboard');
    await page.getByRole('button', { name: 'Add member', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add member', exact: true })).toBeVisible();
    const group = page.getByRole('button', { name: 'Sierra Leone Mile 91 MicroFinance Group' });
    await expect(group).toBeVisible();
    expect(
      await group
        .locator('[dir="auto"]')
        .first()
        .evaluate((element) => getComputedStyle(element).fontWeight),
    ).toBe('700');
    await page
      .getByLabel('Search member accounts by name, phone, or email', { exact: true })
      .fill(account.email);
    await page.getByRole('button', { name: 'Search accounts', exact: true }).click();
    await page.getByRole('button', { name: /Dashboard Newmember/ }).click();
    await group.click();
    await audit(page, info, 'admin-add-member');
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/members' &&
        response.request().method() === 'POST',
      { timeout: 60000 },
    );
    await page.getByRole('button', { name: 'Confirm add member', exact: true }).click();
    const result = await saved;
    expect(result.status()).toBe(201);
    const member = await result.json();
    expect(member.user.id).toBe(account.id);
    expect(member.group.id).toBe(setup.group.id);
    expect(member.group.name).toBe('Module 6 Validation Group 659125');
    await expect(page.getByRole('heading', { name: 'Member details', exact: true })).toBeVisible();
    const persisted = await request.get(setup.apiOrigin + '/api/members/' + member.id, { headers });
    expect(persisted.ok()).toBe(true);
    expect((await persisted.json()).user.id).toBe(account.id);
  } finally {
    await request.patch(groupUrl, { headers, data: { name: setup.group.name } });
  }
});

test('admin dashboard retains real metrics at narrow widths and larger text', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const actual = await login(page, 'administrator', '/api/admin/dashboard');
  const expected =
    'SLE ' +
    Number(actual.metrics.totalSavings).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  await expect(page.getByRole('button', { name: 'Total savings', exact: true })).toContainText(
    expected,
  );
  await expect(page.getByRole('heading', { name: 'Admin dashboard', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('[dir="auto"]')).map((element) => [
      element,
      parseFloat(getComputedStyle(element).fontSize),
    ]);
    for (const [element, size] of elements) {
      element.style.fontSize = size * 1.5 + 'px';
      element.style.lineHeight = '1.5';
    }
  });
  await audit(page, info, 'admin-dashboard-large-text');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'System settings', exact: true })).toBeVisible();
});
