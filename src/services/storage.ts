import AsyncStorage from '@react-native-async-storage/async-storage';
// @ts-ignore
import * as FileSystem from 'expo-file-system/legacy';
import { AppSettings, BookProgress } from '../types';

const KEYS = {
  SETTINGS: 'fastread_settings',
  MY_BOOKS: 'fastread_my_books',
};

// Use cacheDirectory or documentDirectory. 
const BOOKS_DIR = (FileSystem.documentDirectory || FileSystem.cacheDirectory) + 'books/';

const ensureDirExists = async () => {
  const dirInfo = await FileSystem.getInfoAsync(BOOKS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
  }
};

export const saveBookContent = async (bookId: number | string, content: string) => {
  try {
    await ensureDirExists();
    const uri = BOOKS_DIR + `${bookId}.txt`;
    await FileSystem.writeAsStringAsync(uri, content);
  } catch (e) {
    console.error('Failed to save book content', e);
  }
};

export const getBookContent = async (bookId: number | string): Promise<string | null> => {
  try {
    const uri = BOOKS_DIR + `${bookId}.txt`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(uri);
  } catch (e) {
    console.error('Failed to read book content', e);
    return null;
  }
};

export const deleteBookContent = async (bookId: number | string) => {
  try {
    const uri = BOOKS_DIR + `${bookId}.txt`;
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri);
    }
  } catch (e) {
    console.error('Failed to delete book content', e);
  }
};

const DEFAULT_SETTINGS: AppSettings = {
  language: 'fr',
  theme: 'light',
};

export const saveSettings = async (settings: AppSettings) => {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings', e);
  }
};

export const loadSettings = async (): Promise<AppSettings> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.SETTINGS);
    return json ? JSON.parse(json) : DEFAULT_SETTINGS;
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
};

export const saveBookProgress = async (progress: BookProgress) => {
  try {
    const books = await loadMyBooks();
    // Update or add
    const index = books.findIndex(b => b.bookId === progress.bookId);
    if (index >= 0) {
      books[index] = progress;
    } else {
      books.push(progress);
    }
    await AsyncStorage.setItem(KEYS.MY_BOOKS, JSON.stringify(books));
  } catch (e) {
    console.error('Failed to save book progress', e);
  }
};

export const removeBook = async (bookId: number) => {
  try {
    const books = await loadMyBooks();
    const newBooks = books.filter(b => b.bookId !== bookId);
    await AsyncStorage.setItem(KEYS.MY_BOOKS, JSON.stringify(newBooks));
  } catch (e) {
    console.error('Failed to remove book', e);
  }
};

export const loadMyBooks = async (): Promise<BookProgress[]> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.MY_BOOKS);
    return json ? JSON.parse(json) : [];
  } catch (e) {
    console.error(e);
    return [];
  }
};
