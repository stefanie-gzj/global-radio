import React, { useState } from 'react';
import { useTranslation } from '../context/LanguageContext';

const BITRATE_VALUES = [0, 64, 128, 192] as const;
const BITRATE_ICONS: Record<number, string> = { 0: '', 64: '🎵', 128: '🎶', 192: '✨' };

interface Props {
  onSearch: (query: string) => void;
  loading: boolean;
  minBitrate: number;
  onBitrateChange: (bitrate: number) => void;
}

export const SearchBar: React.FC<Props> = ({ onSearch, loading, minBitrate, onBitrateChange }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSearch(value.trim());
  };

  return (
    <div className="search-section-inner">
      <form className="search-bar" onSubmit={handleSubmit}>
        <input
          type="search"
          className="search-bar__input"
          placeholder={t.search.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="search-bar__btn" disabled={loading || !value.trim()}>
          {loading ? <span className="spinner spinner--sm" /> : t.search.button}
        </button>
      </form>
      <div className="bitrate-filter bitrate-filter--search">
        {BITRATE_VALUES.map((b) => (
          <button
            key={b}
            className={`bitrate-btn ${minBitrate === b ? 'bitrate-btn--active' : ''}`}
            onClick={() => onBitrateChange(b)}
          >
            {b === 0 ? t.bitrate.all : `${BITRATE_ICONS[b]} ${t.bitrate.label(b)}`}
          </button>
        ))}
      </div>
    </div>
  );
};
