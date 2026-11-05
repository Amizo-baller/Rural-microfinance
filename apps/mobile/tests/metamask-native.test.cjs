const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load({ expoGo = false, openURL = async () => undefined, failInit = false, schedule = setTimeout } = {}) {
  const calls = [],
    address = '0x' + '12'.repeat(20);
  let options,
    attempts = 0;
  const raw = {
    request: async ({ method }) => (method === 'eth_accounts' ? [address] : '0x' + 'ab'.repeat(65)),
    on() {},
    removeListener() {},
  };
  const client = {
    getProvider: () => raw,
    connect: async (args) => {
      calls.push(['connect', args]);
      return { accounts: [address], chainId: '0x1' };
    },
    disconnect: async () => {
      calls.push(['disconnect']);
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/wallet-transport.native.ts'), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    Error,
    setTimeout: schedule,
    clearTimeout,
    process: { env: {} },
    require(name) {
      if (name === 'expo-constants')
        return {
          __esModule: true,
          default: { appOwnership: expoGo ? 'expo' : null, expoConfig: {} },
        };
      if (name === 'react-native') return { Linking: { openURL }, Platform: { OS: 'android' } };
      if (name === './api-config') return { resolveApiUrl: () => 'http://192.168.0.5:3000/api' };
      if (name === './wallet-polyfills.native') {
        calls.push(['polyfills']);
        return {};
      }
      if (name === '@metamask/connect-evm')
        return {
          createEVMClient: async (value) => {
            calls.push(['sdk']);
            options = value;
            attempts++;
            if (failInit && attempts === 1) throw new Error('relay unavailable');
            return client;
          },
        };
      throw new Error('Unexpected import: ' + name);
    },
  });
  return { api: module.exports, calls, client, address, options: () => options };
}

test('native connection loads polyfills first, shares one client, and returns the selected account', async () => {
  const { api, calls, address, options } = load();
  const [first, second] = await Promise.all([
    api.prepareWalletProvider(),
    api.prepareWalletProvider(),
  ]);
  assert.equal(first, second);
  assert.equal(calls.filter(([name]) => name === 'sdk').length, 1);
  assert.deepEqual(
    Array.from(calls, ([name]) => name),
    ['polyfills', 'sdk'],
  );
  const result = await api.connectWallet();
  assert.equal(result.accounts[0], address);
  assert.equal(result.provider, first);
  assert.equal(options().dapp.url, 'http://192.168.0.5:3000');
  assert.equal(options().dapp.nativeScheme, 'ruralmicrofinance://');
  assert.equal(options().analytics.enabled, false);
});

test('Expo Go reports that an installed build is required without loading native SDK code', async () => {
  const { api, calls } = load({ expoGo: true });
  assert.equal(await api.prepareWalletProvider(), undefined);
  await assert.rejects(api.connectWallet(), /installed.*APK/);
  assert.equal(calls.length, 0);
});

test('failed SDK initialization can be retried', async () => {
  const { api, calls } = load({ failInit: true });
  await assert.rejects(api.prepareWalletProvider(), /relay unavailable/);
  assert.ok(await api.prepareWalletProvider());
  assert.equal(calls.filter(([name]) => name === 'sdk').length, 2);
});

test('failure to open MetaMask rejects the pending connection and disconnects the relay', async () => {
  const { api, client, options, calls } = load({
    openURL: async () => {
      throw new Error('not installed');
    },
  });
  await api.prepareWalletProvider();
  client.connect = async () => {
    options().mobile.preferredOpenLink('metamask://connect');
    return new Promise(() => {});
  };
  await assert.rejects(api.connectWallet(), /Could not open MetaMask Mobile/);
  assert.ok(calls.some(([name]) => name === 'disconnect'));
});

test('native disconnection closes the SDK connection', async () => {
  const { api, calls } = load();
  await api.connectWallet();
  await api.endWalletConnection();
  assert.equal(calls.at(-1)[0], 'disconnect');
});

test('logout rejects an outstanding connection instead of accepting a late wallet response', async () => {
  const { api, client } = load();
  await api.prepareWalletProvider();
  client.connect = () => new Promise(() => {});
  const pending = api.connectWallet();
  const rejected = assert.rejects(pending, /cancelled/);
  await new Promise((resolve) => setImmediate(resolve));
  await api.endWalletConnection();
  await rejected;
});

test('an unresponsive wallet times out and closes its relay connection', async () => {
  let expire;
  const { api, client, calls } = load({ schedule: (callback) => { expire = callback; return 0; } });
  await api.prepareWalletProvider();
  client.connect = () => new Promise(() => {});
  const pending = api.connectWallet();
  const rejected = assert.rejects(pending, /did not respond/);
  await new Promise((resolve) => setImmediate(resolve));
  expire();
  await rejected;
  assert.ok(calls.some(([name]) => name === 'disconnect'));
});

test('wallet rejection preserves code 4001 for cancellation feedback', async () => {
  const { api, client } = load();
  await api.prepareWalletProvider();
  client.connect = async () => { throw Object.assign(new Error('Rejected'), { code: 4001 }); };
  await assert.rejects(api.connectWallet(), { code: 4001 });
});

test('SDK transport timeout closes the stale connection and allows a fresh connection', async () => {
  const { api, client, calls } = load();
  await api.prepareWalletProvider();
  const connect = client.connect;
  client.connect = async () => { throw new Error('RPCErr53: RPC Client invoke method reason (Transport request timed out)'); };
  await assert.rejects(api.connectWallet(), /Reconnect MetaMask/);
  assert.ok(calls.some(([name]) => name === 'disconnect'));
  client.connect = connect;
  assert.ok((await api.connectWallet()).accounts.length);
});

test('reconnect waits for timeout cleanup instead of racing the previous disconnect', async () => {
  const { api, client, calls } = load();
  await api.prepareWalletProvider();
  const connect = client.connect;
  let finishDisconnect;
  client.disconnect = () => new Promise((resolve) => { finishDisconnect = resolve; });
  client.connect = async () => { throw new Error('Transport request timed out'); };
  await assert.rejects(api.connectWallet(), /Reconnect MetaMask/);
  client.connect = connect;
  const next = api.connectWallet();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter(([name]) => name === 'connect').length, 0);
  finishDisconnect();
  assert.ok((await next).accounts.length);
  assert.equal(calls.filter(([name]) => name === 'connect').length, 1);
});
