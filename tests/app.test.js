import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createWeatherService, isPublicIp } from '../src/weather.js';
import { filterEntries, createDefaultDocument } from '../public/model.js';
import { documentSchema } from '../src/schema.js';

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
