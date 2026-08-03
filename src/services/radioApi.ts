import type { Station } from '../types';

/**
 * radio-browser 有多个镜像服务器。只用一个的话，那台一挂整站就没数据了。
 * 这里按顺序尝试，哪台能用就记住哪台。
 */
const SERVERS = [
  'https://de1.api.radio-browser.info/json',
  'https://de2.api.radio-browser.info/json',
  'https://at1.api.radio-browser.info/json',
  'https://nl1.api.radio-browser.info/json',
];
let serverIndex = 0;

const DEFAULT_PARAMS = {
  hidebroken: 'true',
  order: 'clickcount',
  reverse: 'true',
};

/** 去重会刷掉不少条目，所以先多取一些，保证清理后数量还够。 */
const OVERFETCH = 3;

async function fetchJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ ...DEFAULT_PARAMS, ...params }).toString();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < SERVERS.length; attempt++) {
    const idx = (serverIndex + attempt) % SERVERS.length;
    try {
      // 注意：浏览器里不能自定义 User-Agent，强行设置反而会触发多余的预检请求。
      const res = await fetch(`${SERVERS[idx]}${path}?${query}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = (await res.json()) as T;
      serverIndex = idx; // 记住这台可用的服务器
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All radio-browser servers unreachable');
}

function bitrateParam(minBitrate: number): Record<string, string> {
  return minBitrate > 0 ? { bitrateMin: String(minBitrate) } : {};
}

// ── 清洗：去掉不可用的，去掉重复的 ───────────────────────────────────────────

/** 只保留字母数字和汉字，用来判断两条记录是不是同一个台名。 */
function normalizeName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '');
}

/** 同一个流地址（忽略协议、末尾斜杠、查询串）视为同一个电台。 */
function streamKey(station: Station): string {
  const raw = (station.url_resolved || station.url || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.host + u.pathname.replace(/\/+$/, '');
  } catch {
    return raw;
  }
}

/** 明显用不了的条目直接不显示。 */
function isUsable(s: Station): boolean {
  if (!s) return false;
  if (!s.name || !s.name.trim()) return false;
  if (!(s.url_resolved || s.url)) return false;
  // lastcheckok = 1 表示数据库最近一次巡检时这个流是通的
  if (s.lastcheckok !== 1) return false;
  return true;
}

/**
 * 过滤 + 去重。
 * 两道去重：先按流地址（同一个流不同名字），再按台名+国家（同一个台登记多次）。
 */
export function cleanStations(list: Station[], limit: number): Station[] {
  if (!Array.isArray(list)) return [];

  const seenStream = new Set<string>();
  const seenName = new Set<string>();
  const out: Station[] = [];

  for (const s of list) {
    if (!isUsable(s)) continue;

    const sk = streamKey(s);
    if (sk && seenStream.has(sk)) continue;

    const nk = normalizeName(s.name) + '|' + (s.countrycode || '');
    if (nk.length > 1 && seenName.has(nk)) continue;

    if (sk) seenStream.add(sk);
    if (nk.length > 1) seenName.add(nk);

    out.push(s);
    if (out.length >= limit) break;
  }

  return out;
}

// ── 对外接口 ────────────────────────────────────────────────────────────────

export async function getTopStations(limit = 60, minBitrate = 0): Promise<Station[]> {
  const raw = await fetchJson<Station[]>('/stations/topclick', {
    limit: String(limit * OVERFETCH),
    ...bitrateParam(minBitrate),
  });
  return cleanStations(raw, limit);
}

export async function searchStations(query: string, limit = 60, minBitrate = 0): Promise<Station[]> {
  const raw = await fetchJson<Station[]>('/stations/search', {
    name: query,
    limit: String(limit * OVERFETCH),
    order: 'votes',
    reverse: 'true',
    ...bitrateParam(minBitrate),
  });
  return cleanStations(raw, limit);
}

export async function getStationsByCountry(countrycode: string, limit = 60): Promise<Station[]> {
  const raw = await fetchJson<Station[]>(`/stations/bycountrycodeexact/${countrycode}`, {
    limit: String(limit * OVERFETCH),
  });
  return cleanStations(raw, limit);
}

export async function getStationsByTag(tag: string, limit = 60, minBitrate = 0): Promise<Station[]> {
  const raw = await fetchJson<Station[]>('/stations/bytag/' + encodeURIComponent(tag), {
    limit: String(limit * OVERFETCH),
    ...bitrateParam(minBitrate),
  });
  return cleanStations(raw, limit);
}

export async function recordClick(stationuuid: string): Promise<void> {
  await fetch(`${SERVERS[serverIndex]}/url/${stationuuid}`).catch(() => {});
}
