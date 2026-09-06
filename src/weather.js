import { isIP } from 'node:net';
import { z } from 'zod';
import { citySchema } from './schema.js';

const weatherCodes = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
const currentWeatherSchema = z.object({
  temperature_2m: z.number().min(-100).max(100),
  weather_code: z.number().int().refine(code => weatherCodes.has(code)),
  is_day: z.union([z.literal(0), z.literal(1)]),
  time: z.iso.datetime({ local: true }),
});

export const isLoopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
export function isPublicIp(value) {
  const ip = value?.replace(/^::ffff:/, '') || '';
  if (!isIP(ip)) return false;
  if (isIP(ip) === 6) return !/^(::|f[cd]|fe[89ab]|ff)/i.test(ip);
  const [a, b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}
function cacheRequests(ttl, max = 256) {
  const values = new Map();
  return async (key, task) => {
    const hit = values.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (values.size >= max) values.delete(values.keys().next().value);
    const record = { expires: Date.now() + ttl, value: Promise.resolve().then(task) };
    values.set(key, record);
    try { return await record.value; } catch (error) { record.expires = Date.now() + 15000; throw error; }
  };
}
export function createWeatherService(fetcher = fetch) {
  const geoCache = cacheRequests(10 * 60_000), weatherCache = cacheRequests(15 * 60_000), cityCache = cacheRequests(60 * 60_000);
  async function json(url) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error('外部服务暂不可用');
    return response.json();
  }
  return {
    async visitor(address) {
      let ip = address?.replace(/^::ffff:/, '') || '', source = 'visitor';
      try {
        if (isLoopback(address)) {
          source = 'local-egress';
          ip = await geoCache('local-egress', async () => {
            try { return (await json('https://api.ipify.org?format=json')).ip; }
            catch { return (await json('https://ipwho.is/')).ip; }
          });
        }
        if (!isPublicIp(ip)) return { ip: isIP(ip) ? ip : '', source: 'private', location: null };
        const location = await geoCache(ip, async () => {
          const result = await json(`https://ipwho.is/${encodeURIComponent(ip)}?lang=zh`);
          if (!result.success) throw new Error('定位不可用');
          const city = citySchema.parse({ name: result.city || result.region || '未知城市', country: result.country || '', latitude: result.latitude, longitude: result.longitude });
          return { ...city, isp: String(result.connection?.isp || '').slice(0, 150), timezone: result.timezone?.id || '' };
        });
        return { ip, source, location };
      } catch { return { ip: isIP(ip) && !isLoopback(ip) ? ip : '', source, location: null }; }
    },
    async weather(city) {
      try {
        const current = await weatherCache(`${city.latitude.toFixed(2)},${city.longitude.toFixed(2)}`, async () => {
          const params = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude, current: 'temperature_2m,weather_code,is_day', timezone: 'auto' });
          const result = await json(`https://api.open-meteo.com/v1/forecast?${params}`);
          const current = currentWeatherSchema.parse(result.current);
          return { temperature: current.temperature_2m, code: current.weather_code, isDay: current.is_day === 1, time: current.time, fetchedAt: new Date().toISOString() };
        });
        return { city, current, unavailable: false };
      } catch { return { city, current: null, unavailable: true }; }
    },
    async cities(name) {
      return cityCache(name.toLocaleLowerCase(), async () => {
        const params = new URLSearchParams({ name, count: 8, language: 'zh', format: 'json' });
        const result = await json(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
        return (result.results || []).map(x => ({ name: x.name, country: [x.admin1, x.country].filter(Boolean).join(' · '), latitude: x.latitude, longitude: x.longitude })).filter(x => citySchema.safeParse(x).success);
      });
    },
  };
}
