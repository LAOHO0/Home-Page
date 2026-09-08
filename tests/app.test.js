import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createWeatherService, isPublicIp } from '../src/weather.js';
import { filterEntries, createDefaultDocument, createClientId, normalizeWebUrl } from '../public/model.js';
import { documentSchema } from '../src/schema.js';
import { parseImportSource, prepareImport } from '../public/import.js';

test('bulk import previews CSV and text, skips duplicate or unsafe URLs and appends without replacing data', () => {
  const original = createDefaultDocument(), before = structuredClone(original);
  const csv = '\ufeff名称,网址,描述,分类,标签\r\n"示例,工具",example.com,"第一行\n第二行",资料,开发;新标签\r\n重复,https://example.com/,,,\r\n已有,https://github.com,,,\r\n不安全,javascript:alert(1),,,\r\n凭据,https://a:b@example.org,,,\r\n文档,docs.example.org,,,\r\n';
  const plan = prepareImport(original, parseImportSource(csv), 'apps');
  assert.deepEqual(plan.counts, { added: 2, duplicate: 2, invalid: 2, categories: 1, tags: 1 });
  assert.deepEqual(original, before); assert.deepEqual(plan.document.settings, before.settings);
  assert.deepEqual(plan.document.entries.slice(0, before.entries.length), before.entries);
  const added = plan.document.entries.slice(before.entries.length);
  assert.equal(added[0].name, '示例,工具'); assert.equal(added[0].url, 'https://example.com');
  assert.equal(added[0].description, '第一行\n第二行'); assert.equal(added[0].tagIds.length, 2);
  assert.equal(plan.document.categories.find(item => item.id === added[0].categoryId).name, '资料');
  assert.doesNotThrow(() => documentSchema.parse(plan.document));
  const bookmarks = prepareImport(plan.document, parseImportSource('github.com\n\n example.com \nnot a url'), 'bookmarks');
  assert.equal(bookmarks.counts.added, 2); assert.equal(bookmarks.counts.invalid, 1);
  assert.equal(bookmarks.document.entries.at(-1).type, 'bookmarks');
  assert.throws(() => parseImportSource('name,url\n"unfinished,example.com', 'csv'), /引号/);
});

async function faviconServer(t, network) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-favicon-'));
  const app = await createApp({ dataDir: directory, initialUsername: 'favicon-test', initialPassword: 'Favicon-test-only-2026!', faviconNetwork: {
    lookup: async () => [{ address: '93.184.215.14', family: 4 }], ...network,
  } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.database.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'x-navigation-request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'favicon-test', password: 'Favicon-test-only-2026!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return (route, options = {}) => fetch(base + route, { ...options, headers: { Cookie: cookie, 'x-navigation-request': '1', 'Content-Type': 'application/json', ...options.headers } });
}

test('CSV descriptions containing HTML stay plain text and import limits are previewed', () => {
  const csv = 'name,url,description\nExample,example.com,"<a href=""https://other.example"">说明</a>"';
  for (const format of ['auto', 'csv']) {
    const records = parseImportSource(csv, format);
    assert.equal(records[0].url, 'example.com'); assert.equal(records[0].description, '<a href="https://other.example">说明</a>');
  }
  const full = createDefaultDocument();
  full.entries = Array.from({ length: 1999 }, (_, index) => ({ ...full.entries[0], id: 'full-' + index, url: 'https://existing.example/' + index }));
  const plan = prepareImport(full, [{ url: 'one.example', category: '可创建' }, { url: 'two.example', category: '不应创建' }], 'apps');
  assert.equal(plan.counts.added, 1); assert.equal(plan.counts.invalid, 1); assert.equal(plan.document.entries.length, 2000);
  assert.equal(plan.document.categories.some(category => category.name === '不应创建'), false);
  assert.throws(() => parseImportSource('x'.repeat(5 * 1024 * 1024 + 1)), /5 MB/);
  assert.throws(() => parseImportSource(Array.from({ length: 2001 }, () => 'example.com').join('\n')), /2000/);
});

test('favicon endpoint stores a site image as WebP and returns a reusable upload URL', async t => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#2d996a' } }).png().toBuffer();
  const call = await faviconServer(t, { request: async url => new Response(url.href === 'https://example.com/favicon.ico' ? png : null, { status: url.href === 'https://example.com/favicon.ico' ? 200 : 404 }) });
  const response = await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/path?q=1' }) });
  assert.equal(response.status, 200);
  const { url } = await response.json(); assert.match(url, /^\/uploads\/[a-f0-9-]{36}\.webp$/);
  const image = await call(url); assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /image\/webp/);
  assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'webp');
  const current = await (await call('/api/public-data')).json(); current.document.entries[0].icon = url;
  assert.equal((await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(current) })).status, 200);
  assert.ok((await (await call('/api/admin/export')).json()).assets[url]);
});

test('favicon providers fall back in order and total failure still permits saving', async t => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#4052ca' } }).png().toBuffer();
  const sources = ['https://example.com/favicon.ico', 'https://www.google.com/s2/favicons?domain=example.com&sz=64', 'https://icons.duckduckgo.com/ip3/example.com.ico'];
  for (const winner of [0, 1, 2, 3]) {
    const attempts = [];
    const call = await faviconServer(t, { request: async url => {
      attempts.push(url.href);
      if (url.href === sources[winner]) return new Response(png);
      if (url.hostname === 'example.com') throw Error('network unavailable');
      return new Response('<html>not an icon</html>');
    } });
    const result = await (await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/docs' }) })).json();
    assert.deepEqual(attempts, sources.slice(0, Math.min(winner + 1, 3)));
    if (winner < 3) assert.match(result.url, /^\/uploads\//);
    else {
      assert.deepEqual(result, { url: '' });
      const current = await (await call('/api/public-data')).json();
      current.document.entries.push({ ...current.document.entries[0], id: 'no-favicon', name: 'No icon', icon: result.url });
      assert.equal((await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(current) })).status, 200);
    }
  }
});

test('favicon endpoint converts both PNG and bitmap images inside ICO containers', async t => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#669933' } }).png().toBuffer();
  const bitmap = Buffer.alloc(48);
  bitmap.writeUInt32LE(40, 0); bitmap.writeInt32LE(1, 4); bitmap.writeInt32LE(2, 8);
  bitmap.writeUInt16LE(1, 12); bitmap.writeUInt16LE(32, 14); bitmap.writeUInt32LE(8, 20);
  bitmap.set([0x33, 0x99, 0x66, 0xff], 40);
  for (const [width, payload] of [[16, png], [1, bitmap]]) {
    const ico = Buffer.alloc(22 + payload.length);
    ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = width; ico[7] = width;
    ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(payload.length, 14); ico.writeUInt32LE(22, 18); payload.copy(ico, 22);
    const call = await faviconServer(t, { request: async url => new Response(url.hostname === 'example.com' ? ico : null, { status: url.hostname === 'example.com' ? 200 : 404 }) });
    const result = await (await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })).json();
    assert.match(result.url, /^\/uploads\//);
    const meta = await sharp(Buffer.from(await (await call(result.url)).arrayBuffer())).metadata();
    assert.equal(meta.format, 'webp'); assert.equal(meta.width, width); assert.equal(meta.height, width);
  }
});

test('favicon endpoint keeps authentication and URL validation and rejects private destinations', async t => {
  const attempts = [];
  const call = await faviconServer(t, { lookup: async () => [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }], request: async url => { attempts.push(url.href); return new Response(''); } });
  const options = { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) };
  assert.equal((await call('/api/admin/favicon', { ...options, headers: { Cookie: '' } })).status, 401);
  assert.equal((await call('/api/admin/favicon', { ...options, headers: { 'x-navigation-request': '' } })).status, 403);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.com', 'example.com']) {
    assert.equal((await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url }) })).status, 400);
  }
  for (const url of ['http://127.0.0.1', 'http://2130706433', 'http://169.254.169.254', 'http://10.0.0.1', 'http://[::1]', 'http://[::ffff:7f00:1]', 'http://localhost', 'http://printer.local', 'http://example.com']) {
    const response = await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { url: '' });
  }
  assert.deepEqual(attempts, []);
});

test('favicon redirects recheck DNS and cannot cross into private networks', async t => {
  let lookups = 0; const attempts = [];
  const call = await faviconServer(t, {
    lookup: async () => [{ address: ++lookups === 1 ? '93.184.215.14' : '127.0.0.1', family: 4 }],
    request: async (url, options) => { attempts.push({ url: url.href, address: options.address }); return new Response(null, { status: 302, headers: { location: '/redirected.ico' } }); },
  });
  assert.deepEqual(await (await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })).json(), { url: '' });
  assert.deepEqual(attempts, [{ url: 'https://example.com/favicon.ico', address: '93.184.215.14' }]);
});

test('favicon endpoint rejects oversized and malformed image payloads', async t => {
  for (const body of [Buffer.alloc(2 * 1024 * 1024 + 1), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>'), Buffer.from([0, 0, 1, 0, 255, 255])]) {
    const call = await faviconServer(t, { request: async () => new Response(body) });
    assert.deepEqual(await (await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })).json(), { url: '' });
  }
});

test('favicon endpoint eventually returns an empty URL when every provider stalls', async t => {
  const call = await faviconServer(t, { request: () => new Promise(() => {}) });
  const started = Date.now();
  const response = await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { url: '' });
  assert.ok(Date.now() - started < 15000, 'resource saving must not wait indefinitely for an icon');
});

test('bulk favicon requests cannot exhaust the resource saving rate limit', async t => {
  const call = await faviconServer(t, { request: async () => new Response(null, { status: 404 }) });
  let limited = 0;
  for (let i = 0; i < 185; i++) {
    const response = await call('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) });
    if (response.status === 429) limited++; await response.json();
  }
  assert.ok(limited > 0, 'favicon traffic has its own limit');
  const data = await call('/api/public-data'); assert.equal(data.status, 200);
  const current = await data.json();
  current.document.entries.push({ ...current.document.entries[0], id: 'bulk-after-icons', icon: '' });
  assert.equal((await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(current) })).status, 200);
});

test('client IDs work with secure, HTTP-only and legacy browser crypto', () => {
  const uuid = 'ce9c614e-ff7b-4ee8-990f-c57c751d02a0';
  assert.equal(createClientId({ randomUUID: () => uuid }), uuid);
  assert.equal(createClientId({ getRandomValues: bytes => bytes.fill(0) }), '00000000-0000-4000-8000-000000000000');
  for (const cryptoApi of [{}, { randomUUID() { throw Error('unavailable'); }, getRandomValues() { throw Error('unavailable'); } }]) {
    const ids = Array.from({ length: 500 }, () => createClientId(cryptoApi));
    assert.equal(new Set(ids).size, 500);
    assert.ok(ids.every(id => /^[a-zA-Z0-9_-]{1,80}$/.test(id)));
  }
});

test('web URLs accept bare domains without disguising unsafe schemes or credentials', () => {
  const cases = [
    [' example.com ', 'https://example.com'], ['example.com:8080/path', 'https://example.com:8080/path'],
    ['//example.com/path', 'https://example.com/path'], ['HTTP://example.com/a?x=1#b', 'HTTP://example.com/a?x=1#b'],
    ['https://example.com', 'https://example.com'], ['', ''],
    ['javascript:alert(1)', 'javascript:alert(1)'], ['javascript:123', 'javascript:123'], ['data:123', 'data:123'],
    ['ftp://example.com', 'ftp://example.com'], ['/relative', '/relative'],
  ];
  for (const [input, expected] of cases) assert.equal(normalizeWebUrl(input), expected);
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,test', 'ftp://example.com', 'https://user:password@example.com']) {
    const doc = createDefaultDocument(); doc.entries[0].url = normalizeWebUrl(unsafe);
    assert.equal(documentSchema.safeParse(doc).success, false);
  }
});

test('legacy themes migrate without losing customization and invalid layouts are rejected', () => {
  const legacy = createDefaultDocument();
  delete legacy.settings.appearances.classic;
  for (const appearance of Object.values(legacy.settings.appearances)) {
    delete appearance.style; delete appearance.layout;
  }
  legacy.settings.appearances.sky.page.color = '#123456';
  const migrated = documentSchema.parse(legacy);
  assert.equal(migrated.settings.appearances.sky.page.color, '#123456');
  assert.equal(migrated.settings.appearances.classic.layout.panelRadius, 28);
  assert.equal(migrated.settings.appearances.graphite.layout.resourceView, 'list');
  assert.equal(migrated.settings.appearances.forest.layout.overviewLayout, 'stacked');
  assert.equal(migrated.settings.appearances.porcelain.style, 'porcelain');
  assert.equal(migrated.settings.appearances.porcelain.card.radius, 8);
  assert.equal(legacy.settings.appearances.classic, undefined);
  migrated.settings.appearances.sky.layout.panelRadius = 32;
  assert.deepEqual(documentSchema.parse(migrated), migrated);
  migrated.settings.appearances.sky.layout.panelRadius = 999;
  assert.equal(documentSchema.safeParse(migrated).success, false);
});

test('documents from before the porcelain theme receive the new theme defaults', () => {
  const legacy = createDefaultDocument();
  delete legacy.settings.appearances.porcelain;
  const parsed = documentSchema.parse(legacy);
  assert.equal(parsed.settings.appearances.porcelain.style, 'porcelain');
  assert.equal(parsed.settings.appearances.porcelain.layout.panelRadius, 10);
  assert.equal(parsed.settings.appearances.porcelain.card.color, '#ffffff');
});

test('administrator workflows persist safely and backups include images', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-api-'));
  const weatherCalls = [];
  let fallbackWeatherAvailable = false;
  const app = await createApp({ dataDir: directory, initialPassword: undefined, weather: { visitor: async ip => ({ ip, location: null }), weather: async city => {
    weatherCalls.push(city);
    const current = fallbackWeatherAvailable && city.name === '北京' ? { temperature: 20, code: 0, isDay: true, time: '2026-09-05T12:00' } : null;
    return { city, current, unavailable: !current };
  }, cities: async () => [] } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  const call = (route, options = {}) => fetch(base + route, { ...options, headers: { 'x-navigation-request': '1', Cookie: cookie, ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.database.close(); await fs.rm(directory, { recursive: true, force: true }); });
  await t.test('setup is local, has no default password, and enforces sessions and CSRF', async () => {
    assert.equal((await (await call('/api/auth/status')).json()).setupRequired, true);
    assert.equal((await call('/api/admin/export')).status, 401);
    assert.equal((await call('/api/auth/setup', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await call('/api/auth/setup', { method: 'POST', headers: { 'X-Forwarded-For': '8.8.8.8' }, body: '{}' })).status, 403);
    const response = await call('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'test-admin', password: 'Testing-navigation-2026!' }) });
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
    cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/auth/setup', { method: 'POST', body: JSON.stringify({ username: 'x', password: 'Another-password!' }) })).status, 409);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'test-admin', password: '中文错误密码' }) })).status, 401);
  });
  let current = await (await call('/api/public-data')).json();
  await t.test('edits are atomic, validate associations, and reject stale writes', async () => {
    const original = structuredClone(current);
    current.document.entries[0].name = 'Persisted GitHub';
    let response = await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(current) }); assert.equal(response.status, 200); current = await response.json();
    assert.equal((await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(original) })).status, 409);
    const invalid = structuredClone(current); invalid.document.entries[0].url = 'javascript:alert(1)';
    assert.equal((await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(invalid) })).status, 400);
    invalid.document.entries[0].url = 'https://github.com'; invalid.document.entries[0].categoryId = 'missing-category';
    assert.equal((await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(invalid) })).status, 400);
    assert.deepEqual(await (await call('/api/public-data')).json(), current);
  });
  await t.test('valid uploads are converted and JSON export/import restores image assets', async () => {
    const image = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#23a579' } }).png().toBuffer();
    const form = new FormData(); form.append('image', new Blob([image], { type: 'image/png' }), 'sample.png');
    const response = await call('/api/admin/upload', { method: 'POST', body: form }); assert.equal(response.status, 200);
    const { url } = await response.json(); assert.equal((await call(url)).status, 200);
    current.document.settings.appearances.forest.resources.mode = 'image'; current.document.settings.appearances.forest.resources.image = url;
    current = await (await call('/api/admin/document', { method: 'PUT', body: JSON.stringify(current) })).json();
    const backup = await (await call('/api/admin/export')).json(); assert.ok(backup.assets[url]);
    const invalid = structuredClone(backup); invalid.assets[url] = Buffer.from('not an image').toString('base64');
    assert.equal((await call('/api/admin/import', { method: 'POST', body: JSON.stringify({ revision: current.revision, backup: invalid }) })).status, 400);
    assert.deepEqual(await (await call('/api/public-data')).json(), current);
    const restored = await call('/api/admin/import', { method: 'POST', body: JSON.stringify({ revision: current.revision, backup }) }); assert.equal(restored.status, 200); current = await restored.json();
    assert.notEqual(current.document.settings.appearances.forest.resources.image, url);
    assert.equal((await call(current.document.settings.appearances.forest.resources.image)).status, 200);
    const largeCollection = structuredClone(backup);
    for (let i = 0; i < 101; i++) {
      const reference = '/uploads/' + randomUUID() + '.webp'; largeCollection.assets[reference] = backup.assets[url];
      largeCollection.document.entries.push({ ...backup.document.entries[0], id: 'collection-' + i, icon: reference });
    }
    const restoredCollection = await call('/api/admin/import', { method: 'POST', body: JSON.stringify({ revision: current.revision, backup: largeCollection }) });
    assert.equal(restoredCollection.status, 200); current = await restoredCollection.json();
    const exportedCollection = await (await call('/api/admin/export')).json(); assert.equal(Object.keys(exportedCollection.assets).length, 102);
    const roundTrip = await call('/api/admin/import', { method: 'POST', body: JSON.stringify({ revision: current.revision, backup: exportedCollection }) });
    assert.equal(roundTrip.status, 200); current = await roundTrip.json();
    const malicious = new FormData(); malicious.append('image', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'pretend.png');
    assert.equal((await call('/api/admin/upload', { method: 'POST', body: malicious })).status, 400);
  });
  await t.test('private files are inaccessible and sign out invalidates the session', async () => {
    for (const route of ['/data/navigation.sqlite', '/src/app.js', '/.git/config', '/uploads/%2e%2e/navigation.sqlite']) assert.equal((await call(route)).status, 404);
    assert.equal((await call('/api/auth/logout', { method: 'POST' })).status, 200);
    assert.equal((await call('/api/admin/export')).status, 401);
  });
  await t.test('weather honors selected city and defaults without invented weather', async () => {
    const fallback = await (await call('/api/weather')).json(); assert.equal(fallback.city.name, '北京'); assert.equal(fallback.current, null);
    const manual = await (await call('/api/weather?name=上海&latitude=31.23&longitude=121.47&country=中国')).json();
    assert.equal(manual.city.name, '北京'); assert.equal(manual.requestedCity.name, '上海'); assert.equal(manual.fallback, true); assert.equal(manual.current, null);
    assert.deepEqual(weatherCalls.slice(-2).map(city => city.name), ['上海', '北京']);
    fallbackWeatherAvailable = true;
    const recovered = await (await call('/api/weather?name=上海&latitude=31.23&longitude=121.47&country=中国')).json();
    assert.equal(recovered.city.name, '北京'); assert.equal(recovered.current.temperature, 20); assert.equal(recovered.fallback, true);
    fallbackWeatherAvailable = false;
    assert.equal((await call('/api/weather?name=x&latitude=999&longitude=1')).status, 400);
  });
  await t.test('a new application instance reads the SQLite document and administrator', async () => {
    const restarted = await createApp({ dataDir: directory, initialPassword: undefined });
    assert.deepEqual(restarted.locals.database.read(), current); assert.equal(restarted.locals.database.admin().username, 'test-admin');
    restarted.locals.database.close();
  });
});

test('search respects resource type, category, tags and multi-word queries', () => {
  const doc = createDefaultDocument();
  assert.equal(filterEntries(doc, { type: 'apps', query: 'ai' })[0].name, 'ChatGPT');
  assert.equal(filterEntries(doc, { type: 'bookmarks', query: 'Web 开发' })[0].name, 'MDN');
  assert.equal(filterEntries(doc, { type: 'apps', query: '不存在' }).length, 0);
  assert.equal(filterEntries(doc, { type: 'apps', tagId: 'tag-2' }).length, 2);
});

test('geolocation and weather are bounded, cached and degrade independently', async () => {
  let calls = 0;
  const provider = createWeatherService(async url => {
    calls++;
    if (url.includes('ipwho')) return { ok: true, json: async () => ({ success: true, city: '上海', country: '中国', latitude: 31.2, longitude: 121.4, connection: { isp: 'ISP' } }) };
    return { ok: true, json: async () => ({ current: { temperature_2m: 22, weather_code: 0, is_day: 1, time: '2026-09-05T12:00' } }) };
  });
  const visitor = await provider.visitor('8.8.8.8'); assert.equal(visitor.location.name, '上海');
  await provider.visitor('8.8.8.8'); assert.equal(calls, 1);
  const weather = await provider.weather(visitor.location); assert.equal(weather.current.temperature, 22);
  await provider.weather(visitor.location); assert.equal(calls, 2);
  const failing = createWeatherService(async () => { throw Error('offline'); });
  assert.equal((await failing.visitor('8.8.8.8')).ip, '8.8.8.8');
  assert.equal((await failing.weather(visitor.location)).current, null);
  assert.equal(isPublicIp('::ffff:192.168.1.1'), false); assert.equal(isPublicIp('127.0.0.1'), false); assert.equal(isPublicIp('::1'), false);
  const localFallback = createWeatherService(async url => {
    if (url.includes('ipify')) throw Error('ECONNRESET');
    return { ok: true, json: async () => ({ success: true, ip: '8.8.8.8', city: '上海', country: '中国', latitude: 31.2, longitude: 121.4 }) };
  });
  const local = await localFallback.visitor('127.0.0.1'); assert.equal(local.ip, '8.8.8.8'); assert.equal(local.location.name, '上海'); assert.equal(local.source, 'local-egress');
});

test('weather rejects malformed provider readings', async () => {
  const city = { name: '上海', country: '中国', latitude: 31.2, longitude: 121.4 };
  const current = { temperature_2m: 22, weather_code: 0, is_day: 0, time: '2026-09-05T12:00' };
  for (const invalid of [{ is_day: 'false' }, { is_day: undefined }, { weather_code: 999 }, { time: 'invalid' }, { time: undefined }, { temperature_2m: 1000 }]) {
    const service = createWeatherService(async () => ({ ok: true, json: async () => ({ current: { ...current, ...invalid } }) }));
    const result = await service.weather(city); assert.equal(result.unavailable, true); assert.equal(result.current, null);
  }
  const service = createWeatherService(async () => ({ ok: true, json: async () => ({ current }) }));
  const result = await service.weather(city); assert.equal(result.current.isDay, false); assert.equal(result.unavailable, false);
});
