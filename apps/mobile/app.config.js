/* global module, process, require */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads this configuration through CommonJS. */
const { URL } = require('node:url');
const { isIP } = require('node:net');

// A standalone live build has no Metro host to resolve the developer's localhost.
// Fail before building an APK that cannot reach its backend.
module.exports = ({ config }) => {
  if (process.env.RCM_LIVE_BUILD !== '1') return config;
  const address = process.env.EXPO_PUBLIC_API_URL?.trim();
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new Error(
      'Live builds require EXPO_PUBLIC_API_URL with your public HTTPS API address ending in /api.',
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    isIP(hostname.replace(/^\[|\]$/g, '')) ||
    hostname === 'localhost' ||
    !hostname.includes('.') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    !url.pathname.replace(/\/+$/, '').endsWith('/api')
  ) {
    throw new Error(
      'Live builds require a public HTTPS API hostname ending in /api, without credentials, query parameters or fragments.',
    );
  }
  return {
    ...config,
    extra: { ...config.extra, apiUrl: url.toString().replace(/\/+$/, ''), liveBuild: true },
  };
};
