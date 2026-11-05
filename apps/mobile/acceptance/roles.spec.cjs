const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const roles = [
  'MEMBER',
  'GROUP_MANAGER',
  'TREASURER',
  'AUDITOR',
  'LOAN_OFFICER',
  'ADMIN',
  'SUPER_ADMIN',
];
const finance = ['MEMBER', 'GROUP_MANAGER', 'TREASURER', 'AUDITOR', 'ADMIN', 'SUPER_ADMIN'];
const loans = roles.filter((role) => role !== 'AUDITOR');
const groups = ['MEMBER', 'GROUP_MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const administrators = ['ADMIN', 'SUPER_ADMIN'];
// Independent expectations exercise real guards and service scoping, rather than
// importing the policy under test to calculate its expected answers.
const reads = [
  ['/auth/me', roles],
  ['/auth/permissions', roles],
  ['/notifications', roles],
  ['/groups', groups],
  ['/members', groups],
  ['/meetings', groups],
  ['/savings/dashboard', finance],
  ['/financial-records', finance],
  ['/reports', finance],
  ['/loans', loans],
  ['/loans/applications', loans],
  ['/users', administrators],
  ['/admin/dashboard', administrators],
  ['/admin/audit-logs', administrators],
  ['/admin/cycles', administrators],
  ['/system/settings', administrators],
  ['/system/administrators', ['SUPER_ADMIN']],
  ['/member-space', ['MEMBER']],
];
let fixture;
const sessions = {};
const identifiers = {};
const evidence = [];
let spare;

async function call(request, route, role, method = 'GET', data, status = 200) {
  const response = await request.fetch(fixture.apiOrigin + '/api' + route, {
    method,
    ...(role ? { headers: { Authorization: `Bearer ${sessions[role].accessToken}` } } : {}),
    ...(data ? { data } : {}),
  });
  const body = await response.json();
  expect(
    response.status(),
    `${role ?? 'anonymous'} ${method} ${route}: ${JSON.stringify(body)}`,
  ).toBe(status);
  return body;
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(180000);
  fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')),
  );
  identifiers.MEMBER = fixture.member.identifier;
  identifiers.SUPER_ADMIN = fixture.administrator.identifier;
  sessions.SUPER_ADMIN = await call(
    request,
    '/auth/login',
    null,
    'POST',
    { identifier: identifiers.SUPER_ADMIN, password: fixture.password },
    201,
  );
  sessions.MEMBER = await call(
    request,
    '/auth/login',
    null,
    'POST',
    { identifier: identifiers.MEMBER, password: fixture.password },
    201,
  );
  const unique = Date.now();
  for (const role of roles.filter((value) => !sessions[value])) {
    const email = `role-${role.toLowerCase()}-${unique}@acceptance.test`;
    await call(
      request,
      '/users',
      'SUPER_ADMIN',
      'POST',
      { firstName: 'Role', lastName: role, email, password: fixture.password, role },
      201,
    );
    identifiers[role] = email;
    sessions[role] = await call(
      request,
      '/auth/login',
      null,
      'POST',
      { identifier: email, password: fixture.password },
      201,
    );
    expect(sessions[role].user.role).toBe(role);
  }
  spare = await call(
    request,
    '/users',
    'SUPER_ADMIN',
    'POST',
    {
      firstName: 'Role',
      lastName: 'Target',
      email: `role-target-${unique}@acceptance.test`,
      password: fixture.password,
      role: 'MEMBER',
    },
    201,
  );
});

for (const role of roles) {
  test(`${role}: live route permissions, blocked writes and usable dashboard`, async ({
    request,
    page,
  }) => {
    test.setTimeout(120000);
    for (const [route, allowed] of reads) {
      const status = allowed.includes(role) ? 200 : 403;
      await call(request, route, role, 'GET', undefined, status);
      evidence.push({ role, method: 'GET', route, expectedStatus: status, result: 'PASS' });
    }
    // Valid bodies ensure that a denied write cannot pass through to validation.
    if (!administrators.includes(role))
      await call(
        request,
        '/system/settings/role_test',
        role,
        'PATCH',
        { value: { enabled: true } },
        403,
      );
    if (role !== 'SUPER_ADMIN')
      await call(request, `/users/${spare.id}`, role, 'DELETE', undefined, 403);
    if (!['GROUP_MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      await call(
        request,
        '/groups',
        role,
        'POST',
        {
          name: 'Forbidden group',
          registrationNo: `DENIED-${role}`,
          location: 'Test village',
          contactInfo: 'Test contact',
          managerId: sessions.SUPER_ADMIN.user.id,
        },
        403,
      );
    }
    if (['AUDITOR', 'LOAN_OFFICER'].includes(role)) {
      await call(
        request,
        '/savings/contributions',
        role,
        'POST',
        {
          savingsAccountId: fixture.savingsId,
          amount: '1',
          reference: `DENIED-${role}`,
          paymentMethod: 'CASH',
        },
        403,
      );
      await call(
        request,
        '/workflow/payments',
        role,
        'POST',
        {
          requestId: `DENIED-${role}-CHECKOUT`,
          memberId: sessions.MEMBER.user.memberId,
          amount: '1',
          kind: 'CONTRIBUTION',
        },
        403,
      );
    }
    if (role === 'MEMBER') {
      await call(
        request,
        `/savings/accounts/${fixture.savingsId}/status`,
        role,
        'PATCH',
        { status: 'ACTIVE' },
        403,
      );
    }
    if (administrators.includes(role)) {
      await call(
        request,
        `/system/users/${sessions[role].user.id}/role`,
        role,
        'PATCH',
        { role: 'MEMBER' },
        403,
      );
      await call(
        request,
        `/system/users/${spare.id}/role`,
        role,
        'PATCH',
        { role: 'SUPER_ADMIN' },
        400,
      );
    }
    if (role === 'ADMIN')
      await call(
        request,
        `/system/users/${sessions.SUPER_ADMIN.user.id}/role`,
        role,
        'PATCH',
        { role: 'MEMBER' },
        403,
      );

    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      return route.continue({ url: fixture.apiOrigin + url.pathname + url.search });
    });
    await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
    await page
      .getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/)
      .fill(identifiers[role]);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Profile', exact: true })).toBeVisible({
      timeout: 60000,
    });
    if (role === 'MEMBER')
      await expect(
        page.getByRole('button', { name: 'Member workspace', exact: true }),
      ).toBeVisible();
    else
      await expect(page.getByRole('button', { name: 'Member workspace', exact: true })).toHaveCount(
        0,
      );
    if (role === 'TREASURER')
      await expect(
        page.getByRole('button', { name: 'Treasurer workspace', exact: true }),
      ).toBeVisible();
    if (administrators.includes(role))
      await expect(
        page.getByRole('button', { name: 'Manage platform', exact: true }),
      ).toBeVisible();
    if (role === 'AUDITOR') {
      await expect(page.getByRole('button', { name: 'Loans', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Transactions', exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
    evidence.push({ role, check: 'dashboard sign-in and role controls', result: 'PASS' });
  });
}

test('roles cooperate on a scoped loan and withdrawal without unauthorized review or duplicate debits', async ({
  request,
}) => {
  test.setTimeout(180000);
  const unique = Date.now();
  const group = await call(
    request,
    '/groups',
    'GROUP_MANAGER',
    'POST',
    {
      name: `Role workflow ${unique}`,
      registrationNo: `ROLE-${unique}`,
      location: 'Test village',
      contactInfo: 'Test manager',
      managerId: sessions.GROUP_MANAGER.user.id,
      weeklyContributionAmount: '25',
      withdrawalsAllowed: true,
    },
    201,
  );
  await call(
    request,
    `/groups/${fixture.group.id}`,
    'GROUP_MANAGER',
    'PATCH',
    { name: 'Not my assigned group' },
    403,
  );
  const borrower = await call(
    request,
    '/auth/register',
    null,
    'POST',
    {
      memberId: `ROLE-${unique}`,
      firstName: 'Role',
      lastName: 'Borrower',
      email: `borrower-${unique}@acceptance.test`,
      password: fixture.password,
      passwordConfirmation: fixture.password,
      role: 'MEMBER',
      groupId: group.id,
    },
    201,
  );
  sessions.BORROWER = borrower;
  const workspace = await call(request, '/member-space', 'BORROWER');
  const account = await call(
    request,
    '/savings/accounts',
    'BORROWER',
    'POST',
    { groupMemberId: workspace.membership.id },
    201,
  );
  const application = await call(
    request,
    '/loans/applications',
    'BORROWER',
    'POST',
    {
      memberId: borrower.user.memberId,
      amount: '100',
      purpose: 'Purchase seeds for the family farm',
      durationMonths: 1,
    },
    201,
  );
  await call(
    request,
    `/loans/applications/${application.id}/status`,
    'MEMBER',
    'PATCH',
    { status: 'APPROVED' },
    403,
  );
  await call(
    request,
    `/loans/applications/${application.id}/status`,
    'TREASURER',
    'PATCH',
    { status: 'APPROVED' },
    403,
  );
  await call(request, `/loans/applications/${application.id}/status`, 'LOAN_OFFICER', 'PATCH', {
    status: 'UNDER_REVIEW',
    reviewerNotes: 'Application documents checked',
  });
  // Current policy reserves final approval for managers and administrators.
  await call(
    request,
    `/loans/applications/${application.id}/status`,
    'LOAN_OFFICER',
    'PATCH',
    { status: 'APPROVED' },
    403,
  );
  await call(request, `/loans/applications/${application.id}/status`, 'GROUP_MANAGER', 'PATCH', {
    status: 'APPROVED',
    reviewerNotes: 'Manager approved after review',
  });
  const start = new Date(),
    due = new Date(start.getTime() + 30 * 86400000);
  const loan = await call(
    request,
    `/loans/applications/${application.id}/loan`,
    'TREASURER',
    'POST',
    { interestRate: '0', startDate: start.toISOString(), dueDate: due.toISOString() },
    201,
  );
  await call(request, `/loans/${loan.id}/disburse`, 'TREASURER', 'POST', {}, 201);
  expect((await call(request, `/loans/${loan.id}`, 'BORROWER')).status).toBe('ACTIVE');
  await call(request, `/loans/${loan.id}`, 'MEMBER', 'GET', undefined, 403);
  await call(
    request,
    `/loans/${loan.id}/repayments`,
    'BORROWER',
    'POST',
    { amount: '25', reference: `DENIED-REPAY-${unique}` },
    403,
  );
  await call(
    request,
    `/loans/${loan.id}/repayments`,
    'TREASURER',
    'POST',
    { amount: '25', reference: `ROLE-REPAY-${unique}` },
    201,
  );
  expect(Number((await call(request, `/loans/${loan.id}`, 'BORROWER')).outstandingBalance)).toBe(
    75,
  );
  await call(
    request,
    '/savings/contributions',
    'TREASURER',
    'POST',
    {
      savingsAccountId: account.id,
      amount: '40',
      reference: `ROLE-SAVINGS-${unique}`,
      paymentMethod: 'CASH',
    },
    201,
  );
  await call(request, `/savings/accounts/${account.id}`, 'MEMBER', 'GET', undefined, 403);
  const managerRecords = await call(request, '/financial-records', 'GROUP_MANAGER');
  expect(managerRecords.items.some((row) => row.reference === `CONTR-ROLE-SAVINGS-${unique}`)).toBe(
    true,
  );
  expect(managerRecords.items.every((row) => row.groupId === group.id)).toBe(true);
  const audited = await call(request, `/savings/accounts/${account.id}`, 'AUDITOR');
  expect(Number(audited.balance)).toBe(40);
  const withdrawal = await call(
    request,
    '/member-space/withdrawals',
    'BORROWER',
    'POST',
    {
      savingsAccountId: account.id,
      amount: '10',
      reference: `ROLE-WITHDRAW-${unique}`,
      reason: 'Family school expenses',
    },
    201,
  );
  await call(
    request,
    `/admin/withdrawals/${withdrawal.id}/review`,
    'TREASURER',
    'POST',
    { decision: 'APPROVED', notes: 'Cannot approve directly' },
    403,
  );
  await call(
    request,
    `/admin/withdrawals/${withdrawal.id}/finance-review`,
    'TREASURER',
    'POST',
    { decision: 'RECOMMEND_APPROVAL', notes: 'Savings and available balance checked' },
    201,
  );
  await call(
    request,
    `/admin/withdrawals/${withdrawal.id}/review`,
    'ADMIN',
    'POST',
    { decision: 'APPROVED', notes: 'Approved following finance review' },
    201,
  );
  await call(
    request,
    `/admin/withdrawals/${withdrawal.id}/review`,
    'ADMIN',
    'POST',
    { decision: 'APPROVED', notes: 'Duplicate approval must fail' },
    409,
  );
  expect(Number((await call(request, `/savings/accounts/${account.id}`, 'BORROWER')).balance)).toBe(
    30,
  );
  expect((await call(request, '/notifications', 'BORROWER')).items.length).toBeGreaterThan(0);
  await call(request, `/system/users/${spare.id}/role`, 'SUPER_ADMIN', 'PATCH', { role: 'ADMIN' });
  await call(request, `/system/users/${spare.id}/role`, 'SUPER_ADMIN', 'PATCH', { role: 'MEMBER' });
  await call(request, '/admin/audit-logs', 'ADMIN');
  evidence.push({
    check:
      'Cross-role loan, repayment, savings, independent withdrawal review, duplicate debit protection and group ownership',
    result: 'PASS',
  });
});

test('authentication rejects anonymous users and immediately enforces role changes and suspension', async ({
  request,
}) => {
  test.setTimeout(120000);
  await call(
    request,
    `/groups/${fixture.group.id}`,
    'SUPER_ADMIN',
    'PATCH',
    { weeklyContributionAmount: null },
    400,
  );
  await call(
    request,
    `/groups/${fixture.group.id}`,
    'SUPER_ADMIN',
    'PATCH',
    { withdrawalsAllowed: null },
    400,
  );
  for (const route of ['/auth/me', '/groups', '/financial-records', '/loans', '/notifications']) {
    await call(request, route, null, 'GET', undefined, 401);
  }
  const target = await call(request, `/users/${spare.id}`, 'SUPER_ADMIN');
  sessions.TARGET = await call(
    request,
    '/auth/login',
    null,
    'POST',
    { identifier: target.email, password: fixture.password },
    201,
  );
  await call(request, `/system/users/${spare.id}/role`, 'SUPER_ADMIN', 'PATCH', {
    role: 'AUDITOR',
  });
  const permissions = await call(request, '/auth/permissions', 'TARGET');
  expect(permissions.permissions).toContain('financial:read');
  expect(permissions.permissions).not.toContain('financial:write');
  await call(request, '/member-space', 'TARGET', 'GET', undefined, 403);
  await call(
    request,
    '/auth/refresh',
    null,
    'POST',
    { refreshToken: sessions.TARGET.refreshToken },
    401,
  );
  await call(request, `/users/${spare.id}/status`, 'SUPER_ADMIN', 'PATCH', { status: 'SUSPENDED' });
  await call(request, '/auth/me', 'TARGET', 'GET', undefined, 401);
  evidence.push({
    check:
      'Anonymous access, current-role enforcement, refresh revocation and suspended-account rejection',
    result: 'PASS',
  });
});

test.afterAll(() => {
  fs.writeFileSync(
    path.resolve(__dirname, '../../../.acceptance/role-results.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), checks: evidence }, null, 2),
  );
});
