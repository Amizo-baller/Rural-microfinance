const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(provider) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/metamask.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    window: { ethereum: provider },
    TextEncoder,
    URL,
    require: (name) =>
      name === './wallet-transport'
        ? {
            currentWalletProvider: () =>
              provider?.providers?.find((item) => item.isMetaMask) ??
              (provider?.isMetaMask ? provider : undefined),
          }
        : { Platform: { OS: 'web' }, Linking: { openURL: async () => undefined } },
  });
  return module.exports;
}
const addresses = Array.from(
  { length: 20 },
  (_, index) => '0x' + (index + 1).toString(16).padStart(40, '0'),
);
test('session watcher ends once for an active-account change and removes all listeners', () => {
  const listeners = new Map();
  const provider = { on: (name, fn) => listeners.set(name, fn), removeListener: (name) => listeners.delete(name) };
  const api = load(provider);
  let ended = 0;
  const stop = api.watchWalletSession(provider, addresses[0], () => ended++);
  listeners.get('accountsChanged')([addresses[0]]);
  assert.equal(ended, 0);
  listeners.get('accountsChanged')([addresses[1], addresses[0]]);
  listeners.get('disconnect')();
  assert.equal(ended, 1);
  stop();
  assert.equal(listeners.size, 0);
});
test('session watcher invalidates on network changes even when the account is unchanged', () => {
  const listeners = new Map();
  const api = load();
  let ended = 0;
  const stop = api.watchWalletSession({ on: (name, fn) => listeners.set(name, fn) }, addresses[0], () => ended++);
  listeners.get('chainChanged')('0x2');
  assert.equal(ended, 1);
  stop();
});
test('account picker requests MetaMask permissions and returns all twenty approved accounts', async () => {
  const calls = [];
  const provider = {
    isMetaMask: true,
    request: async (arg) => {
      calls.push(arg);
      return arg.method === 'eth_accounts' ? addresses : [];
    },
  };
  const api = load(provider);
  assert.equal(api.metaMaskProvider(), provider);
  const accounts = await api.chooseWalletAccounts(provider);
  assert.equal(JSON.stringify(accounts), JSON.stringify(addresses));
  assert.equal(calls[0].method, 'wallet_requestPermissions');
  assert.equal(calls[1].method, 'eth_accounts');
});
test('disconnect revokes all account permissions and clears local selection even on rejection', async () => {
  const api = load();
  api.selectWallet(addresses[19]);
  const before = api.walletGeneration();
  let method;
  await assert.rejects(
    api.disconnectWalletAccounts({
      request: async (args) => {
        method = args.method;
        throw new Error('cancelled');
      },
    }),
  );
  assert.equal(method, 'wallet_revokePermissions');
  assert.equal(api.selectedWallet(), '');
  assert.ok(api.walletGeneration() > before);
});
test('older mobile account access falls back only for unsupported methods, not rejected permissions', async () => {
  const api = load();
  const calls = [];
  const accounts = await api.chooseWalletAccounts({
    request: async ({ method }) => {
      calls.push(method);
      if (method === 'wallet_requestPermissions')
        throw Object.assign(new Error('unsupported'), { code: -32601 });
      return [addresses[0]];
    },
  });
  assert.equal(accounts[0], addresses[0]);
  assert.equal(calls[1], 'eth_requestAccounts');
  let attempts = 0;
  await assert.rejects(
    api.chooseWalletAccounts({
      request: async () => {
        attempts++;
        throw Object.assign(new Error('cancelled'), { code: 4001 });
      },
    }),
  );
  assert.equal(attempts, 1);
});
test('personal signing uses the explicitly selected account and UTF-8 message bytes', async () => {
  const api = load();
  let actual;
  const provider = {
    request: async (args) => {
      actual = args;
      return '0x' + 'ab'.repeat(65);
    },
  };
  await api.walletSignature(provider, 'Sign in: account 20', addresses[19]);
  assert.equal(actual.method, 'personal_sign');
  assert.equal(actual.params[1], addresses[19]);
  assert.equal(
    Buffer.from(actual.params[0].slice(2), 'hex').toString('utf8'),
    'Sign in: account 20',
  );
});
test('ignores malformed accounts and discovers MetaMask among multiple injected wallets', () => {
  const provider = { isMetaMask: true };
  const api = load({ providers: [{ isMetaMask: false }, provider] });
  assert.equal(api.metaMaskProvider(), provider);
  assert.equal(
    JSON.stringify(api.walletAccounts([addresses[0], addresses[0], 'not-an-address', null])),
    JSON.stringify([addresses[0]]),
  );
  assert.equal(
    api.walletAppUrl(undefined, '192.168.0.5:8084'),
    'http://192.168.0.5:8084/?signIn=1',
  );
  assert.throws(() => api.walletAppUrl('https://user:secret@example.test'), /Configure/);
});
