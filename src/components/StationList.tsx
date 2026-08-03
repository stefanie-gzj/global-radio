import React from 'react';
import { StationCard } from './StationCard';
import type { Station } from '../types';
import type { PlayerState } from '../hooks/usePlayer';
import { useTranslation } from '../context/LanguageContext';

interface Props {
  stations: Station[];
  loading: boolean;
  error: string | null;
  currentStation: Station | null;
  playerState: PlayerState;
  isFavorite: (id: string) => boolean;
  /** 上次连不上的电台，会被置灰并排到底部 */
  isBroken?: (id: string) => boolean;
  onTogglePlay: (station: Station) => void;
  onToggleFavorite: (station: Station) => void;
  emptyMessage?: string;
}

export const StationList: React.FC<Props> = ({
  stations, loading, error, currentStation, playerState,
  isFavorite, isBroken, onTogglePlay, onToggleFavorite, emptyMessage,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="state-box">
        <span className="spinner spinner--lg" />
        <p>{t.player.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-box state-box--error">
        <p>⚠️ {error}</p>
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="state-box">
        <p className="state-box__empty">📻 {emptyMessage ?? t.empty.explore}</p>
      </div>
    );
  }

  return (
    <div className="station-list">
      {stations.map((station) => {
        const isActive = currentStation?.stationuuid === station.stationuuid;
        return (
          <StationCard
            key={station.stationuuid}
            station={station}
            isPlaying={isActive && playerState === 'playing'}
            playerState={isActive ? playerState : 'idle'}
            isFavorite={isFavorite(station.stationuuid)}
            isBroken={isBroken ? isBroken(station.stationuuid) : false}
            onTogglePlay={onTogglePlay}
            onToggleFavorite={onToggleFavorite}
          />
        );
      })}
    </div>
  );
};
