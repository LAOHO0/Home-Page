import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-appearance-'));
const output = path.resolve('test-results/appearance');
await fs.mkdir(output, { recursive: true });
const city = { name: '上海', country: '中国', latitude: 31.23, longitude: 121.47 };
const app = await createApp({ dataDir: directory, initialPassword: undefined, weather: {
  visitor: async () => ({ ip: '203.0.113.42', source: 'visitor', location: { ...city, isp: '测试网络' } }),
  weather: async selected => ({ city: selected, current: { temperature: 25, code: 61, isDay: true, time: '2026-09-08T12:00' } }),
  cities: async () => [city],
} });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
// Keep status probes deterministic and prevent test navigation to third-party sites.
await context.route(url => url.origin !== base, route => route.fulfill({ status: 200, body: '' }));
const page = await context.newPage();
const errors = [];
context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(5000);
const shot = name => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: 'disabled' });
function updateDocument(change) {
  const snapshot = app.locals.database.read();
  change(snapshot.document);
  app.locals.database.write(snapshot.document, snapshot.revision);
}
async function home() {
  await page.goto(base);
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await expect(page.locator('#weather-value')).toContainText('25°C');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-brand-logo] img, .resource-icon img')].every(img => img.naturalWidth > 0));
}
async function geometry(label) {
  const result = await page.evaluate(() => {
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const overflow = [...document.querySelectorAll('.brand, .clock, .visitor, .weather, .search-box, .tag-filter, .resource-card')]
      .filter(visible).filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className);
    const inputWidth = document.querySelector('#query').getBoundingClientRect().width;
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, overflow, inputWidth };
  });
  assert.ok(result.pageWidth <= result.viewport + 1, `${label}: page overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.overflow, [], `${label}: component overflow`);
  assert.ok(result.inputWidth >= 90, `${label}: search input too narrow (${result.inputWidth}px)`);
}
async function brand(source, custom = false) {
  const logos = page.locator('[data-brand-logo]');
  for (let i = 0; i < await logos.count(); i++) {
    await expect(logos.nth(i)).toHaveAttribute('data-custom-logo', String(custom));
    await expect(logos.nth(i).locator('img')).toHaveAttribute('src', source);
  }
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', custom ? source : '/brand/favicon.svg');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', custom ? source : '/brand/apple-touch-icon.png');
}
async function saveSettings() {
  const saved = page.waitForResponse(response => response.url() === base + '/api/admin/document' && response.request().method() === 'PUT');
  await page.locator('#settings-form').getByRole('button', { name: '保存设置' }).click();
  assert.equal((await saved).status(), 200);
}
try {
  for (const theme of ['porcelain', 'sky', 'classic', 'graphite', 'forest']) {
    updateDocument(doc => { doc.settings.theme = theme; });
    await home();
    await brand(['classic', 'graphite'].includes(theme) ? '/brand/logo-inverse.svg' : '/brand/logo.svg');
    for (const width of [320, 390, 768, 820, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await geometry(`${theme} ${width}`);
      await page.locator('#query').fill('一个较长的搜索词');
      await page.locator('#visitor-ip').click();
      await geometry(`${theme} ${width} with query and IP`);
      await page.locator('#query').fill('');
      await page.locator('#visitor-ip').click();
      if ([390, 1440].includes(width)) await shot(`home-${theme}-${width}`);
    }
  }
  updateDocument(doc => { doc.settings.theme = 'porcelain'; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await home();
  const query = page.locator('#query');
  await page.getByRole('radio', { name: '网页', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '应用', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#search-engine-field')).toBeHidden();
  await query.fill('ai');
  await expect(page.locator('.resource-card')).toHaveCount(1);
  await expect(query).toHaveAttribute('aria-expanded', 'true');
  await query.press('ArrowDown');
  await expect(query).toHaveAttribute('aria-activedescendant', 'suggestion-0');
  await query.press('Enter');
  await expect(page.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(query).toHaveValue('');
  await expect(query).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#results-status')).toHaveText('1 / 6 个');
  await page.locator('#reset-filters').click();
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await query.fill('GitHub');
  await query.press('ArrowUp');
  await expect(query).toHaveAttribute('aria-activedescendant', 'suggestion-0');
  const popupPromise = context.waitForEvent('page');
  await query.press('Enter');
  const popup = await popupPromise;
  await popup.waitForURL('https://github.com/');
  await popup.close();
  await query.fill('Git');
  await query.press('Escape');
  await expect(query).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#clear-search').click();
  await page.locator('#category-filter').selectOption('category-0');
  await query.fill('Git');
  await page.locator('#clear-search').click();
  await expect(page.locator('#category-filter')).toHaveValue('category-0');
  await expect(page.locator('.resource-card')).toHaveCount(2);
  await page.locator('#reset-filters').click();
  await query.fill('没有这个资源');
  await page.locator('#content').getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await page.locator('#bookmarks-tab').click();
  await expect(page.getByRole('radio', { name: '书签', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-tag="tag-4"] .tag-count')).toHaveText('4');
  await page.getByRole('radio', { name: '书签', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#search-engine-field')).toBeVisible();
  await page.locator('#search-engine').selectOption('bing');
  await query.fill('design & logo');
  await expect(query).toHaveAttribute('aria-expanded', 'false');
  const searchPopup = context.waitForEvent('page');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  const searchPage = await searchPopup;
  await searchPage.waitForURL('https://www.bing.com/search?q=design%20%26%20logo');
  await searchPage.close();

  await page.route('**/api/weather?*', route => route.fulfill({ status: 503, json: { error: 'Weather unavailable' } }), { times: 1 });
  await page.locator('#weather-city').click();
  await page.locator('#city-automatic').click();
  await expect(page.locator('#weather-value')).toHaveText('天气暂不可用');
  await page.locator('#weather-city').click();
  await page.locator('#city-automatic').click();
  await expect(page.locator('#weather-value')).toContainText('25°C');

  const original = structuredClone(app.locals.database.read().document);
  updateDocument(doc => {
    doc.settings.siteName = 'MyNavigationWorkspaceWithAVeryLongUnbrokenTitle';
    doc.tags[0].name = '人工智能与自动化研究资料';
    doc.tags[1].name = 'DevelopmentAndCollaborationResources';
    doc.categories[0].name = '开发工具与个人基础设施管理';
    doc.entries[0].name = 'ApplicationWithAnExceptionallyLongUnbrokenName';
    doc.entries[0].description = '长期使用的资源描述，包含多种服务入口、协作工具与参考资料。';
  });
  await home();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); await geometry('long content ' + width); }
  await shot('long-content');
  updateDocument(doc => Object.assign(doc, original));

  updateDocument(doc => {
    doc.settings.appearances.porcelain.overview.color = '#25272b';
    doc.settings.appearances.porcelain.overview.text = '#f1f3f5';
  });
  await home();
  await expect(page.locator('.topbar [data-brand-logo] img')).toHaveAttribute('src', '/brand/logo-inverse.svg');
  await expect(page.locator('footer [data-brand-logo] img')).toHaveAttribute('src', '/brand/logo.svg');
  updateDocument(doc => Object.assign(doc, original));

  const setup = await page.request.post(base + '/api/auth/setup', { headers: { 'x-navigation-request': '1' }, data: { username: 'appearance-test', password: 'Appearance-test-only-2026!' } });
  assert.equal(setup.status(), 200);
  await page.goto(base + '/admin.html#settings');
  await page.locator('#settings-form').waitFor();
  const uploaded = await sharp({ create: { width: 120, height: 120, channels: 4, background: '#d89020' } }).png().toBuffer();
  await page.locator('#logo-file').setInputFiles({ name: 'custom-brand.png', mimeType: 'image/png', buffer: uploaded });
  await expect(page.locator('#site-logo-input')).toHaveValue(/^\/uploads\//);
  const custom = await page.locator('#site-logo-input').inputValue();
  await page.locator('#site-name-input').fill('品牌测试站');
  await saveSettings();
  await brand(custom, true);
  await home();
  await brand(custom, true);
  await expect(page).toHaveTitle('品牌测试站');
  await page.goto(base + '/admin.html#settings');
  await page.locator('#logout').click();
  await page.reload();
  await page.locator('#auth-title').filter({ hasText: '欢迎回来' }).waitFor();
  await brand(custom, true);
  await expect(page).toHaveTitle('管理后台 · 品牌测试站');
  await shot('admin-login');
  await page.locator('#username').fill('appearance-test');
  await page.locator('#password').fill('Appearance-test-only-2026!');
  await page.locator('#auth-submit').click();
  await page.locator('#settings-form').waitFor();
  await page.locator('#remove-logo').click();
  await saveSettings();
  await brand('/brand/logo.svg');
  await page.locator('#site-logo-input').fill('/assets/missing-logo.png');
  await saveSettings();
  await brand('/brand/logo.svg');
  await home();
  await brand('/brand/logo.svg');

  // A slow old image must never overwrite a newer logo, including a timed-out load.
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { started = resolve; });
  let finished;
  const complete = new Promise(resolve => { finished = resolve; });
  await page.route('**/assets/slow-brand.png', async route => { started(); await held; await route.fulfill({ contentType: 'image/png', body: uploaded }); finished(); });
  const applyLogo = logo => page.evaluate(async logo => { const { applyBrand } = await import('/ui.js'); applyBrand({ siteName: '品牌测试站', logo }); }, logo);
  await applyLogo('/assets/slow-brand.png');
  await pending;
  await applyLogo(custom);
  await brand(custom, true);
  const slowFinished = page.waitForEvent('requestfinished', request => request.url() === base + '/assets/slow-brand.png');
  release();
  await complete;
  await slowFinished;
  await brand(custom, true);
  await applyLogo('');
  await brand('/brand/logo.svg');

  await page.clock.install();
  let releaseTimeout, timeoutStarted;
  const timeoutHeld = new Promise(resolve => { releaseTimeout = resolve; });
  const timeoutPending = new Promise(resolve => { timeoutStarted = resolve; });
  let timeoutFinished;
  const timeoutComplete = new Promise(resolve => { timeoutFinished = resolve; });
  await page.route('**/assets/timeout-brand.png', async route => { timeoutStarted(); await timeoutHeld; await route.fulfill({ contentType: 'image/png', body: uploaded }); timeoutFinished(); });
  await applyLogo('/assets/timeout-brand.png');
  await timeoutPending;
  await page.clock.runFor(5100);
  const timedOutFinished = page.waitForEvent('requestfinished', request => request.url() === base + '/assets/timeout-brand.png');
  releaseTimeout();
  await timeoutComplete;
  await timedOutFinished;
  await page.clock.runFor(100);
  await brand('/brand/logo.svg');

  for (const [name, size] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    const response = await page.request.get(base + '/brand/' + name);
    assert.equal(response.status(), 200);
    const metadata = await sharp(await response.body()).metadata();
    assert.equal(metadata.width, size); assert.equal(metadata.height, size);
  }
  assert.deepEqual(errors, []);
  console.log('Appearance checks passed: five themes at six widths, keyboard search, filters, weather recovery, long content, brand upload/removal/fallback/races, login branding and icon assets.');
} catch (error) { await shot('failure'); console.error('Page errors:', errors); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); app.locals.database.close(); await fs.rm(directory, { recursive: true, force: true }); }
