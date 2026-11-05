const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { HDNodeWallet } = require('ethers');

for (const [index, role, action] of [
  [20, 'ADMIN', 'Manage platform'],
  [21, 'TREASURER', 'Treasurer workspace'],
  [22, 'MEMBER', 'Member workspace'],
]) {
  test(`wallet login opens the backend-assigned ${role} dashboard`, async ({ page, request }) => {
    test.setTimeout(240000);
    const root = path.resolve(__dirname, '../../..');
    const fixture = JSON.parse(fs.readFileSync(path.join(root, '.acceptance/fixture.json')));
    const database = new URL(require('dotenv').parse(fs.readFileSync(path.join(root, 'apps/api/.env'))).DATABASE_URL);
    if (!/^rcm_ui_acceptance_\d+$/.test(fixture.databaseName) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(fixture.apiOrigin).hostname)) {
      throw new Error('Isolated local acceptance database and API required');
    }
    async function post(route, data, token) {
      const response = await request.post(fixture.apiOrigin + '/api' + route, {
        data, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      });
      expect(response.status(), route).toBe(201);
      return response.json();
    }
    // Public development keys are linked only to new users in the isolated test database.
    const wallet = HDNodeWallet.fromPhrase(
      'test test test test test test test test test test test junk',
      undefined, `m/44'/60'/0'/0/${index}`,
    );
    const address = wallet.address.toLowerCase();
    const identifier = `wallet-role-${role.toLowerCase()}-${Date.now()}@acceptance.test`;
    const administrator = await post('/auth/login', {
      identifier: fixture.administrator.identifier, password: fixture.password,
    });
    await post('/users', {
      firstName: 'Wallet', lastName: role, email: identifier,
      password: fixture.password, role,
    }, administrator.accessToken);
    const normal = await post('/auth/login', { identifier, password: fixture.password });
    expect(normal.user.role).toBe(role);
    const challenge = await post('/auth/wallet/link/challenge', {
      address, chainId: '31337',
    }, normal.accessToken);
    await post('/auth/wallet/link', {
      address, message: challenge.message, signature: await wallet.signMessage(challenge.message),
    }, normal.accessToken);
    await post('/auth/logout', { refreshToken: normal.refreshToken });
    await post('/auth/logout', { refreshToken: administrator.refreshToken });

    await page.exposeFunction('__signRoleWallet', (hex) =>
      wallet.signMessage(Buffer.from(hex.slice(2), 'hex')));
    await page.addInitScript(({ address }) => {
      let connected = false;
      let activeAddress = address;
      const listeners = {};
      window.__switchRoleWallet = () => {
        activeAddress = '0x' + '99'.repeat(20);
        for (const handler of listeners.accountsChanged ?? []) handler([activeAddress]);
      };
      window.ethereum = {
        isMetaMask: true,
        on(event, handler) { (listeners[event] ??= []).push(handler); },
        removeListener(event, handler) {
          listeners[event] = (listeners[event] ?? []).filter((item) => item !== handler);
        },
        async request({ method, params }) {
          if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
            connected = true;
            return method === 'eth_requestAccounts' ? [activeAddress] : [];
          }
          if (method === 'eth_accounts') return connected ? [activeAddress] : [];
          if (method === 'eth_chainId') return '0x7a69';
          if (method === 'personal_sign') return window.__signRoleWallet(params[0]);
          if (method === 'wallet_revokePermissions') {
            connected = false;
            for (const handler of listeners.accountsChanged ?? []) handler([]);
            return null;
          }
          throw new Error('Unexpected wallet method: ' + method);
        },
      };
    }, { address });
    await page.route('**/api/**', (route) => {
      const target = new URL(route.request().url());
      return route.continue({ url: fixture.apiOrigin + target.pathname + target.search });
    });
    await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
    const loginResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/wallet/login');
    await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
    const response = await loginResponse;
    expect(response.status()).toBe(201);
    const session = await response.json();
    expect(session.user).toMatchObject({ id: normal.user.id, role, walletAddress: address });
    await expect(page.getByRole('heading', { name: `${role[0] + role.slice(1).toLowerCase()} dashboard`, level: 1, exact: true }))
      .toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: action, exact: true }))
      .toBeVisible({ timeout: 60000 });
    for (const other of ['Manage platform', 'Treasurer workspace', 'Member workspace']) {
      if (other !== action) await expect(page.getByRole('button', { name: other, exact: true })).toHaveCount(0);
    }
    if (role !== 'ADMIN') {
      const restricted = await request.get(fixture.apiOrigin + '/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      expect(restricted.status()).toBe(403);
    }
    const memberSpace = await request.get(fixture.apiOrigin + '/api/member-space', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(memberSpace.status()).toBe(role === 'MEMBER' ? 200 : 403);
    const adminAccounts = await request.get(fixture.apiOrigin + '/api/admin/savings-accounts', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(adminAccounts.status()).toBe(role === 'ADMIN' ? 200 : 403);
    const forgedRole = await request.post(fixture.apiOrigin + '/api/auth/wallet/challenge', {
      data: { address, chainId: '31337', role: 'ADMIN' },
    });
    expect(forgedRole.status()).toBe(400);
    const loggedOut = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/logout');
    if (role === 'MEMBER') {
      // This screen has no WalletAuth panel: the session guard must remain active.
      await page.getByRole('button', { name: 'Member workspace', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Disconnect all wallets', exact: true })).toHaveCount(0);
      await page.evaluate(() => window.__switchRoleWallet());
    } else {
      await page.getByRole('button', { name: role === 'TREASURER' ? 'Logout' : 'Disconnect all wallets', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('auth_session_v2'))).toBeNull();
    expect((await loggedOut).ok()).toBeTruthy();
    const refresh = await request.post(fixture.apiOrigin + '/api/auth/refresh', {
      data: { refreshToken: session.refreshToken },
    });
    expect(refresh.status()).toBe(401);
  });
}
