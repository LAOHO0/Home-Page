import { $, icon, iconButton, installIcons, request, textElement, resourceIcon, busy, showToast, downloadJson, downloadText, cityPicker, applyBrand } from './ui.js';
import { backupByteLimit, createClientId, exportEntries, filterEntries, normalizeWebUrl } from './model.js';
import { createAppearanceEditor } from './appearance.js';
import { createBulkImportEditor } from './bulk-import.js';

let snapshot, page = 'apps', taxonomyKind = 'categories', editedId, dirty = false, setup = false, pendingBackup, settingsCity, entryDirty = false;
let sorter;
let entriesBusy = false;
let iconFetchController, iconVersion = 0, entrySaving = false, bulkDirty = false;
const selectedEntryIds = new Set();
const titles = { apps: '应用', bookmarks: '书签', taxonomy: '分类与标签', appearance: '主题与背景', settings: '站点设置', backup: '备份与迁移' };
const setDirty = value => { dirty = value; };
const api = async (...args) => { try { return await request(...args); } catch (error) { if (error.status === 401) { document.querySelectorAll('dialog[open]').forEach(x => x.close()); await checkAuth(); } throw error; } };
async function upload(file) {
  if (file.size > 5 * 1024 * 1024) throw Error('图片不能超过 5 MB。');
  const body = new FormData(); body.append('image', file); return (await api('/api/admin/upload', { method: 'POST', body })).url;
}
async function fetchIcon(url, signal = AbortSignal.timeout(12_000)) {
  return (await api('/api/admin/favicon', { method: 'POST', body: JSON.stringify({ url }), signal })).url || '';
}
async function save(value) {
  const result = await api('/api/admin/document', { method: 'PUT', body: JSON.stringify(value) }); snapshot = result; updateCounts(); return result;
}
function updateCounts() {
  $('#apps-count').textContent = snapshot.document.entries.filter(x => x.type === 'apps').length;
  $('#bookmarks-count').textContent = snapshot.document.entries.filter(x => x.type === 'bookmarks').length;
  applyBrand(snapshot.document.settings);
}
const appearance = createAppearanceEditor({ getSnapshot: () => snapshot, save, setDirty, upload });
const bulkImport = createBulkImportEditor({ getSnapshot: () => snapshot, getType: () => page, save, fetchIcon, setDirty: value => { bulkDirty = value; },
  reload: async () => { snapshot = await api('/api/public-data'); updateCounts(); renderEntries(); }, onSaved: () => renderEntries(),
});
$('#bulk-import').onclick = () => bulkImport.open();
function confirmAction(title, message) {
  const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
  return new Promise(resolve => {
    $('#confirm-ok').onclick = () => { dialog.returnValue = 'yes'; dialog.close(); };
    $('#confirm-cancel').onclick = () => { dialog.returnValue = ''; dialog.close(); };
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); dialog.returnValue = ''; dialog.showModal();
  });
}
function navigate() {
  selectedEntryIds.clear();
  page = location.hash.slice(1) in titles ? location.hash.slice(1) : 'apps';
  $('#page-title').textContent = titles[page];
  $('#admin-nav').querySelectorAll('a').forEach(a => { a.dataset.page === page ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  document.querySelectorAll('.admin-pane').forEach(pane => { pane.hidden = pane.id !== (['apps', 'bookmarks'].includes(page) ? 'entries-pane' : page + '-pane'); });
  if (['apps', 'bookmarks'].includes(page)) { $('#manage-query').value = ''; $('#add-entry').replaceChildren(icon('plus'), document.createTextNode('添加' + titles[page])); renderEntries(); }
  if (page === 'taxonomy') renderTaxonomies();
  if (page === 'appearance') appearance.open();
  if (page === 'settings') fillSettings();
  dirty = false;
}
$('#admin-nav').onclick = async event => {
  const link = event.target.closest('a'); if (!link) return; event.preventDefault();
  if (dirty && !await confirmAction('放弃未保存的修改？', '当前页面的修改尚未保存。')) return;
  dirty = false; if (location.hash === link.hash) navigate(); else location.hash = link.hash;
};
window.addEventListener('hashchange', () => {
  if (!snapshot) return;
  if (dirty && !window.confirm('当前修改尚未保存，是否放弃？')) { history.replaceState(null, '', '#' + page); return; }
  navigate();
});
window.addEventListener('beforeunload', event => { if (dirty || entryDirty || bulkDirty) { event.preventDefault(); event.returnValue = ''; } });
async function checkAuth() {
  const status = await request('/api/auth/status'); setup = status.setupRequired;
  $('#auth-view').hidden = status.authenticated; $('#admin-layout').hidden = !status.authenticated;
  if (status.authenticated) { snapshot = await api('/api/public-data'); $('#admin-username').textContent = status.username; updateCounts(); navigate(); return; }
  $('#auth-title').textContent = setup ? '设置管理员' : '欢迎回来';
  $('#auth-message').textContent = setup ? status.setupAllowed ? '创建本站管理员，密码至少 12 位。' : '请在服务器本机完成首次设置，或配置 ADMIN_PASSWORD。' : '登录后管理你的应用、收藏和外观。';
  $('#auth-submit').textContent = setup ? '创建并登录' : '登录'; $('#auth-submit').disabled = setup && !status.setupAllowed;
  $('#password').minLength = setup ? 12 : 1; $('#password').autocomplete = setup ? 'new-password' : 'current-password';
  $('#confirm-password-field').hidden = !setup; $('#confirm-password').required = setup;
  const publicData = await request('/api/public-data').catch(() => null);
  if (publicData && !snapshot && !$('#auth-view').hidden) applyBrand(publicData.document.settings);
}
$('#auth-form').onsubmit = async event => {
  event.preventDefault(); $('#auth-error').textContent = '';
  if (setup && $('#password').value !== $('#confirm-password').value) { $('#auth-error').textContent = '两次密码不一致。'; return; }
  const button = $('#auth-submit'); button.disabled = true;
  try {
    await request(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value }) });
    $('#password').value = ''; $('#confirm-password').value = ''; await checkAuth();
  } catch (error) { $('#auth-error').textContent = error.message; } finally { button.disabled = false; }
};
$('#logout').onclick = async () => {
  if (dirty && !await confirmAction('退出登录？', '未保存的修改将被放弃。')) return;
  await busy($('#logout'), async () => { await api('/api/auth/logout', { method: 'POST' }); dirty = false; snapshot = null; await checkAuth(); });
};
function orderedIds(kind) { return kind === 'entries' ? snapshot.document.entries.filter(x => x.type === page).map(x => x.id) : snapshot.document[kind].map(x => x.id); }
async function reorder(kind, ids) {
  const doc = structuredClone(snapshot.document);
  if (kind === 'entries') { const byId = new Map(doc.entries.map(x => [x.id, x])); let i = 0; doc.entries = doc.entries.map(x => x.type === page ? byId.get(ids[i++]) : x); }
  else { const byId = new Map(doc[kind].map(x => [x.id, x])); doc[kind] = ids.map(id => byId.get(id)); }
  await save({ document: doc, revision: snapshot.revision }); kind === 'entries' ? renderEntries() : renderTaxonomies();
}
function actionButtons(item, kind, edit, remove) {
  const actions = textElement('div', '', 'row-actions'), ids = orderedIds(kind), index = ids.indexOf(item.id);
  for (const [delta, name, label] of [[-1, 'arrow-up', '上移'], [1, 'arrow-down', '下移']]) {
    const button = iconButton(name, label + item.name, () => busy(button, async () => { const next = [...ids]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; await reorder(kind, next); }));
    button.disabled = index + delta < 0 || index + delta >= ids.length; actions.append(button);
  }
  actions.append(iconButton('pencil', '编辑' + item.name, edit));
  const removeButton = iconButton('trash-2', '删除' + item.name, () => busy(removeButton, remove)); removeButton.classList.add('delete'); actions.append(removeButton); return actions;
}
function dragHandle() { const handle = textElement('span', '', 'drag'); handle.title = '拖动排序'; handle.setAttribute('aria-hidden', 'true'); handle.append(icon('grip-vertical')); return handle; }
function initSort(list, kind, disabled = false) {
  sorter?.destroy();
  if (!window.Sortable) return;
  sorter = new window.Sortable(list, { animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150, handle: '.drag', disabled, dataIdAttr: 'data-id', onEnd: async () => {
    try { await reorder(kind, [...list.children].map(x => x.dataset.id)); } catch (e) { showToast(e.message, true); kind === 'entries' ? renderEntries() : renderTaxonomies(); }
  } });
}
function visibleEntries() { return filterEntries(snapshot.document, { type: page, query: $('#manage-query').value }); }
function updateEntrySelection(entries = visibleEntries()) {
  const visibleIds = new Set(entries.map(entry => entry.id));
  // Hidden resources must never be included in a bulk operation.
  for (const id of selectedEntryIds) if (!visibleIds.has(id)) selectedEntryIds.delete(id);
  const count = selectedEntryIds.size, all = $('#select-all-entries');
  all.checked = count > 0 && count === entries.length;
  all.indeterminate = count > 0 && count < entries.length;
  all.disabled = entriesBusy || !entries.length;
  $('#invert-selection').disabled = entriesBusy || !entries.length;
  $('#bulk-transfer').textContent = page === 'apps' ? '转为书签' : '转为应用';
  $('#bulk-transfer').disabled = $('#bulk-delete').disabled = entriesBusy || !count;
  $('#bulk-export').disabled = entriesBusy || !snapshot.document.entries.length;
  $('#selection-summary').textContent = entriesBusy ? '正在保存…' : `已选 ${count} 项 · 当前 ${entries.length} 项`;
  $('#entry-list').querySelectorAll('.entry-row').forEach(row => {
    const checked = selectedEntryIds.has(row.dataset.id);
    row.querySelector('.entry-select').checked = checked; row.classList.toggle('is-selected', checked);
  });
}
function renderEntries() {
  const entries = visibleEntries();
  const list = $('#entry-list'); list.replaceChildren();
  for (const entry of entries) {
    const row = textElement('div', '', 'entry-row'); row.dataset.id = entry.id;
    const selection = textElement('label', '', 'entry-selection'), checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.className = 'entry-select'; checkbox.setAttribute('aria-label', '选择' + entry.name);
    checkbox.onchange = () => { checkbox.checked ? selectedEntryIds.add(entry.id) : selectedEntryIds.delete(entry.id); updateEntrySelection(); };
    selection.append(checkbox);
    const main = textElement('div', '', 'entry-main'), copy = textElement('div', '', 'resource-copy');
    copy.append(textElement('b', entry.name), textElement('span', entry.description || entry.url, 'entry-url')); main.append(resourceIcon(entry), copy);
    const category = snapshot.document.categories.find(x => x.id === entry.categoryId)?.name || '未分类';
    const tags = textElement('div', '', 'entry-tags'); snapshot.document.tags.filter(x => entry.tagIds.includes(x.id)).forEach(tag => tags.append(textElement('span', tag.name, 'entry-tag')));
    row.append(selection, dragHandle(), main, textElement('span', category, 'entry-category'), tags, actionButtons(entry, 'entries', () => openEntry(entry), async () => {
      if (!await confirmAction('删除资源？', `确认删除“${entry.name}”？`)) return;
      const doc = structuredClone(snapshot.document); doc.entries = doc.entries.filter(x => x.id !== entry.id); await save({ document: doc, revision: snapshot.revision }); renderEntries(); showToast('资源已删除');
    })); list.append(row);
  }
  if (!entries.length) list.append(textElement('p', '暂无匹配资源', 'empty'));
  updateEntrySelection(entries);
  initSort(list, 'entries', !!$('#manage-query').value || !entries.length);
}
$('#manage-query').oninput = renderEntries;
$('#select-all-entries').onchange = event => {
  for (const entry of visibleEntries()) event.target.checked ? selectedEntryIds.add(entry.id) : selectedEntryIds.delete(entry.id);
  updateEntrySelection();
};
$('#invert-selection').onclick = () => {
  for (const entry of visibleEntries()) selectedEntryIds.has(entry.id) ? selectedEntryIds.delete(entry.id) : selectedEntryIds.add(entry.id);
  updateEntrySelection();
};
async function changeSelectedEntries(remove = false) {
  if (entriesBusy) return;
  const ids = new Set(visibleEntries().filter(entry => selectedEntryIds.has(entry.id)).map(entry => entry.id));
  if (!ids.size) return;
  const target = page === 'apps' ? 'bookmarks' : 'apps';
  const title = remove ? '批量删除资源？' : `转为${titles[target]}？`;
  const message = remove ? `确认删除已选的 ${ids.size} 个资源？` : `确认将 ${ids.size} 个资源转为${titles[target]}？名称、网址、描述、图标、分类和标签都会保留。`;
  if (!await confirmAction(title, message)) return;
  entriesBusy = true; $('#entries-pane').inert = true; $('#entries-pane').setAttribute('aria-busy', 'true'); updateEntrySelection();
  try {
    const doc = structuredClone(snapshot.document);
    doc.entries = remove ? doc.entries.filter(entry => !ids.has(entry.id)) : doc.entries.map(entry => ids.has(entry.id) ? { ...entry, type: target } : entry);
    await save({ document: doc, revision: snapshot.revision });
    selectedEntryIds.clear();
    if (['apps', 'bookmarks'].includes(page)) renderEntries();
    showToast(remove ? `已删除 ${ids.size} 个资源` : `已将 ${ids.size} 个资源转为${titles[target]}`);
  } catch (error) { showToast(error.message, true); }
  finally { entriesBusy = false; $('#entries-pane').inert = false; $('#entries-pane').removeAttribute('aria-busy'); if (snapshot) updateEntrySelection(); }
}
$('#bulk-transfer').onclick = () => changeSelectedEntries();
$('#bulk-delete').onclick = () => changeSelectedEntries(true);
function entriesForExport(scope) {
  if (scope === 'all') return snapshot.document.entries;
  if (scope === 'page') return snapshot.document.entries.filter(entry => entry.type === page);
  const entries = visibleEntries();
  return scope === 'selected' ? entries.filter(entry => selectedEntryIds.has(entry.id)) : entries;
}
function updateExportCount() {
  const count = entriesForExport($('#export-scope').value).length;
  $('#export-count').textContent = `将导出 ${count} 个资源`;
  $('#export-form button[type="submit"]').disabled = !count;
}
$('#bulk-export').onclick = () => {
  for (const option of $('#export-scope').options) option.disabled = !entriesForExport(option.value).length;
  $('#export-scope').value = ['selected', 'filtered', 'page', 'all'].find(scope => entriesForExport(scope).length) || 'all';
  updateExportCount(); $('#export-dialog').showModal();
};
$('#export-scope').onchange = updateExportCount;
$('#export-form').onsubmit = event => {
  event.preventDefault();
  const format = $('#export-format').value, scope = $('#export-scope').value, entries = entriesForExport(scope);
  if (!entries.length) { updateExportCount(); return; }
  try {
    const content = exportEntries(snapshot.document, entries, format);
    const types = { json: 'application/json;charset=utf-8', csv: 'text/csv;charset=utf-8', html: 'text/html;charset=utf-8' };
    const filename = `navigation-${scope === 'all' ? 'all' : page}-${scope}-${new Date().toISOString().slice(0, 10)}.${format}`;
    downloadText(format === 'csv' ? '\ufeff' + content : content, filename, types[format]);
    $('#export-dialog').close(); showToast(`已导出 ${entries.length} 个资源`);
  } catch (error) { showToast(error.message, true); }
};
function openEntry(entry) {
  cancelIconFetch(); $('#entry-icon-status').textContent = '';
  editedId = entry?.id; entryDirty = false;
  $('#entry-title').textContent = (entry ? '编辑' : '添加') + titles[page];
  $('#entry-type').value = entry?.type || page;
  $('#entry-name').value = entry?.name || ''; $('#entry-description').value = entry?.description || ''; $('#entry-url').value = entry?.url || ''; $('#entry-icon').value = entry?.icon || '';
  $('#entry-category').replaceChildren(new Option('未分类', ''), ...snapshot.document.categories.map(x => new Option(x.name, x.id))); $('#entry-category').value = entry?.categoryId || '';
  $('#entry-tags').replaceChildren(); snapshot.document.tags.forEach(tag => {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = tag.id; input.checked = entry?.tagIds.includes(tag.id) || false; label.append(input, document.createTextNode(tag.name)); $('#entry-tags').append(label);
  });
  $('#entry-error').textContent = ''; $('#entry-dialog').showModal();
}
$('#add-entry').onclick = () => openEntry();
$('#entry-form').oninput = () => { entryDirty = true; };
const normalizeEntryUrl = () => ($('#entry-url').value = normalizeWebUrl($('#entry-url').value));
$('#entry-url').onblur = normalizeEntryUrl;
function cancelIconFetch() {
  iconVersion++; iconFetchController?.abort(); iconFetchController = null;
  $('#fetch-entry-icon').disabled = false; $('#fetch-entry-icon').removeAttribute('aria-busy');
}
$('#entry-url').oninput = $('#entry-icon').oninput = () => { cancelIconFetch(); $('#entry-icon-status').textContent = ''; };
$('#fetch-entry-icon').onclick = async () => {
  const url = normalizeEntryUrl();
  if (!url) { $('#entry-icon-status').textContent = '请先填写网址。'; return; }
  cancelIconFetch(); const version = iconVersion, previousIcon = $('#entry-icon').value;
  const controller = new AbortController(); iconFetchController = controller;
  const button = $('#fetch-entry-icon'); button.disabled = true; button.setAttribute('aria-busy', 'true');
  $('#entry-icon-status').textContent = '正在获取图标…';
  try {
    const image = await fetchIcon(url, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
    if (version !== iconVersion || !$('#entry-dialog').open || $('#entry-icon').value !== previousIcon) return;
    if (image) { $('#entry-icon').value = image; entryDirty = true; }
    $('#entry-icon-status').textContent = image ? '已获取图标，保存后生效。' : '未获取到图标，可上传图标或继续保存。';
  } catch {
    if (version === iconVersion && !controller.signal.aborted) $('#entry-icon-status').textContent = '未获取到图标，可上传图标或继续保存。';
  } finally {
    if (version === iconVersion) { iconFetchController = null; button.disabled = false; button.removeAttribute('aria-busy'); }
  }
};
$('#entry-form').onsubmit = async event => {
  event.preventDefault(); if (entrySaving) return;
  cancelIconFetch(); entrySaving = true; const button = event.submitter; $('#entry-error').textContent = '';
  const controls = [...$('#entry-form').querySelectorAll('input, select, button')].filter(control => !control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try {
    const url = normalizeWebUrl($('#entry-url').value); $('#entry-url').value = url; let iconUrl = $('#entry-icon').value.trim();
    const type = $('#entry-type').value, original = snapshot.document.entries.find(entry => entry.id === editedId);
    const preserveIcon = original && original.type !== type && original.url === url && original.icon === iconUrl;
    if (!iconUrl && !preserveIcon) {
      $('#entry-icon-status').textContent = '正在获取图标，获取失败仍会保存资源…';
      try { iconUrl = await fetchIcon(url); } catch {}
      if (!$('#entry-dialog').open) return;
      $('#entry-icon').value = iconUrl;
    }
    const doc = structuredClone(snapshot.document), entry = { id: editedId || createClientId(), type, name: $('#entry-name').value.trim(), description: $('#entry-description').value.trim(), url, icon: iconUrl, categoryId: $('#entry-category').value, tagIds: [...document.querySelectorAll('#entry-tags input:checked')].map(x => x.value) };
    const index = doc.entries.findIndex(x => x.id === entry.id); index === -1 ? doc.entries.push(entry) : doc.entries.splice(index, 1, entry);
    await save({ document: doc, revision: snapshot.revision }); entryDirty = false; $('#entry-dialog').close(); renderEntries(); showToast('资源已保存');
  } catch (e) { $('#entry-error').textContent = e.message; } finally { entrySaving = false; controls.forEach(control => { control.disabled = false; }); }
};
$('#upload-entry-icon').onclick = () => $('#entry-icon-file').click();
$('#entry-icon-file').onchange = () => busy($('#upload-entry-icon'), async () => {
  cancelIconFetch(); const version = iconVersion, file = $('#entry-icon-file').files[0]; $('#entry-icon-file').value = '';
  if (file) {
    const image = await upload(file);
    if (version === iconVersion && $('#entry-dialog').open) { $('#entry-icon').value = image; entryDirty = true; $('#entry-icon-status').textContent = '图标已上传，保存后生效。'; }
  }
});
$('#entry-dialog').addEventListener('close', cancelIconFetch);
function renderTaxonomies() {
  const label = taxonomyKind === 'categories' ? '分类' : '标签';
  $('#add-taxonomy').replaceChildren(icon('plus'), document.createTextNode('添加' + label));
  $('#taxonomy-tabs').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === taxonomyKind)));
  const list = $('#taxonomy-list'); list.replaceChildren();
  snapshot.document[taxonomyKind].forEach(item => {
    const count = snapshot.document.entries.filter(x => taxonomyKind === 'categories' ? x.categoryId === item.id : x.tagIds.includes(item.id)).length;
    const row = textElement('div', '', 'taxonomy-row'); row.dataset.id = item.id;
    row.append(dragHandle(), textElement('b', item.name), textElement('small', `${count} 个资源`), actionButtons(item, taxonomyKind, () => openTaxonomy(item), async () => {
      if (!await confirmAction('删除' + label + '？', `“${item.name}”关联 ${count} 个资源。删除后保留资源并解除关联。`)) return;
      const doc = structuredClone(snapshot.document); doc[taxonomyKind] = doc[taxonomyKind].filter(x => x.id !== item.id);
      doc.entries.forEach(entry => { if (taxonomyKind === 'categories' && entry.categoryId === item.id) entry.categoryId = ''; if (taxonomyKind === 'tags') entry.tagIds = entry.tagIds.filter(id => id !== item.id); });
      await save({ document: doc, revision: snapshot.revision }); renderTaxonomies(); showToast(label + '已删除');
    })); list.append(row);
  });
  if (!snapshot.document[taxonomyKind].length) list.append(textElement('p', '暂无' + label, 'empty'));
  initSort(list, taxonomyKind, !snapshot.document[taxonomyKind].length);
}
$('#taxonomy-tabs').onclick = event => { const button = event.target.closest('[data-kind]'); if (button) { taxonomyKind = button.dataset.kind; renderTaxonomies(); } };
function openTaxonomy(item) { editedId = item?.id; $('#taxonomy-title').textContent = (item ? '编辑' : '添加') + (taxonomyKind === 'categories' ? '分类' : '标签'); $('#taxonomy-name').value = item?.name || ''; $('#taxonomy-error').textContent = ''; $('#taxonomy-dialog').showModal(); }
$('#add-taxonomy').onclick = () => openTaxonomy();
$('#taxonomy-form').onsubmit = async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try {
    const doc = structuredClone(snapshot.document), item = { id: editedId || createClientId(), name: $('#taxonomy-name').value.trim() };
    const index = doc[taxonomyKind].findIndex(x => x.id === item.id); index === -1 ? doc[taxonomyKind].push(item) : doc[taxonomyKind].splice(index, 1, item);
    await save({ document: doc, revision: snapshot.revision }); $('#taxonomy-dialog').close(); renderTaxonomies(); showToast('已保存');
  } catch (e) { $('#taxonomy-error').textContent = e.message; } finally { event.submitter.disabled = false; }
};
function logoPreview() { const img = $('#logo-preview'); const url = $('#site-logo-input').value.trim(); img.hidden = !url; if (url) img.src = url; }
function fillSettings() {
  const s = snapshot.document.settings; $('#site-name-input').value = s.siteName; $('#site-logo-input').value = s.logo; $('#greeting-input').value = s.greeting; $('#engine-input').value = s.defaultEngine; $('#footer-input').value = s.footer;
  settingsCity = structuredClone(s.defaultCity); $('#default-city').replaceChildren(icon('map-pin'), document.createTextNode(settingsCity.name), icon('pencil')); logoPreview();
}
$('#settings-form').oninput = () => setDirty(true);
$('#default-city').onclick = () => cityPicker(city => { settingsCity = city; $('#default-city').replaceChildren(icon('map-pin'), document.createTextNode(city.name), icon('pencil')); setDirty(true); });
$('#settings-form').onsubmit = event => {
  event.preventDefault(); busy(event.submitter, async () => {
    const doc = structuredClone(snapshot.document); Object.assign(doc.settings, { siteName: $('#site-name-input').value.trim(), logo: $('#site-logo-input').value.trim(), greeting: $('#greeting-input').value.trim(), footer: $('#footer-input').value, defaultEngine: $('#engine-input').value, defaultCity: settingsCity });
    await save({ document: doc, revision: snapshot.revision }); setDirty(false); showToast('站点设置已保存');
  });
};
$('#upload-logo').onclick = () => $('#logo-file').click();
$('#logo-file').onchange = () => busy($('#upload-logo'), async () => { const file = $('#logo-file').files[0]; if (file) { $('#site-logo-input').value = await upload(file); logoPreview(); setDirty(true); } $('#logo-file').value = ''; });
$('#remove-logo').onclick = () => { $('#site-logo-input').value = ''; logoPreview(); setDirty(true); };
$('#site-logo-input').onchange = logoPreview;
$('#export-backup').onclick = () => busy($('#export-backup'), async () => { const backup = await api('/api/admin/export'); downloadJson(backup, `navigation-${new Date().toISOString().slice(0, 10)}.json`); showToast('备份已导出'); });
$('#choose-backup').onclick = () => $('#backup-file').click();
$('#backup-file').onchange = () => busy($('#choose-backup'), async () => {
  $('#import-summary').hidden = true; pendingBackup = null;
  const file = $('#backup-file').files[0]; if (!file) return;
  if (file.size > backupByteLimit) throw Error('备份不能超过 35 MB。');
  const backup = JSON.parse(await file.text());
  if (backup.format !== 'navigation-backup' || backup.version !== 1 || !Array.isArray(backup.document?.entries)) throw Error('请选择本站导出的备份文件。');
  pendingBackup = backup; $('#import-details').textContent = `${backup.document.settings.siteName} · ${backup.document.entries.length} 个资源 · ${Object.keys(backup.assets || {}).length} 张图片`; $('#import-summary').hidden = false; $('#backup-file').value = '';
});
$('#cancel-import').onclick = () => { pendingBackup = null; $('#import-summary').hidden = true; };
$('#import-backup').onclick = () => busy($('#import-backup'), async () => {
  if (!pendingBackup) return;
  snapshot = await api('/api/admin/import', { method: 'POST', body: JSON.stringify({ revision: snapshot.revision, backup: pendingBackup }), signal: AbortSignal.timeout(90_000) });
  pendingBackup = null; $('#import-summary').hidden = true; updateCounts(); showToast('备份已恢复');
});
document.querySelectorAll('dialog [data-close]').forEach(button => button.onclick = async () => {
  const dialog = button.closest('dialog'); if (dialog.id === 'entry-dialog' && entryDirty && !await confirmAction('放弃未保存的资源？', '当前输入尚未保存。')) return;
  entryDirty = false; dialog.close();
});
$('#entry-dialog').addEventListener('cancel', async event => { if (entrySaving) { event.preventDefault(); return; } if (entryDirty) { event.preventDefault(); if (await confirmAction('放弃未保存的资源？', '当前输入尚未保存。')) { entryDirty = false; $('#entry-dialog').close(); } } });
installIcons();
checkAuth().catch(error => { $('#auth-error').textContent = error.message; });
