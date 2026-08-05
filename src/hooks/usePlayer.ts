import { useState, useRef, useCallback, useEffect } from 'react';
import type { Station } from '../types';
import { recordClick } from '../services/radioApi';

export type PlayerState = 'idle' | 'loading' | 'playing' | 'reconnecting' | 'error';
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
/** 分析窗口大小，必须和 AnalyserNode.fftSize 一致 */
const FFT_SIZE = 2048;

/* ── 断线重连 ──────────────────────────────────────────────────────────────
 *
 * 网络电台是一条一直开着的 HTTP 连接。它会断，而且经常断：
 * CDN 的空闲/会话超时、电台自己重启编码器、路由器换 IP、笔记本休眠、
 * Wi-Fi 漫游……几十分钟断一次是常态，不是异常。
 *
 * 所以播放器必须自己爬起来。策略是指数退避：2s → 4s → 8s → 16s → 30s 封顶，
 * 一旦真的播起来了（playing 事件）就把计数清零。
 */
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;
/** 连续失败多少次之后放弃，改为报错等用户手动点。约 20 分钟。 */
const RECONNECT_MAX_ATTEMPTS = 40;

/* ── 看门狗 ────────────────────────────────────────────────────────────────
 *
 * 最阴险的故障不是「报错」，是「假装还在播」：连接还在、audio 元素还是
 * paused=false，但 currentTime 不动了，一点声音都没有。事件不会告诉你这件事。
 *
 * 判据用 audio 自己的 timeupdate 事件——它由媒体管线驱动，后台标签页里不受
 * JS 定时器限速影响，只要还有音频在流就会一直响。setInterval 只是兜底巡检，
 * 后台会被 Chrome 降到大约每分钟一次，所以它绝不能是唯一判据。
 */
const WATCHDOG_INTERVAL_MS = 10000;
const STALL_TIMEOUT_MS = 20000;

/** 只在本机调试时往控制台打日志，线上保持安静 */
const DEBUG = typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

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

/**
 * 页面是 https 的，浏览器会直接掐掉 http:// 的流（混合内容），
 * 而且掐得很安静——控制台一行警告，用户只看到「播放出错」。
 * 先试同地址的 https 版本，多数 CDN 两边都开着。
 */
function preferHttps(url: string): string {
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http://')) {
    return 'https://' + url.slice('http://'.length);
  }
  return url;
}

/** 数一数系统当前有几个音频输出设备。蓝牙耳机断开时这个数会变。 */
async function countOutputs(): Promise<number> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return -1;
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter(d => d.kind === 'audiooutput').length;
  } catch { return -1; }
}

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);      // 用户音量
  const makeupRef = useRef<GainNode | null>(null);    // 自动补偿增益
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const playIdRef = useRef(0);                        // 防止快速切台时的竞态
  const volumeRef = useRef(savedVolume());
  const stationRef = useRef<Station | null>(null);

  // 重连状态
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const lastProgressRef = useRef(0);
  /** 用户主动按了停止——这种情况下绝对不要重连 */
  const userStoppedRef = useRef(true);
  /** 因为耳机断开而暂停的——等耳机回来自动续播，同样不要重连 */
  const deviceLossRef = useRef(false);
  /** play() 的最新一份实现，给事件回调用，避免闭包拿到旧的 */
  const playRef = useRef<(station: Station, isRetry?: boolean) => void>(() => {});

  const [currentStation, setCurrentStation] = useState<Station | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [normalizeState, setNormalizeState] = useState<NormalizeState>('off');
  const [volume, setVolumeState] = useState(volumeRef.current);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const stopMeasuring = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  // ── helpers ────────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    stopMeasuring();
    stopWatchdog();
    if (audioRef.current) {
      const a = audioRef.current;
      a.pause();
      a.removeAttribute('src');
      a.load();                    // 断开正在下载的流，否则连接会挂着不放
      a.remove();
      audioRef.current = null;
    }
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
    gainRef.current = null;
    makeupRef.current = null;
    analyserRef.current = null;
  }, [stopMeasuring, stopWatchdog]);

  /* ── Media Session ────────────────────────────────────────────────────────
   *
   * 告诉浏览器和操作系统「这个标签页正在放什么」。三个好处：
   * 1. 耳机上的播放/暂停键、系统媒体面板能控制它
   * 2. Chrome 会把有媒体会话的标签页当成真正在放媒体，后台优先级更高
   * 3. 锁屏/通知栏能看到台名
   */
  const updateMediaSession = useCallback((station: Station | null, state: PlayerState) => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      if (!station) {
        ms.metadata = null;
        ms.playbackState = 'none';
        return;
      }
      const artwork = station.favicon
        ? [{ src: station.favicon, sizes: '256x256', type: 'image/png' }]
        : [];
      ms.metadata = new MediaMetadata({
        title: station.name,
        artist: [station.country, station.codec].filter(Boolean).join(' · ') || 'Radio',
        album: 'Free Global Radio',
        artwork,
      });
      ms.playbackState =
        state === 'playing' ? 'playing' :
        state === 'idle' || state === 'error' ? 'paused' : 'playing';
    } catch { /* 老浏览器没有 MediaMetadata，忽略 */ }
  }, []);

  /** 安排一次重连。指数退避，封顶 30 秒。 */
  const scheduleReconnect = useCallback((reason: string) => {
    if (userStoppedRef.current || deviceLossRef.current) return;
    const station = stationRef.current;
    if (!station) return;
    if (reconnectTimerRef.current !== null) return;   // 已经排上了，别排第二次

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;

    if (attempt > RECONNECT_MAX_ATTEMPTS) {
      teardown();
      setPlayerState('error');
      setReconnectAttempt(0);
      updateMediaSession(station, 'error');
      return;
    }

    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
    setPlayerState('reconnecting');
    setReconnectAttempt(attempt);
    updateMediaSession(station, 'reconnecting');
    if (DEBUG) console.warn(`[radio] 断了（${reason}），${delay / 1000}s 后第 ${attempt} 次重连`);

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (userStoppedRef.current || deviceLossRef.current) return;
      const st = stationRef.current;
      if (st) playRef.current(st, true);
    }, delay);
  }, [teardown, updateMediaSession]);

  /**
   * 看门狗：盯着 currentTime 有没有在往前走。
   * 主判据是 timeupdate（媒体管线驱动，后台不被限速），
   * setInterval 只是兜底——后台会被降到约每分钟一次，所以不能只靠它。
   */
  const startWatchdog = useCallback(() => {
    stopWatchdog();
    lastProgressRef.current = Date.now();
    watchdogRef.current = window.setInterval(() => {
      if (userStoppedRef.current || deviceLossRef.current) return;
      const a = audioRef.current;
      if (!a || a.paused) return;
      if (Date.now() - lastProgressRef.current > STALL_TIMEOUT_MS) {
        scheduleReconnect('卡住了，声音没有在往前走');
      }
    }, WATCHDOG_INTERVAL_MS);
  }, [stopWatchdog, scheduleReconnect]);

  const bindAudioEvents = useCallback((audio: HTMLAudioElement, id: number) => {
    const mine = () => playIdRef.current === id;

    // 播放进度在走 = 一切正常。看门狗的主判据。
    audio.addEventListener('timeupdate', () => {
      if (mine()) lastProgressRef.current = Date.now();
    });

    // 缓冲中。注意：重连过程中也会触发 waiting，但这时候不能把「重连中(第N次)」
    // 覆盖成「缓冲中」——那样用户就看不到到底在重连了。
    audio.addEventListener('waiting', () => {
      if (mine() && !userStoppedRef.current) {
        setPlayerState(s => (s === 'reconnecting' ? s : 'loading'));
      }
    });

    audio.addEventListener('playing', () => {
      if (!mine()) return;
      attemptRef.current = 0;            // 真的播起来了，退避计数清零
      setReconnectAttempt(0);
      lastProgressRef.current = Date.now();
      setPlayerState('playing');
      updateMediaSession(stationRef.current, 'playing');
    });

    // 意料之外的暂停 = 流断了。用户自己按的停止、或耳机断开导致的暂停不算。
    audio.addEventListener('pause', () => {
      if (!mine()) return;
      if (userStoppedRef.current || deviceLossRef.current) return;
      scheduleReconnect('播放被中断');
    });

    // 直播流「正常结束」几乎总是服务器把连接关了。
    audio.addEventListener('ended', () => {
      if (mine()) scheduleReconnect('服务器关闭了连接');
    });

    audio.addEventListener('error', () => {
      if (mine()) scheduleReconnect('连接出错');
    });

    // stalled / suspend 单独看都可能是正常的（缓冲满了浏览器就会 suspend），
    // 所以不直接重连，只是交给看门狗判断——真卡住 20 秒才动手。
    audio.addEventListener('stalled', () => {
      if (mine() && DEBUG) console.warn('[radio] stalled');
    });
    audio.addEventListener('suspend', () => {
      if (mine() && DEBUG) console.warn('[radio] suspend');
    });
  }, [scheduleReconnect, updateMediaSession]);

  /**
   * 持续测量压缩后的响度，缓慢地把补偿增益推向目标。
   * 测量点在补偿增益之前，所以不会自己追自己（不构成反馈环）。
   */
  const startMeasuring = useCallback((id: number) => {
    stopMeasuring();
    // 只分配一次，复用同一块缓冲区
    const buf = new Float32Array(FFT_SIZE);
    timerRef.current = window.setInterval(() => {
      const ctx = ctxRef.current;
      const analyser = analyserRef.current;
      const makeup = makeupRef.current;
      if (playIdRef.current !== id || !ctx || !analyser || !makeup) return;

      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      if (rms < SILENCE_FLOOR) return; // 静音或间奏，跳过

      const desired = clamp(TARGET_RMS / rms, GAIN_MIN, GAIN_MAX);
      const current = makeup.gain.value;
      // 每次只走 25%，避免音量忽上忽下地"呼吸"
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
    comp.knee.value = 24;
    comp.ratio.value = 10;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;

    // 自动补偿增益：由响度测量实时推动，用来拉平不同电台
    const makeup = ctx.createGain();
    makeup.gain.value = 1;

    // 响度测量（旁路，不出声）
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;

    // 用户音量
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current;

    src.connect(comp);
    comp.connect(analyser);   // 只测量，不往下接
    comp.connect(makeup);
    makeup.connect(gain);
    gain.connect(ctx.destination);

    // 系统换音频设备（插拔耳机、蓝牙断开）会把 AudioContext 挂起，
    // 挂起后不会自己醒——必须显式 resume，否则就是「显示在播、其实没声」。
    ctx.onstatechange = () => {
      if (ctxRef.current !== ctx) return;
      if (ctx.state === 'suspended' && !userStoppedRef.current && !deviceLossRef.current) {
        ctx.resume().catch(() => {});
      }
    };

    ctxRef.current = ctx;
    gainRef.current = gain;
    makeupRef.current = makeup;
    analyserRef.current = analyser;
    return ctx;
  }, []);

  /** 新建一个 audio 元素。挂进 DOM——脱离文档的媒体元素有被回收的风险，
   *  而且挂进去 Chrome 才会稳定地把这个标签页算成「正在播放媒体」。 */
  const createAudio = useCallback((): HTMLAudioElement => {
    const audio = new Audio();
    audio.preload = 'none';
    audio.autoplay = false;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    return audio;
  }, []);

  // 尝试带 CORS 播放，成功才能做响度处理
  const playWithNormalization = useCallback(
    (url: string, id: number): Promise<boolean> =>
      new Promise(resolve => {
        const audio = createAudio();
        audio.crossOrigin = 'anonymous';

        let settled = false;
        const settle = (ok: boolean) => {
          if (settled || playIdRef.current !== id) return;
          settled = true;
          if (!ok) { audio.pause(); audio.removeAttribute('src'); audio.remove(); }
          resolve(ok);
        };

        const timer = setTimeout(() => settle(false), 5000);

        audio.addEventListener('playing', () => { clearTimeout(timer); settle(true); });
        audio.addEventListener('error', () => { clearTimeout(timer); settle(false); });

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
    [buildGraph, bindAudioEvents, createAudio]
  );

  // 普通 <audio> 兜底：不需要 CORS，但也做不了响度处理
  const playFallback = useCallback((url: string, id: number) => {
    const audio = createAudio();
    audio.volume = volumeRef.current;
    bindAudioEvents(audio, id);
    audioRef.current = audio;
    audio.src = url;
    audio.load();
    audio.play().catch(() => {
      if (playIdRef.current === id) scheduleReconnect('无法开始播放');
    });
  }, [bindAudioEvents, createAudio, scheduleReconnect]);

  // ── public API ─────────────────────────────────────────────────────────────

  const play = useCallback(async (station: Station, isRetry = false) => {
    teardown();
    clearReconnect();
    const id = ++playIdRef.current;
    const url = preferHttps(station.url_resolved || station.url);

    userStoppedRef.current = false;
    deviceLossRef.current = false;
    if (!isRetry) {
      attemptRef.current = 0;
      setReconnectAttempt(0);
    }

    stationRef.current = station;
    setCurrentStation(station);
    setPlayerState(isRetry ? 'reconnecting' : 'loading');
    setNormalizeState('off');
    updateMediaSession(station, isRetry ? 'reconnecting' : 'loading');

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

    startWatchdog();
    if (!isRetry) recordClick(station.stationuuid);
  }, [
    teardown, clearReconnect, playWithNormalization, playFallback,
    startMeasuring, startWatchdog, updateMediaSession,
  ]);

  useEffect(() => { playRef.current = play; }, [play]);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    deviceLossRef.current = false;
    attemptRef.current = 0;
    clearReconnect();
    teardown();
    ++playIdRef.current;
    stationRef.current = null;
    setCurrentStation(null);
    setPlayerState('idle');
    setNormalizeState('off');
    setReconnectAttempt(0);
    updateMediaSession(null, 'idle');
  }, [teardown, clearReconnect, updateMediaSession]);

  const togglePlay = useCallback((station: Station) => {
    const same = currentStation?.stationuuid === station.stationuuid;
    const busy = playerState === 'playing' || playerState === 'loading' || playerState === 'reconnecting';
    if (same && busy) stop();
    else play(station);
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
      gainRef.current.gain.value = vol;      // Web Audio 链路
    } else if (audioRef.current) {
      audioRef.current.volume = vol;         // 兜底链路
    }
  }, []);

  const isPlaying = useCallback(
    (id: string) => currentStation?.stationuuid === id &&
      (playerState === 'playing' || playerState === 'loading' || playerState === 'reconnecting'),
    [currentStation, playerState]
  );

  /* ── 蓝牙耳机断开 / 重连 ───────────────────────────────────────────────────
   *
   * 期望行为：
   *   耳机断开 → 暂停（不要甩到笔记本外放，在办公室/仓库里会很尴尬）
   *   耳机接回 → 自动接着播
   *
   * 判据是音频输出设备的数量变化。不需要麦克风权限也数得出来
   * （拿不到设备名字，但数量和 kind 是准的）。
   */
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;

    let known = -1;
    let disposed = false;
    countOutputs().then(n => { if (!disposed) known = n; });

    const onDeviceChange = async () => {
      const now = await countOutputs();
      if (disposed || now < 0) return;
      const before = known;
      known = now;
      if (before < 0) return;

      const station = stationRef.current;
      if (!station) return;

      if (now < before) {
        // 设备变少了 = 耳机断开。暂停，并且明确标记不要触发重连。
        if (!userStoppedRef.current && !deviceLossRef.current) {
          deviceLossRef.current = true;
          clearReconnect();
          audioRef.current?.pause();
          ctxRef.current?.suspend().catch(() => {});
          setPlayerState('idle');
          updateMediaSession(station, 'idle');
        }
      } else if (now > before && deviceLossRef.current) {
        // 设备变多了，而且我们正是因为设备丢失才停的 = 耳机回来了，接着播。
        deviceLossRef.current = false;
        attemptRef.current = 0;
        playRef.current(station, false);
      }
    };

    md.addEventListener('devicechange', onDeviceChange);
    return () => { disposed = true; md.removeEventListener('devicechange', onDeviceChange); };
  }, [clearReconnect, updateMediaSession]);

  /* 回到这个标签页时顺手体检一次：AudioContext 醒着吗？声音还在走吗？
   * 后台标签页里定时器被限速，回来的这一刻是最好的补救时机。 */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (userStoppedRef.current || deviceLossRef.current) return;
      if (!stationRef.current) return;

      const ctx = ctxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});

      const a = audioRef.current;
      if (a && !a.paused && Date.now() - lastProgressRef.current > STALL_TIMEOUT_MS) {
        scheduleReconnect('回到页面时发现已经卡住');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [scheduleReconnect]);

  /* 耳机上的播放/暂停键、系统媒体面板 */
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms?.setActionHandler) return;
    const safe = (action: MediaSessionAction, fn: (() => void) | null) => {
      try { ms.setActionHandler(action, fn); } catch { /* 这个浏览器不支持这个动作 */ }
    };
    safe('play', () => { const st = stationRef.current; if (st) playRef.current(st, false); });
    safe('pause', () => stop());
    safe('stop', () => stop());
    return () => {
      safe('play', null);
      safe('pause', null);
      safe('stop', null);
    };
  }, [stop]);

  // 卸载时收拾干净
  useEffect(() => {
    return () => {
      userStoppedRef.current = true;
      clearReconnect();
      teardown();
    };
  }, [teardown, clearReconnect]);

  return {
    currentStation, playerState, normalizeState, volume, reconnectAttempt,
    play, stop, togglePlay, setVolume, isPlaying,
  };
}
