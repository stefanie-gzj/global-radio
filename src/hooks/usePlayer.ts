import { useState, useRef, useCallback, useEffect } from 'react';
import type { Station } from '../types';
import { recordClick } from '../services/radioApi';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'error';
export type NormalizeState = 'active' | 'unavailable' | 'off';

const VOLUME_KEY = 'global-radio-volume';
const STATION_VOLUME_KEY = 'global-radio-station-volume';

/**
 * 各家电台的响度标准不一样，切台时忽大忽小。两条腿走路：
 *
 * 1. 电台允许跨域读取时（CORS）：接进 Web Audio，
 *    压缩器压掉峰值 → 实时测量响度 → 自动补偿增益，把不同电台拉到同一个响度。
 * 2. 电台不允许时（大多数）：没法处理音频，改成记住你为这个台手动调过的音量，
 *    下次播它自动恢复。第一次手调一下，之后一劳永逸。
 */

/** 目标响度（时域 RMS）。0.12 大约是普通音乐电台的正常水平。 */
const TARGET_RMS = 0.12;
/** 补偿增益的上下限，避免把噪底放大成噪音、或把强信号压得太狠。 */
const GAIN_MIN = 0.35;
const GAIN_MAX = 5;
/** 多久测量一次响度 */
const MEASURE_MS = 400;
/** 低于这个值认为是静音/间奏，不参与调整 */
const SILENCE_FLOOR = 0.0015;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function savedVolume(): number {
  try { return clamp(parseFloat(localStorage.getItem(VOLUME_KEY) || '0.8'), 0, 1); }
  catch { return 0.8; }
}

function readStationVolumes(): { [id: string]: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(STATION_VOLUME_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function writeStationVolume(id: string, v: number): void {
  if (!id) return;
  try {
    const map = readStationVolumes();
    map[id] = v;
    localStorage.setItem(STATION_VOLUME_KEY, JSON.stringify(map));
  } catch { /* 隐私模式写不进去，忽略 */ }
}

export function usePlayer() {
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const ctxRef      = useRef<AudioContext | null>(null);
  const gainRef     = useRef<GainNode | null>(null);   // 用户音量
  const makeupRef   = useRef<GainNode | null>(null);   // 自动补偿增益
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef    = useRef<number | null>(null);
  const bufRef      = useRef<Float32Array | null>(null);
  const playIdRef   = useRef(0);                        // 防止快速切台时的竞态
  const volumeRef   = useRef(savedVolume());
  const stationRef  = useRef<Station | null>(null);

  const [currentStation, setCurrentStation] = useState<Station | null>(null);
  const [playerState,    setPlayerState]    = useState<PlayerState>('idle');
  const [normalizeState, setNormalizeState] = useState<NormalizeState>('off');
  const [volume,         setVolumeState]    = useState(volumeRef.current);

  const stopMeasuring = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopMeasuring();
      audioRef.current?.pause();
      ctxRef.current?.close().catch(() => {});
    };
  }, [stopMeasuring]);

  // ── helpers ────────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    stopMeasuring();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    if (ctxRef.current)   { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
    gainRef.current = null;
    makeupRef.current = null;
    analyserRef.current = null;
    bufRef.current = null;
  }, [stopMeasuring]);

  const bindAudioEvents = useCallback((audio: HTMLAudioElement, id: number) => {
    audio.addEventListener('waiting', () => {
      if (playIdRef.current === id) setPlayerState('loading');
    });
    audio.addEventListener('playing', () => {
      if (playIdRef.current === id) setPlayerState('playing');
    });
    audio.addEventListener('pause', () => {
      if (playIdRef.current === id)
        setPlayerState(s => (s === 'playing' || s === 'loading') ? 'idle' : s);
    });
    audio.addEventListener('error', () => {
      if (playIdRef.current === id) setPlayerState('error');
    });
  }, []);

  /**
   * 持续测量压缩后的响度，缓慢地把补偿增益推向目标。
   * 测量点在补偿增益之前，所以不会自己追自己（不构成反馈环）。
   */
  const startMeasuring = useCallback((id: number) => {
    stopMeasuring();
    timerRef.current = window.setInterval(() => {
      const ctx = ctxRef.current;
      const analyser = analyserRef.current;
      const makeup = makeupRef.current;
      const buf = bufRef.current;
      if (playIdRef.current !== id || !ctx || !analyser || !makeup || !buf) return;

      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      if (rms < SILENCE_FLOOR) return; // 静音或间奏，跳过

      const desired = clamp(TARGET_RMS / rms, GAIN_MIN, GAIN_MAX);
      const current = makeup.gain.value;
      // 每次只走 25%，避免音量忽上忽下地“呼吸”
      const next = current + (desired - current) * 0.25;
      makeup.gain.setTargetAtTime(next, ctx.currentTime, 0.4);
    }, MEASURE_MS);
  }, [stopMeasuring]);

  // 音频链路：源 → 压缩器 → 自动补偿 → 用户音量 → 喇叭
  const buildGraph = useCallback((audio: HTMLAudioElement): AudioContext => {
    const ctx = new AudioContext({ latencyHint: 'playback' });
    const src = ctx.createMediaElementSource(audio);

    // 压缩器：压掉峰值，垫起细节
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value      = 24;
    comp.ratio.value     = 10;
    comp.attack.value    = 0.002;
    comp.release.value   = 0.2;

    // 自动补偿增益：由响度测量实时推动，用来拉平不同电台
    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    // 响度测量（旁路，不出声）
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    // 用户音量
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;

    src.connect(comp);
    comp.connect(analyser);      // 只测量，不往下接
    comp.connect(makeup);
    makeup.connect(gain);
    gain.connect(ctx.destination);

    ctxRef.current      = ctx;
    gainRef.current     = gain;
    makeupRef.current   = makeup;
    analyserRef.current = analyser;
    bufRef.current      = new Float32Array(analyser.fftSize);
    return ctx;
  }, []);

  // 尝试带 CORS 播放，成功才能做响度处理
  const playWithNormalization = useCallback(
    (url: string, id: number): Promise<boolean> =>
      new Promise(resolve => {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'none';

        let settled = false;
        const settle = (ok: boolean) => {
          if (settled || playIdRef.current !== id) return;
          settled = true;
          if (!ok) { audio.pause(); audio.src = ''; }
          resolve(ok);
        };

        const timer = setTimeout(() => settle(false), 5000);

        audio.addEventListener('playing', () => { clearTimeout(timer); settle(true); });
        audio.addEventListener('error',   () => { clearTimeout(timer); settle(false); });

        try {
          buildGraph(audio);
          audioRef.current = audio;
          bindAudioEvents(audio, id);
          audio.src = url;
          audio.load();
          audio.play().catch(() => { clearTimeout(timer); settle(false); });
        } catch {
          clearTimeout(timer);
          settle(false);
        }
      }),
    [buildGraph, bindAudioEvents]
  );

  // 普通 <audio> 兜底：不需要 CORS，但也做不了响度处理
  const playFallback = useCallback((url: string, id: number) => {
    const audio = new Audio();
    audio.preload = 'none';
    audio.volume  = volumeRef.current;
    bindAudioEvents(audio, id);
    audioRef.current = audio;
    audio.src = url;
    audio.load();
    audio.play().catch(() => { if (playIdRef.current === id) setPlayerState('error'); });
  }, [bindAudioEvents]);

  // ── public API ─────────────────────────────────────────────────────────────

  const play = useCallback(async (station: Station) => {
    teardown();
    const id  = ++playIdRef.current;
    const url = station.url_resolved || station.url;

    stationRef.current = station;
    setCurrentStation(station);
    setPlayerState('loading');
    setNormalizeState('off');

    // 这个台以前手动调过音量的话，先恢复到那个音量
    const remembered = readStationVolumes()[station.stationuuid];
    if (typeof remembered === 'number' && remembered >= 0 && remembered <= 1) {
      volumeRef.current = remembered;
      setVolumeState(remembered);
    }

    const normalized = await playWithNormalization(url, id);

    if (playIdRef.current !== id) return; // 用户已经切台了

    if (normalized) {
      setNormalizeState('active');
      startMeasuring(id);
    } else {
      teardown();
      if (playIdRef.current !== id) return;
      playFallback(url, id);
      setNormalizeState('unavailable');
    }

    recordClick(station.stationuuid);
  }, [teardown, playWithNormalization, playFallback, startMeasuring]);

  const stop = useCallback(() => {
    teardown();
    ++playIdRef.current;
    stationRef.current = null;
    setCurrentStation(null);
    setPlayerState('idle');
    setNormalizeState('off');
  }, [teardown]);

  const togglePlay = useCallback((station: Station) => {
    if (currentStation?.stationuuid === station.stationuuid && playerState === 'playing') {
      stop();
    } else {
      play(station);
    }
  }, [currentStation, playerState, play, stop]);

  const setVolume = useCallback((v: number) => {
    const vol = clamp(v, 0, 1);
    volumeRef.current = vol;
    setVolumeState(vol);
    try { localStorage.setItem(VOLUME_KEY, String(vol)); } catch { /* 忽略 */ }

    // 记住这个电台的音量：下次播它自动恢复
    const st = stationRef.current;
    if (st) writeStationVolume(st.stationuuid, vol);

    if (gainRef.current) {
      gainRef.current.gain.value = vol;   // Web Audio 链路
    } else if (audioRef.current) {
      audioRef.current.volume = vol;      // 兜底链路
    }
  }, []);

  const isPlaying = useCallback(
    (id: string) => currentStation?.stationuuid === id && playerState === 'playing',
    [currentStation, playerState]
  );

  return { currentStation, playerState, normalizeState, volume, play, stop, togglePlay, setVolume, isPlaying };
}
