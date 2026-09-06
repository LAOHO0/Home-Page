import { z } from 'zod';
import { normalizeDocument } from '../public/model.js';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const uploadPath = /^\/uploads\/[a-f0-9-]{36}\.webp$/;
export function isWebUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export const imageUrl = z.string().max(2000).refine(x => !x || uploadPath.test(x) || /^\/assets\/[a-zA-Z0-9._-]+$/.test(x) || isWebUrl(x), '图片地址必须为 HTTP(S) URL 或本站图片');
export const citySchema = z.object({ name: z.string().trim().min(1).max(100), country: z.string().max(100), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict();
const layer = z.object({ mode: z.enum(['solid', 'gradient', 'image']), color, text: color, gradientTo: color, angle: z.number().min(0).max(360), image: imageUrl, position: z.enum(['center', 'top', 'bottom', 'left', 'right']), size: z.enum(['cover', 'contain', 'auto']), overlay: color, opacity: z.number().min(0).max(100) }).strict();
const layout = z.object({
  maxWidth: z.number().int().min(960).max(1600), pageGutter: z.number().int().min(16).max(96),
  panelRadius: z.number().int().min(0).max(32), panelGap: z.number().int().min(0).max(48),
  overviewPadding: z.number().int().min(20).max(72), resourcesPadding: z.number().int().min(20).max(72),
  overviewGap: z.number().int().min(16).max(96), gridGap: z.number().int().min(8).max(32),
  cardPadding: z.number().int().min(12).max(36), cardMinWidth: z.number().int().min(180).max(360),
  panelShadow: z.number().int().min(0).max(40), cardLift: z.number().int().min(0).max(8),
  borderMode: z.enum(['none', 'subtle', 'defined']), overviewLayout: z.enum(['split', 'stacked']), resourceView: z.enum(['grid', 'list']),
}).strict();
const appearance = z.object({ style: z.enum(['classic', 'editorial', 'terminal', 'immersive', 'porcelain']), page: layer, overview: layer, resources: layer, card: z.object({ color, text: color, opacity: z.number().min(0).max(100), radius: z.number().min(0).max(24) }).strict(), layout }).strict();
const taxonomy = z.object({ id, name: z.string().trim().min(1).max(40) }).strict();
const documentShape = z.object({
  version: z.literal(1),
  settings: z.object({ siteName: z.string().trim().min(1).max(60), logo: imageUrl, greeting: z.string().max(160), footer: z.string().max(300), defaultEngine: z.enum(['google', 'baidu', 'bing']), defaultCity: citySchema, theme: z.enum(['classic', 'sky', 'graphite', 'forest', 'porcelain']), appearances: z.object({ classic: appearance, sky: appearance, graphite: appearance, forest: appearance, porcelain: appearance }).strict() }).strict(),
  categories: z.array(taxonomy).max(100), tags: z.array(taxonomy).max(200),
  entries: z.array(z.object({ id, type: z.enum(['apps', 'bookmarks']), name: z.string().trim().min(1).max(80), description: z.string().max(200), url: z.string().max(2000).refine(isWebUrl, '网址必须以 http:// 或 https:// 开头'), icon: imageUrl, categoryId: id.or(z.literal('')), tagIds: z.array(id).max(30) }).strict()).max(2000),
}).strict().superRefine((doc, ctx) => {
  for (const key of ['categories', 'tags', 'entries']) {
    if (new Set(doc[key].map(x => x.id)).size !== doc[key].length) ctx.addIssue({ code: 'custom', path: [key], message: 'ID 不能重复' });
  }
  for (const key of ['categories', 'tags']) {
    if (new Set(doc[key].map(x => x.name.toLocaleLowerCase())).size !== doc[key].length) ctx.addIssue({ code: 'custom', path: [key], message: '名称不能重复' });
  }
  for (const entry of doc.entries) {
    if (entry.categoryId && !doc.categories.some(x => x.id === entry.categoryId)) ctx.addIssue({ code: 'custom', path: ['entries'], message: '分类不存在' });
    if (new Set(entry.tagIds).size !== entry.tagIds.length || entry.tagIds.some(id => !doc.tags.some(x => x.id === id))) ctx.addIssue({ code: 'custom', path: ['entries'], message: '标签不存在或重复' });
  }
});
export const documentSchema = z.preprocess(normalizeDocument, documentShape);
export const credentialsSchema = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(12, '密码至少 12 位').max(128) }).strict();
export function imageReferences(doc) {
  return [...new Set([doc.settings.logo, ...doc.entries.map(x => x.icon), ...Object.values(doc.settings.appearances).flatMap(x => [x.page.image, x.overview.image, x.resources.image])].filter(x => uploadPath.test(x)))];
}
