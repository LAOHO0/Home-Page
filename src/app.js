import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { z, ZodError } from 'zod';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { citySchema, credentialsSchema, documentSchema, imageReferences, uploadPath } from './schema.js';
import { createWeatherService, isLoopback } from './weather.js';
import { backupByteLimit } from '../public/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashPassword = promisify(scrypt);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const ttl = 12 * 60 * 60 * 1000;
const revisionSchema = z.number().int().positive();
function failure(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function sessionToken(req) { return /(?:^|;\s*)navigation_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || ''; }

export async function createApp({ dataDir = process.env.DATA_DIR || path.join(root, 'data'), weather = createWeatherService(), allowLocalSetup = true, trustProxy = process.env.TRUST_PROXY || '', initialPassword = process.env.ADMIN_PASSWORD, initialUsername = process.env.ADMIN_USERNAME || 'admin' } = {}) {
  const database = openDatabase(dataDir);
  const uploads = path.join(dataDir, 'uploads');
  await fs.mkdir(uploads, { recursive: true });
  async function createAdmin(credentials) {
    const { username, password } = credentialsSchema.parse(credentials);
    const salt = randomBytes(16).toString('hex');
    const hash = (await hashPassword(password, salt, 64)).toString('hex');
    if (!database.createAdmin(username, salt, hash)) throw failure('管理员已存在，请登录。', 409);
  }
  if (!database.admin() && initialPassword) await createAdmin({ username: initialUsername, password: initialPassword });
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy.split(',').map(x => x.trim()));
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'https:', 'http:', 'data:', 'blob:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'self'"], frameSrc: ["'self'"], upgradeInsecureRequests: null } }, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let origin;
      try { origin = req.get('origin') ? new URL(req.get('origin')) : null; } catch { return next(failure('请求来源无效', 403)); }
      if ((origin && origin.host !== req.get('host')) || req.get('sec-fetch-site') === 'cross-site' || req.get('x-navigation-request') !== '1') return next(failure('请从本站管理页面提交操作。', 403));
    }
    next();
  });
  const apiLimit = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '请求过于频繁，请稍后重试。' } });
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 12, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '尝试次数过多，请 15 分钟后重试。' } });
  app.use('/api', apiLimit);
  function requireAdmin(req, res, next) { if (!database.authenticated(hashToken(sessionToken(req)))) return next(failure('登录已失效，请重新登录。', 401)); next(); }
  function login(req, res) {
    const token = randomBytes(32).toString('hex');
    database.session(hashToken(token), Date.now() + ttl);
    res.cookie('navigation_session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: ttl });
    res.json({ username: database.admin().username });
  }
  const localSetup = req => allowLocalSetup && isLoopback(req.socket.remoteAddress) && isLoopback(req.ip) && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.get('host') || '') && !req.get('x-forwarded-for') && !req.get('forwarded');
  app.get('/api/auth/status', (req, res) => res.json({ setupRequired: !database.admin(), setupAllowed: !database.admin() && localSetup(req), authenticated: database.authenticated(hashToken(sessionToken(req))), username: database.authenticated(hashToken(sessionToken(req))) ? database.admin()?.username : null }));
  app.post('/api/auth/setup', authLimit, express.json({ limit: '8kb' }), async (req, res) => { if (!localSetup(req)) throw failure('首次设置需要在服务器本机访问，或配置 ADMIN_PASSWORD 后启动服务。', 403); await createAdmin(req.body); login(req, res); });
  app.post('/api/auth/login', authLimit, express.json({ limit: '8kb' }), async (req, res) => {
    const { username, password } = z.object({ username: z.string().max(60), password: z.string().max(128) }).parse(req.body);
    const admin = database.admin();
    const hash = await hashPassword(password, admin?.salt || 'not-initialized', 64);
    if (!admin || username !== admin.username || !timingSafeEqual(hash, Buffer.from(admin.hash, 'hex'))) throw failure('用户名或密码不正确。', 401);
    login(req, res);
  });
  app.post('/api/auth/logout', (req, res) => { database.logout(hashToken(sessionToken(req))); res.clearCookie('navigation_session', { path: '/' }); res.json({ ok: true }); });
  app.get('/api/public-data', (req, res) => res.json(database.read()));
  app.get('/api/visitor', async (req, res) => res.json(await weather.visitor(req.ip)));
  app.get('/api/weather', async (req, res) => {
    const fallback = database.read().document.settings.defaultCity;
    const city = req.query.latitude === undefined ? fallback : citySchema.parse({ name: req.query.name, country: req.query.country || '', latitude: Number(req.query.latitude), longitude: Number(req.query.longitude) });
    const result = await weather.weather(city);
    if (!result.current && (city.latitude !== fallback.latitude || city.longitude !== fallback.longitude)) {
      return res.json({ ...await weather.weather(fallback), fallback: true, requestedCity: city });
    }
    res.json(result);
  });
  app.get('/api/cities', async (req, res) => {
    const name = z.string().trim().min(2).max(80).parse(req.query.q);
    try { res.json(await weather.cities(name)); } catch { throw failure('城市查询暂不可用，请稍后重试。', 503); }
  });
  app.use('/api/admin', requireAdmin);
  async function verifyImages(document) {
    for (const reference of imageReferences(document)) {
      try { await fs.access(path.join(uploads, path.basename(reference))); } catch { throw failure('配置引用的本地图片不存在，请重新上传。'); }
    }
  }
  app.put('/api/admin/document', express.json({ limit: '3mb' }), async (req, res) => {
    const revision = revisionSchema.parse(req.body?.revision);
    const document = documentSchema.parse(req.body?.document);
    await verifyImages(document);
    res.json(database.write(document, revision));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
  async function convertImage(buffer) {
    try {
      const pipeline = sharp(buffer, { limitInputPixels: 32_000_000, animated: false });
      const meta = await pipeline.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format) || meta.pages > 1) throw Error('format');
      return await pipeline.rotate().resize({ width: 2400, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
    } catch { throw failure('请选择有效的 PNG、JPG 或 WebP 图片（不超过 3200 万像素）。'); }
  }
  app.post('/api/admin/upload', upload.single('image'), async (req, res) => {
    if (!req.file) throw failure('请选择图片。');
    const bytes = await convertImage(req.file.buffer), name = randomUUID() + '.webp';
    await fs.writeFile(path.join(uploads, name), bytes, { flag: 'wx' });
    res.json({ url: '/uploads/' + name });
  });
  app.get('/api/admin/export', async (req, res) => {
    const { document } = database.read();
    const references = imageReferences(document);
    let estimatedBytes = Buffer.byteLength(JSON.stringify(document, null, 2));
    for (const reference of references) {
      estimatedBytes += 4 * Math.ceil((await fs.stat(path.join(uploads, path.basename(reference)))).size / 3);
      if (estimatedBytes > backupByteLimit) throw failure('备份超过 35 MB，请先压缩或移除部分自定义图片。');
    }
    const assets = {};
    for (const reference of references) assets[reference] = (await fs.readFile(path.join(uploads, path.basename(reference)))).toString('base64');
    const backup = { format: 'navigation-backup', version: 1, exportedAt: new Date().toISOString(), document, assets };
    if (Buffer.byteLength(JSON.stringify(backup, null, 2)) > backupByteLimit) throw failure('备份超过 35 MB，请先压缩或移除部分自定义图片。');
    res.set('Content-Disposition', 'attachment; filename="navigation-backup.json"');
    res.json(backup);
  });
  app.post('/api/admin/import', express.json({ limit: '40mb' }), async (req, res) => {
    const revision = revisionSchema.parse(req.body?.revision);
    const backup = z.object({ format: z.literal('navigation-backup'), version: z.literal(1), exportedAt: z.string(), document: documentSchema, assets: z.record(z.string().regex(uploadPath), z.string().max(7_000_000)).refine(x => Object.keys(x).length <= 2013, '图片数量过多') }).strict().parse(req.body?.backup);
    if (Buffer.byteLength(JSON.stringify(backup)) > backupByteLimit) throw failure('备份不能超过 35 MB。');
    const references = imageReferences(backup.document);
    const files = [], replacements = new Map();
    try {
      for (const reference of references) {
        if (!backup.assets[reference]) throw failure('备份缺少图片数据，请重新导出完整备份。');
        const bytes = await convertImage(Buffer.from(backup.assets[reference], 'base64'));
        const name = randomUUID() + '.webp';
        await fs.writeFile(path.join(uploads, name), bytes, { flag: 'wx' });
        files.push(path.join(uploads, name)); replacements.set(reference, '/uploads/' + name);
      }
      const doc = backup.document;
      doc.settings.logo = replacements.get(doc.settings.logo) || doc.settings.logo;
      doc.entries.forEach(x => { x.icon = replacements.get(x.icon) || x.icon; });
      Object.values(doc.settings.appearances).forEach(theme => ['page', 'overview', 'resources'].forEach(key => { theme[key].image = replacements.get(theme[key].image) || theme[key].image; }));
      res.json(database.write(doc, revision));
    } catch (error) { await Promise.allSettled(files.map(file => fs.unlink(file))); throw error; }
  });
  app.use('/uploads', (req, res, next) => uploadPath.test('/uploads' + req.path) ? next() : res.sendStatus(404), express.static(uploads, { index: false, immutable: true, maxAge: '1y', dotfiles: 'deny' }));
  app.use('/icons', express.static(path.join(root, 'node_modules/lucide-static/icons'), { index: false, maxAge: '1d' }));
  app.get('/vendor/sortable.js', (req, res) => res.sendFile(path.join(root, 'node_modules/sortablejs/Sortable.min.js')));
  app.use(express.static(path.join(root, 'public'), { dotfiles: 'deny' }));
  app.get('/admin', (req, res) => res.redirect('/admin.html'));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) return res.status(400).json({ error: '数据格式不正确：' + error.issues[0].message, field: error.issues[0].path.join('.') });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5 MB。' : '图片上传失败，请重新选择。' });
    const status = error.status || 500;
    if (status === 500) console.error('Request failed:', error.message);
    res.status(status).json({ error: status === 500 ? '保存或读取失败，请稍后重试。' : error.message });
  });
  app.locals.database = database;
  return app;
}
