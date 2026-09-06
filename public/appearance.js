import { themeDefaults, themeNames, layoutPresets } from './model.js';
import { $, textElement, busy, showToast } from './ui.js';

export function createAppearanceEditor({ getSnapshot, save, setDirty, upload }) {
  let draft, revision, theme, layer = 'page', ready = false, changes = 0;
  const frame = $('#appearance-preview');
  let device = 'desktop';
  const layoutFields = [
    ['panelRadius', 'panel-radius', '面板圆角', 0, 32, 'primary'],
    ['panelGap', 'panel-gap', '面板之间的间距', 0, 48, 'primary'],
    ['gridGap', 'grid-gap', '卡片之间的间距', 8, 32, 'primary'],
    ['maxWidth', 'max-width', '页面最大宽度', 960, 1600, 'advanced'],
    ['pageGutter', 'page-gutter', '页面左右留白', 16, 96, 'advanced'],
    ['overviewPadding', 'overview-padding', '概览区域内边距', 20, 72, 'advanced'],
    ['resourcesPadding', 'resources-padding', '资源区域内边距', 20, 72, 'advanced'],
    ['overviewGap', 'overview-gap', '概览内容间距', 16, 96, 'advanced'],
    ['panelShadow', 'panel-shadow', '面板阴影强度', 0, 40, 'advanced'],
    ['cardMinWidth', 'card-min-width', '卡片最小宽度', 180, 360, 'card'],
    ['cardPadding', 'card-padding', '卡片内部留白', 12, 36, 'card'],
    ['cardLift', 'card-lift', '悬浮位移', 0, 8, 'card'],
  ];
  for (const [key, id, label, min, max, group] of layoutFields) {
    const wrapper = textElement('div', '', 'layout-field');
    const heading = textElement('label', label); heading.htmlFor = 'layout-' + id; heading.id = 'label-' + id;
    const controls = textElement('div', '', 'range-control');
    const range = document.createElement('input'), number = document.createElement('input');
    range.type = 'range'; range.id = 'layout-' + id; number.type = 'number'; number.id = range.id + '-number';
    for (const input of [range, number]) {
      input.min = min; input.max = max; input.step = 1; input.setAttribute('aria-labelledby', heading.id);
      input.oninput = () => {
        if (!input.value || !input.validity.valid) return;
        const value = Number(input.value); draft.settings.appearances[theme].layout[key] = value;
        range.value = value; number.value = value; syncPresets(); changed();
      };
      input.onchange = () => { if (!input.validity.valid || !input.value) input.value = draft.settings.appearances[theme].layout[key]; };
    }
    controls.append(range, number, textElement('span', key === 'panelShadow' ? '%' : 'px', 'range-unit'));
    wrapper.append(heading, controls); $('#layout-' + group + '-fields').append(wrapper);
  }
  function syncPresets() {
    $('#layout-presets').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Object.entries(layoutPresets[button.dataset.preset]).every(([key, value]) => draft.settings.appearances[theme].layout[key] === value))));
  }
  function resizePreview() {
    const stage = $('#preview-stage'), width = device === 'desktop' ? 1280 : 375, height = device === 'desktop' ? 900 : 812;
    if (!stage.clientWidth) return;
    const scale = Math.min(1, stage.clientWidth / width);
    stage.style.height = Math.round(height * scale) + 'px'; frame.style.width = width + 'px'; frame.style.height = height + 'px';
    frame.style.left = (stage.clientWidth - width * scale) / 2 + 'px'; frame.style.transform = `scale(${scale})`;
  }
  new ResizeObserver(resizePreview).observe($('#preview-stage'));
  $('#preview-devices').onclick = event => {
    const button = event.target.closest('[data-device]'); if (!button) return;
    device = button.dataset.device; $('#preview-devices').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === button))); resizePreview();
  };
  function selectEditor(name) {
    $('#editor-tabs').querySelectorAll('button').forEach(button => { const selected = button.dataset.editorTab === name; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
    document.querySelectorAll('.editor-pane').forEach(pane => { pane.hidden = pane.id !== 'editor-' + name; });
  }
  $('#editor-tabs').onclick = event => { const button = event.target.closest('[data-editor-tab]'); if (button) selectEditor(button.dataset.editorTab); };
  $('#editor-tabs').onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...$('#editor-tabs').querySelectorAll('button')], current = tabs.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    selectEditor(tabs[next].dataset.editorTab); tabs[next].focus();
  };
  $('#layout-presets').onclick = event => {
    const button = event.target.closest('[data-preset]'); if (!button) return;
    Object.assign(draft.settings.appearances[theme].layout, layoutPresets[button.dataset.preset]); fill(); changed();
  };
  const layoutSelections = { 'overview-layout': 'overviewLayout', 'resource-view': 'resourceView', 'border-mode': 'borderMode' };
  Object.entries(layoutSelections).forEach(([id, key]) => { $('#layout-' + id).onchange = () => { draft.settings.appearances[theme].layout[key] = $('#layout-' + id).value; changed(); }; });
  $('#reset-layout').onclick = () => { draft.settings.appearances[theme].layout = structuredClone(themeDefaults[theme].layout); fill(); changed(); };
  function preview() { if (draft && ready) frame.contentWindow.postMessage({ type: 'navigation-preview', document: draft, theme }, location.origin); }
  frame.addEventListener('load', () => { ready = true; preview(); });
  window.addEventListener('message', event => { if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'navigation-preview-ready') { ready = true; preview(); } });
  function changed() { changes++; setDirty(true); $('#appearance-status').textContent = '未保存'; preview(); }
  function fill() {
    const settings = draft.settings.appearances[theme], bg = settings[layer];
    $('#theme-options').querySelectorAll('button').forEach(button => button.setAttribute('aria-checked', String(button.dataset.theme === theme)));
    $('#layer-select').value = layer;
    $('#background-modes').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === bg.mode)));
    $('#gradient-fields').hidden = bg.mode !== 'gradient'; $('#image-fields').hidden = bg.mode !== 'image';
    const values = { 'bg-color': bg.color, 'bg-text': bg.text, 'bg-gradient': bg.gradientTo, 'bg-angle': bg.angle, 'bg-image': bg.image, 'bg-position': bg.position, 'bg-size': bg.size, 'bg-overlay': bg.overlay, 'bg-opacity': bg.opacity, 'card-color': settings.card.color, 'card-text': settings.card.text, 'card-opacity': settings.card.opacity, 'card-radius': settings.card.radius };
    Object.entries(values).forEach(([id, value]) => { $('#' + id).value = value; });
    layoutFields.forEach(([key, id]) => { $('#layout-' + id).value = settings.layout[key]; $('#layout-' + id + '-number').value = settings.layout[key]; });
    Object.entries(layoutSelections).forEach(([id, key]) => { $('#layout-' + id).value = settings.layout[key]; });
    syncPresets(); outputs(); imagePreview(); preview(); resizePreview();
  }
  function outputs() {
    $('#angle-value').textContent = $('#bg-angle').value + '°'; $('#opacity-value').textContent = $('#bg-opacity').value + '%'; $('#card-opacity-value').textContent = $('#card-opacity').value + '%'; $('#card-radius-value').textContent = $('#card-radius').value + ' px';
  }
  function imagePreview() {
    const image = $('#background-preview'), url = draft.settings.appearances[theme][layer].image;
    image.hidden = !url; $('#background-image-error').hidden = true;
    image.onload = () => { $('#background-image-error').hidden = true; };
    image.onerror = () => { $('#background-image-error').hidden = false; };
    if (url) image.src = url; else image.removeAttribute('src');
  }
  $('#layer-select').onchange = () => { layer = $('#layer-select').value; fill(); };
  $('#background-modes').onclick = event => { const button = event.target.closest('[data-mode]'); if (button) { draft.settings.appearances[theme][layer].mode = button.dataset.mode; fill(); changed(); } };
  const mappings = { 'bg-color': 'color', 'bg-text': 'text', 'bg-gradient': 'gradientTo', 'bg-angle': 'angle', 'bg-image': 'image', 'bg-position': 'position', 'bg-size': 'size', 'bg-overlay': 'overlay', 'bg-opacity': 'opacity' };
  Object.entries(mappings).forEach(([id, key]) => {
    $('#' + id).addEventListener('input', () => { const input = $('#' + id); draft.settings.appearances[theme][layer][key] = input.type === 'range' ? Number(input.value) : input.value.trim(); outputs(); changed(); });
  });
  $('#bg-image').addEventListener('change', imagePreview);
  ['color', 'text', 'opacity', 'radius'].forEach(key => { $('#card-' + key).oninput = () => { const input = $('#card-' + key); draft.settings.appearances[theme].card[key] = input.type === 'range' ? Number(input.value) : input.value; outputs(); changed(); }; });
  $('#remove-background').onclick = () => { draft.settings.appearances[theme][layer].image = ''; fill(); changed(); };
  $('#upload-background').onclick = () => $('#background-file').click();
  $('#background-file').onchange = () => busy($('#upload-background'), async () => {
    const file = $('#background-file').files[0]; if (!file) return;
    const targetTheme = theme, targetLayer = layer, targetDraft = draft;
    const url = await upload(file); if (draft !== targetDraft) return;
    draft.settings.appearances[targetTheme][targetLayer].image = url; draft.settings.appearances[targetTheme][targetLayer].mode = 'image';
    fill(); changed(); $('#background-file').value = '';
  });
  $('#reset-layer').onclick = () => { draft.settings.appearances[theme][layer] = structuredClone(themeDefaults[theme][layer]); fill(); changed(); };
  $('#reset-theme').onclick = () => { draft.settings.appearances[theme] = structuredClone(themeDefaults[theme]); fill(); changed(); };
  $('#save-appearance').onclick = () => busy($('#save-appearance'), async () => {
    const submittedDraft = draft, submittedChanges = changes;
    const result = await save({ document: structuredClone(draft), revision });
    if (draft !== submittedDraft) return;
    revision = result.revision;
    if (changes !== submittedChanges) {
      setDirty(true); $('#appearance-status').textContent = '未保存'; showToast('外观已保存，新的调整仍待保存'); return;
    }
    draft = structuredClone(result.document); setDirty(false); $('#appearance-status').textContent = '已保存'; showToast('外观已保存');
  });
  return {
    open() {
      const snapshot = getSnapshot(); draft = structuredClone(snapshot.document); revision = snapshot.revision; theme = draft.settings.theme;
      const choices = $('#theme-options'); choices.replaceChildren();
      Object.entries(themeNames).forEach(([id, name]) => {
        const button = document.createElement('button'); button.className = 'theme-choice'; button.type = 'button'; button.dataset.theme = id; button.setAttribute('role', 'radio');
        const miniature = textElement('div', '', 'theme-miniature'); miniature.setAttribute('aria-hidden', 'true');
        const heading = textElement('span', '', 'mini-heading'), clock = textElement('span', '09:41', 'mini-clock'), search = textElement('span', '', 'mini-search'), grid = textElement('span', '', 'mini-grid');
        for (let i = 0; i < 6; i++) grid.append(textElement('i', '', 'mini-item'));
        miniature.append(heading, clock, search, grid);
        button.append(miniature, textElement('b', name)); button.onclick = () => { theme = id; draft.settings.theme = id; fill(); changed(); }; choices.append(button);
      });
      $('#appearance-status').textContent = '已保存'; fill();
    },
  };
}
