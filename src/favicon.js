import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';
import decodeIco from 'decode-ico';
import { parse } from 'parse5';
import { isWebUrl } from './schema.js';
import { faviconUrls } from '../public/model.js';

const maxBytes = 2 * 1024 * 1024;
const maxHtmlBytes = 512 * 1024;
const maxRedirects = 3;
const requestTimeout = 3000;
const blocked = new BlockList(), globalV6 = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix);
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6');
function publicAddress(address) {
  return isIP(address) === 4 ? !blocked.check(address) : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
function hostname(url) { return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, ''); }
function unsafeTarget() { const error = Error('Non-public favicon target'); error.code = 'PRIVATE_TARGET'; return error; }
function validateTarget(url) {
  const host = hostname(url);
  if (!isWebUrl(url.href) || !host || /(^|\.)(localhost|local|internal|lan|home|onion)$/i.test(host) || (isIP(host) && !publicAddress(host))) throw unsafeTarget();
}
function bounded(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function requestResource(url, { address, family, signal, accept = '*/*', limit = maxBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get({ hostname: address, family, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search,
      servername: isIP(hostname(url)) ? '' : hostname(url), agent: false, signal,
      headers: { Host: url.host, Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'Home-Page-Favicon/1.0' },
    }, response => {
      let size = 0; const chunks = [];
      if (Number(response.headers['content-length']) > limit) { response.destroy(Error('Favicon too large')); }
      response.on('error', reject);
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) { response.destroy(Error('Favicon too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300,
        headers: new Headers(Object.entries(response.headers).filter(([, value]) => value !== undefined)), arrayBuffer: async () => Buffer.concat(chunks),
      }));
    });
    request.on('error', reject);
  });
}
async function convertFavicon(bytes) {
  if (!bytes.length || bytes.length > maxBytes) throw Error('Invalid favicon size');
  let raw;
  if (bytes.length >= 6 && bytes.readUInt32LE(0) === 0x00010000) {
    const count = bytes.readUInt16LE(4), end = 6 + count * 16;
    if (!count || count > 32 || end > bytes.length) throw Error('Invalid ICO directory');
    const entries = Array.from({ length: count }, (_, index) => {
      const offset = 6 + index * 16, size = bytes.readUInt32LE(offset + 8), start = bytes.readUInt32LE(offset + 12);
      if (!size || start < end || start + size > bytes.length) throw Error('Invalid ICO image');
      return { offset, size, start, width: bytes[offset] || 256, height: bytes[offset + 1] || 256 };
    }).sort((a, b) => b.width * b.height - a.width * a.height);
    const best = entries[0], payload = bytes.subarray(best.start, best.start + best.size);
    if (!payload.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      if (payload.length < 40 || payload.readUInt32LE(0) < 40 || payload.readInt32LE(4) !== best.width || Math.abs(payload.readInt32LE(8)) !== best.height * 2) throw Error('Invalid ICO bitmap dimensions');
    }
    const single = Buffer.alloc(22 + payload.length);
    bytes.copy(single, 0, 0, 6); single.writeUInt16LE(1, 4);
    bytes.copy(single, 6, best.offset, best.offset + 16); single.writeUInt32LE(22, 18); payload.copy(single, 22);
    const image = decodeIco(single)[0]; bytes = Buffer.from(image.data);
    if (image.type === 'bmp') raw = { width: image.width, height: image.height, channels: 4 };
  }
  const pipeline = sharp(bytes, { limitInputPixels: 1_048_576, animated: false, ...(raw ? { raw } : {}) });
  const meta = await pipeline.metadata();
  if (!['png', 'jpeg', 'webp', 'gif', 'raw'].includes(meta.format)) throw Error('Unsupported favicon image');
  return pipeline.rotate().resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
}
async function fetchValidated(url, { lookup, request, signal, accept, limit }) {
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    validateTarget(url);
    const host = hostname(url);
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await bounded(lookup(host, { all: true, verbatim: true }), signal);
    if (!addresses.length) throw Error('Favicon DNS unavailable');
    if (addresses.some(item => !publicAddress(item.address))) throw unsafeTarget();
    const response = await bounded(request(url, { ...addresses[0], signal, accept, limit }), signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); if (!location) throw Error('Invalid redirect');
      url = new URL(location, url); continue;
    }
    if (!response.ok || Number(response.headers.get('content-length')) > limit) throw Error('Favicon unavailable');
    const bytes = Buffer.from(await bounded(response.arrayBuffer(), signal));
    if (bytes.length > limit) throw Error('Favicon too large');
    return { url, response, bytes };
  }
  throw Error('Too many favicon redirects');
}
function attributes(node) { return Object.fromEntries((node.attrs || []).map(({ name, value }) => [name.toLowerCase(), value])); }
function walk(node, callback) {
  if (!node) return;
  callback(node);
  for (const child of node.childNodes || []) walk(child, callback);
}
function httpUrl(value, base) {
  try {
    const url = new URL(value, base);
    validateTarget(url);
    return url;
  } catch { return null; }
}
function declaredIcons(html, pageUrl) {
  const document = parse(html);
  const links = [], manifests = [];
  let base = pageUrl;
  walk(document, node => {
    if (node.tagName === 'base') {
      const href = attributes(node).href;
      const candidate = href && httpUrl(href, pageUrl);
      if (candidate) base = candidate.href;
    }
    if (node.tagName !== 'link') return;
    const attrs = attributes(node), rel = (attrs.rel || '').toLowerCase().split(/\s+/).filter(Boolean), href = attrs.href;
    if (!href) return;
    const candidate = httpUrl(href, base);
    if (!candidate) return;
    if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) links.push(candidate.href);
    if (rel.includes('manifest')) manifests.push(candidate.href);
  });
  return { links: [...new Set(links)], manifests: [...new Set(manifests)] };
}
function manifestIcons(bytes, manifestUrl) {
  try {
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(manifest.icons)) return [];
    return [...new Set(manifest.icons.map(icon => icon && typeof icon.src === 'string' ? httpUrl(icon.src, manifestUrl)?.href : '').filter(Boolean))];
  } catch { return []; }
}
async function fetchImage(url, network, signal) {
  const result = await fetchValidated(new URL(url), { ...network, signal, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.1', limit: maxBytes });
  return convertFavicon(result.bytes);
}
export function createFaviconService({ lookup = dnsLookup, request = requestResource } = {}) {
  return async value => {
    let pageUrl;
    try { pageUrl = new URL(value); validateTarget(pageUrl); } catch { return null; }
    const network = { lookup, request };
    const ownSources = faviconUrls(value);
    const signal = AbortSignal.timeout(requestTimeout);
    try {
      try { return await fetchImage(ownSources[0], network, signal); } catch (error) { if (error.code === 'PRIVATE_TARGET') return null; }
      try {
        const htmlResult = await fetchValidated(new URL('/', pageUrl), { ...network, signal, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', limit: maxHtmlBytes });
        const declarations = declaredIcons(htmlResult.bytes.toString('utf8'), htmlResult.url.href);
        for (const candidate of declarations.links) {
          try { return await fetchImage(candidate, network, signal); } catch {}
        }
        const candidates = [];
        for (const manifest of declarations.manifests) {
          try {
            const manifestResult = await fetchValidated(new URL(manifest), { ...network, signal, accept: 'application/manifest+json,application/json,text/plain;q=0.9,*/*;q=0.1', limit: maxHtmlBytes });
            candidates.push(...manifestIcons(manifestResult.bytes, manifestResult.url.href));
          } catch {}
        }
        for (const candidate of [...new Set(candidates)]) {
          try { return await fetchImage(candidate, network, signal); } catch {}
        }
      } catch {}
      for (const source of ownSources.slice(1)) {
        try { return await fetchImage(source, network, signal); } catch {}
      }
    } catch {}
    return null;
  };
}
export { declaredIcons };
