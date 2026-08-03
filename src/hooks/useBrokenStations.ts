import { useState, useCallback } from 'react';

/**
 * 记住「点了播不出来」的电台。
 *
 * 数据库说某个台是通的，不代表现在真的能连上。这里在本机记一笔：
 * 播放失败 → 记下来，列表里置灰并沉到底部；
 * 播放成功 → 立刻消掉记录。
 *
 * 记录只保留 3 天——电台经常是临时抽风，过几天可能自己好了，
 * 一直拉黑反而会把好台埋掉。
 */

const KEY = 'global-radio-broken';
const TTL = 1000 * 60 * 60 * 24 * 3; // 3 天

type BrokenMap = { [stationId: string]: number };

function read(): BrokenMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as BrokenMap;
    const now = Date.now();
    const fresh: BrokenMap = {};
    for (const id of Object.keys(raw)) {
      if (typeof raw[id] === 'number' && now - raw[id] < TTL) fresh[id] = raw[id];
    }
    return fresh;
  } catch {
    return {};
  }
}

function write(map: BrokenMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

export function useBrokenStations() {
  const [broken, setBroken] = useState<BrokenMap>(read);

  const markBroken = useCallback((id: string) => {
    if (!id) return;
    setBroken(prev => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: Date.now() };
      write(next);
      return next;
    });
  }, []);

  const markWorking = useCallback((id: string) => {
    if (!id) return;
    setBroken(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      write(next);
      return next;
    });
  }, []);

  const isBroken = useCallback((id: string) => Boolean(broken[id]), [broken]);

  const clearBroken = useCallback(() => {
    setBroken({});
    write({});
  }, []);

  return { isBroken, markBroken, markWorking, clearBroken, brokenCount: Object.keys(broken).length };
}
