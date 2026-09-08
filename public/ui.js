import { themeNames, themeDefaults, faviconUrls } from './model.js';
export const $ = selector => document.querySelector(selector);
export const icon = name => {
  const el = document.createElement('i'); el.className = 'icon'; el.setAttribute('aria-hidden', 'true'); el.style.setProperty('--icon', `url('/icons/${name}.svg')`); return el;
};
export function iconButton(name, title, action) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-button'; button.title = title; button.setAttribute('aria-label', title); button.append(icon(name)); if (action) button.addEventListener('click', action); return button;
}
export function installIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.replaceChildren(icon(el.dataset.icon)); }); }
export function textElement(tag, text, className = '') { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; }
export function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function storageSet(key, value) { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {} }
export async function request(url, options = {}) {
  const headers = { 'x-navigation-request': '1', ...options.headers };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(25_000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.error || '请求失败，请重试。'); error.status = response.status; throw error; }
  return result;
}
export function rgba(hex, percent = 100) { return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${percent / 100})`; }
export function paintLayer(el, settings) {
  if (!el || !settings) return;
  let image = 'none';
  if (settings.mode === 'gradient') image = `linear-gradient(${settings.angle}deg,${settings.color},${settings.gradientTo})`;
  if (settings.mode === 'image' && settings.image) image = `linear-gradient(${rgba(settings.overlay, settings.opacity)},${rgba(settings.overlay, settings.opacity)}),url(${JSON.stringify(settings.image)})`;
  el.style.setProperty('--layer-color', settings.color); el.style.setProperty('--layer-image', image);
  el.style.setProperty('--layer-size', settings.size); el.style.setProperty('--layer-position', settings.position);
  el.style.setProperty('--fg', settings.text);
}
export function applyAppearance(doc, theme, root = document) {
  if (!themeNames[theme]) theme = doc.settings.theme;
  const a = doc.settings.appearances[theme];
  const layout = a.layout || themeDefaults[theme].layout;
  root.documentElement.dataset.theme = theme;
  root.documentElement.dataset.style = a.style || themeDefaults[theme].style;
  root.documentElement.dataset.overview = layout.overviewLayout;
  root.documentElement.dataset.resourceView = layout.resourceView;
  root.documentElement.dataset.border = layout.borderMode;
  root.documentElement.dataset.joined = String(layout.panelGap === 0);
  paintLayer(root.body, a.page);
  paintLayer(root.querySelector('#overview'), a.overview);
  paintLayer(root.querySelector('#resources'), a.resources);
  root.documentElement.style.setProperty('--card-bg', rgba(a.card.color, a.card.opacity));
  root.documentElement.style.setProperty('--card-fg', a.card.text);
  root.documentElement.style.setProperty('--card-radius', a.card.radius + 'px');
  const lengths = { 'shell-max': 'maxWidth', 'page-gutter': 'pageGutter', 'panel-radius': 'panelRadius', 'panel-gap': 'panelGap', 'overview-padding': 'overviewPadding', 'resources-padding': 'resourcesPadding', 'overview-gap': 'overviewGap', 'grid-gap': 'gridGap', 'card-padding': 'cardPadding', 'card-min-width': 'cardMinWidth', 'card-lift': 'cardLift' };
  Object.entries(lengths).forEach(([variable, key]) => root.documentElement.style.setProperty('--' + variable, layout[key] + 'px'));
  root.documentElement.style.setProperty('--panel-shadow-opacity', String(layout.panelShadow / 100));
}
export function resourceIcon(entry) {
  const box = textElement('span', entry.name.slice(0, 1).toLocaleUpperCase(), 'resource-icon');
  let host;
  try { host = new URL(entry.url).hostname; } catch { return box; }
  const bundled = { 'github.com': 'github', 'chatgpt.com': 'chatgpt', 'excalidraw.com': 'excalidraw', 'dash.cloudflare.com': 'cloudflare', 'www.notion.so': 'notion', 'notion.so': 'notion', 'www.figma.com': 'figma', 'figma.com': 'figma', 'developer.mozilla.org': 'mdn', 'sspai.com': 'sspai', 'vercel.com': 'vercel', 'www.oschina.net': 'oschina', 'www.bing.com': 'bing', 'www.wikipedia.org': 'wikipedia' };
  const serverFavicon = `/api/favicon?url=${encodeURIComponent(entry.url)}`;
  const providers = faviconUrls(entry.url);
  const sources = [...new Set([entry.icon, bundled[host] ? `/assets/${bundled[host]}.png` : '', providers[0], serverFavicon, ...providers.slice(1)].filter(Boolean))];
  let index = 0;
  function next() {
    if (index >= sources.length) return;
    const img = new Image(40, 40); img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    let finished = false;
    const finish = success => {
      if (finished) return; finished = true; clearTimeout(timer); img.onload = img.onerror = null;
      if (success) box.replaceChildren(img); else next();
    };
    const timer = setTimeout(() => finish(false), 4000);
    img.onload = () => finish(true); img.onerror = () => finish(false); img.src = sources[index++];
  }
  next();
  return box;
}
let resourceStatusObserver;
const checkedResourceStatuses = new WeakSet();
function checkResourceStatus(card) {
  if (checkedResourceStatuses.has(card)) return;
  checkedResourceStatuses.add(card);
  const status = card.querySelector('.resource-status');
  if (!status) return;
  let target;
  try { target = new URL(card.href); } catch { status.className = 'resource-status is-unknown'; status.title = '网址无效'; return; }
  if (location.protocol === 'https:' && target.protocol === 'http:') { status.className = 'resource-status is-unknown'; status.title = '混合内容限制，未检测'; return; }
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); status.className = 'resource-status is-off'; status.title = '超时或暂不可达'; }, 6000);
  fetch(target.href, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    .then(() => { status.className = 'resource-status is-on'; status.title = '在线'; })
    .catch(() => { status.className = 'resource-status is-off'; status.title = '超时或暂不可达'; })
    .finally(() => clearTimeout(timer));
}
export function observeResourceStatuses(root) {
  const cards = [...root.querySelectorAll('.resource-status')].map(status => status.closest('.resource-card')).filter(Boolean);
  if (!cards.length) return;
  if (!resourceStatusObserver && 'IntersectionObserver' in window) resourceStatusObserver = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { resourceStatusObserver.unobserve(entry.target); checkResourceStatus(entry.target); } }), { rootMargin: '160px' });
  cards.forEach(card => resourceStatusObserver ? resourceStatusObserver.observe(card) : checkResourceStatus(card));
}
export function makeResourceCard(entry, { withStatus = false } = {}) {
  const link = document.createElement('a'); link.className = 'resource-card'; link.href = entry.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  const copy = document.createElement('span'); copy.className = 'resource-copy';
  const name = textElement('b', entry.name); name.title = entry.name;
  copy.append(name, textElement('span', entry.description, 'resource-description'));
  link.append(resourceIcon(entry), copy);
  if (withStatus) { const status = textElement('span', '', 'resource-status is-checking'); status.title = '正在检测在线状态'; status.setAttribute('aria-label', status.title); link.append(status); }
  link.append(icon('arrow-up-right')); return link;
}
export function showToast(message, error = false) {
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dialog && error) {
    let notice = dialog.querySelector('.dialog-notice');
    if (!notice) { notice = textElement('p', '', 'error-text dialog-notice'); notice.setAttribute('role', 'alert'); dialog.append(notice); }
    notice.textContent = message;
    dialog.addEventListener('close', () => notice.remove(), { once: true });
  }
  const toast = $('#toast'); toast.textContent = message; toast.classList.toggle('is-error', error); toast.hidden = false;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 5000);
}
export async function busy(button, task) {
  button.disabled = true; button.setAttribute('aria-busy', 'true');
  try { return await task(); } catch (error) { showToast(error.message, true); } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}
export function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function cityPicker(onSelect, onAutomatic) {
  const dialog = $('#city-dialog'), form = $('#city-search'), list = $('#city-results'), error = $('#city-error');
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const automatic = $('#city-automatic'); automatic.hidden = !onAutomatic;
  automatic.onclick = () => { onAutomatic(); dialog.close(); };
  let controller;
  form.onsubmit = async event => {
    event.preventDefault(); controller?.abort();
    const searchController = new AbortController(); controller = searchController;
    list.replaceChildren(); error.textContent = '正在查询城市…';
    try {
      const cities = await request('/api/cities?q=' + encodeURIComponent($('#city-query').value.trim()), { signal: AbortSignal.any([searchController.signal, AbortSignal.timeout(25_000)]) });
      if (searchController.signal.aborted) return;
      error.textContent = cities.length ? '' : '未找到城市，可尝试拼音或附近城市。';
      cities.forEach(city => { const button = textElement('button', `${city.name} · ${city.country}`, 'city-result'); button.type = 'button'; button.onclick = () => { onSelect(city); dialog.close(); }; list.append(button); });
    } catch (e) { if (!searchController.signal.aborted) error.textContent = e.message; }
  };
  dialog.addEventListener('close', () => controller?.abort(), { once: true });
  $('#city-query').value = ''; list.replaceChildren(); error.textContent = ''; dialog.showModal();
}
