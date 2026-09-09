import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportEntries } from '../public/model.js';

const entry = { id: 'resource-1', type: 'apps', name: '开发, "工具"', url: 'https://example.com/?a=1&b=2', description: '第一行\n第二行', categoryId: 'dev', tagIds: ['code'], icon: '/assets/github.png' };
const document = { categories: [{ id: 'dev', name: '开发 & <设计>' }], tags: [{ id: 'code', name: '代码' }], entries: [entry] };

test('resource JSON preserves identifiers, metadata and resolved taxonomy names', () => {
  const original = structuredClone(document);
  assert.deepEqual(JSON.parse(exportEntries(document, [entry], 'json')), [{ ...entry, category: '开发 & <设计>', tags: ['代码'] }]);
  assert.deepEqual(document, original);
  assert.deepEqual(JSON.parse(exportEntries(document, [], 'json')), []);
});

test('CSV quotes commas, quotes and multiline text without losing Chinese characters', () => {
  assert.equal(exportEntries(document, [entry], 'csv'), 'type,name,url,description,category,tags,icon\napps,"开发, ""工具""",https://example.com/?a=1&b=2,"第一行\n第二行",开发 & <设计>,代码,/assets/github.png\n');
});

test('CSV treats formula-like resource fields as text', () => {
  for (const name of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\t=1+1']) {
    const csv = exportEntries(document, [{ ...entry, name, description: '', categoryId: '', tagIds: [], icon: '' }], 'csv');
    assert.equal(csv.split('\n')[1], `apps,'${name},https://example.com/?a=1&b=2,,,,`);
  }
});

test('bookmark HTML escapes folder names, link names, URLs and tags', () => {
  const html = exportEntries(document, [{ ...entry, name: '<script> & "收藏"' }], 'html');
  assert.match(html, /<H3>开发 &amp; &lt;设计&gt;<\/H3>/);
  assert.match(html, /HREF="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(html, /TAGS="代码"/);
  assert.match(html, /&lt;script&gt; &amp; &quot;收藏&quot;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(exportEntries(document, [{ ...entry, categoryId: '' }], 'html'), /<H3>未分类<\/H3>/);
  assert.throws(() => exportEntries(document, [entry], 'unknown'), /不支持/);
});
