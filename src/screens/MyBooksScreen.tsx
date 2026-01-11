import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { BookProgress } from '../types';
import { Ionicons } from '@expo/vector-icons';

export default function MyBooksScreen() {
  const navigation = useNavigation<any>();
  const { myBooks, t, theme, updateBookProgress, deleteBook } = useApp();

  const [books, setBooks] = useState<BookProgress[]>([]);

  useEffect(() => {
    // Sort by last read (desc)
    const sorted = [...myBooks].sort((a, b) => b.lastRead - a.lastRead);
    setBooks(sorted);
  }, [myBooks]);

  const handlePress = (book: BookProgress) => {
    navigation.navigate('Reader', {
      bookId: book.bookId,
      title: book.title, 
      txtUrl: book.txtUrl,
      initialIndex: book.currentWordIndex
    });
  };

  const handleDelete = (book: BookProgress) => {
     Alert.alert(
         'Delete Book',
         `Are you sure you want to remove \"${book.title}\" from your library?`,
         [
             { text: 'Cancel', style: 'cancel' },
             { text: 'Delete', style: 'destructive', onPress: () => {
                 if(deleteBook) deleteBook(book.bookId);
             }}
         ]
     );
  };

  const renderItem = ({ item }: { item: BookProgress }) => {
    return (
      <View style={[styles.bookItem, { backgroundColor: theme.cardBackground, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.bookInfo} onPress={() => handlePress(item)}>
            <Text style={[styles.bookTitle, { color: theme.text }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.bookAuthor, { color: theme.subText }]} numberOfLines={1}>{item.author}</Text>
            <View style={styles.progressRow}>
               <View style={[styles.progressBar, { backgroundColor: theme.border }]}>
                  <View style={[styles.progressFill, { width: `${item.progressPercentage}%`, backgroundColor: theme.tint }]} />
               </View>
               <Text style={[styles.progressText, { color: theme.subText }]}>{Math.round(item.progressPercentage)}%</Text>
            </View>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item)}>
             <Ionicons name="trash-outline" size={20} color="red" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.headerTitle, { color: theme.text }]}>{t.tab_mybooks}</Text>

      {books.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{t.empty_books_title}</Text>
          <Text style={[styles.emptySubtitle, { color: theme.subText }]}>{t.empty_books_subtitle}</Text>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(item) => item.bookId.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    margin: 20,
    marginTop: 10,
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
  },
  bookItem: {
    flexDirection: 'row',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    // Elevation for Android
    elevation: 3,
    alignItems: 'center',
  },
  bookInfo: {
      flex: 1,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  bookAuthor: {
    fontSize: 14,
    marginBottom: 10,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    marginRight: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  deleteButton: {
      padding: 10,
      marginLeft: 10,
  }
});