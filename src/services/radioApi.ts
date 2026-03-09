import type { Station } from '../types';

const BASE_URL = 'https://de1.api.radio-browser.info/json';

const DEFAULT_PARAMS = {
  hidebroken: 'true',
  order: 'clickcount',
  reverse: 'true',
};

async function fetchJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const query = new URLSearchParams({ ...DEFAULT_PARAMS, ...params }).toString();
  const res = await fetch(`${BASE_URL}${path}?${query}`, {
    headers: { 'User-Agent': 'FreeGlobalRadioApp/1.0' },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function bitrateParam(minBitrate: number): Record<string, string> {
  return minBitrate > 0 ? { bitrateMin: String(minBitrate) } : {};
}

export async function getTopStations(limit = 60, minBitrate = 0): Promise<Station[]> {
  return fetchJson<Station[]>('/stations/topclick', {
    limit: String(limit),
    ...bitrateParam(minBitrate),
  });
}

export async function searchStations(query: string, limit = 60, minBitrate = 0): Promise<Station[]> {
  return fetchJson<Station[]>('/stations/search', {
    name: query,
    limit: String(limit),
    order: 'votes',
    reverse: 'true',
    ...bitrateParam(minBitrate),
  });
}

export async function getStationsByCountry(countrycode: string, limit = 60): Promise<Station[]> {
  return fetchJson<Station[]>(`/stations/bycountrycodeexact/${countrycode}`, {
    limit: String(limit),
  });
}

export async function getStationsByTag(tag: string, limit = 60, minBitrate = 0): Promise<Station[]> {
  return fetchJson<Station[]>('/stations/bytag/' + encodeURIComponent(tag), {
    limit: String(limit),
    ...bitrateParam(minBitrate),
  });
}

export async function recordClick(stationuuid: string): Promise<void> {
  await fetch(`${BASE_URL}/url/${stationuuid}`).catch(() => {});
}
