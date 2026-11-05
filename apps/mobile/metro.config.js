const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
const empty = path.resolve(__dirname, 'src/empty-module.js');
const shims = Object.fromEntries(
  ['crypto', 'http', 'https', 'net', 'tls', 'zlib', 'os', 'dns', 'assert', 'url', 'path', 'fs'].map(
    (name) => [name, empty],
  ),
);
// Keep browser builds on their normal resolution path.
config.resolver.resolveRequest = (context, name, platform) => {
  if (platform !== 'web') {
    if (name === 'ws')
      return {
        type: 'sourceFile',
        filePath: path.resolve(__dirname, 'src/wallet-websocket.native.ts'),
      };
    const builtin = name.replace(/^node:/, '');
    if (builtin === 'stream')
      return { type: 'sourceFile', filePath: require.resolve('readable-stream') };
    if (shims[builtin]) return { type: 'sourceFile', filePath: shims[builtin] };
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
