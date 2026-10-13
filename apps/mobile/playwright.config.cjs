const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './acceptance',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  globalTeardown: require.resolve('./acceptance/teardown.cjs'),
  outputDir: './acceptance-results',
  reporter: [['list'], ['html', { outputFolder: './acceptance-report', open: 'never' }]],
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    channel: 'msedge',
    launchOptions: { args: ['--disable-gpu', '--renderer-process-limit=1'] },
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 360, height: 740 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --expose-gc --max-old-space-size=256 ../../scripts/mobile-acceptance-server.cjs',
    url: 'http://127.0.0.1:4173',
    timeout: 240000,
    reuseExistingServer: false,
  },
});
