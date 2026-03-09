import React, { useState, useEffect, useCallback } from 'react';
import { StationList } from './components/StationList';
import { PlayerBar } from './components/PlayerBar';
import { SearchBar } from './components/SearchBar';
import { GenreFilter } from './components/GenreFilter';
import { usePlayer } from './hooks/usePlayer';
import { useFavorites } from './hooks/useFavorites';
import { useTranslation } from './context/LanguageContext';
import { getTopStations, searchStations, getStationsByTag } from './services/radioApi';
import type { Station, TabType } from './types';

export default function App() {
  const { t, lang, toggle } = useTranslation();

  const [tab, setTab] = useState<TabType>('explore');
  const [exploreStations, setExploreStations] = useState<Station[]>([]);
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState('');
  const [minBitrate, setMinBitrate] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const player = usePlayer();
  const { favorites, isFavorite, toggleFavorite } = useFavorites();

  const loadExplore = useCallback(async (genre: string, bitrate: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = genre
        ? await getStationsByTag(genre, 60, bitrate)
        : await getTopStations(60, bitrate);
      setExploreStations(data);
    } catch {
      setError(t.error.load);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (tab === 'explore') loadExplore(selectedGenre, minBitrate);
  }, [tab, selectedGenre, minBitrate, loadExplore]);

  const handleSearch = useCallback(async (query: string, bitrate: number) => {
    setSearchQuery(query);
    setLoading(true);
    setError(null);
    try {
      const data = await searchStations(query, 60, bitrate);
      setSearchResults(data);
    } catch {
      setError(t.error.search);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const currentStations =
    tab === 'explore' ? exploreStations :
    tab === 'search'  ? searchResults   :
    favorites;

  const currentLoading = tab !== 'favorites' && loading;
  const currentError   = tab !== 'favorites' ? error : null;

  return (
    <div className="app">
      <header className="header">
        <div className="header__inner">
          <h1 className="header__logo">
            <span className="header__logo-icon">📻</span>
            {t.appName}
          </h1>
          <div className="header__right">
            <nav className="tab-nav">
              {(['explore', 'search', 'favorites'] as TabType[]).map(id => (
                <button
                  key={id}
                  className={`tab-btn ${tab === id ? 'tab-btn--active' : ''}`}
                  onClick={() => setTab(id)}
                >
                  {t.tabs[id]}
                  {id === 'favorites' && favorites.length > 0 && (
                    <span className="tab-badge">{favorites.length}</span>
                  )}
                </button>
              ))}
            </nav>
            <button className="lang-btn" onClick={toggle} title="Switch language / 切换语言">
              {lang === 'zh' ? 'EN' : '中'}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {tab === 'explore' && (
          <GenreFilter
            selected={selectedGenre}
            minBitrate={minBitrate}
            onGenreChange={setSelectedGenre}
            onBitrateChange={setMinBitrate}
          />
        )}
        {tab === 'search' && (
          <div className="search-section">
            <SearchBar
              onSearch={(q) => handleSearch(q, minBitrate)}
              loading={loading}
              minBitrate={minBitrate}
              onBitrateChange={(b) => {
                setMinBitrate(b);
                if (searchQuery) handleSearch(searchQuery, b);
              }}
            />
            {searchQuery && !loading && (
              <p className="search-hint">
                {t.search.results(searchQuery, searchResults.length)}
              </p>
            )}
          </div>
        )}

        <StationList
          stations={currentStations}
          loading={currentLoading}
          error={currentError}
          currentStation={player.currentStation}
          playerState={player.playerState}
          isFavorite={isFavorite}
          onTogglePlay={player.togglePlay}
          onToggleFavorite={toggleFavorite}
          emptyMessage={
            tab === 'favorites' ? t.empty.favorites :
            tab === 'search'    ? t.empty.search    :
            t.empty.explore
          }
        />
      </main>

      <PlayerBar
        station={player.currentStation}
        playerState={player.playerState}
        normalizeState={player.normalizeState}
        volume={player.volume}
        onStop={player.stop}
        onVolumeChange={player.setVolume}
      />
    </div>
  );
}
