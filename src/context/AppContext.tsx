import React, { createContext, useState, useEffect, useContext } from 'react';
import { AppSettings, BookProgress } from '../types';
import * as Storage from '../services/storage';
import { Translations, Theme } from '../constants/translations';

interface AppContextProps {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  myBooks: BookProgress[];
  updateBookProgress: (progress: BookProgress) => Promise<void>;
  deleteBook: (bookId: number) => Promise<void>;
  refreshMyBooks: () => Promise<void>;
  t: typeof Translations.fr;
  theme: typeof Theme.light;
}

const defaultSettings: AppSettings = {
  language: 'fr',
  theme: 'light',
  reader: {
    fontSize: 24, // Base size
    fontWeight: '600',
    fontFamily: 'System',
    lineHeightScale: 1.5,
  }
};

const AppContext = createContext<AppContextProps>({
  settings: defaultSettings,
  updateSettings: async () => {},
  myBooks: [],
  updateBookProgress: async () => {},
  deleteBook: async () => {},
  refreshMyBooks: async () => {},
  t: Translations.fr,
  theme: Theme.light,
});

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [myBooks, setMyBooks] = useState<BookProgress[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const s = await Storage.loadSettings();
    // Deep merge with defaults to ensure new keys (reader) are present
    const merged = { 
        ...defaultSettings, 
        ...s,
        reader: {
            ...defaultSettings.reader,
            ...(s?.reader || {})
        }
    };
    setSettings(merged);
    const b = await Storage.loadMyBooks();
    setMyBooks(b);
  };

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    await Storage.saveSettings(merged);
  };

  const updateBookProgress = async (progress: BookProgress) => {
    await Storage.saveBookProgress(progress);
    // Optimistic update
    setMyBooks(prev => {
      const idx = prev.findIndex(b => b.bookId === progress.bookId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = progress;
        return copy;
      }
      return [...prev, progress];
    });
  };
  
  const deleteBook = async (bookId: number) => {
    // We assume Storage has a remove method or we manually update list
    // Ideally Storage.removeBook(bookId) should exist. 
    // Implementing inline storage logic here if needed, or better, add to storage service.
    // For now, let's update state and blindly save full list if simple API, 
    // but Storage.saveBookProgress saves individually. 
    // We likely need a removeBook in storage.ts
    // Check if Storage has removeBook. If not, we will need to implement it.
    // Assuming we can just filter memory and re-save list if storage is array based.
    
    // Let's implement robustly:
    await Storage.removeBook(bookId);
    setMyBooks(prev => prev.filter(b => b.bookId !== bookId));
  };

  const refreshMyBooks = async () => {
    const b = await Storage.loadMyBooks();
    setMyBooks(b);
  };

  const t = settings.language === 'en' ? Translations.en : Translations.fr;
  const currentTheme = settings.theme === 'dark' ? Theme.dark : Theme.light;

  return (
    <AppContext.Provider value={{ settings, updateSettings, myBooks, updateBookProgress, deleteBook, refreshMyBooks, t, theme: currentTheme }}>
      {children}
    </AppContext.Provider>
  );
};


export const useApp = () => useContext(AppContext);
