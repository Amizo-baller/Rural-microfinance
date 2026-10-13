const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');

test('loan reference layout uses real balances and preserves repayment and application flows', async ({
  page,
  request,
}, info) => {
  test.setTimeout(240000);
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')),
  );
  async function call(route, token, method = 'GET', data) {
    const response = await request.fetch(fixture.apiOrigin + '/api' + route, {
      method,
      timeout: 60000,
      ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
      ...(data ? { data } : {}),
    });
    expect(response.ok(), `${method} ${route}: ${response.status()}`).toBe(true);
    return response.json();
  }
  const staff = await call('/auth/login', undefined, 'POST', {
    identifier: fixture.administrator.identifier,
    password: fixture.password,
  });
  const identifier = `loan-ui-${Date.now()}@acceptance.test`;
  const member = await call('/auth/register', undefined, 'POST', {
    firstName: 'Loan',
    lastName: 'Review',
    email: identifier,
    role: 'MEMBER',
    password: fixture.password,
    passwordConfirmation: fixture.password,
    groupId: fixture.group.id,
  });
  const application = await call('/loans/applications', member.accessToken, 'POST', {
    amount: '2000',
    purpose: 'Equipment for the community farm',
    durationMonths: 6,
  });
  await call('/loans/applications/' + application.id + '/status', staff.accessToken, 'PATCH', {
    status: 'APPROVED',
  });
  const loan = await call(
    '/loans/applications/' + application.id + '/loan',
    staff.accessToken,
    'POST',
    {
      interestRate: '0',
      startDate: '2026-08-01T00:00:00.000Z',
      dueDate: '2027-02-01T00:00:00.000Z',
    },
  );
  await call('/loans/' + loan.id + '/disburse', staff.accessToken, 'POST', {});
  await call('/loans/' + loan.id + '/repayments', member.accessToken, 'POST', {
    amount: '800',
    reference: 'LOAN-UI-INITIAL-REPAYMENT',
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: fixture.apiOrigin + url.pathname + url.search });
  });
  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByLabel('Email address or phone number', { exact: true }).fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Dashboard' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 60000 });
  await page.getByRole('button', { name: 'Pay loan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Loans', exact: true })).toBeVisible();
  await expect(page.getByLabel('Loading loans')).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByText('SLE 1,200.00', { exact: true })).toHaveCount(2);
  await expect(page.getByText('SLE 800.00', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Repayment progress', exact: true }),
  ).toHaveAttribute('aria-valuenow', '40');
  await expect(page.getByText('Not scheduled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Loans', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({ path: info.outputPath('loan-dashboard-reference.png') });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[dir="auto"]')) {
      const size = parseFloat(getComputedStyle(element).fontSize);
      element.style.fontSize = size * 1.5 + 'px';
      element.style.lineHeight = '1.5';
    }
  });
  await page.screenshot({ path: info.outputPath('loan-dashboard-large-text.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Repay loan', exact: true }).click();
  await page.getByLabel('Repayment amount (GHS) · max 1200', { exact: true }).fill('100');
  const recorded = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/loans/${loan.id}/repayments` &&
      response.request().method() === 'POST',
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Record repayment', exact: true }).click();
  expect((await recorded).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Dismiss message', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Pay loan', exact: true }).click();
  await expect(page.getByLabel('Loading loans')).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByText('SLE 1,100.00', { exact: true })).toHaveCount(2);
  await expect(page.getByText('SLE 900.00', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Repayment progress', exact: true }),
  ).toHaveAttribute('aria-valuenow', '45');
  expect((await call('/loans/' + loan.id, member.accessToken)).outstandingBalance).toBe('1100');
  await page.getByRole('button', { name: 'Apply for a loan', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Submit loan application', exact: true }),
  ).toBeVisible();
});
