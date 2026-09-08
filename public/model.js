export const themeNames = { classic: '经典 · 圆润旧版', sky: '晴空 · 轻盈白', graphite: '终端 · 石墨黑', forest: '山岚 · 自然绿', porcelain: '月白 · 极简' };
export const backupByteLimit = 35 * 1024 * 1024;
export function normalizeWebUrl(value) {
  const url = String(value ?? '').trim();
  if (!url || /^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (/^[/?#]/.test(url)) return url;
  const hostWithPort = /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(url);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !hostWithPort) return url;
  return 'https://' + url;
}
let clientIdSequence = 0;
export function faviconUrls(value) {
  const url = new URL(value), host = encodeURIComponent(url.hostname);
  return [new URL('/favicon.ico', url).href, `https://www.google.com/s2/favicons?domain=${host}&sz=64`, `https://icons.duckduckgo.com/ip3/${host}.ico`];
}
export function createClientId(cryptoApi = globalThis.crypto) {
  try { if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID(); } catch {}
  try {
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {}
  // Resource identifiers, never session tokens or other secrets.
  return `client-${Date.now().toString(36)}-${(++clientIdSequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
const layout = (extra = {}) => ({ maxWidth: 1280, pageGutter: 40, panelRadius: 0, panelGap: 0, overviewPadding: 38, resourcesPadding: 32, overviewGap: 60, gridGap: 14, cardPadding: 22, cardMinWidth: 240, panelShadow: 0, cardLift: 0, borderMode: 'subtle', overviewLayout: 'split', resourceView: 'grid', ...extra });
const background = (color, text, extra = {}) => ({ mode: 'solid', color, text, gradientTo: color, angle: 135, image: '', position: 'center', size: 'cover', overlay: '#000000', opacity: 0, ...extra });
export const themeDefaults = {
  porcelain: {
    style: 'porcelain',
    page: background('#f7f8f8', '#202724'),
    overview: background('#ffffff', '#202724'), resources: background('#f7f8f8', '#202724'),
    card: { color: '#ffffff', text: '#202724', opacity: 100, radius: 8 },
    layout: layout({ maxWidth: 1400, pageGutter: 40, panelRadius: 0, panelGap: 0, overviewPadding: 56, resourcesPadding: 36, overviewGap: 72, gridGap: 12, cardPadding: 20, cardMinWidth: 240, panelShadow: 0, cardLift: 0, borderMode: 'subtle', overviewLayout: 'split', resourceView: 'grid' }),
  },
  classic: {
    style: 'classic',
    page: background('#1c1c1e', '#f7fafc', { mode: 'gradient', gradientTo: '#303238', angle: 145 }),
    overview: background('#2c2c2e', '#f7fafc'), resources: background('#2c2c2e', '#f7fafc'),
    card: { color: '#3a3a3c', text: '#f7fafc', opacity: 100, radius: 18 },
    layout: layout({ maxWidth: 1400, panelRadius: 28, panelGap: 24, overviewPadding: 48, resourcesPadding: 48, overviewGap: 48, gridGap: 16, cardPadding: 20, cardMinWidth: 220, panelShadow: 24, cardLift: 4, borderMode: 'none' }),
  },
  sky: {
    style: 'editorial',
    page: background('#edf2f8', '#202b3d', { mode: 'gradient', gradientTo: '#fafcfe' }),
    overview: background('#ffffff', '#202b3d'), resources: background('#ffffff', '#202b3d'),
    card: { color: '#f4f7fb', text: '#202b3d', opacity: 100, radius: 8 },
    layout: layout(),
  },
  graphite: {
    style: 'terminal',
    page: background('#191a1d', '#f1f3f5'), overview: background('#25272b', '#f1f3f5'),
    resources: background('#25272b', '#f1f3f5'), card: { color: '#303338', text: '#f1f3f5', opacity: 100, radius: 3 },
    layout: layout({ panelRadius: 2, panelGap: 8, overviewPadding: 28, resourcesPadding: 28, overviewGap: 40, gridGap: 8, cardPadding: 14, resourceView: 'list', borderMode: 'defined' }),
  },
  forest: {
    style: 'immersive',
    page: background('#e2ebe5', '#203d32', { mode: 'image', image: '/assets/mountains.jpg', overlay: '#e7f0ea', opacity: 40 }),
    overview: background('#f6faf7', '#203d32'), resources: background('#f6faf7', '#203d32'),
    card: { color: '#e5eee8', text: '#203d32', opacity: 92, radius: 12 },
    layout: layout({ maxWidth: 1200, panelRadius: 16, panelGap: 16, overviewPadding: 28, resourcesPadding: 32, overviewGap: 24, gridGap: 16, cardPadding: 20, panelShadow: 10, cardLift: 2, overviewLayout: 'stacked' }),
  },
};
export const layoutPresets = {
  compact: { pageGutter: 24, panelGap: 8, overviewPadding: 28, resourcesPadding: 28, overviewGap: 24, gridGap: 10, cardPadding: 14, cardMinWidth: 200 },
  standard: { pageGutter: 40, panelGap: 16, overviewPadding: 38, resourcesPadding: 32, overviewGap: 40, gridGap: 14, cardPadding: 20, cardMinWidth: 240 },
  roomy: { pageGutter: 56, panelGap: 24, overviewPadding: 52, resourcesPadding: 44, overviewGap: 56, gridGap: 20, cardPadding: 26, cardMinWidth: 280 },
};

function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function normalizeAppearance(base, value) {
  if (value === undefined) return structuredClone(base);
  if (!record(value)) return value;
  return {
    ...value,
    style: value.style === undefined ? base.style : value.style,
    layout: value.layout === undefined ? structuredClone(base.layout) : value.layout,
  };
}
export function normalizeDocument(value) {
  if (!record(value) || !record(value.settings) || !record(value.settings.appearances)) return value;
  const next = structuredClone(value);
  // Earlier backups have three color themes and no layout fields.
  for (const name of ['classic', 'porcelain']) if (next.settings.appearances[name] === undefined) next.settings.appearances[name] = structuredClone(themeDefaults[name]);
  for (const [name, base] of Object.entries(themeDefaults)) next.settings.appearances[name] = normalizeAppearance(base, next.settings.appearances[name]);
  return next;
}
export const defaultCity = { name: '北京', country: '中国', latitude: 39.9042, longitude: 116.4074 };
export function createDefaultDocument() {
  const categories = ['开发工具', '效率应用', '设计创作', '技术社区'].map((name, i) => ({ id: `category-${i}`, name }));
  const tags = ['AI', '开发', '设计', '协作', '阅读'].map((name, i) => ({ id: `tag-${i}`, name }));
  const resources = [
    ['GitHub', '代码与灵感，在这里相遇', 'https://github.com', 0, [1], 'apps'],
    ['ChatGPT', '随时开始一场新的对话', 'https://chatgpt.com', 1, [0], 'apps'],
    ['Excalidraw', '把想法画出来', 'https://excalidraw.com', 2, [2, 3], 'apps'],
    ['Cloudflare', '连接你的网站与世界', 'https://dash.cloudflare.com', 0, [1], 'apps'],
    ['Notion', '笔记、知识与日常计划', 'https://www.notion.so', 1, [3], 'apps'],
    ['Figma', '一起设计下一个好作品', 'https://www.figma.com', 2, [2, 3], 'apps'],
    ['MDN', '可信赖的 Web 开发文档', 'https://developer.mozilla.org/zh-CN/', 0, [1], 'bookmarks'],
    ['少数派', '发现更好的数字生活', 'https://sspai.com', 3, [4], 'bookmarks'],
    ['Vercel', '让创意轻松上线', 'https://vercel.com', 0, [1], 'bookmarks'],
    ['开源中国', '与开源社区一起成长', 'https://www.oschina.net', 3, [1, 4], 'bookmarks'],
    ['Bing', '发现值得探索的世界', 'https://www.bing.com', 1, [4], 'bookmarks'],
    ['Wikipedia', '自由的百科全书', 'https://www.wikipedia.org', 3, [4], 'bookmarks'],
  ];
  return { version: 1, settings: { siteName: '我的导航', logo: '', greeting: '', footer: '我的导航 · 把日常收藏在这里', defaultEngine: 'google', defaultCity: structuredClone(defaultCity), theme: 'sky', appearances: structuredClone(themeDefaults) }, categories, tags,
    entries: resources.map(([name, description, url, category, labelIds, type], i) => ({ id: `entry-${i}`, name, description, url, categoryId: categories[category].id, tagIds: labelIds.map(n => tags[n].id), type, icon: '' })) };
}
export function filterEntries(document, { type = 'apps', query = '', categoryId = '', tagId = '' } = {}) {
  const tokens = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return document.entries.filter(entry => {
    const category = document.categories.find(x => x.id === entry.categoryId)?.name || '';
    const tags = document.tags.filter(x => entry.tagIds.includes(x.id)).map(x => x.name).join(' ');
    const text = `${entry.name} ${entry.description} ${category} ${tags}`.normalize('NFKC').toLocaleLowerCase();
    return entry.type === type && (!categoryId || entry.categoryId === categoryId) && (!tagId || entry.tagIds.includes(tagId)) && tokens.every(token => text.includes(token));
  });
}
