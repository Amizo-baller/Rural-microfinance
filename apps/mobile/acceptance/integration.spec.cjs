const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const fixture = () =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')));
const SESSION_KEY = 'auth_session_v2';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: fixture().apiOrigin + url.pathname + url.search });
  });
});
async function signIn(page, kind = 'member') {
  await page.goto('/?signIn=1');
  await page
    .getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/)
    .fill(fixture()[kind].identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture().password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', {
      name: kind === 'member' ? 'My Dashboard' : 'Admin dashboard',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
}
async function stored(page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), SESSION_KEY);
}
async function dismiss(page) {
  const button = page.getByRole('button', { name: 'Dismiss message', exact: true });
  if (await button.count()) await button.click();
}

test('real expired access refreshes, reload restores the session, and logout revokes it', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await signIn(page);
  const original = await stored(page);
  await page.evaluate(
    ({ key, expired }) => {
      const value = JSON.parse(sessionStorage.getItem(key));
      value.accessToken = expired;
      sessionStorage.setItem(key, JSON.stringify(value));
    },
    { key: SESSION_KEY, expired: fixture().expiredAccessToken },
  );
  const refresh = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/refresh',
  );
  await page.reload();
  expect((await refresh).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  const renewed = await stored(page);
  expect(renewed.accessToken).not.toBe(fixture().expiredAccessToken);
  expect(renewed.refreshToken).not.toBe(original.refreshToken);
  const old = await request.post(fixture().apiOrigin + '/api/auth/refresh', {
    data: { refreshToken: original.refreshToken },
  });
  expect(old.status()).toBe(401);
  const logout = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/auth/logout',
  );
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  expect((await logout).status()).toBe(201);
  const revoked = await request.post(fixture().apiOrigin + '/api/auth/refresh', {
    data: { refreshToken: renewed.refreshToken },
  });
  expect(revoked.status()).toBe(401);
  expect(await page.getByRole('button', { name: 'Home', exact: true }).count()).toBe(0);
});

test('revoked sessions return to sign-in and offline logout clears local credentials', async ({
  page,
}) => {
  test.setTimeout(180000);
  await signIn(page);
  await page.evaluate(
    ({ key, expired }) =>
      sessionStorage.setItem(
        key,
        JSON.stringify({ accessToken: expired, refreshToken: 'revoked-refresh-token' }),
      ),
    { key: SESSION_KEY, expired: fixture().expiredAccessToken },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  await dismiss(page);
  await page
    .getByLabel(/^(Member ID, email address or phone number|Email address or phone number)$/)
    .fill(fixture().member.identifier);
  await page.getByLabel('Password', { exact: true }).fill(fixture().password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();
  await page.context().setOffline(false);
});

test('server form validation is shown and stale real search responses cannot replace new filters', async ({
  page,
}) => {
  test.setTimeout(180000);
  await signIn(page);
  await page.getByRole('button', { name: 'Profile', exact: true }).first().click();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Ama');
  await page.getByLabel('Email address', { exact: true }).fill('not-an-email');
  const validation = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.startsWith('/api/users/'),
  );
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  const invalidResponse = await validation;
  expect(invalidResponse.request().postDataJSON().email).toBe('not-an-email');
  expect(invalidResponse.status()).toBe(400);
  await expect(page.getByText('email must be an email', { exact: false })).toBeVisible();
  await dismiss(page);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await expect(page.getByText('Ama Mensah', { exact: true })).toBeVisible();
  let release;
  let held;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    held = resolve;
  });
  await page.route('**/api/members?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('search') === 'Ama') {
      held();
      await gate;
    }
    await route.continue({ url: fixture().apiOrigin + url.pathname + url.search });
  });
  try {
    await page
      .getByLabel('Search name, phone, email, or member number', { exact: true })
      .fill('Ama');
    await page.getByRole('button', { name: 'Search members', exact: true }).click();
    await started;
    await page
      .getByLabel('Search name, phone, email, or member number', { exact: true })
      .fill('NoMatchingMember');
    await page.getByRole('button', { name: 'Search members', exact: true }).click();
    await expect(
      page.getByText('No members were returned for this account and filter.', { exact: true }),
    ).toBeVisible();
    const oldReply = page.waitForResponse(
      (response) => new URL(response.url()).searchParams.get('search') === 'Ama',
    );
    release();
    await oldReply;
    await expect(
      page.getByText('No members were returned for this account and filter.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Ama Mensah', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test('staff group pagination, entry loading and refresh use actual server pages', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const login = await request.post(fixture().apiOrigin + '/api/auth/login', {
    data: { identifier: fixture().administrator.identifier, password: fixture().password },
  });
  expect(login.ok()).toBe(true);
  const staff = await login.json();
  const headers = { Authorization: 'Bearer ' + staff.accessToken };
  const created = [];
  try {
    for (let index = 0; index < 21; index++) {
      const response = await request.post(fixture().apiOrigin + '/api/groups', {
        headers,
        data: {
          name: 'Integration page group ' + index,
          registrationNo: 'INTEGRATION-' + index,
          location: 'Test village',
          contactInfo: '+233200123456',
          managerId: fixture().administrator.id,
        },
      });
      expect(response.ok()).toBe(true);
      created.push(await response.json());
    }
    await signIn(page, 'administrator');
    const first = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/groups' &&
        new URL(response.url()).searchParams.get('page') === '1',
    );
    await page.getByRole('button', { name: 'Groups', exact: true }).first().click();
    const firstPage = await (await first).json();
    expect(firstPage.items.length).toBe(20);
    expect(firstPage.total).toBe(22);
    const cards = page.getByRole('button').filter({ hasText: /Administrator: Review Officer/ });
    await expect(cards).toHaveCount(20);
    const second = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/groups' &&
        new URL(response.url()).searchParams.get('page') === '2',
    );
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    expect((await (await second).json()).items.length).toBe(2);
    await expect(cards).toHaveCount(22);
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/groups' &&
        new URL(response.url()).searchParams.get('page') === '1',
    );
    await page.getByRole('button', { name: 'Refresh / Retry', exact: true }).click();
    await refreshed;
    await expect(cards).toHaveCount(20);
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toBeVisible();
  } finally {
    for (const group of created) {
      const response = await request.patch(
        fixture().apiOrigin + '/api/groups/' + group.id + '/status',
        { headers, data: { status: 'ARCHIVED' } },
      );
      expect(response.ok()).toBe(true);
    }
  }
});
