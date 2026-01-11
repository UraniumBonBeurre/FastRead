import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import SearchScreen from './src/screens/SearchScreen';
import MyBooksScreen from './src/screens/MyBooksScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ReaderScreen from './src/screens/ReaderScreen';
import { AppProvider, useApp } from './src/context/AppContext';
import { RootStackParamList } from './src/types';

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { t, theme } = useApp();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'book';

          if (route.name === 'SearchTab') {
            iconName = focused ? 'search' : 'search-outline';
          } else if (route.name === 'MyBooksTab') {
            iconName = focused ? 'library' : 'library-outline';
          } else if (route.name === 'SettingsTab') {
            iconName = focused ? 'settings' : 'settings-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.subText,
        tabBarStyle: {
          backgroundColor: theme.cardBackground,
          borderTopColor: theme.border,
        },
        headerStyle: {
          backgroundColor: theme.cardBackground,
        },
        headerTintColor: theme.text,
      })}
    >
      <Tab.Screen 
        name="SearchTab" 
        component={SearchScreen} 
        options={{ title: t.tab_search }}
      />
      <Tab.Screen 
        name="MyBooksTab" 
        component={MyBooksScreen} 
        options={{ title: t.tab_mybooks }}
      />
      <Tab.Screen 
        name="SettingsTab" 
        component={SettingsScreen} 
        options={{ title: t.tab_settings }}
      />
    </Tab.Navigator>
  );
}

function MainApp() {
  const { theme, settings } = useApp();
  
  const isDark = settings.theme === 'dark';
  const baseTheme = isDark ? DarkTheme : DefaultTheme;

  const navTheme = {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        primary: theme.tint,
        background: theme.background,
        card: theme.cardBackground,
        text: theme.text,
        border: theme.border,
        notification: theme.tint,
      },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName="Main" screenOptions={{ headerShown: false }}>
        <Stack.Screen 
          name="Main" 
          component={MainTabs} 
        />
        <Stack.Screen 
          name="Reader" 
          component={ReaderScreen} 
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}


