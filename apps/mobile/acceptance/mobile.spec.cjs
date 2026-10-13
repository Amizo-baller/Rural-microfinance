const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs');
const path = require('node:path');

const fixture = () =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')));
test.beforeEach(async ({ page }) => {
  // Exercise the exported production UI with genuine requests to the isolated API.
  await page.route('**/api/**', async (route) => {
    const original = new URL(route.request().url());
    await route.continue({ url: fixture().apiOrigin + original.pathname + original.search });
  });
});

async function dismiss(page) {
  const button = page.getByRole('button', { name: 'Dismiss message', exact: true });
  if (await button.count()) await button.click();
}
async function home(page) {
  await dismiss(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
}
async function signIn(page, account = 'member') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page
    .getByLabel('Email address or phone number', { exact: true })
    .fill(fixture()[account].identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture().password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: account === 'member' ? 'My Dashboard' : 'Admin dashboard',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Loading account activity...', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}
async function capture(page, info, name) {
  await expect(page.getByRole('button', { name: 'Refreshing...', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
  await info.attach(name + '-screen', {
    path: info.outputPath(name + '.png'),
    contentType: 'image/png',
  });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await info.attach(name + '-accessibility', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  expect(
    results.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
      elements: item.nodes.map((node) => node.target),
    })),
    name,
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    name + ' horizontal overflow',
  ).toBe(true);
}
async function largeText(page) {
  await page.evaluate(() => {
    const fields = Array.from(document.querySelectorAll('[dir="auto"], input, textarea')).map(
      (element) => [element, parseFloat(getComputedStyle(element).fontSize)],
    );
    fields.forEach(([element, size]) => {
      element.style.fontSize = size * 1.5 + 'px';
      element.style.lineHeight = '1.5';
    });
  });
}
async function api(request, route, { session, method = 'GET', data } = {}) {
  const response = await request.fetch(fixture().apiOrigin + '/api' + route, {
    method,
    ...(data ? { data } : {}),
    ...(session ? { headers: { Authorization: 'Bearer ' + session.accessToken } } : {}),
  });
  expect(response.ok(), route + ' returned ' + response.status()).toBe(true);
  return response.status() === 204 ? undefined : response.json();
}

test('member can use all financial and community screens with live services', async ({
  page,
  request,
}, info) => {
  test.setTimeout(420000);
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Total savings', exact: true })).toContainText(
    'SLE 0.00',
  );
  for (const label of ['Save', 'Pay loan', 'History', 'Activity']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole('button', { name: 'My community, Acceptance community', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Blockchain synced', { exact: true })).toHaveCount(0);
  await capture(page, info, '06-dashboard');

  await page.getByRole('button', { name: 'Profile', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
  await page.getByLabel('First name', { exact: true }).fill('Ama');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile updated', { exact: true })).toBeVisible();
  await dismiss(page);
  await capture(page, info, '07-profile');

  await page.getByRole('button', { name: 'Groups', exact: true }).click();
  await expect(page.getByText('Acceptance community', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Acceptance community/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Acceptance community', exact: true }),
  ).toBeVisible();
  await capture(page, info, '08-group');

  await home(page);
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(page.getByText(/Ama Mensah/).first()).toBeVisible();
  await capture(page, info, '09-members');
  await page.getByRole('button', { name: /Ama Mensah/ }).click();
  await expect(page.getByRole('heading', { name: 'Member details', exact: true })).toBeVisible();
  await expect(page.getByText('Savings balance: GHS 0', { exact: true })).toBeVisible();
  await capture(page, info, '09b-member-details');

  await page.getByRole('button', { name: 'Savings', exact: true }).first().click();
  await expect(page.getByText('UI-SAVINGS-001', { exact: true })).toBeVisible();
  await capture(page, info, '10-savings');
  await page.getByRole('button', { name: 'View contributions', exact: true }).click();
  await expect(page.getByText('No contributions recorded.', { exact: true })).toBeVisible();
  await page.getByLabel('Contribution amount (GHS)', { exact: true }).fill('12.50');
  await page.getByLabel('Description (optional)', { exact: true }).fill('Weekly savings');
  await page.getByRole('button', { name: 'Record contribution', exact: true }).click();
  await expect(page.getByText('Contribution recorded', { exact: true })).toBeVisible();
  await dismiss(page);
  await expect(page.getByText('Balance: GHS 12.5', { exact: true })).toBeVisible();
  await capture(page, info, '11-contributions');

  await page.getByRole('button', { name: 'Loans', exact: true }).first().click();
  await expect(page.getByText('No created loans found.', { exact: true })).toBeVisible();
  await capture(page, info, '12-loans-empty');
  await page.getByRole('button', { name: 'Apply for a loan', exact: true }).click();
  await page.getByLabel('Loan amount (GHS)', { exact: true }).fill('100');
  await page.getByLabel('Purpose', { exact: true }).fill('Buy seeds for the next harvest');
  await page.getByLabel('Duration (months)', { exact: true }).fill('6');
  await capture(page, info, '13-loan-application');
  await page.getByRole('button', { name: 'Submit loan application', exact: true }).click();
  await expect(page.getByText('Application submitted', { exact: true })).toBeVisible();
  await dismiss(page);

  const staff = await api(request, '/auth/login', {
    method: 'POST',
    data: { identifier: fixture().administrator.identifier, password: fixture().password },
  });
  const member = await api(request, '/auth/login', {
    method: 'POST',
    data: { identifier: fixture().member.identifier, password: fixture().password },
  });
  const applications = await api(request, '/loans/applications', { session: member });
  const application = applications.items.find(
    (item) => item.purpose === 'Buy seeds for the next harvest',
  );
  expect(application).toBeTruthy();
  await api(request, '/loans/applications/' + application.id + '/status', {
    session: staff,
    method: 'PATCH',
    data: { status: 'APPROVED' },
  });
  const loan = await api(request, '/loans/applications/' + application.id + '/loan', {
    session: staff,
    method: 'POST',
    data: {
      interestRate: '0',
      startDate: new Date(Date.now() - 1000).toISOString(),
      dueDate: new Date(Date.now() + 180 * 86400000).toISOString(),
    },
  });
  await api(request, '/loans/' + loan.id + '/disburse', {
    session: staff,
    method: 'POST',
    data: {},
  });
  await page.getByRole('button', { name: 'Loans', exact: true }).first().click();
  await page.getByRole('button', { name: 'View loan details', exact: true }).click();
  await expect(page.getByText('Outstanding: GHS 100 · 6 months', { exact: true })).toBeVisible();
  await capture(page, info, '14-loan-details');
  await page.getByRole('button', { name: 'Refresh / Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Loan details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make a repayment', exact: true }).click();
  await page.getByLabel(/Repayment amount/).fill('25');
  await page.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await expect(page.getByText('Repayment recorded', { exact: true })).toBeVisible();
  await dismiss(page);
  await expect(page.getByText('Outstanding: GHS 75 · 6 months', { exact: true })).toBeVisible();
  expect((await api(request, '/loans/' + loan.id, { session: member })).outstandingBalance).toBe(
    '75',
  );
  const savings = await api(request, '/savings/dashboard', { session: member });
  expect(savings.accounts.find((item) => item.id === fixture().savingsId).balance).toBe('12.5');
  await capture(page, info, '15-repayments');

  await home(page);
  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await expect(page.getByText(/Weekly savings|CONTR-/).first()).toBeVisible();
  await capture(page, info, '16-transactions');
  const transactions = await api(request, '/financial-records', { session: member });
  const transaction = transactions.items.find((item) => item.type === 'CONTRIBUTION');
  expect(transaction).toBeTruthy();
  const verification = await api(request, '/blockchain/verify/' + transaction.id, {
    session: member,
  });
  expect(verification.verificationResult).toBe('PENDING');
  await api(request, '/blockchain/proofs', {
    session: member,
    method: 'POST',
    data: {
      reference: transaction.reference,
      recordHash: verification.databaseHash,
      transactionType: transaction.type,
    },
  });
  await home(page);
  await page.getByRole('button', { name: 'Blockchain', exact: true }).click();
  await page.getByLabel('Transaction UUID', { exact: true }).fill(transaction.id);
  await page.getByRole('button', { name: 'Verify transaction', exact: true }).click();
  await expect(page.getByText('Result: VERIFIED', { exact: true })).toBeVisible();
  await capture(page, info, '17-blockchain-verification');

  await home(page);
  await page.getByRole('button', { name: 'Meetings', exact: true }).click();
  await expect(page.getByText(/Monthly savings meeting/).first()).toBeVisible();
  await capture(page, info, '18-meetings');
  await page.getByRole('button', { name: 'View and record attendance', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.getByText('Attendance saved', { exact: true })).toBeVisible();
  await dismiss(page);
  await expect(page.getByText('My attendance: PRESENT', { exact: true })).toBeVisible();
  await capture(page, info, '19-attendance');
  const attendance = await api(request, '/meetings/' + fixture().meetingId + '/attendance', {
    session: member,
  });
  expect(attendance.find((item) => item.user.id === fixture().member.id).status).toBe('PRESENT');

  await home(page);
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('Welcome, Ama', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toBeDisabled();
  await capture(page, info, '20-notifications');
  await home(page);
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('Balance: GHS 12.5', { exact: true })).toBeVisible();
  await capture(page, info, '21-reports');
  await home(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account and help', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System settings', exact: true })).toHaveCount(0);
  await capture(page, info, '22-settings');
});

test('registration, validation, keyboard navigation and delivered reset link work', async ({
  page,
  request,
}, info) => {
  test.setTimeout(240000);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Community growth made simple', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('01-splash.png') });
  await info.attach('01-splash-screen', {
    path: info.outputPath('01-splash.png'),
    contentType: 'image/png',
  });
  await page.clock.runFor(1500);
  await page.clock.resume();
  await expect(page.getByText('Grow with savings', { exact: true })).toBeVisible();
  await capture(page, info, '02-onboarding');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Manage loans simply', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await capture(page, info, '03-login');
  await page.getByLabel('Email address or phone number', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(
    page.getByText('Correct the highlighted fields and try again.', { exact: true }),
  ).toBeVisible();
  await dismiss(page);
  await capture(page, info, '04-registration-validation');
  const phone = '+233209876543';
  await page.getByLabel('First name', { exact: true }).fill('Esi');
  await page.getByLabel('Last name', { exact: true }).fill('Adjei');
  await page.getByLabel('Phone number', { exact: true }).fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(fixture().password);
  await page.getByLabel('Confirm password', { exact: true }).fill(fixture().password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await page.getByLabel('Email address or phone number', { exact: true }).fill(phone);
  await capture(page, info, '05-forgot-password');
  await page.getByRole('button', { name: 'Send reset instructions', exact: true }).click();
  await expect(page.getByText('Request received', { exact: true })).toBeVisible();
  const delivery = await (await request.get('http://127.0.0.1:4180/last-reset')).json();
  expect(delivery.recipient.phone).toBe(phone);
  await dismiss(page);
  await page.goto(delivery.resetUrl);
  await expect(
    page.getByRole('heading', { name: 'Choose a new password', exact: true }),
  ).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('UpdatedReviewA1!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('UpdatedReviewA1!');
  await capture(page, info, '05b-reset-password');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByText('Password changed', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await dismiss(page);
  await page.getByLabel('Email address or phone number', { exact: true }).fill(phone);
  await page.getByLabel('Password', { exact: true }).fill('UpdatedReviewA1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible();
});

test('administrator settings and 320px large-text layout remain usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page, 'administrator');
  await expect(page.getByRole('button', { name: 'Total savings', exact: true })).toContainText(
    'SLE 12.50',
  );
  await largeText(page);
  await capture(page, info, 'large-text-admin-dashboard');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'System settings', exact: true })).toBeVisible();
  await largeText(page);
  await page.getByRole('button', { name: /community_help/ }).click();
  await page
    .getByLabel('Setting value (JSON object)', { exact: true })
    .fill('{"contact":"Community hall"}');
  await page.getByRole('button', { name: 'Save setting', exact: true }).click();
  await expect(page.getByText('Setting saved', { exact: true })).toBeVisible();
  await dismiss(page);
  await capture(page, info, 'large-text-admin-settings');
});

test('a failed profile load shows retry and recovers', async ({ page }, info) => {
  await page.route('**/api/users/*', (route) => route.abort('connectionfailed'));
  await signIn(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await capture(page, info, 'profile-error');
  await page.unroute('**/api/users/*');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Ama');
});
