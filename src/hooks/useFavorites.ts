import { useState, useCallback } from 'react';
import type { Station } from '../types';

const STORAGE_KEY = 'global-radio-favorites';

function loadFavorites(): Station[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(stations: Station[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stations));
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Station[]>(loadFavorites);

  const addFavorite = useCallback((station: Station) => {
    setFavorites((prev) => {
      if (prev.some((s) => s.stationuuid === station.stationuuid)) return prev;
      const next = [station, ...prev];
      saveFavorites(next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((stationuuid: string) => {
    setFavorites((prev) => {
      const next = prev.filter((s) => s.stationuuid !== stationuuid);
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (stationuuid: string) => favorites.some((s) => s.stationuuid === stationuuid),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (station: Station) => {
      if (isFavorite(station.stationuuid)) {
        removeFavorite(station.stationuuid);
      } else {
        addFavorite(station);
      }
    },
    [isFavorite, addFavorite, removeFavorite]
  );

  return { favorites, isFavorite, toggleFavorite };
}
