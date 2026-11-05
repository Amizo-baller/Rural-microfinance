const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('Admin replaces group manager and the dropdown has exactly three choices', () => {
  const { ACCOUNT_ROLES, roleLabel } = loadModule('account-roles.ts');
  assert.equal(JSON.stringify(ACCOUNT_ROLES), JSON.stringify([
    { value: 'ADMIN', label: 'Admin' },
    { value: 'TREASURER', label: 'Treasurer' },
    { value: 'MEMBER', label: 'Member' },
  ]));
  assert.equal(roleLabel('GROUP_MANAGER'), 'Admin');
  assert.equal(roleLabel('ADMIN'), 'Admin');
});

function loadModule(file, globals = {}, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) =>
      mocks[name] ??
      (name.startsWith('./') ? loadModule(name.slice(2) + '.ts', globals, mocks) : require(name)),
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    ...globals,
  });
  return module.exports;
}
const validation = loadModule('validation.ts');

function googleAuthModule(environment, response, calls = []) {
  const webClientId = 'test-client.apps.googleusercontent.com';
  const sdk = {
    GoogleOneTapSignIn: {
      configure: (options) => calls.push(options),
      checkPlayServices: async () => calls.push('play-services'),
      presentExplicitSignIn: async () => response,
    },
    isSuccessResponse: (value) => value.type === 'success',
    isCancelledResponse: (value) => value.type === 'cancelled',
  };
  return loadModule('google-auth.android.ts', {}, {
    'expo-constants': {
      __esModule: true,
      default: { executionEnvironment: environment, expoConfig: { extra: { google: { webClientId } } } },
      ExecutionEnvironment: { StoreClient: 'storeClient' },
    },
    'react-native-nitro-google-signin': sdk,
  });
}

test('Google sign-in returns an ID token after configuring the Web client and checking Play services', async () => {
  const calls = [];
  const auth = googleAuthModule('standalone', { type: 'success', data: { idToken: 'verified-by-server' } }, calls);
  assert.equal(await auth.googleIdToken(), 'verified-by-server');
  assert.equal(calls[0].webClientId, 'test-client.apps.googleusercontent.com');
  assert.equal(calls[1], 'play-services');
});

test('Google sign-in cancellation returns no token and missing tokens fail', async () => {
  const cancelled = googleAuthModule('standalone', { type: 'cancelled' });
  assert.equal(await cancelled.googleIdToken(), null);
  const missing = googleAuthModule('standalone', { type: 'success', data: { idToken: null } });
  await assert.rejects(missing.googleIdToken(), /could not complete sign-in/);
});

test('Google sign-in in Expo Go explains how to use the installed app without accessing native modules', async () => {
  const calls = [];
  const auth = googleAuthModule('storeClient', null, calls);
  await assert.rejects(auth.googleIdToken(), /installed Rural Microfinance Android app/);
  assert.equal(calls.length, 0);
});
const validRegistration = {
  memberId: '2026001',
  firstName: 'Ama',
  lastName: 'Mensah',
  email: '',
  phone: '+233201234567',
  password: 'Strong123',
  confirmation: 'Strong123',
  groupId: '',
};

test('registration allows phone-only rural users and trims names/contact fields', () => {
  assert.equal(
    Object.keys(
      validation.registrationErrors({
        ...validRegistration,
        firstName: ' Ama ',
        phone: ' +233201234567 ',
      }),
    ).length,
    0,
  );
});
test('registration identifies weak passwords, invalid contact details and mismatches', () => {
  const errors = validation.registrationErrors({
    ...validRegistration,
    firstName: 'A',
    email: 'bad',
    phone: 'abc',
    password: 'weak',
    confirmation: 'different',
    groupId: 'bad',
  });
  for (const key of ['firstName', 'email', 'phone', 'password', 'confirmation', 'groupId'])
    assert.ok(errors[key], key);
});
test('registration requires a contact method', () => {
  assert.ok(validation.registrationErrors({ ...validRegistration, phone: '' }).phone);
});
test('dates reject impossible calendar dates and reversed ranges', () => {
  assert.equal(validation.isValidDate('2024-02-29'), true);
  for (const value of ['2025-02-29', '2026-04-31', '2026-13-01', '06/10/2026', ''])
    assert.equal(validation.isValidDate(value), false);
  assert.ok(validation.dateRangeError('2026-10-06', '2026-10-01'));
  assert.equal(validation.dateRangeError('', ''), null);
  assert.equal(validation.dateRangeError('2026-10-06', '2026-10-06'), null);
});

function client(fetchImpl, { web = false, timeout = false } = {}) {
  const storage = new Map();
  const secure = {
    getItemAsync: async (key) => storage.get(key) ?? null,
    setItemAsync: async (key, value) => {
      storage.set(key, value);
    },
    deleteItemAsync: async (key) => {
      storage.delete(key);
    },
  };
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  return {
    storage,
    api: loadModule(
      'api-client.ts',
      {
        fetch: fetchImpl,
        window: { sessionStorage },
        ...(timeout
          ? {
              setTimeout: (fn) => {
                queueMicrotask(fn);
                return 1;
              },
              clearTimeout: () => {},
            }
          : {}),
      },
      {
        'expo-constants': {
          default: { expoConfig: { extra: { apiUrl: 'http://test/api' } } },
          __esModule: true,
        },
        'expo-secure-store': secure,
        'react-native': { Platform: { OS: web ? 'web' : 'android' } },
      },
    ),
  };
}
const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

test('tokens round-trip and clear on both native and web', async () => {
  for (const web of [false, true]) {
    const { api } = client(async () => response(200, {}), { web });
    await api.storeTokens('access', 'refresh');
    assert.equal((await api.getStoredTokens()).accessToken, 'access');
    await api.clearTokens();
    assert.equal((await api.getStoredTokens()).refreshToken, null);
  }
});
test('expired saved session refreshes auth/me and retries with the new token', async () => {
  const calls = [];
  const { api } = client(async (url, options) => {
    calls.push([url, options.headers.Authorization]);
    if (url.endsWith('/auth/refresh'))
      return response(200, { accessToken: 'new', refreshToken: 'rotated' });
    return options.headers.Authorization === 'Bearer new'
      ? response(200, { id: 'user' })
      : response(401, { message: 'Expired' });
  });
  await api.storeTokens('old', 'refresh');
  assert.equal((await api.request('/auth/me')).id, 'user');
  assert.equal(calls.length, 3);
  assert.equal((await api.getStoredTokens()).refreshToken, 'rotated');
});
test('failed refreshed token clears the session and invokes the failure handler', async () => {
  let failures = 0;
  const { api } = client(async (url) =>
    url.endsWith('/auth/refresh')
      ? response(200, { accessToken: 'new', refreshToken: 'rotated' })
      : response(401, { message: 'Inactive' }),
  );
  await api.storeTokens('old', 'refresh');
  api.setAuthFailureHandler(() => {
    failures++;
  });
  await assert.rejects(api.request('/users/me'), { status: 401 });
  assert.equal(failures, 1);
  assert.equal((await api.getStoredTokens()).accessToken, null);
});
test('offline refresh preserves saved tokens for a later retry', async () => {
  const { api } = client(async (url) => {
    if (url.endsWith('/auth/refresh')) throw Error('Offline');
    return response(401, {});
  });
  await api.storeTokens('old', 'refresh');
  await assert.rejects(api.request('/auth/me'), { status: 0 });
  assert.equal((await api.getStoredTokens()).refreshToken, 'refresh');
});
test('bad login and reset requests do not refresh or clear another session', async () => {
  let calls = 0;
  const { api } = client(async () => {
    calls++;
    return response(401, { message: 'Invalid details' });
  });
  await api.storeTokens('old', 'refresh');
  await assert.rejects(
    api.request('/auth/login', { body: { identifier: 'invalid', password: 'invalid' } }),
    { status: 401 },
  );
  assert.equal(calls, 1);
  assert.equal((await api.getStoredTokens()).accessToken, 'old');
});
test('validation arrays remain visible and 204 responses succeed', async () => {
  const { api } = client(async (url) =>
    url.endsWith('/empty')
      ? response(204)
      : response(400, { message: ['First name is required', 'Phone is invalid'] }),
  );
  await assert.rejects(
    api.request('/invalid'),
    (error) => error.message.includes('Phone is invalid') && error.validationErrors.length === 2,
  );
  assert.equal(await api.request('/empty'), undefined);
});
test('a stalled connection aborts and returns an actionable error', async () => {
  const { api } = client(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Error('Timeout')));
      }),
    { timeout: true },
  );
  await assert.rejects(
    api.request('/savings'),
    (error) => error.status === 0 && error.message.includes('connection'),
  );
});
test('in-flight account data is rejected after logout', async () => {
  let finish;
  const { api } = client(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await api.storeTokens('old', 'refresh');
  const pending = api.request('/savings');
  await new Promise((resolve) => setImmediate(resolve));
  await api.clearTokens();
  finish(response(200, { privateBalance: 100 }));
  await assert.rejects(pending, (error) => error.message.includes('session changed'));
});

test('concurrent expired requests share a single refresh', async () => {
  let refreshes = 0;
  const { api } = client(async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshes++;
      await new Promise((resolve) => setImmediate(resolve));
      return response(200, { accessToken: 'new', refreshToken: 'rotated' });
    }
    return options.headers.Authorization === 'Bearer new'
      ? response(200, { ok: true })
      : response(401, {});
  });
  await api.storeTokens('old', 'refresh');
  const results = await Promise.all([api.request('/savings'), api.request('/loans')]);
  assert.equal(refreshes, 1);
  assert.equal(
    results.every((item) => item.ok),
    true,
  );
});
test('late refresh cannot overwrite a newly signed-in account', async () => {
  let finishRefresh;
  const { api } = client(async (url) => {
    if (url.endsWith('/auth/refresh'))
      return new Promise((resolve) => {
        finishRefresh = resolve;
      });
    return response(401, {});
  });
  await api.storeTokens('old', 'old-refresh');
  const pending = api.request('/savings');
  await new Promise((resolve) => setImmediate(resolve));
  await api.clearTokens();
  await api.storeTokens('other-account', 'other-refresh');
  finishRefresh(response(200, { accessToken: 'late', refreshToken: 'late-refresh' }));
  await assert.rejects(pending, (error) => error.message.includes('session changed'));
  assert.equal((await api.getStoredTokens()).accessToken, 'other-account');
});

const configuration = loadModule('api-config.ts');
const integration = loadModule('integration-state.ts');
test('native development and mobile-web addresses reach the desktop API', () => {
  assert.equal(
    configuration.resolveApiUrl({
      platform: 'android',
      configuredUrl: 'http://localhost:3000/api/',
      metroHost: '192.168.1.20:8081',
    }),
    'http://192.168.1.20:3000/api',
  );
  assert.equal(configuration.resolveApiUrl({ platform: 'android' }), 'http://10.0.2.2:3000/api');
  assert.equal(
    configuration.resolveApiUrl({
      platform: 'web',
      configuredUrl: 'http://localhost:3000/api',
      webHostname: '192.168.1.20',
    }),
    'http://192.168.1.20:3000/api',
  );
  assert.equal(
    configuration.resolveApiUrl({
      platform: 'web',
      configuredUrl: 'https://api.example.test/api/',
      webHostname: 'app.example.test',
    }),
    'https://api.example.test/api',
  );
  assert.equal(configuration.resolveApiUrl({ platform: 'web', configuredUrl: '/api/' }), '/api');
  assert.throws(() => configuration.resolveApiUrl({ platform: 'ios', configuredUrl: '/api' }));
  assert.throws(() =>
    configuration.resolveApiUrl({
      platform: 'web',
      configuredUrl: 'https://user:password@api.example.test/api',
    }),
  );
  assert.throws(() =>
    configuration.resolveApiUrl({ platform: 'web', configuredUrl: 'ftp://api.example.test/api' }),
  );
});
test('old installed token pairs migrate into one stored session record', async () => {
  const { api, storage } = client(async () => response(200, {}));
  storage.set('auth_access_token', 'old');
  storage.set('auth_refresh_token', 'refresh');
  assert.equal((await api.getStoredTokens()).accessToken, 'old');
  assert.equal(JSON.parse(storage.get(api.SESSION_STORAGE_KEY)).refreshToken, 'refresh');
  assert.equal(storage.has('auth_access_token'), false);
});
test('partial and corrupt saved sessions never authenticate requests', async () => {
  const { api, storage } = client(async () => response(200, {}));
  storage.set('auth_access_token', 'partial');
  assert.equal((await api.getStoredTokens()).accessToken, null);
  assert.equal(storage.size, 0);
  storage.set(api.SESSION_STORAGE_KEY, '{broken');
  assert.equal((await api.getStoredTokens()).refreshToken, null);
  assert.equal(storage.size, 0);
});
test('concurrent session writes cannot mix accounts or token pairs', async () => {
  const { api } = client(async () => response(200, {}));
  await Promise.allSettled([
    api.storeTokens('first', 'first-refresh'),
    api.storeTokens('second', 'second-refresh'),
  ]);
  const stored = await api.getStoredTokens();
  assert.equal(stored.accessToken, 'second');
  assert.equal(stored.refreshToken, 'second-refresh');
});
test('public authentication requests do not send another account bearer token', async () => {
  let authorization;
  const { api } = client(async (_url, options) => {
    authorization = options.headers.Authorization;
    return response(200, {});
  });
  await api.storeTokens('private', 'refresh');
  await api.request('/auth/forgot-password', { body: { identifier: 'someone' } });
  assert.equal(authorization, undefined);
});
test('a forbidden role response preserves the current session', async () => {
  let calls = 0;
  const { api } = client(async () => {
    calls++;
    return response(403, { error: { message: 'Permission denied' } });
  });
  await api.storeTokens('valid', 'refresh');
  await assert.rejects(api.request('/system/settings'), {
    status: 403,
    message: 'Permission denied',
  });
  assert.equal(calls, 1);
  assert.equal((await api.getStoredTokens()).accessToken, 'valid');
});
test('a temporary account-service outage preserves the session without refreshing or logging out', async () => {
  let calls = 0;
  const { api } = client(async () => {
    calls++;
    return response(503, {
      error: 'The account service is temporarily unavailable. Please try again shortly.',
    });
  });
  await api.storeTokens('valid', 'refresh');
  await assert.rejects(api.request('/auth/me'), { status: 503 });
  assert.equal(calls, 1);
  assert.equal((await api.getStoredTokens()).accessToken, 'valid');
  assert.equal((await api.getStoredTokens()).refreshToken, 'refresh');
});
test('malformed successful JSON is an error rather than fabricated empty data', async () => {
  const { api } = client(async () => ({
    status: 200,
    ok: true,
    json: async () => {
      throw new SyntaxError('bad json');
    },
  }));
  await assert.rejects(api.request('/groups'), (error) => error.message.includes('invalid data'));
});
test('response-body timeouts are bounded, not just connection startup', async () => {
  const { api } = client(
    async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) }),
    { timeout: true },
  );
  await assert.rejects(
    api.request('/groups'),
    (error) => error.status === 0 && error.message.includes('too long'),
  );
});
test('paginated refreshes merge shifted records without duplicate ids', () => {
  const merged = integration.mergeRecords(
    [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ],
    [
      { id: 'b', value: 3 },
      { id: 'c', value: 4 },
    ],
  );
  assert.equal(merged.length, 3);
  assert.equal(merged[1].value, 3);
  assert.throws(() => integration.assertPage({ items: [], page: 1, limit: 20 }));
});
test('newer filters and logout invalidate older response commits', () => {
  const tracker = new integration.RequestTracker();
  const old = tracker.start('members');
  const current = tracker.start('members');
  assert.equal(tracker.current('members', old), false);
  assert.equal(tracker.current('members', current), true);
  tracker.clear();
  const nextAccount = tracker.start('members');
  assert.equal(tracker.current('members', current), false);
  assert.equal(tracker.current('members', nextAccount), true);
});

test('phone address resolution works with React Native actual read-only URL getters', () => {
  const babel = require('@babel/core');
  const nativeSource = fs.readFileSync(require.resolve('react-native/Libraries/Blob/URL'), 'utf8');
  const code = babel.transformSync(nativeSource, {
    babelrc: false,
    configFile: false,
    plugins: [
      '@babel/plugin-transform-flow-strip-types',
      '@babel/plugin-transform-modules-commonjs',
    ],
  }).code;
  const nativeModule = { exports: {} };
  vm.runInNewContext(code, {
    module: nativeModule,
    exports: nativeModule.exports,
    require: (name) => (name === './NativeBlobModule' ? null : {}),
  });
  const nativeConfiguration = loadModule('api-config.ts', { URL: nativeModule.exports.URL });
  assert.equal(
    nativeConfiguration.resolveApiUrl({
      platform: 'android',
      configuredUrl: 'http://localhost:3000/api',
      metroHost: '10.244.90.147:8081',
    }),
    'http://10.244.90.147:3000/api',
  );
  assert.equal(
    nativeConfiguration.resolveApiUrl({
      platform: 'ios',
      configuredUrl: 'http://localhost:3000/api',
      metroHost: '10.244.90.147:8081',
    }),
    'http://10.244.90.147:3000/api',
  );
  assert.equal(
    nativeConfiguration.resolveApiUrl({ platform: 'android' }),
    'http://10.0.2.2:3000/api',
  );
});
