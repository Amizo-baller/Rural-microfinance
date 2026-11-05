const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('treasurer records contributions, reviews withdrawals, processes approved loans and generates reports', async ({
  page,
  request,
}) => {
  test.setTimeout(360000);
  const setup = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')),
  );
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: setup.apiOrigin + url.pathname + url.search });
  });
  const authenticate = async (identifier) => {
    const response = await request.post(setup.apiOrigin + '/api/auth/login', {
      data: { identifier, password: setup.password },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const admin = await authenticate(setup.administrator.identifier);
  const member = await authenticate(setup.member.identifier);
  const adminHeaders = { Authorization: `Bearer ${admin.accessToken}` };
  const memberHeaders = { Authorization: `Bearer ${member.accessToken}` };
  const unique = Date.now();
  const email = `treasurer-${unique}@acceptance.test`;
  const created = await request.post(setup.apiOrigin + '/api/users', {
    headers: adminHeaders,
    data: {
      firstName: 'Finance',
      lastName: 'Officer',
      email,
      password: setup.password,
      role: 'TREASURER',
    },
  });
  expect(created.ok()).toBeTruthy();
  const treasurer = await authenticate(email);
  const financeHeaders = { Authorization: `Bearer ${treasurer.accessToken}` };
  for (const endpoint of ['/users', '/system/settings', '/admin/audit-logs', '/admin/cycles']) {
    expect(
      (
        await request.get(setup.apiOrigin + '/api' + endpoint, { headers: financeHeaders })
      ).status(),
    ).toBe(403);
  }
  const initialSavings = await (
    await request.get(setup.apiOrigin + '/api/savings/dashboard', { headers: memberHeaders })
  ).json();
  const account = initialSavings.accounts.find(
    (row) => row.currency === 'SLE' && row.status === 'ACTIVE',
  );
  const initialBalance = Number(account.balance);

  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
  await page
    .getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/)
    .fill(email);
  await page.getByLabel('Password', { exact: true }).fill(setup.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const openWorkspace = async () => {
    await page
      .getByRole('button', { name: 'Treasurer workspace', exact: true })
      .click({ timeout: 60000 });
    await expect(
      page.getByRole('heading', { name: 'Treasurer workspace', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
  };
  await openWorkspace();
  await page.getByRole('button', { name: 'Record contribution', exact: true }).click();
  const accountCard = page.getByText(account.accountNumber, { exact: true }).locator('..');
  await accountCard.getByLabel('Contribution amount (SLE)', { exact: true }).fill('25');
  await accountCard
    .getByLabel('Description (optional)', { exact: true })
    .fill(`Treasurer contribution ${unique}`);
  await accountCard.getByRole('radio', { name: 'CASH', exact: true }).click();
  const contributionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/savings/contributions' &&
      response.request().method() === 'POST',
  );
  await accountCard.getByRole('button', { name: 'Record contribution', exact: true }).click();
  expect((await contributionResponse).ok()).toBeTruthy();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  const credited = await (
    await request.get(setup.apiOrigin + `/api/savings/accounts/${account.id}`, {
      headers: memberHeaders,
    })
  ).json();
  expect(Number(credited.balance)).toBe(initialBalance + 25);
  const contributions = await (
    await request.get(
      setup.apiOrigin +
        `/api/savings/contributions?search=${encodeURIComponent(`Treasurer contribution ${unique}`)}`,
      { headers: financeHeaders },
    )
  ).json();
  expect(contributions.items[0].paymentMethod).toBe('CASH');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await openWorkspace();
  await page.getByRole('button', { name: 'Verify contributions', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirm member requests', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve loan application', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();

  const reference = `WD-TREASURER-${unique}`;
  const withdrawal = await request.post(setup.apiOrigin + '/api/admin/withdrawals', {
    headers: memberHeaders,
    data: {
      savingsAccountId: account.id,
      amount: '5',
      reference,
      reason: 'School materials financial review',
    },
  });
  expect(withdrawal.ok()).toBeTruthy();
  const withdrawalId = (await withdrawal.json()).id;
  expect(
    (
      await request.post(setup.apiOrigin + `/api/admin/withdrawals/${withdrawalId}/review`, {
        headers: financeHeaders,
        data: { decision: 'APPROVED', notes: 'Treasurer cannot make final decisions' },
      })
    ).status(),
  ).toBe(403);
  await openWorkspace();
  const withdrawalCard = page.getByText(reference, { exact: true }).locator('..');
  await withdrawalCard.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
  await page
    .getByLabel('Withdrawal review notes')
    .fill('Account and documents verified by Treasurer');
  await page.getByRole('button', { name: 'Submit financial review', exact: true }).click();
  await expect(withdrawalCard).toContainText('RECOMMEND APPROVAL');
  await expect(withdrawalCard).toContainText('PENDING');
  const reviewedBalance = await (
    await request.get(setup.apiOrigin + `/api/savings/accounts/${account.id}`, {
      headers: memberHeaders,
    })
  ).json();
  expect(Number(reviewedBalance.balance)).toBe(Number(credited.balance));
  const adminQueue = await (
    await request.get(setup.apiOrigin + '/api/admin/withdrawals', { headers: adminHeaders })
  ).json();
  expect(
    adminQueue.items.find((row) => row.id === withdrawalId).financeReview.newValues.notes,
  ).toContain('verified by Treasurer');

  const applicationResponse = await request.post(setup.apiOrigin + '/api/loans/applications', {
    headers: memberHeaders,
    data: {
      memberId: member.user.memberId,
      amount: '10',
      purpose: 'Working capital for treasurer approved operation test',
      durationMonths: 1,
    },
  });
  expect(applicationResponse.ok()).toBeTruthy();
  const application = await applicationResponse.json();
  expect(
    (
      await request.patch(setup.apiOrigin + `/api/loans/applications/${application.id}/status`, {
        headers: financeHeaders,
        data: { status: 'APPROVED' },
      })
    ).status(),
  ).toBe(403);
  const startDate = new Date().toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);
  const terms = { interestRate: '0', startDate, dueDate };
  expect(
    (
      await request.post(setup.apiOrigin + `/api/loans/applications/${application.id}/loan`, {
        headers: financeHeaders,
        data: terms,
      })
    ).status(),
  ).toBe(409);
  const approved = await request.patch(
    setup.apiOrigin + `/api/loans/applications/${application.id}/status`,
    {
      headers: adminHeaders,
      data: { status: 'APPROVED', reviewerNotes: 'Admin approval for finance processing' },
    },
  );
  expect(approved.ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Approved applications', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Set up approved loan', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Set up approved loan', exact: true }).first().click();
  await expect(page.getByLabel('Loan interest rate')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel loan setup', exact: true }).click();
  const loanResponse = await request.post(
    setup.apiOrigin + `/api/loans/applications/${application.id}/loan`,
    { headers: financeHeaders, data: terms },
  );
  expect(loanResponse.ok()).toBeTruthy();
  const loan = await loanResponse.json();
  await page.getByRole('button', { name: 'Loan operations', exact: true }).click();
  const loanCard = page.getByText(loan.loanReference, { exact: true }).locator('..');
  await loanCard.getByRole('button', { name: 'Record loan disbursement', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm loan disbursement', exact: true }).click();
  await expect(loanCard).toContainText('ACTIVE');
  expect(
    (
      await request.post(setup.apiOrigin + `/api/loans/${loan.id}/disburse`, {
        headers: financeHeaders,
        data: {},
      })
    ).status(),
  ).toBe(409);

  await page.getByRole('button', { name: 'Generate financial reports', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reports and analytics', exact: true }),
  ).toBeVisible();
  const reportResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/reports/analytics',
  );
  await page.getByRole('button', { name: 'Run report', exact: true }).click();
  expect((await reportResponse).ok()).toBeTruthy();
  expect(errors).toEqual([]);
});
