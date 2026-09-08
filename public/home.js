import { filterEntries } from './model.js';
import { $, icon, installIcons, request, textElement, applyAppearance, makeResourceCard, observeResourceStatuses, storageGet, storageSet, showToast, cityPicker } from './ui.js';

let documentData, type = 'apps', searchScope = 'web', activeTag = '', fullIp = '', showIp = false, visitor, weatherSequence = 0;
const isPreview = new URLSearchParams(location.search).has('preview');
// The appearance editor embeds the homepage in an iframe. Keep preview interactions
// inside the frame so a click on the brand cannot navigate away from preview mode.
if (isPreview) document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (link?.classList.contains('brand')) { event.preventDefault(); event.stopPropagation(); }
}, true);
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
  setTheme(documentData.settings.theme);
  $('#search-engine').value = documentData.settings.defaultEngine;
  $('#category-filter').replaceChildren(new Option('全部分类', ''), ...documentData.categories.map(x => new Option(x.name, x.id)));
  const tags = $('#tag-filters'); tags.replaceChildren();
  documentData.tags.forEach(tag => {
    const button = document.createElement('button'); button.className = 'tag-filter'; button.type = 'button'; button.dataset.tag = tag.id;
    button.setAttribute('aria-label', tag.name); button.setAttribute('aria-pressed', 'false');
    const count = textElement('small', '', 'tag-count'); count.setAttribute('aria-hidden', 'true');
    button.append(icon('hash'), textElement('span', tag.name, 'tag-label'), count);
    button.onclick = () => { activeTag = activeTag === tag.id ? '' : tag.id; render(); }; tags.append(button);
  });
  render(); updateClock();
}
function render() {
  if (!documentData) return;
  const query = searchScope === 'web' ? '' : $('#query').value;
  $('#search-scope').querySelectorAll('[data-scope]').forEach(button => { const selected = button.dataset.scope === searchScope; button.setAttribute('aria-checked', String(selected)); button.tabIndex = selected ? 0 : -1; });
  $('#search-engine-field').hidden = searchScope !== 'web';
  $('#query').placeholder = searchScope === 'web' ? '今天想找点什么？' : '搜索名称、描述、分类或标签';
  const entries = filterEntries(documentData, { type, query, categoryId: $('#category-filter').value, tagId: activeTag });
  const collection = documentData.entries.filter(entry => entry.type === type);
  const filtered = Boolean(query || activeTag || $('#category-filter').value);
  const content = $('#content'); content.replaceChildren();
  $('#resource-count').textContent = collection.length;
  $('#results-status').textContent = filtered ? `${entries.length} / ${collection.length} 个` : `全部 ${collection.length} 个`;
  $('#reset-filters').hidden = !filtered;
  $('#clear-search').hidden = !$('#query').value;
  $('#tag-filters').querySelectorAll('button').forEach(button => {
    const selected = button.dataset.tag === activeTag; button.setAttribute('aria-pressed', String(selected));
    button.replaceChild(icon(selected ? 'check' : 'hash'), button.firstElementChild);
    button.querySelector('.tag-count').textContent = collection.filter(entry => entry.tagIds.includes(button.dataset.tag)).length;
  });
  $('#collection-tabs').querySelectorAll('button').forEach(button => { const selected = button.dataset.type === type; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
  content.setAttribute('aria-labelledby', `${type}-tab`);
  if (!entries.length) {
    const empty = textElement('div', '', 'empty'); empty.append(icon(filtered ? 'search-x' : 'inbox'), textElement('p', filtered ? '没有找到匹配的资源' : '暂无资源'));
    if (filtered) { const reset = textElement('button', '清除筛选', 'reset-filters'); reset.type = 'button'; reset.onclick = resetFilters; empty.append(reset); }
    content.append(empty); renderSuggestions(); return;
  }
  if (type === 'bookmarks') {
    [...documentData.categories, { id: '', name: '未分类' }].forEach(category => {
      const group = entries.filter(x => x.categoryId === category.id); if (!group.length) return;
      content.append(textElement('h3', category.name, 'group-title')); const grid = textElement('div', '', 'resource-grid'); group.forEach(x => grid.append(makeResourceCard(x, { withStatus: !isPreview }))); content.append(grid);
    });
  } else { const grid = textElement('div', '', 'resource-grid'); entries.forEach(x => grid.append(makeResourceCard(x, { withStatus: !isPreview }))); content.append(grid); }
  observeResourceStatuses(content); renderSuggestions();
}
function switchType(next) { type = next; if (searchScope !== 'web') searchScope = type; render(); }
$('#collection-tabs').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) switchType(button.dataset.type); });
$('#collection-tabs').addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); switchType(event.key === 'Home' ? 'apps' : event.key === 'End' ? 'bookmarks' : type === 'apps' ? 'bookmarks' : 'apps'); $(`#${type}-tab`).focus(); } });
const suggestionBox = $('#search-suggestions');
let suggestionIndex = -1;
function hideSuggestions() {
  suggestionBox.hidden = true; suggestionIndex = -1; $('#query').setAttribute('aria-expanded', 'false'); $('#query').removeAttribute('aria-activedescendant');
}
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
  suggestionIndex = -1; $('#query').removeAttribute('aria-activedescendant');
  if (!query || (!entries.length && !tags.length)) { hideSuggestions(); return; }
  tags.forEach(tag => {
    const button = textElement('button', `标签 · ${tag.name}`, 'search-suggestion'); button.type = 'button'; button.dataset.tag = tag.id; button.setAttribute('role', 'option'); suggestionBox.append(button);
  });
  entries.forEach(entry => {
    const category = documentData.categories.find(x => x.id === entry.categoryId)?.name || '';
    const button = textElement('button', `${entry.name} · ${entry.type === 'apps' ? '应用' : '书签'}${category ? ' · ' + category : ''}`, 'search-suggestion'); button.type = 'button'; button.dataset.entry = entry.id; button.setAttribute('role', 'option'); suggestionBox.append(button);
  });
  [...suggestionBox.children].forEach((button, index) => { button.id = `suggestion-${index}`; button.tabIndex = -1; button.setAttribute('aria-selected', 'false'); });
  suggestionBox.hidden = false; $('#query').setAttribute('aria-expanded', 'true');
}
suggestionBox?.addEventListener('click', event => {
  const button = event.target.closest('[data-tag], [data-entry]'); if (!button) return;
  if (button.dataset.tag) { activeTag = button.dataset.tag; $('#query').value = ''; render(); hideSuggestions(); return; }
  const entry = documentData.entries.find(x => x.id === button.dataset.entry); if (entry) window.open(entry.url, '_blank', 'noopener,noreferrer');
  hideSuggestions();
});
$('#query').addEventListener('input', () => { render(); });
$('#query').addEventListener('focus', renderSuggestions);
$('#query').addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { if (!suggestionBox.hidden) event.preventDefault(); hideSuggestions(); return; }
  if (event.key === 'Tab') { hideSuggestions(); return; }
  if (suggestionBox.hidden) return;
  const options = [...suggestionBox.children];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : suggestionIndex < 0 ? 0 : -1) + options.length) % options.length;
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === suggestionIndex)));
    $('#query').setAttribute('aria-activedescendant', options[suggestionIndex].id); options[suggestionIndex].scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && suggestionIndex >= 0) { event.preventDefault(); options[suggestionIndex].click(); }
});
function resetFilters() { $('#query').value = ''; activeTag = ''; $('#category-filter').value = ''; render(); hideSuggestions(); $('#category-filter').focus(); }
$('#reset-filters').onclick = resetFilters;
$('#clear-search').onclick = () => { $('#query').value = ''; render(); hideSuggestions(); $('#query').focus(); };
$('#category-filter').onchange = render;
function switchScope(scope) { searchScope = scope; if (scope !== 'web') type = scope; render(); hideSuggestions(); }
$('#search-scope').onclick = event => { const button = event.target.closest('[data-scope]'); if (button) switchScope(button.dataset.scope); };
$('#search-scope').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const scopes = ['web', 'apps', 'bookmarks'];
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (scopes.indexOf(searchScope) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
  switchScope(scopes[index]); $('#search-scope').querySelector(`[data-scope="${searchScope}"]`).focus();
};
$('#search-form').onsubmit = event => {
  event.preventDefault(); const query = $('#query').value.trim(); if (!query) { $('#query').focus(); return; }
  if (searchScope !== 'web') return render();
  const urls = { google: 'https://www.google.com/search?q=', baidu: 'https://www.baidu.com/s?wd=', bing: 'https://www.bing.com/search?q=' };
  window.open(urls[$('#search-engine').value] + encodeURIComponent(query), '_blank', 'noopener,noreferrer');
};
function paintIp() {
  $('#visitor-ip').textContent = 'IP · ' + (fullIp ? showIp ? fullIp : fullIp.includes('.') ? fullIp.replace(/^(\d+)\..*\.(\d+)$/, '$1.***.***.$2') : fullIp.slice(0, 7) + '…' : '暂不可用');
  $('#visitor-ip').disabled = !fullIp; $('#visitor-ip').title = showIp ? '隐藏完整 IP' : '显示完整 IP';
  $('#visitor-ip').setAttribute('aria-pressed', String(showIp)); $('#visitor-ip').append(icon(showIp ? 'eye-off' : 'eye'));
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
    $('#weather-value').replaceChildren(textElement('span', `${Math.round(result.current.temperature)}°C`, 'weather-temperature'), document.createTextNode(' '), textElement('span', text, 'weather-condition'));
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
document.addEventListener('click', event => { if (!event.target.closest('#search-form')) hideSuggestions(); });
boot();
