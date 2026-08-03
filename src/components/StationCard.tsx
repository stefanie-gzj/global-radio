import React from 'react';
import type { Station } from '../types';
import type { PlayerState } from '../hooks/usePlayer';
import { useTranslation } from '../context/LanguageContext';

interface Props {
  station: Station;
  isPlaying: boolean;
  playerState: PlayerState;
  isFavorite: boolean;
  /** 上次点开连不上，置灰提示；再点播放键就是重试 */
  isBroken?: boolean;
  onTogglePlay: (station: Station) => void;
  onToggleFavorite: (station: Station) => void;
}

const FALLBACK_FAVICON = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='%23e0e7ff'/><path d='M8 7h2v10H8zm4 2h2v8h-2zm4-4h2v14h-2z' fill='%236366f1'/></svg>`;

const BROKEN_HINT = '上次连不上，点播放可以再试一次 · Could not connect last time — press play to retry';

export const StationCard: React.FC<Props> = ({
  station, isPlaying, playerState, isFavorite, isBroken = false,
  onTogglePlay, onToggleFavorite,
}) => {
  const { t } = useTranslation();

  return (
    <div
      className={`station-card ${isPlaying ? 'station-card--playing' : ''} ${isBroken ? 'station-card--broken' : ''}`}
      style={isBroken && !isPlaying ? { opacity: 0.45 } : undefined}
    >
      <div className="station-card__favicon-wrap">
        <img
          src={station.favicon || FALLBACK_FAVICON}
          alt=""
          className="station-card__favicon"
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = FALLBACK_FAVICON; }}
        />
        {isPlaying && (
          <span className="station-card__wave"><span /><span /><span /></span>
        )}
      </div>

      <div className="station-card__info">
        <p className="station-card__name" title={isBroken ? BROKEN_HINT : station.name}>
          {isBroken && (
            <span
              className="station-card__broken-flag"
              title={BROKEN_HINT}
              style={{ marginRight: 6 }}
            >
              ⚠️
            </span>
          )}
          {station.name}
        </p>
        <p className="station-card__meta">
          {station.countrycode && <span className="station-card__country">{station.countrycode}</span>}
          {station.codec && <span>{station.codec}</span>}
          {station.bitrate > 0 && <span>{station.bitrate}kbps</span>}
        </p>
        {station.tags && (
          <p className="station-card__tags" title={station.tags}>
            {station.tags.split(',').slice(0, 3).map(tag => tag.trim()).filter(Boolean).map(tag => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </p>
        )}
      </div>

      <div className="station-card__actions">
        <button
          className={`btn-icon btn-favorite ${isFavorite ? 'btn-favorite--active' : ''}`}
          onClick={() => onToggleFavorite(station)}
          title={isFavorite ? t.station.removeFav : t.station.addFav}
          aria-label={isFavorite ? t.station.removeFav : t.station.addFav}
        >
          {isFavorite ? '★' : '☆'}
        </button>
        <button
          className={`btn-icon btn-play ${isPlaying ? 'btn-play--active' : ''}`}
          onClick={() => onTogglePlay(station)}
          title={isBroken && !isPlaying ? BROKEN_HINT : (isPlaying ? t.station.stop : t.station.play)}
          aria-label={isPlaying ? t.station.stop : t.station.play}
        >
          {isPlaying ? '⏹' : (isBroken ? '↻' : '▶')}
        </button>
      </div>
    </div>
  );
};
