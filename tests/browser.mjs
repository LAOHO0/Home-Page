import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-ui-'));
const output = path.resolve('test-results'); await fs.mkdir(output, { recursive: true });
const city = { name: '上海', country: '中国', latitude: 31.23, longitude: 121.47 };
const app = await createApp({ dataDir: directory, initialPassword: undefined, weather: {
  visitor: async () => ({ ip: '203.0.113.42', source: 'visitor', location: { ...city, isp: '测试网络' } }),
  weather: async selected => ({ city: selected, current: { temperature: 25, code: 2, isDay: true, time: '2026-09-05T12:00' } }), cities: async () => [city],
} });
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
const shot = name => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: 'disabled' });
async function noOverflow() { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow'); }
async function saved() { await page.getByRole('status').filter({ hasText: /已保存|已恢复|已删除/ }).last().waitFor(); }
try {
  await page.goto(base); await page.locator('.resource-card').first().waitFor(); await page.locator('#weather-value').filter({ hasText: '25°C' }).waitFor();
  assert.equal(await page.locator('#themes').count(), 0);
  await page.locator('#lunar-date').filter({ hasText: '农历' }).waitFor();
  assert.equal(await page.locator('#visitor-ip').textContent(), 'IP · 203.***.***.42'); await page.locator('#visitor-ip').click(); assert.equal(await page.locator('#visitor-ip').textContent(), 'IP · 203.0.113.42');
  assert.ok(await page.locator('.resource-card').first().evaluate(element => element.querySelector('.resource-description').getBoundingClientRect().top >= element.querySelector('b').getBoundingClientRect().bottom));
  await page.waitForFunction(() => [...document.querySelectorAll('.resource-card')].every(card => card.querySelector('img')?.naturalWidth > 0));
  await shot('home-sky-desktop');
  await page.locator('#search-scope').selectOption('apps'); await page.locator('#query').fill('ai'); assert.equal(await page.locator('.resource-card').count(), 1);
  await page.locator('#search-suggestions').getByRole('option').filter({ hasText: 'ChatGPT' }).waitFor();
  await page.locator('#query').fill('不存在'); await page.getByText('没有找到匹配的资源').waitFor();
  await page.locator('#clear-search').click(); assert.equal(await page.locator('.resource-card').count(), 6);
  await page.locator('#bookmarks-tab').click(); await page.locator('#query').fill('Web 开发'); assert.equal(await page.locator('.resource-card').count(), 1);
  await page.locator('#search-scope').selectOption('web'); await page.locator('#query').fill('Hello world'); assert.equal(await page.locator('.resource-card').count(), 6);
  await page.locator('#query').fill(''); await page.locator('#apps-tab').click();
  await page.locator('#weather-city').click(); await page.locator('#city-query').fill('上海'); await page.locator('#city-search').getByRole('button').click(); await page.getByRole('button', { name: '上海 · 中国', exact: true }).click(); await page.getByText('手动选择', { exact: true }).waitFor();
  for (const width of [375, 768]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(); await shot('home-forest-' + width); }
  await page.route('**/api/weather?*', route => route.fulfill({ json: { city: { name: '北京', country: '中国', latitude: 39.9, longitude: 116.4 }, current: { temperature: 18, code: 3, isDay: false, time: '2026-09-05T12:00' }, fallback: true, requestedCity: city } }), { times: 1 });
  await page.locator('#weather-city').click(); await page.locator('#city-automatic').click();
  await page.locator('#weather-source').filter({ hasText: '默认城市 · 原城市天气不可用' }).waitFor();
  assert.equal(await page.locator('#weather-city').textContent(), '北京'); assert.equal(await page.locator('#weather-value').textContent(), '阴 · 18°C');
  await page.setViewportSize({ width: 375, height: 900 }); await noOverflow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.request.post(base + '/api/auth/setup', { headers: { 'x-navigation-request': '1' }, data: { username: 'browser-test', password: 'Browser-only-test-2026!' } }); assert.equal(response.status(), 200);
  await page.goto(base + '/admin.html'); await page.locator('#admin-layout').waitFor();
  await page.locator('#add-entry').click(); await page.locator('#entry-name').fill('测试应用'); await page.locator('#entry-url').fill('https://example.com'); await page.locator('#entry-description').fill('新增资源描述'); await page.locator('#entry-category').selectOption('category-0'); await page.locator('#entry-tags input').first().check(); await page.locator('#entry-form').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '编辑测试应用', exact: true }).waitFor();
  await page.getByRole('button', { name: '编辑测试应用', exact: true }).click(); await page.locator('#entry-name').fill('修改后应用'); await page.locator('#entry-form').getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('button', { name: '编辑修改后应用', exact: true }).waitFor();
  await page.getByRole('button', { name: '上移修改后应用', exact: true }).click(); await shot('admin-apps-desktop');
  await page.locator('a[data-page="taxonomy"]').click(); await page.locator('#add-taxonomy').click(); await page.locator('#taxonomy-name').fill('新增分类'); await page.locator('#taxonomy-form').getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('button', { name: '编辑新增分类', exact: true }).waitFor();
  await page.locator('[data-kind="tags"]').click(); await page.locator('#add-taxonomy').click(); await page.locator('#taxonomy-name').fill('新标签'); await page.locator('#taxonomy-form').getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('button', { name: '编辑新标签', exact: true }).waitFor();
  await page.locator('a[data-page="appearance"]').click(); await page.locator('.theme-choice[data-theme="porcelain"]').click();
  assert.equal(await page.locator('.theme-choice[data-theme="porcelain"]').getAttribute('aria-checked'), 'true');
  await page.locator('[data-preset="roomy"]').click();
  assert.equal(await page.locator('#layout-grid-gap-number').inputValue(), '20');
  await page.locator('#layout-panel-radius-number').fill('30');
  await page.locator('#layout-panel-gap-number').fill('26');
  const previewFrame = page.frames().find(frame => frame !== page.mainFrame());
  await previewFrame.waitForFunction(() => getComputedStyle(document.querySelector('.overview')).borderTopLeftRadius === '30px' && getComputedStyle(document.querySelector('main')).gap === '26px');
  await page.locator('[data-device="mobile"]').click();
  await previewFrame.waitForFunction(() => innerWidth === 375 && document.documentElement.scrollWidth <= innerWidth + 1);
  await page.locator('[data-device="desktop"]').click();
  await page.locator('#editor-background-tab').click(); await page.locator('#layer-select').selectOption('resources'); await page.locator('[data-mode="image"]').click();
  const image = await sharp({ create: { width: 240, height: 120, channels: 3, background: '#d3e7dd' } }).png().toBuffer();
  await page.locator('#background-file').setInputFiles({ name: 'background.png', mimeType: 'image/png', buffer: image });
  await page.waitForFunction(() => document.querySelector('#bg-image').value.startsWith('/uploads/'));
  await page.locator('#bg-opacity').fill('75'); await page.locator('#save-appearance').click();
  await page.locator('#appearance-status').filter({ hasText: '已保存' }).waitFor(); await shot('admin-appearance-desktop');
  await page.reload();
  await page.locator('#layout-panel-radius-number').waitFor();
  assert.equal(await page.locator('#layout-panel-radius-number').inputValue(), '30');
  assert.equal(await page.locator('#layout-panel-gap-number').inputValue(), '26');
  assert.equal(await page.locator('#layout-grid-gap-number').inputValue(), '20');
  await page.locator('#editor-background-tab').click(); await page.locator('#layer-select').selectOption('resources'); assert.match(await page.locator('#bg-image').inputValue(), /^\/uploads\//);
  assert.equal(await page.locator('#bg-opacity').inputValue(), '75');
  let holdSave, markSavePending;
  const saveHeld = new Promise(resolve => { holdSave = resolve; });
  const savePending = new Promise(resolve => { markSavePending = resolve; });
  await page.route('**/api/admin/document', async route => {
    const response = await route.fetch(); markSavePending(); await saveHeld; await route.fulfill({ response });
  }, { times: 1 });
  await page.locator('#bg-opacity').fill('60'); await page.locator('#save-appearance').click(); await savePending;
  await page.locator('#bg-opacity').fill('40'); holdSave();
  await page.getByRole('status').filter({ hasText: '外观已保存，新的调整仍待保存' }).waitFor();
  assert.equal(await page.locator('#appearance-status').textContent(), '未保存');
  await page.locator('#layer-select').selectOption('page'); await page.locator('#layer-select').selectOption('resources');
  assert.equal(await page.locator('#bg-opacity').inputValue(), '40');
  await page.locator('#save-appearance').click(); await page.locator('#appearance-status').filter({ hasText: '已保存' }).waitFor();
  await page.reload(); await page.locator('#editor-background-tab').click(); await page.locator('#layer-select').selectOption('resources'); assert.equal(await page.locator('#bg-opacity').inputValue(), '40');
  await page.locator('.theme-choice[data-theme="sky"]').click(); await page.locator('.theme-choice[data-theme="porcelain"]').click(); assert.match(await page.locator('#bg-image').inputValue(), /^\/uploads\//); await page.locator('#save-appearance').click(); await page.locator('#appearance-status').filter({ hasText: '已保存' }).waitFor();
  await page.goto(base); await page.locator('.resource-card').first().waitFor(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'porcelain'); assert.equal(await page.locator('html').getAttribute('data-style'), 'porcelain'); await shot('home-porcelain-desktop');
  await page.goto(base + '/admin.html'); await page.locator('#admin-layout').waitFor();
  await page.locator('a[data-page="settings"]').click(); await page.locator('#site-name-input').fill('测试导航站'); await page.locator('#greeting-input').fill('自定义欢迎语'); await page.locator('#default-city').click(); await page.locator('#city-query').fill('上海'); await page.locator('#city-search').getByRole('button').click(); await page.getByRole('button', { name: '上海 · 中国', exact: true }).click(); await page.locator('#settings-form').getByRole('button', { name: '保存设置', exact: true }).click(); await page.locator('#admin-brand').filter({ hasText: '测试导航站' }).waitFor();
  await page.locator('a[data-page="backup"]').click(); const backupResponse = await page.request.get(base + '/api/admin/export'); const backup = await backupResponse.json(); assert.ok(Object.keys(backup.assets).length);
  await page.locator('#backup-file').setInputFiles({ name: 'restore.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await page.locator('#import-summary').waitFor(); await page.locator('#import-backup').click(); await page.locator('#import-summary').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 375, height: 900 }); await noOverflow(); await shot('admin-backup-mobile');
  await page.locator('a[data-page="apps"]').click(); await noOverflow(); await shot('admin-apps-mobile');
  await page.getByRole('button', { name: '删除修改后应用', exact: true }).click(); await page.locator('#confirm-ok').click(); await page.getByRole('button', { name: '删除修改后应用', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('a[data-page="appearance"]').click(); await noOverflow(); await shot('admin-appearance-mobile');
  await page.locator('#logout').click(); await page.locator('#auth-view').waitFor(); await page.reload(); await page.locator('#auth-view').waitFor();
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: themes, mobile layout, search, visitor masking, manual weather, CRUD, reorder, taxonomy, uploaded backgrounds, settings, backup and logout.');
} catch (error) { await shot('failure'); console.error('Page errors:', errors); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); app.locals.database.close(); await fs.rm(directory, { recursive: true, force: true }); }
