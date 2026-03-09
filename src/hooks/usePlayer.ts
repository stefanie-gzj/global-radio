import { useState, useRef, useCallback, useEffect } from 'react';
import type { Station } from '../types';
import { recordClick } from '../services/radioApi';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'error';
export type NormalizeState = 'active' | 'unavailable' | 'off';

const VOLUME_KEY = 'global-radio-volume';

function savedVolume(): number {
  try { return Math.min(1, Math.max(0, parseFloat(localStorage.getItem(VOLUME_KEY) || '0.8'))); }
  catch { return 0.8; }
}

export function usePlayer() {
  const audioRef  = useRef<HTMLAudioElement | null>(null);
  const ctxRef    = useRef<AudioContext | null>(null);
  const gainRef   = useRef<GainNode | null>(null);
  const playIdRef = useRef(0);        // guards against race conditions
  const volumeRef = useRef(savedVolume());

  const [currentStation, setCurrentStation] = useState<Station | null>(null);
  const [playerState,    setPlayerState]    = useState<PlayerState>('idle');
  const [normalizeState, setNormalizeState] = useState<NormalizeState>('off');
  const [volume,         setVolumeState]    = useState(volumeRef.current);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── helpers ────────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    if (ctxRef.current)   { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
    gainRef.current = null;
  }, []);

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

  // Build Web Audio graph: DynamicsCompressor → GainNode → speakers
  const buildGraph = useCallback((audio: HTMLAudioElement): AudioContext => {
    const ctx = new AudioContext({ latencyHint: 'playback' });

    const src = ctx.createMediaElementSource(audio);

    // DynamicsCompressor: tames loud peaks & lifts quiet audio → perceived normalization
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;   // dB: start compressing here
    comp.knee.value      = 24;    // dB: smooth transition width
    comp.ratio.value     = 10;    // compression ratio
    comp.attack.value    = 0.002; // 2 ms — fast enough to catch peaks
    comp.release.value   = 0.2;   // 200 ms — natural release

    // User-controlled master gain
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;

    src.connect(comp);
    comp.connect(gain);
    gain.connect(ctx.destination);

    ctxRef.current = ctx;
    gainRef.current = gain;
    return ctx;
  }, []);

  // Attempt CORS-enabled playback so Web Audio API can process the stream.
  // Resolves true if audio starts playing, false on CORS/network error.
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

        // Give the CORS attempt up to 5 s; most failures are near-instant
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

  // Plain <audio> fallback — no CORS required, no normalization
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

    setCurrentStation(station);
    setPlayerState('loading');
    setNormalizeState('off');

    const normalized = await playWithNormalization(url, id);

    if (playIdRef.current !== id) return; // user already switched stations

    if (normalized) {
      setNormalizeState('active');
    } else {
      teardown();
      if (playIdRef.current !== id) return;
      playFallback(url, id);
      setNormalizeState('unavailable');
    }

    recordClick(station.stationuuid);
  }, [teardown, playWithNormalization, playFallback]);

  const stop = useCallback(() => {
    teardown();
    ++playIdRef.current;
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
    volumeRef.current = v;
    setVolumeState(v);
    localStorage.setItem(VOLUME_KEY, String(v));
    if (gainRef.current) {
      gainRef.current.gain.value = v;  // Web Audio path
    } else if (audioRef.current) {
      audioRef.current.volume = v;     // fallback path
    }
  }, []);

  const isPlaying = useCallback(
    (id: string) => currentStation?.stationuuid === id && playerState === 'playing',
    [currentStation, playerState]
  );

  return { currentStation, playerState, normalizeState, volume, play, stop, togglePlay, setVolume, isPlaying };
}
