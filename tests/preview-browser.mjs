import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-preview-'));
const app = await createApp({ dataDir: directory, initialPassword: undefined, weather: {
  visitor: async () => ({ location: null }),
  weather: async city => ({ city, current: null }), cities: async () => [],
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(4000);
const frame = page.frameLocator('#appearance-preview');
async function selectTheme(theme) {
  await page.locator(`.theme-choice[data-theme="${theme}"]`).click();
  await expect(page.locator(`.theme-choice[data-theme="${theme}"]`)).toHaveAttribute('aria-checked', 'true');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', theme, { timeout: 2000 });
}
try {
  const setup = await page.request.post(base + '/api/auth/setup', { headers: { 'x-navigation-request': '1' }, data: { username: 'preview-test', password: 'Preview-only-test-2026!' } });
  assert.equal(setup.status(), 200);
  await page.goto(base + '/admin.html#appearance');
  await frame.locator('.resource-card').first().waitFor();
  for (const theme of ['porcelain', 'graphite', 'classic', 'forest', 'sky']) await selectTheme(theme);
  console.log('Direct theme switching passed.');
  await page.locator('[data-theme="porcelain"] #label-panel-radius').count();
  await page.locator('.theme-choice[data-theme="porcelain"]').click();
  await page.locator('#layout-panel-radius-number').fill('21');
  await page.locator('#layout-panel-radius-number').press('Tab');
  await page.locator('.theme-choice[data-theme="graphite"]').click();
  await page.locator('.theme-choice[data-theme="porcelain"]').click();
  await expect(page.locator('#layout-panel-radius-number')).toHaveValue('21');
  console.log('Per-theme draft settings retained while switching themes.');
  await frame.locator('.topbar .brand').click();
  await frame.locator('.resource-card').first().waitFor();
  await selectTheme('porcelain');
  console.log('Theme switching after preview brand click passed.');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error('Preview frame URL:', page.frames().find(frame => frame !== page.mainFrame())?.url());
  console.error('Page errors:', errors);
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  app.locals.database.close(); await fs.rm(directory, { recursive: true, force: true });
}
