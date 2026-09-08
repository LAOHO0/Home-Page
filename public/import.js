import { createClientId, normalizeWebUrl } from './model.js';

export const importByteLimit = 5 * 1024 * 1024;
const columns = new Map([
  ['url', 'url'], ['网址', 'url'], ['链接', 'url'], ['name', 'name'], ['title', 'name'], ['名称', 'name'], ['标题', 'name'],
  ['description', 'description'], ['描述', 'description'], ['简介', 'description'], ['category', 'category'], ['folder', 'category'], ['分类', 'category'],
  ['tags', 'tags'], ['标签', 'tags'],
]);
function parseCsv(text, delimiter) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  function field() { row.push(cell); cell = ''; closed = false; }
  function line() { field(); if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > 2001) throw Error('单次最多导入 2000 项，请分批导入。'); }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === delimiter) field();
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[i + 1] === '\n') i++; line(); }
    else if (char === '"') { if (cell.trim() || closed) throw Error('CSV 引号位置不正确。'); cell = ''; quoted = true; }
    else if (closed) { if (char.trim()) throw Error('CSV 引号后缺少分隔符。'); }
    else cell += char;
  }
  if (quoted) throw Error('CSV 引号未闭合。');
  if (cell || row.length || closed) line();
  return rows;
}
function folderHeading(list) {
  for (let node = list; node; node = node.parentElement) {
    let previous = node.previousElementSibling;
    while (previous?.tagName === 'P') previous = previous.previousElementSibling;
    const heading = previous?.tagName === 'H3' ? previous : previous?.querySelector(':scope > h3');
    if (heading) return heading;
  }
  return null;
}
export function parseImportSource(value, format = 'auto') {
  const text = String(value).replace(/^\uFEFF/, '').trim();
  if (!text) throw Error('请选择文件或粘贴需要导入的内容。');
  if (new TextEncoder().encode(text).length > importByteLimit) throw Error('导入内容不能超过 5 MB。');
  const firstLine = text.split(/\r?\n/, 1)[0], delimiter = firstLine.includes('\t') ? '\t' : ',';
  const csv = format === 'csv' || format === 'tsv' || /(?:^|[,\t])\s*"?(?:url|网址|链接)"?\s*(?:[,\t]|$)/i.test(firstLine);
  let records;
  if (format === 'html' || (format === 'auto' && !csv && text.startsWith('<') && /<(?:!DOCTYPE\s+NETSCAPE|dl\b|a\s)/i.test(text))) {
    // Template contents stay inert: never attach the imported markup to the page.
    const template = document.createElement('template'); template.innerHTML = text;
    records = [...template.content.querySelectorAll('a[href]')].map(anchor => {
      const list = anchor.closest('dl');
      const heading = folderHeading(list);
      const next = anchor.closest('dt')?.nextElementSibling;
      return { name: anchor.textContent.trim(), url: anchor.getAttribute('href'), category: heading?.textContent.trim() || '',
        description: next?.tagName === 'DD' ? next.textContent.trim() : '', tags: anchor.getAttribute('tags') || '',
      };
    });
  } else if (csv) {
    const rows = parseCsv(text, delimiter), header = rows.shift()?.map(value => columns.get(value.trim().toLocaleLowerCase())) || [];
    if (!header.includes('url')) throw Error('CSV 需要“网址”或“url”列。');
    records = rows.map(row => {
      const record = {};
      header.forEach((key, index) => { if (key) record[key] = row[index] || ''; });
      return record;
    });
  } else records = text.split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => ({ url }));
  if (records.length > 2000) throw Error('单次最多导入 2000 项，请分批导入。');
  if (!records.length) throw Error('没有找到可导入的资源。');
  return records;
}
const nameKey = name => name.toLocaleLowerCase();
export function prepareImport(current, records, type) {
  if (!['apps', 'bookmarks'].includes(type)) throw Error('请选择导入为应用或书签。');
  if (records.length > 2000) throw Error('单次最多导入 2000 项，请分批导入。');
  const document = structuredClone(current), rows = [];
  const counts = { added: 0, duplicate: 0, invalid: 0, categories: 0, tags: 0 };
  const urls = new Set(document.entries.filter(entry => entry.type === type).map(entry => new URL(entry.url).href));
  const categories = new Map(document.categories.map(item => [nameKey(item.name), item.id]));
  const tags = new Map(document.tags.map(item => [nameKey(item.name), item.id]));
  for (const record of records) {
    const row = { name: String(record.name || '').trim(), url: normalizeWebUrl(record.url), description: String(record.description || '').trim(), category: String(record.category || '').trim(),
      tags: [...new Set((Array.isArray(record.tags) ? record.tags : String(record.tags || '').split(/[,;；|]/)).map(value => String(value).trim()).filter(Boolean))], status: 'invalid', reason: '',
    };
    rows.push(row);
    let url;
    try {
      url = new URL(row.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
    } catch { row.reason = '网址必须是有效且不含账号密码的 HTTP(S) 地址'; counts.invalid++; continue; }
    if (!row.name) row.name = url.hostname;
    if (row.name.length > 80 || row.description.length > 200 || row.url.length > 2000 || row.category.length > 40 || row.tags.length > 30 || row.tags.some(tag => tag.length > 40)) {
      row.reason = '名称、描述、网址、分类或标签超过长度限制'; counts.invalid++; continue;
    }
    if (urls.has(url.href)) { row.status = 'duplicate'; row.reason = '同类型中已有此网址'; counts.duplicate++; continue; }
    const newCategory = row.category && !categories.has(nameKey(row.category));
    const newTags = [...new Map(row.tags.filter(name => !tags.has(nameKey(name))).map(name => [nameKey(name), name])).values()];
    if (document.entries.length >= 2000 || document.categories.length + Number(!!newCategory) > 100 || document.tags.length + newTags.length > 200) {
      row.reason = '超出站点容量（2000 个资源、100 个分类、200 个标签）'; counts.invalid++; continue;
    }
    if (newCategory) {
      const category = { id: createClientId(), name: row.category }; document.categories.push(category); categories.set(nameKey(category.name), category.id); counts.categories++;
    }
    for (const name of newTags) { const tag = { id: createClientId(), name }; document.tags.push(tag); tags.set(nameKey(name), tag.id); counts.tags++; }
    const entry = { id: createClientId(), type, name: row.name, description: row.description, url: row.url, icon: '', categoryId: categories.get(nameKey(row.category)) || '', tagIds: [...new Set(row.tags.map(name => tags.get(nameKey(name))))] };
    document.entries.push(entry); urls.add(url.href);
    row.status = 'ready'; row.reason = '可导入'; row.entryId = entry.id; counts.added++;
  }
  return { document, rows, counts };
}
