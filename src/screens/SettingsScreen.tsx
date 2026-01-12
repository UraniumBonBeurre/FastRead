import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { AppTheme, AppLanguage } from '../types';

export default function SettingsScreen() {
  const { settings, updateSettings, t, theme } = useApp();

  const toggleLanguage = () => {
    updateSettings({ language: settings.language === 'fr' ? 'en' : 'fr' });
  };
  
  const toggleTheme = () => {
     updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.headerTitle, { color: theme.text }]}>{t.settings_title}</Text>

      <ScrollView contentContainerStyle={styles.content}>
        
        {/* Language Section */}
        <View style={[styles.section, { backgroundColor: theme.cardBackground, shadowColor: '#000' }]}>
          <Text style={[styles.sectionHeader, { color: theme.subText }]}>{t.lang_section}</Text>
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
            <Text style={[styles.label, { color: theme.text }]}>{settings.language === 'fr' ? 'Français' : 'English'}</Text>
            <TouchableOpacity onPress={toggleLanguage} style={[styles.button, { backgroundColor: theme.tint }]}>
               <Text style={styles.buttonText}>{t.change_btn}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Appearance Section */}
        <View style={[styles.section, { backgroundColor: theme.cardBackground, shadowColor: '#000' }]}>
          <Text style={[styles.sectionHeader, { color: theme.subText }]}>{t.appearance_section}</Text>
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
             <Text style={[styles.label, { color: theme.text }]}>{t.dark_mode}</Text>
             <Switch 
               value={settings.theme === 'dark'} 
               onValueChange={toggleTheme}
               trackColor={{ false: theme.border, true: theme.tint }}
               thumbColor="#fff"
             />
          </View>
        </View>

      </ScrollView>
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
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 30,
    borderRadius: 12,
    padding: 15,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  label: {
    fontSize: 16,
  },
  description: {
    fontSize: 14,
    marginBottom: 15,
  },
  button: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
  optionCard: {
    marginBottom: 10,
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  selectedOption: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  optionDesc: {
     fontSize: 13,
     color: '#666',
  },
  selectedText: {
    color: '#fff',
  },
});
