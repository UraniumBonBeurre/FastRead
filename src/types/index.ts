export interface Author {
  name: string;
  birth_year?: number;
  death_year?: number;
}

export interface Formats {
  "text/plain"?: string;
  "text/plain; charset=utf-8"?: string;
  "text/plain; charset=us-ascii"?: string;
  "application/epub+zip"?: string;
  "image/jpeg"?: string;
  [key: string]: string | undefined;
}


export interface Book {
  id: number;
  title: string;
  authors: Author[];
  translators: Author[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean;
  media_type: string;
  formats: Formats;
  download_count: number;
}

export interface BookListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Book[];
}

export type ReadingMode = 'rsvp' | 'prompter';
export type AppLanguage = 'fr' | 'en';
export type AppTheme = 'light' | 'dark' | 'sepia';

export interface ReaderSettings {
  fontSize: number;
  fontWeight: 'normal' | 'bold' | '300' | '600';
  fontFamily: 'System' | 'Serif' | 'Monospace';
  lineHeightScale: number;
}

export interface AppSettings {
  language: AppLanguage;
  theme: AppTheme;
  reader: ReaderSettings;
}

export interface BookProgress {
  bookId: number;
  title: string;
  author: string;
  coverUrl?: string;
  txtUrl: string;
  totalWords: number;
  currentWordIndex: number; // For RSVP
  progressPercentage: number;
  lastRead: number; // Timestamp
}

export type RootStackParamList = {
  Main: undefined; // Tab Navigator
  Reader: { bookId: number; title: string; txtUrl: string; initialIndex?: number };
};

