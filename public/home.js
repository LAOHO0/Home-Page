import { filterEntries } from './model.js';
import { $, icon, installIcons, request, textElement, applyAppearance, makeResourceCard, observeResourceStatuses, storageGet, storageSet, showToast, cityPicker } from './ui.js';

let documentData, type = 'apps', activeTag = '', fullIp = '', showIp = false, visitor, weatherSequence = 0;
const isPreview = new URLSearchParams(location.search).has('preview');
let manualCity;
try { manualCity = JSON.parse(storageGet('navigation-city')); } catch {}
if (!manualCity || typeof manualCity.name !== 'string' || !Number.isFinite(manualCity.latitude) || !Number.isFinite(manualCity.longitude)) manualCity = null;
const codes = new Map([
  [0, ['晴', 'sun']], [1, ['晴间多云', 'cloud-sun']], [2, ['多云', 'cloud-sun']], [3, ['阴', 'cloud']], [45, ['雾', 'cloud-fog']], [48, ['雾凇', 'cloud-fog']],
  ...[51, 53, 55, 56, 57].map(code => [code, ['毛毛雨', 'cloud-drizzle']]), ...[61, 63, 65, 66, 67, 80, 81, 82].map(code => [code, ['雨', 'cloud-rain']]),
  ...[71, 73, 75, 77, 85, 86].map(code => [code, ['雪', 'cloud-snow']]), ...[95, 96, 99].map(code => [code, ['雷雨', 'cloud-lightning']]),
]);
function updateClock() {
  const now = new Date();
  $('#time').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#seconds').textContent = String(now.getSeconds()).padStart(2, '0');
  $('#date').textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const lunar = $('#lunar-date');
  if (lunar && window.Lunar) lunar.textContent = '农历' + window.Lunar.format(now);
  const hour = now.getHours();
  $('#greeting').textContent = documentData?.settings.greeting || (hour < 5 || hour >= 23 ? '夜深了，慢慢来。' : hour < 12 ? '早上好，开始美好的一天。' : hour < 18 ? '下午好，愿灵感常在。' : '晚上好，留一点时间给自己。');
}
function setTheme(theme) {
  applyAppearance(documentData, theme);
}
function populate() {
  document.title = documentData.settings.siteName; $('#site-name').textContent = documentData.settings.siteName;
  $('#footer-text').textContent = documentData.settings.footer;
  const logo = $('#brand-logo'); logo.replaceChildren(icon('compass'));
  if (documentData.settings.logo) { const img = new Image(32, 32); img.alt = ''; img.src = documentData.settings.logo; img.onload = () => logo.replaceChildren(img); }
  setTheme(documentData.settings.theme);
  $('#search-engine').value = documentData.settings.defaultEngine;
  $('#category-filter').replaceChildren(new Option('全部分类', ''), ...documentData.categories.map(x => new Option(x.name, x.id)));
  const tags = $('#tag-filters'); tags.replaceChildren();
  documentData.tags.forEach(tag => { const button = textElement('button', `# ${tag.name}`, 'tag-filter'); button.type = 'button'; button.dataset.tag = tag.id; button.setAttribute('aria-pressed', 'false'); button.onclick = () => { activeTag = activeTag === tag.id ? '' : tag.id; render(); }; tags.append(button); });
  render(); updateClock();
}
function render() {
  if (!documentData) return;
  const query = $('#search-scope').value === 'web' ? '' : $('#query').value;
  const entries = filterEntries(documentData, { type, query, categoryId: $('#category-filter').value, tagId: activeTag });
  const content = $('#content'); content.replaceChildren();
  $('#resource-count').textContent = documentData.entries.filter(x => x.type === type).length;
  $('#results-status').textContent = query || activeTag || $('#category-filter').value ? `${entries.length} 个结果` : '';
  $('#clear-search').hidden = !$('#query').value;
  $('#tag-filters').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tag === activeTag)));
  $('#collection-tabs').querySelectorAll('button').forEach(button => { const selected = button.dataset.type === type; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  content.setAttribute('aria-labelledby', `${type}-tab`);
  if (!entries.length) { content.append(textElement('p', query || activeTag || $('#category-filter').value ? '没有找到匹配的资源' : '暂无资源', 'empty')); renderSuggestions(); return; }
  if (type === 'bookmarks') {
    [...documentData.categories, { id: '', name: '未分类' }].forEach(category => {
      const group = entries.filter(x => x.categoryId === category.id); if (!group.length) return;
      content.append(textElement('h3', category.name, 'group-title')); const grid = textElement('div', '', 'resource-grid'); group.forEach(x => grid.append(makeResourceCard(x, { withStatus: !isPreview }))); content.append(grid);
    });
  } else { const grid = textElement('div', '', 'resource-grid'); entries.forEach(x => grid.append(makeResourceCard(x, { withStatus: !isPreview }))); content.append(grid); }
  observeResourceStatuses(content); renderSuggestions();
}
function switchType(next) { type = next; if ($('#search-scope').value !== 'web') $('#search-scope').value = type; render(); }
$('#collection-tabs').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) switchType(button.dataset.type); });
$('#collection-tabs').addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); switchType(event.key === 'Home' ? 'apps' : event.key === 'End' ? 'bookmarks' : type === 'apps' ? 'bookmarks' : 'apps'); $(`#${type}-tab`).focus(); } });
const suggestionBox = $('#search-suggestions');
function suggestionMatches(query) {
  const tokens = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { entries: [], tags: [] };
  const entries = documentData.entries.filter(entry => {
    const category = documentData.categories.find(x => x.id === entry.categoryId)?.name || '';
    const tags = documentData.tags.filter(x => entry.tagIds.includes(x.id)).map(x => x.name).join(' ');
    const text = `${entry.name} ${entry.description} ${category} ${tags}`.normalize('NFKC').toLocaleLowerCase();
    return tokens.every(token => text.includes(token));
  }).slice(0, 6);
  const tags = documentData.tags.filter(tag => tokens.every(token => tag.name.normalize('NFKC').toLocaleLowerCase().includes(token))).slice(0, 4);
  return { entries, tags };
}
function renderSuggestions() {
  if (!suggestionBox || !documentData) return;
  const query = $('#query').value.trim();
  const { entries, tags } = suggestionMatches(query);
  suggestionBox.replaceChildren();
  if (!query || (!entries.length && !tags.length)) { suggestionBox.hidden = true; return; }
  tags.forEach(tag => {
    const button = textElement('button', `标签 · ${tag.name}`, 'search-suggestion'); button.type = 'button'; button.dataset.tag = tag.id; button.setAttribute('role', 'option'); suggestionBox.append(button);
  });
  entries.forEach(entry => {
    const category = documentData.categories.find(x => x.id === entry.categoryId)?.name || '';
    const button = textElement('button', `${entry.name} · ${entry.type === 'apps' ? '应用' : '书签'}${category ? ' · ' + category : ''}`, 'search-suggestion'); button.type = 'button'; button.dataset.entry = entry.id; button.setAttribute('role', 'option'); suggestionBox.append(button);
  });
  suggestionBox.hidden = false;
}
suggestionBox?.addEventListener('click', event => {
  const button = event.target.closest('[data-tag], [data-entry]'); if (!button) return;
  if (button.dataset.tag) { activeTag = button.dataset.tag; $('#query').value = ''; suggestionBox.hidden = true; render(); return; }
  const entry = documentData.entries.find(x => x.id === button.dataset.entry); if (entry) window.open(entry.url, '_blank', 'noopener,noreferrer');
  suggestionBox.hidden = true;
});
$('#query').addEventListener('input', () => { render(); });
$('#query').addEventListener('keydown', event => { if (event.key === 'Escape') { suggestionBox.hidden = true; } });
$('#clear-search').onclick = () => { $('#query').value = ''; activeTag = ''; $('#category-filter').value = ''; suggestionBox.hidden = true; render(); $('#query').focus(); };
$('#category-filter').onchange = render;
$('#search-scope').onchange = () => { const scope = $('#search-scope').value; $('#search-engine').hidden = scope !== 'web'; $('#query').placeholder = scope === 'web' ? '今天想找点什么？' : '搜索名称、描述、分类或标签'; if (scope !== 'web') type = scope; render(); };
$('#search-form').onsubmit = event => {
  event.preventDefault(); const query = $('#query').value.trim(); if (!query) { $('#query').focus(); return; }
  if ($('#search-scope').value !== 'web') return render();
  const urls = { google: 'https://www.google.com/search?q=', baidu: 'https://www.baidu.com/s?wd=', bing: 'https://www.bing.com/search?q=' };
  window.open(urls[$('#search-engine').value] + encodeURIComponent(query), '_blank', 'noopener,noreferrer');
};
function paintIp() {
  $('#visitor-ip').textContent = 'IP · ' + (fullIp ? showIp ? fullIp : fullIp.includes('.') ? fullIp.replace(/^(\d+)\..*\.(\d+)$/, '$1.***.***.$2') : fullIp.slice(0, 7) + '…' : '暂不可用');
  $('#visitor-ip').disabled = !fullIp; $('#visitor-ip').title = showIp ? '隐藏完整 IP' : '显示完整 IP';
}
$('#visitor-ip').onclick = () => { showIp = !showIp; paintIp(); };
async function loadWeather() {
  const sequence = ++weatherSequence;
  const city = manualCity || visitor?.location || documentData.settings.defaultCity;
  $('#weather-city').replaceChildren(document.createTextNode(city.name), icon('chevron-down'));
  $('#weather-value').textContent = '正在获取';
  $('#weather-source').textContent = manualCity ? '手动选择' : visitor?.location ? '按 IP 定位' : '默认城市';
  try {
    const params = new URLSearchParams({ name: city.name, country: city.country || '', latitude: city.latitude, longitude: city.longitude });
    const result = await request('/api/weather?' + params);
    if (sequence !== weatherSequence) return;
    $('#weather-value').removeAttribute('title');
    if (result.fallback) {
      $('#weather-city').replaceChildren(document.createTextNode(result.city.name), icon('chevron-down'));
      $('#weather-source').textContent = '默认城市 · 原城市天气不可用';
    }
    if (!result.current) { $('#weather-value').textContent = '天气暂不可用'; $('#weather-icon').replaceChildren(icon('cloud-off')); return; }
    const [text, name] = codes.get(result.current.code) || ['未知天气', 'cloud'];
    $('#weather-value').textContent = `${text} · ${Math.round(result.current.temperature)}°C`;
    $('#weather-icon').replaceChildren(icon(name === 'sun' && !result.current.isDay ? 'moon' : name));
    $('#weather-value').title = '数据更新时间：' + result.current.time;
  } catch {
    if (sequence === weatherSequence) {
      $('#weather-value').textContent = '天气暂不可用'; $('#weather-value').removeAttribute('title'); $('#weather-icon').replaceChildren(icon('cloud-off'));
    }
  }
}
$('#weather-city').onclick = () => cityPicker(city => { manualCity = city; storageSet('navigation-city', JSON.stringify(city)); loadWeather(); }, () => { manualCity = null; storageSet('navigation-city', null); loadWeather(); });
async function boot() {
  installIcons(); updateClock(); setInterval(updateClock, 1000);
  try {
    const data = await request('/api/public-data'); documentData = data.document; populate();
    if (isPreview) { $('#weather-value').textContent = '天气'; $('#visitor-location').textContent = '主题预览'; $('#visitor-ip').textContent = ''; parent.postMessage({ type: 'navigation-preview-ready' }, location.origin); return; }
    try { visitor = await request('/api/visitor'); } catch { visitor = { location: null }; }
    fullIp = visitor.ip || ''; paintIp();
    $('#visitor-location').textContent = visitor.location ? `${visitor.location.country} · ${visitor.location.name}` : '位置暂不可用';
    $('#visitor-location').title = 'IP 预计位置';
    $('#visitor-isp').textContent = [visitor.location?.isp, visitor.source === 'local-egress' ? '本机公网出口' : ''].filter(Boolean).join(' · ');
    await loadWeather();
  } catch (error) { $('#content').replaceChildren(textElement('p', '资源加载失败，请刷新重试。', 'empty')); showToast(error.message, true); }
}
window.addEventListener('message', event => {
  if (!isPreview || event.origin !== location.origin || event.source !== parent || event.data?.type !== 'navigation-preview' || !event.data.document) return;
  documentData = event.data.document; populate(); setTheme(event.data.theme);
});
document.addEventListener('click', event => { if (!event.target.closest('#search-form')) suggestionBox?.setAttribute('hidden', ''); });
boot();
