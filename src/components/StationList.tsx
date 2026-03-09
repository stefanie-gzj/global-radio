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
  onTogglePlay: (station: Station) => void;
  onToggleFavorite: (station: Station) => void;
  emptyMessage?: string;
}

export const StationList: React.FC<Props> = ({
  stations, loading, error, currentStation, playerState,
  isFavorite, onTogglePlay, onToggleFavorite, emptyMessage,
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
            onTogglePlay={onTogglePlay}
            onToggleFavorite={onToggleFavorite}
          />
        );
      })}
    </div>
  );
};
