const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test(
  'calendar selection, cancellation, clearing and contribution limits work in the browser',
  { timeout: 600000 },
  async () => {
    const { build } = require('esbuild');
    const { chromium } = require('@playwright/test');
    const http = require('node:http');
    const componentPath = path.join(__dirname, '../src/date-field.tsx').replace(/\\/g, '/');
    const result = await build({
      stdin: {
        contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { DateField } from ${JSON.stringify(componentPath)};
      function App() {
        const [date, setDate] = useState('2026-10-19');
        const [week, setWeek] = useState('2026-10-12');
        return <main style={{maxWidth:400,padding:16}}>
          <DateField label="Application date" value={date} onChangeText={setDate} />
          <output aria-label="Selected application date">{date || 'empty'}</output>
          <DateField label="Contribution week" value={week} onChangeText={setWeek} clearable={false} maxDate="2026-10-19" />
          <output aria-label="Selected contribution week">{week}</output>
          <DateField label="Busy date" value="" onChangeText={() => {}} disabled />
        </main>;
      }
      createRoot(document.getElementById('root')).render(<App />);`,
        resolveDir: path.join(__dirname, '..'),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      alias: { 'react-native': 'react-native-web' },
      define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
    });
    const server = http.createServer((request, response) => {
      response.setHeader(
        'Content-Type',
        request.url === '/bundle.js' ? 'text/javascript' : 'text/html',
      );
      response.end(
        request.url === '/bundle.js'
          ? result.outputFiles[0].text
          : '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar check</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
      );
    });
    let browser;
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 90000 });
      const page = await browser.newPage({
        viewport: { width: 360, height: 800 },
        timezoneId: 'America/Los_Angeles',
      });
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const application = page.getByRole('button', { name: 'Application date', exact: true });
      await application.click();
      let dialog = page.getByRole('dialog', { name: 'Select Application date', exact: true });
      await dialog.getByRole('button', { name: '2026', exact: true }).click();
      await dialog.getByRole('button', { name: 'Choose year 2024', exact: true }).click();
      await dialog.getByRole('button', { name: 'Choose February', exact: true }).click();
      await dialog.getByRole('button', { name: '2024-02-29', exact: true }).click();
      const evidence = path.resolve(__dirname, '../../../.phone-test');
      fs.mkdirSync(evidence, { recursive: true });
      await page.screenshot({ path: path.join(evidence, 'calendar-leap-day.png') });
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      assert.equal(await page.getByLabel('Selected application date').textContent(), '2024-02-29');
      await application.click();
      await dialog.getByRole('button', { name: 'Next month', exact: true }).click();
      await dialog.getByRole('button', { name: '2024-03-12', exact: true }).click();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(await page.getByLabel('Selected application date').textContent(), '2024-02-29');
      await application.click();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await dialog.count(), 0);
      assert.equal(await page.getByLabel('Selected application date').textContent(), '2024-02-29');
      await application.click();
      await dialog.getByRole('button', { name: 'Clear date', exact: true }).click();
      assert.equal(await page.getByLabel('Selected application date').textContent(), 'empty');
      await page.getByRole('button', { name: 'Contribution week', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Select Contribution week', exact: true });
      assert.equal(
        await dialog.getByRole('button', { name: 'Clear date', exact: true }).count(),
        0,
      );
      assert.equal(
        await dialog.getByRole('button', { name: '2026-10-20', exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await dialog.getByRole('button', { name: 'Next month', exact: true }).isDisabled(),
        true,
      );
      await dialog.getByRole('button', { name: '2026-10-19', exact: true }).click();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      assert.equal(await page.getByLabel('Selected contribution week').textContent(), '2026-10-19');
      assert.equal(
        await page.getByRole('button', { name: 'Busy date', exact: true }).isDisabled(),
        true,
      );
      assert.deepEqual(failures, []);
    } finally {
      if (browser) await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
