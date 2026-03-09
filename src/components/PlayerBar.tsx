import React from 'react';
import type { Station } from '../types';
import type { PlayerState, NormalizeState } from '../hooks/usePlayer';
import { useTranslation } from '../context/LanguageContext';

interface Props {
  station: Station | null;
  playerState: PlayerState;
  normalizeState: NormalizeState;
  volume: number;
  onStop: () => void;
  onVolumeChange: (v: number) => void;
}

export const PlayerBar: React.FC<Props> = ({
  station, playerState, normalizeState, volume, onStop, onVolumeChange,
}) => {
  const { t } = useTranslation();
  if (!station) return null;

  const stateLabel: Record<PlayerState, string> = {
    idle:    t.player.idle,
    loading: t.player.loading,
    playing: t.player.playing,
    error:   t.player.error,
  };

  return (
    <div className={`player-bar player-bar--${playerState}`}>
      <div className="player-bar__info">
        {playerState === 'loading' && <span className="spinner" />}
        {playerState === 'playing' && (
          <span className="player-bar__wave"><span /><span /><span /><span /></span>
        )}
        {playerState === 'error' && <span className="player-bar__icon">⚠️</span>}
        <div className="player-bar__text">
          <span className="player-bar__name">{station.name}</span>
          <span className="player-bar__state">
            {stateLabel[playerState]}
            {playerState === 'playing' && normalizeState === 'active' && (
              <span className="normalize-badge normalize-badge--on" title={t.player.normalize}>
                ◈ {t.player.normalize}
              </span>
            )}
            {playerState === 'playing' && normalizeState === 'unavailable' && (
              <span className="normalize-badge normalize-badge--off" title={t.player.normalizeUnavailable}>
                ◇ {t.player.normalizeUnavailable}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="player-bar__controls">
        <label className="player-bar__volume" aria-label={t.player.volume}>
          <span>🔊</span>
          <input
            type="range" min="0" max="1" step="0.02"
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
          />
          <span className="player-bar__vol-label">{Math.round(volume * 100)}%</span>
        </label>
        <button className="btn-stop" onClick={onStop} title={t.player.stop} aria-label={t.player.stop}>
          {t.player.stop}
        </button>
      </div>
    </div>
  );
};
