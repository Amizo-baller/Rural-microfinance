const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { HDNodeWallet } = require('ethers');

test('twenty wallet accounts can be picked, signed in, switched and disconnected safely', async ({ page, request }) => {
  test.setTimeout(480000);
  const root = path.resolve(__dirname, '../../..');
  const fixture = JSON.parse(fs.readFileSync(path.join(root, '.acceptance/fixture.json')));
  const url = new URL(require('dotenv').parse(fs.readFileSync(path.join(root, 'apps/api/.env'))).DATABASE_URL);
  if (!/^rcm_ui_acceptance_\d+$/.test(fixture.databaseName) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Isolated local database required');
  url.pathname = '/' + fixture.databaseName;
  const prisma = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url: url.toString() } } });
  // Public Hardhat development mnemonic. These keys are used only in this isolated test database.
  const wallets = Array.from({ length: 20 }, (_, i) => HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, `m/44'/60'/0'/0/${i}`));
  const addresses = wallets.map((wallet) => wallet.address.toLowerCase());
  try {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MEMBER' } });
    const passwordHash = await require('bcrypt').hash(fixture.password, 4);
    const users = [];
    for (let index = 0; index < wallets.length; index++) users.push(await prisma.user.create({ data: {
      memberId: `WALLET-${index + 1}`, firstName: 'Wallet', lastName: String(index + 1), email: `wallet-${index + 1}@acceptance.test`,
      passwordHash, roleId: role.id, status: 'ACTIVE', blockchainAddress: index === 0 ? null : addresses[index],
    } }));
    // Link the first wallet through the authenticated API using a real signature.
    const normal = await (await request.post(fixture.apiOrigin + '/api/auth/login', { data: { identifier: users[0].memberId, password: fixture.password } })).json();
    const headers = { Authorization: `Bearer ${normal.accessToken}` };
    const challenge = await (await request.post(fixture.apiOrigin + '/api/auth/wallet/link/challenge', { headers, data: { address: addresses[0], chainId: '31337' } })).json();
    const linked = await request.post(fixture.apiOrigin + '/api/auth/wallet/link', { headers, data: { address: addresses[0], message: challenge.message, signature: await wallets[0].signMessage(challenge.message) } });
    expect(linked.status()).toBe(201);
    // Verify every real signer/user mapping without repeatedly loading twenty dashboards.
    for (let index = 0; index < wallets.length; index++) {
      const challengeResponse = await request.post(fixture.apiOrigin + '/api/auth/wallet/challenge', { data: { address: addresses[index], chainId: '31337' } });
      expect(challengeResponse.status()).toBe(201);
      const { message } = await challengeResponse.json();
      const login = await request.post(fixture.apiOrigin + '/api/auth/wallet/login', { data: { address: addresses[index], message, signature: await wallets[index].signMessage(message) } });
      expect(login.status()).toBe(201);
      const session = await login.json();
      expect(session.user).toMatchObject({ id: users[index].id, role: 'MEMBER', walletAddress: addresses[index] });
      const refreshed = await request.post(fixture.apiOrigin + '/api/auth/refresh', { data: { refreshToken: session.refreshToken } });
      expect(refreshed.status()).toBe(201);
      const renewed = await refreshed.json();
      expect(renewed.user.walletAddress).toBe(addresses[index]);
      await request.post(fixture.apiOrigin + '/api/auth/logout', { data: { refreshToken: renewed.refreshToken } });
    }
    await page.exposeFunction('__testWalletSign', async (address, hex) => {
      const wallet = wallets[addresses.indexOf(address.toLowerCase())];
      return wallet.signMessage(Buffer.from(hex.slice(2), 'hex'));
    });
    await page.addInitScript(({ addresses }) => {
      const listeners = {};
      let connected = false;
      window.__wallet = { active: 0, hold: false, release: null, prompts: 0, revokes: 0, signatures: 0,
        switch(index) { this.active = index; emit('accountsChanged', accounts()); },
      };
      function emit(event, value) { for (const handler of listeners[event] ?? []) handler(value); }
      function accounts() { return connected ? [addresses[window.__wallet.active], ...addresses.filter((_, i) => i !== window.__wallet.active)] : []; }
      window.ethereum = { isMetaMask: true,
        on(event, handler) { (listeners[event] ??= []).push(handler); },
        removeListener(event, handler) { listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler); },
        async request({ method, params }) {
          if (method === 'wallet_requestPermissions' || method === 'eth_requestAccounts') { connected = true; window.__wallet.prompts++; emit('accountsChanged', accounts()); return method === 'eth_requestAccounts' ? accounts() : []; }
          if (method === 'wallet_revokePermissions') { connected = false; window.__wallet.revokes++; emit('accountsChanged', []); return null; }
          if (method === 'eth_accounts') return accounts();
          if (method === 'eth_chainId') return '0x7a69';
          if (method === 'personal_sign') {
            if (window.__wallet.hold) await new Promise((resolve) => { window.__wallet.release = resolve; });
            const signature = await window.__testWalletSign(params[1], params[0]);
            window.__wallet.signatures++;
            return signature;
          }
          throw new Error('Unexpected wallet method: ' + method);
        },
      };
    }, { addresses });
    await page.route('**/api/**', (route) => {
      const target = new URL(route.request().url());
      return route.continue({ url: fixture.apiOrigin + target.pathname + target.search });
    });
    await page.goto('/?signIn=1', { waitUntil: 'domcontentloaded' });
    const automaticLogin = page.waitForResponse((result) => new URL(result.url()).pathname === '/api/auth/wallet/login');
    await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
    const automaticResponse = await automaticLogin;
    expect(automaticResponse.status()).toBe(201);
    expect((await automaticResponse.json()).user).toMatchObject({ id: users[0].id, role: 'MEMBER', walletAddress: addresses[0] });
    await expect(page.getByRole('button', { name: 'Member workspace', exact: true })).toBeVisible({ timeout: 60000 });
    await page.evaluate(() => window.__wallet.switch(1));
    await expect(page.getByRole('button', { name: 'Sign in with selected wallet', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose accounts in MetaMask', exact: true }).click();
    await expect(page.getByRole('radio')).toHaveCount(20);
    expect(await page.evaluate(() => window.__wallet.prompts)).toBe(2);
    // Exercise the first/last wallet through the UI and MetaMask account-change events.
    for (const index of [0, 19]) {
      if (index === 19) {
        await page.getByRole('button', { name: 'Select connected account', exact: true }).click();
      }
      await page.getByRole('radio', { name: new RegExp(addresses[index]) }).click();
      const response = page.waitForResponse((result) => new URL(result.url()).pathname === '/api/auth/wallet/login');
      await page.getByRole('button', { name: 'Sign in with selected wallet', exact: true }).click();
      const result = await response;
      expect(result.status()).toBe(201);
      const session = await result.json();
      expect(session.user).toMatchObject({ id: users[index].id, role: 'MEMBER', walletAddress: addresses[index] });
      await expect(page.getByRole('button', { name: 'Member workspace', exact: true })).toBeVisible({ timeout: 60000 });
      // Changing the MetaMask active account ends the previous app identity.
      await page.evaluate((next) => window.__wallet.switch(next), index === 0 ? 1 : 0);
      await expect(page.getByRole('button', { name: 'Sign in with selected wallet', exact: true })).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem('auth_session_v2'))).toBeNull();
    }
    // Disconnect while a signature is outstanding. A late approval must not sign in.
    await page.evaluate(() => { window.__wallet.hold = true; });
    await page.getByRole('button', { name: 'Sign in with selected wallet', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__wallet.release))).toBe(true);
    await page.getByRole('button', { name: 'Disconnect all wallets', exact: true }).click();
    await expect(page.getByText('No wallet account selected', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.__wallet.release(); window.__wallet.hold = false; });
    await expect.poll(() => page.evaluate(() => window.__wallet.signatures)).toBe(4);
    await expect(page.getByRole('button', { name: 'Connect MetaMask', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('auth_session_v2'))).toBeNull();
    expect(await page.evaluate(() => window.__wallet.revokes)).toBe(1);
    // Disconnecting wallets must preserve a normal password/Google-style app session.
    await page.getByLabel('Member ID, email address or phone number', { exact: true }).fill(users[0].memberId);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    const normalSession = await page.evaluate(() => sessionStorage.getItem('auth_session_v2'));
    expect(normalSession).not.toBeNull();
    await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
    await expect(page.getByRole('radio')).toHaveCount(20);
    await page.getByRole('button', { name: 'Close account picker', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect all wallets', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My profile', exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('auth_session_v2'))).toBe(normalSession);
  } finally { await prisma.$disconnect(); }
});
