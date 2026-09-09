import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../src/app.js';

const entries = [
  { id: 'app-one', type: 'apps', name: '开发, "工具"', url: 'https://example.com/?a=1&b=2', description: '第一行\n第二行', icon: '/assets/github.png', categoryId: 'dev', tagIds: ['code', 'read'] },
  { id: 'app-two', type: 'apps', name: '云服务', url: 'https://example.org/', description: '云端工作', icon: '/assets/cloudflare.png', categoryId: 'work', tagIds: ['code'] },
  { id: 'bookmark-one', type: 'bookmarks', name: '参考 <资料>', url: 'https://example.net/', description: '阅读收藏', icon: '/assets/mdn.png', categoryId: 'dev', tagIds: ['read'] },
];

test('resource management works through the browser and persists through the real API', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-resources-'));
  const app = await createApp({ dataDir: directory, initialPassword: undefined });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.database.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = context.request;
  const headers = { 'x-navigation-request': '1' };
  assert.equal((await request.post(base + '/api/auth/setup', { headers, data: { username: 'resource-test', password: 'Resources-browser-2026!' } })).status(), 200);
  const read = async () => (await request.get(base + '/api/public-data')).json();
  const row = id => page.locator(`#entry-list [data-id="${id}"]`);
  const select = id => row(id).locator('.entry-select');
  const reset = async () => {
    const current = await read();
    current.document.categories = [{ id: 'dev', name: '开发 & 设计' }, { id: 'work', name: '效率' }];
    current.document.tags = [{ id: 'code', name: '代码' }, { id: 'read', name: '阅读' }];
    current.document.entries = structuredClone(entries);
    assert.equal((await request.put(base + '/api/admin/document', { headers, data: current })).status(), 200);
    // A changed query forces a document load; hash-only navigation keeps the old snapshot.
    await page.goto(base + `/admin.html?revision=${current.revision}#apps`);
    await expect(row('app-one')).toBeVisible();
  };
  const download = async (format, scope) => {
    await page.locator('#bulk-export').click();
    await page.locator('#export-format').selectOption(format);
    if (scope) await page.locator('#export-scope').selectOption(scope);
    const pending = page.waitForEvent('download');
    await page.locator('#export-form button[type="submit"]').click();
    const file = await pending;
    assert.ok(file.suggestedFilename().endsWith('.' + format));
    return fs.readFile(await file.path());
  };

  await t.test('editing a resource moves it in both directions while preserving its metadata', async () => {
    await reset();
    await row('app-two').getByRole('button', { name: '编辑云服务', exact: true }).click();
    await expect(page.locator('#entry-type')).toHaveValue('apps');
    await page.locator('#entry-type').selectOption('bookmarks');
    await page.locator('#entry-form button[type="submit"]').click();
    await expect(row('app-two')).toHaveCount(0);
    assert.deepEqual((await read()).document.entries.find(entry => entry.id === 'app-two'), { ...entries[1], type: 'bookmarks' });
    await page.locator('a[data-page="bookmarks"]').click();
    await row('app-two').getByRole('button', { name: '编辑云服务', exact: true }).click();
    await expect(page.locator('#entry-type')).toHaveValue('bookmarks');
    await page.locator('#entry-type').selectOption('apps');
    await page.locator('#entry-form button[type="submit"]').click();
    await expect(row('app-two')).toHaveCount(0);
    assert.deepEqual((await read()).document.entries, entries);
    await page.reload();
    await page.locator('a[data-page="apps"]').click();
    await expect(row('app-two')).toBeVisible();
  });

  await t.test('type-only edits preserve an empty icon and a multiline description', async subtest => {
    await reset();
    const current = await read(), original = { ...entries[0], icon: '' };
    current.document.entries[0] = original;
    assert.equal((await request.put(base + '/api/admin/document', { headers, data: current })).status(), 200);
    await page.reload();
    await page.route('**/api/admin/favicon', route => route.fulfill({ json: { url: '/assets/github.png' } }));
    subtest.after(() => page.unroute('**/api/admin/favicon'));
    await row('app-one').getByRole('button', { name: '编辑' + original.name, exact: true }).click();
    await page.locator('#entry-type').selectOption('bookmarks');
    await page.locator('#entry-form button[type="submit"]').click();
    await expect(row('app-one')).toHaveCount(0);
    assert.deepEqual((await read()).document.entries.find(entry => entry.id === 'app-one'), { ...original, type: 'bookmarks' });
  });

  await t.test('selection follows the filter and bulk transfers preserve all other resources', async () => {
    await reset();
    await page.locator('#select-all-entries').check();
    await expect(page.locator('.entry-select:checked')).toHaveCount(2);
    await page.locator('#manage-query').fill('云');
    await expect(page.locator('.entry-select:checked')).toHaveCount(1);
    await page.locator('#invert-selection').click();
    await expect(page.locator('#bulk-transfer')).toBeDisabled();
    await page.locator('#select-all-entries').check();
    await page.locator('#bulk-transfer').click(); await page.locator('#confirm-cancel').click();
    assert.deepEqual((await read()).document.entries, entries);
    await page.locator('#bulk-transfer').click(); await page.locator('#confirm-ok').click();
    await expect(row('app-two')).toHaveCount(0);
    await expect(page.locator('#apps-count')).toHaveText('1');
    await expect(page.locator('#bookmarks-count')).toHaveText('2');
    assert.deepEqual((await read()).document.entries, [entries[0], { ...entries[1], type: 'bookmarks' }, entries[2]]);
    await page.locator('a[data-page="bookmarks"]').click();
    await expect(page.locator('#bulk-transfer')).toBeDisabled();
    await expect(page.locator('#bulk-transfer')).toHaveText('转为应用');
    await select('app-two').check();
    await page.locator('#bulk-transfer').click(); await page.locator('#confirm-ok').click();
    await expect(row('app-two')).toHaveCount(0);
    assert.deepEqual((await read()).document.entries, entries);
  });

  await t.test('exports download the selected, filtered, current-page or all resources', async () => {
    await reset(); await select('app-one').check();
    const selected = JSON.parse((await download('json', 'selected')).toString());
    assert.deepEqual(selected, [{ ...entries[0], category: '开发 & 设计', tags: ['代码', '阅读'] }]);
    await page.locator('#manage-query').fill('云');
    const csv = await download('csv', 'filtered');
    assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(csv.toString(), /apps,云服务,https:\/\/example.org\//);
    assert.doesNotMatch(csv.toString(), /参考|第一行/);
    const currentPage = JSON.parse((await download('json', 'page')).toString());
    assert.deepEqual(currentPage.map(entry => entry.id), ['app-one', 'app-two']);
    const html = (await download('html', 'all')).toString();
    assert.match(html, /NETSCAPE-Bookmark-file-1/);
    assert.match(html, /开发 &amp; 设计/);
    assert.match(html, /参考 &lt;资料&gt;/);
    assert.equal((html.match(/<DT><A /g) || []).length, 3);
    assert.deepEqual((await read()).document.entries, entries);
  });

  await t.test('a conflicting bulk save preserves the newer document and the pending selection', async () => {
    await reset(); await select('app-one').check();
    const concurrent = await read(); concurrent.document.entries[1].name = '另一窗口已修改';
    assert.equal((await request.put(base + '/api/admin/document', { headers, data: concurrent })).status(), 200);
    await page.locator('#bulk-transfer').click();
    const pending = page.waitForResponse(response => response.url().endsWith('/api/admin/document') && response.request().method() === 'PUT');
    await page.locator('#confirm-ok').click(); assert.equal((await pending).status(), 409);
    await expect(page.locator('#toast.is-error')).toBeVisible();
    await expect(select('app-one')).toBeChecked();
    await expect(page.locator('#bulk-transfer')).toBeEnabled();
    assert.deepEqual((await read()).document, concurrent.document);
  });

  await t.test('bulk deletion requires confirmation and removes only checked resources', async () => {
    await reset(); await select('app-two').check();
    await page.locator('#bulk-delete').click(); await page.locator('#confirm-cancel').click();
    assert.deepEqual((await read()).document.entries, entries);
    await page.locator('#bulk-delete').click(); await page.locator('#confirm-ok').click();
    await expect(row('app-two')).toHaveCount(0);
    assert.deepEqual((await read()).document.entries, [entries[0], entries[2]]);
    await expect(page.locator('#bulk-delete')).toBeDisabled();
  });

  await t.test('empty filters and small screens keep the controls usable', async () => {
    await reset(); await select('app-one').check();
    await page.locator('#manage-query').fill('没有这个资源');
    await expect(page.locator('#select-all-entries')).toBeDisabled();
    await expect(page.locator('#bulk-transfer')).toBeDisabled();
    await expect(page.locator('#bulk-export')).toBeEnabled();
    await page.locator('#bulk-export').click();
    await page.locator('#export-scope').selectOption('all');
    await expect(page.locator('#export-form button[type="submit"]')).toBeEnabled();
    await page.locator('#export-dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('#manage-query').fill('');
    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}px`);
    }
    await fs.mkdir('test-results', { recursive: true });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.screenshot({ path: 'test-results/resources-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await select('app-one').check();
    await page.screenshot({ path: 'test-results/resources-desktop.png', fullPage: true });
    const empty = await read(); empty.document.entries = [];
    assert.equal((await request.put(base + '/api/admin/document', { headers, data: empty })).status(), 200);
    await page.reload();
    await expect(page.locator('#bulk-export')).toBeDisabled();
    assert.deepEqual(errors, []);
  });
});
