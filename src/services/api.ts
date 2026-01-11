import axios from 'axios';
import { BookListResponse } from '../types';

const API_URL = 'https://gutendex.com/books';

export const fetchBooks = async (page: number = 1, language: string = 'fr'): Promise<BookListResponse> => {
  try {
    const langParam = language ? `&languages=${language}` : '';
    const response = await axios.get(`${API_URL}?page=${page}${langParam}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching books:', error);
    throw error;
  }
};

export const searchBooks = async (query: string, language: string = 'fr'): Promise<BookListResponse> => {
  try {
    const langParam = language ? `&languages=${language}` : '';
    const response = await axios.get(`${API_URL}?search=${encodeURIComponent(query)}${langParam}`);
    return response.data;
  } catch (error) {
    console.error('Error searching books:', error);
    throw error;
  }
};

export const fetchBookContent = async (url: string): Promise<string> => {
  try {
    // Gutendex provides URLs for text content.
    // Sometimes they are http and might need https, or might be zipped.
    // We prioritize "text/plain; charset=utf-8" or "text/plain".
    const response = await axios.get(url, { responseType: 'text' });
    return response.data;
  } catch (error) {
    console.error('Error fetching book content:', error);
    throw error;
  }
};
