import React from 'react';
import { useTranslation } from '../context/LanguageContext';

const GENRE_KEYS = ['all', 'pop', 'rock', 'jazz', 'classical', 'electronic', 'news', 'talk', 'country', 'hiphop'] as const;
const GENRE_TAGS: Record<typeof GENRE_KEYS[number], string> = {
  all: '', pop: 'pop', rock: 'rock', jazz: 'jazz', classical: 'classical',
  electronic: 'electronic', news: 'news', talk: 'talk', country: 'country', hiphop: 'hiphop',
};

const BITRATE_VALUES = [0, 64, 128, 192] as const;
const BITRATE_ICONS: Record<number, string> = { 0: '', 64: '🎵', 128: '🎶', 192: '✨' };

interface Props {
  selected: string;
  minBitrate: number;
  onGenreChange: (tag: string) => void;
  onBitrateChange: (bitrate: number) => void;
}

export const GenreFilter: React.FC<Props> = ({ selected, minBitrate, onGenreChange, onBitrateChange }) => {
  const { t } = useTranslation();

  return (
    <div className="filters">
      <div className="genre-filter">
        {GENRE_KEYS.map((key) => (
          <button
            key={key}
            className={`genre-btn ${selected === GENRE_TAGS[key] ? 'genre-btn--active' : ''}`}
            onClick={() => onGenreChange(GENRE_TAGS[key])}
          >
            {t.genres[key]}
          </button>
        ))}
      </div>
      <div className="bitrate-filter">
        {BITRATE_VALUES.map((b) => (
          <button
            key={b}
            className={`bitrate-btn ${minBitrate === b ? 'bitrate-btn--active' : ''}`}
            onClick={() => onBitrateChange(b)}
            title={b ? `≥ ${b} kbps` : undefined}
          >
            {b === 0
              ? t.bitrate.all
              : `${BITRATE_ICONS[b]} ${t.bitrate.label(b)}`}
          </button>
        ))}
      </div>
    </div>
  );
};
