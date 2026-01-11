import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Image, Modal, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchBooks, searchBooks, fetchBookContent } from '../services/api';
import { getBookContent, saveBookContent } from '../services/storage';
import { Book } from '../types';
import { useApp } from '../context/AppContext';

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const { updateBookProgress, settings, theme } = useApp();
  const [books, setBooks] = useState<Book[]>([]);

  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [hasMore, setHasMore] = useState(true);
  
  // Download State
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0 to 1

  // Initial load
  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      let response;
      if (query.length > 0) {
        // Find books by search (pagination not implemented for search in this simple V1)
        response = await searchBooks(query, settings.language);
        setBooks(response.results); // Replace logic for search
        setHasMore(false); // Disable infinite scroll for search for simplicity
      } else {
        // Browse logic
        response = await fetchBooks(page, settings.language);
        if (response.results.length === 0) {
          setHasMore(false);
        } else {
          setBooks(prev => {
            const existingIds = new Set(prev.map(b => b.id));
            const newBooks = response.results.filter((b: Book) => !existingIds.has(b.id));
            return [...prev, ...newBooks];
          });
          setPage(prev => prev + 1);
        }

      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    setHasMore(true);
    // Trigger useEffect or manual call?
    // Manual call to reset list
    setLoading(true);
    searchBooks(query, settings.language).then(res => {
      setBooks(res.results);
      setLoading(false);
      setHasMore(false); // Simple search handling
    }).catch(() => setLoading(false));
  }; 

  const navigateToReader = async (book: Book) => {
    // Find text format
    const formats = book.formats;
    const txtUrl = 
      formats['text/plain; charset=utf-8'] || 
      formats['text/plain; charset=us-ascii'] || 
      formats['text/plain'];

    if (!txtUrl) {
      alert("Ce livre n'est pas disponible en format texte (txt).");
      return;
    }

    
    // Note: Project Gutenberg text files are often zipped (.zip). 
    // Gutendex usually provides the unzipped text URL if available, 
    // but sometimes only the zip. For MVP, we alert if no direct text.
    if (txtUrl.endsWith('.zip')) {
        alert("Ce format (ZIP) n'est pas encore supporté par le lecteur simple.");
        return;
    }
    
    // Check if downloaded
    try {
        const cached = await getBookContent(book.id);
        if (!cached) {
            // Download
            setDownloading(true);
            setDownloadProgress(0.1);
            
            // Fake progress for UX
            const interval = setInterval(() => {
                setDownloadProgress(p => p < 0.9 ? p + 0.1 : p);
            }, 500);
            
            try {
                const content = await fetchBookContent(txtUrl);
                clearInterval(interval);
                setDownloadProgress(1.0);
                
                await saveBookContent(book.id, content);
                
                // Add to My Books immediately
                await updateBookProgress({
                   bookId: book.id,
                   title: book.title,
                   author: (book.authors && book.authors[0]) ? book.authors[0].name : 'Unknown',
                   txtUrl: txtUrl,
                   totalWords: 0, // Will update on open
                   currentWordIndex: 0,
                   progressPercentage: 0,
                   lastRead: Date.now()
                });
                
                // Small delay to visually complete
                setTimeout(() => {
                    setDownloading(false);
                    setDownloadProgress(0);
                    navigation.navigate('Reader', {
                        bookId: book.id,
                        title: book.title, 
                        txtUrl: txtUrl,
                        initialIndex: 0
                    });
                }, 500);
            } catch (err) {
                clearInterval(interval);
                setDownloading(false);
                setDownloadProgress(0);
                Alert.alert("Erreur", "Echec du téléchargement.");
                console.error(err);
                return;
            }
        } else {
            // Already native
            navigation.navigate('Reader', {
                bookId: book.id,
                title: book.title, 
                txtUrl: txtUrl,
                initialIndex: 0
            });
        }
    } catch(e) {
        console.error(e);
        // Fallback
        navigation.navigate('Reader', {
            bookId: book.id,
            title: book.title, 
            txtUrl: txtUrl,
            initialIndex: 0
        });
    }
  };

  const renderBookItem = ({ item }: { item: Book }) => {

    const coverUrl = item.formats['image/jpeg'];
    
    return (
      <TouchableOpacity style={styles.card} onPress={() => navigateToReader(item)}>
        <View style={styles.coverContainer}>
          {coverUrl ? (
             <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="cover" />
          ) : (
             <View style={[styles.cover, styles.placeholderCover]} />
          )}
        </View>
        <View style={styles.info}>
          <Text style={styles.bookTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.bookAuthor} numberOfLines={1}>
            {item.authors.map(a => a.name).join(', ')}
          </Text>
          <Text style={styles.bookMeta}>{item.download_count} téléchargements</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
       <View style={styles.searchContainer}>
          <TextInput 
            style={styles.input} 
            placeholder="Rechercher un livre, un auteur..." 
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
          />
          {query.length > 0 && (
             <TouchableOpacity onPress={() => { setQuery(''); setPage(1); setBooks([]); setHasMore(true); loadBooks(); }} style={styles.clearBtn}>
               <Text style={{color:'#666'}}>X</Text>
             </TouchableOpacity>
          )}
       </View>

       {/* Download Modal */}
       <Modal transparent visible={downloading} animationType="fade">
           <View style={styles.modalOverlay}>
               <View style={styles.downloadBox}>
                   <ActivityIndicator size="large" color="#007AFF" />
                   <Text style={{ marginTop: 15, marginBottom: 10, fontWeight: '600' }}>Téléchargement...</Text>
                   <View style={styles.progressBar}>
                       <View style={[styles.progressFill, { width: `${downloadProgress * 100}%` }]} />
                   </View>
               </View>
           </View>
       </Modal>

      <FlatList
        data={books}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderBookItem}
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
           if (query.length === 0) loadBooks();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loading ? <ActivityIndicator size="small" color="#999" /> : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  searchContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: '#eee',
    borderRadius: 8,
    paddingHorizontal: 15,
  },
  clearBtn: {
    marginLeft: 10,
    padding: 5,
  },
  listContent: {
    padding: 10,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
    height: 120, // fixed height for uniformity
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 3,
  },
  coverContainer: {
    width: 80,
    height: '100%',
    backgroundColor: '#ddd',
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  placeholderCover: {
    backgroundColor: '#ccc',
  },
  info: {
    flex: 1,
    padding: 10,
    justifyContent: 'center',
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#000',
  },
  bookAuthor: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  bookMeta: {
    fontSize: 12,
    color: '#888',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  downloadBox: {
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: '#eee',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF', // System blue
  },
});
