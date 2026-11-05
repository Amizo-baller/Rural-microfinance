/* global process, require */
/* eslint-disable @typescript-eslint/no-require-imports -- These tests run directly in Node as CommonJS. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const configure = require('../app.config.js');
const originalMode = process.env.RCM_LIVE_BUILD;
const originalUrl = process.env.EXPO_PUBLIC_API_URL;

function restore() {
  if (originalMode === undefined) delete process.env.RCM_LIVE_BUILD;
  else process.env.RCM_LIVE_BUILD = originalMode;
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = originalUrl;
}

test('live APK builds reject missing, local, insecure and ambiguous API addresses', () => {
  try {
    process.env.RCM_LIVE_BUILD = '1';
    for (const address of [
      '',
      'http://api.example.com/api',
      'https://localhost/api',
      'https://10.0.2.2/api',
      'https://192.168.1.1/api',
      'https://[::1]/api',
      'https://phone.local/api',
      'https://api.example.com',
      'https://user:password@api.example.com/api',
      'https://api.example.com/api?token=secret',
      'https://api.example.com/api#fragment',
    ]) {
      process.env.EXPO_PUBLIC_API_URL = address;
      assert.throws(() => configure({ config: {} }), /Live builds require/);
    }
  } finally {
    restore();
  }
});

test('live APK builds embed the public API and preserve the existing Expo configuration', () => {
  try {
    process.env.RCM_LIVE_BUILD = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com/api/';
    const config = { name: 'Rural Microfinance', extra: { eas: { projectId: 'existing' } } };
    const result = configure({ config });
    assert.equal(result.extra.apiUrl, 'https://api.example.com/api');
    assert.equal(result.extra.liveBuild, true);
    assert.deepEqual(result.extra.eas, config.extra.eas);
    assert.equal(config.extra.apiUrl, undefined);
  } finally {
    restore();
  }
});

test('development and existing preview builds retain their current API resolution', () => {
  try {
    delete process.env.RCM_LIVE_BUILD;
    const config = { extra: { router: {} } };
    assert.equal(configure({ config }), config);
  } finally {
    restore();
  }
});
