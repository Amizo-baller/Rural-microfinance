const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('a registered account can log out, sign in repeatedly, and recover from duplicate signup', async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../.acceptance/fixture.json')),
  );
  const email = `existing-account-${Date.now()}@acceptance.test`;
  const phone = '+232' + String(Date.now()).slice(-8);
  const account = {
    firstName: 'Existing',
    lastName: 'Account',
    email,
    phone,
    password: fixture.password,
    passwordConfirmation: fixture.password,
    role: 'MEMBER',
  };
  const start = Date.now();
  const registered = await request.post(fixture.apiOrigin + '/api/auth/register', {
    data: account,
    timeout: 20000,
  });
  expect(registered.status()).toBe(201);
  const original = await registered.json();
  console.log(`Registration completed in ${Date.now() - start} ms`);
  const exited = await request.post(fixture.apiOrigin + '/api/auth/logout', {
    data: { refreshToken: original.refreshToken },
  });
  expect(exited.ok()).toBe(true);
  for (const identifier of [email.toUpperCase(), phone, email]) {
    const started = Date.now();
    const signedIn = await request.post(fixture.apiOrigin + '/api/auth/login', {
      data: { identifier, password: fixture.password },
      timeout: 20000,
    });
    expect(signedIn.status()).toBe(201);
    const session = await signedIn.json();
    expect(session.user.id).toBe(original.user.id);
    console.log(`Existing account login completed in ${Date.now() - started} ms`);
    const loggedOut = await request.post(fixture.apiOrigin + '/api/auth/logout', {
      data: { refreshToken: session.refreshToken },
    });
    expect(loggedOut.ok()).toBe(true);
  }
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    return route.continue({ url: fixture.apiOrigin + url.pathname + url.search });
  });
  await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: 'New here? Create an account', exact: true }).click();
  await page.getByLabel('First name', { exact: true }).fill(account.firstName);
  await page.getByLabel('Last name', { exact: true }).fill(account.lastName);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByLabel('Confirm password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Account already registered', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email address or phone number', { exact: true })).toHaveValue(
    email,
  );
  await page.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 60000 });
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await page.getByLabel('Email address or phone number', { exact: true }).fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Dashboard', exact: true })).toBeVisible({
    timeout: 60000,
  });
});
