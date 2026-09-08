import { $, textElement, busy, showToast } from './ui.js';
import { parseImportSource, prepareImport, importByteLimit } from './import.js';

export function createBulkImportEditor({ getSnapshot, getType, save, reload, onSaved, fetchIcon, setDirty }) {
  const dialog = $('#bulk-dialog');
  let prepared, format = 'auto', importing = false, runController, sourceVersion = 0, needsReload = false;
  function invalidate() {
    sourceVersion++; prepared = null; $('#bulk-preview-panel').hidden = true; $('#bulk-confirm').disabled = true;
    $('#bulk-error').textContent = ''; $('#bulk-progress').textContent = ''; setDirty(!!$('#bulk-source').value.trim());
  }
  async function preview() {
    invalidate();
    if (needsReload) {
      try { await reload(); needsReload = false; }
      catch { $('#bulk-error').textContent = '刷新最新内容失败，请稍后重试。'; return; }
    }
    try {
      const records = parseImportSource($('#bulk-source').value, format), snapshot = getSnapshot();
      prepared = { ...prepareImport(snapshot.document, records, $('#bulk-type').value), revision: snapshot.revision };
      const counts = prepared.counts;
      $('#bulk-summary').textContent = `可导入 ${counts.added} 项 · 重复 ${counts.duplicate} 项 · 无效 ${counts.invalid} 项 · 新增分类 ${counts.categories} 个、标签 ${counts.tags} 个`;
      const body = $('#bulk-rows'); body.replaceChildren();
      for (const row of prepared.rows) {
        const tr = document.createElement('tr');
        tr.append(textElement('td', row.name || '未命名'), textElement('td', row.url), textElement('td', row.category || '未分类'), textElement('td', row.reason, row.status === 'invalid' ? 'error-text' : row.status === 'duplicate' ? 'muted' : ''));
        body.append(tr);
      }
      $('#bulk-preview-panel').hidden = false; $('#bulk-confirm').disabled = !counts.added;
      $('#bulk-confirm').textContent = `导入 ${counts.added} 项${$('#bulk-type').value === 'apps' ? '应用' : '书签'}`;
    } catch (error) { $('#bulk-error').textContent = error.message; }
  }
  $('#bulk-source').oninput = () => { format = 'auto'; invalidate(); };
  $('#bulk-type').onchange = invalidate;
  $('#bulk-preview').onclick = () => preview();
  $('#bulk-choose-file').onclick = () => $('#bulk-file').click();
  $('#bulk-file').onchange = () => busy($('#bulk-choose-file'), async () => {
    const file = $('#bulk-file').files[0]; $('#bulk-file').value = ''; if (!file) return;
    invalidate(); const version = sourceVersion;
    if (file.size > importByteLimit) { $('#bulk-error').textContent = '导入文件不能超过 5 MB。'; return; }
    const source = await file.text();
    if (version !== sourceVersion || !dialog.open) return;
    format = /\.html?$/i.test(file.name) ? 'html' : /\.(csv|tsv)$/i.test(file.name) ? 'csv' : 'auto';
    $('#bulk-source').value = source; await preview();
  });
  async function populateIcons(entries) {
    const stopIcons = new AbortController(), signal = AbortSignal.any([runController.signal, stopIcons.signal, AbortSignal.timeout(12_000)]);
    const byOrigin = new Map(); let cursor = 0, completed = 0;
    async function worker() {
      while (cursor < entries.length && !signal.aborted) {
        const entry = entries[cursor++], origin = new URL(entry.url).origin;
        if (!byOrigin.has(origin)) byOrigin.set(origin, fetchIcon(entry.url, signal).catch(error => { if (error.status === 429) stopIcons.abort(); return ''; }));
        entry.icon = await byOrigin.get(origin);
        $('#bulk-progress').textContent = `正在获取图标：${++completed}/${entries.length}；失败的资源仍会导入。`;
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));
  }
  $('#bulk-confirm').onclick = async () => {
    if (!prepared?.counts.added || importing) return;
    importing = true; runController = new AbortController(); $('#bulk-error').textContent = '';
    const controls = [...dialog.querySelectorAll('button, input, select, textarea')].map(element => ({ element, disabled: element.disabled }));
    controls.forEach(({ element }) => { element.disabled = true; });
    try {
      const document = structuredClone(prepared.document), ids = new Set(prepared.rows.map(row => row.entryId).filter(Boolean));
      const entries = document.entries.filter(entry => ids.has(entry.id));
      if ($('#bulk-fetch-icons').checked) await populateIcons(entries);
      if (runController.signal.aborted || !dialog.open) return;
      $('#bulk-progress').textContent = '正在保存导入结果…';
      await save({ document, revision: prepared.revision });
      const { added, duplicate, invalid } = prepared.counts;
      setDirty(false); dialog.close(); onSaved(); showToast(`已导入 ${added} 项，跳过 ${duplicate + invalid} 项`);
    } catch (error) {
      if (error.status === 409) {
        needsReload = true; invalidate();
        try { await reload(); needsReload = false; $('#bulk-error').textContent = '站点内容已更新，请重新预览后导入。'; }
        catch { $('#bulk-error').textContent = '刷新最新内容失败，请稍后重试。'; }
      } else $('#bulk-error').textContent = error.message;
    } finally {
      importing = false; controls.forEach(({ element, disabled }) => { element.disabled = disabled; });
      $('#bulk-confirm').disabled = !prepared?.counts.added; $('#bulk-progress').textContent = '';
    }
  };
  dialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); });
  dialog.addEventListener('close', () => { runController?.abort(); sourceVersion++; setDirty(false); });
  return { open() {
    if (importing) return;
    $('#bulk-type').value = getType(); $('#bulk-source').value = ''; $('#bulk-fetch-icons').checked = true;
    format = 'auto'; invalidate(); dialog.showModal();
  } };
}
