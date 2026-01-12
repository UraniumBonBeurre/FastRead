import React, { useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, PanResponder, useWindowDimensions, Dimensions } from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  useSharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

interface HeadlinesRendererProps {
  content: string[];
  progress: SharedValue<number>;
  isInteracting: SharedValue<boolean>;
  fontSize: number;
  theme: {
    text: string;
    background: string;
    dimText: string;
    fontFamily?: string;
    fontWeight?: string;
  };
  onScroll?: (index: number) => void;
  onScrollEnd?: (index: number) => void;
}

// Optimized multiplier to balance gap vs overlap.
// 0.6 is standard Courier ratio.
// 0.65 is a safe compromise for Menlo/monospace.
const CHAR_W_MULTIPLIER = 0.65; 
// Windowing: keep a limited number of words in a single Text line
const WINDOW_WORDS = 400; // total words in window
const WINDOW_BACK = 150;  // how many words kept behind current index

// Initial screen width (fallback)
const INITIAL_WIDTH = Dimensions.get('window').width;

export const HeadlinesRenderer: React.FC<HeadlinesRendererProps> = ({
  content,
  progress,
  isInteracting,
  fontSize,
  theme,
  onScroll,
  onScrollEnd,
}) => {
  const { width: windowWidth } = useWindowDimensions();
  // Initialize with a real value to prevent "jump" or NaN
  const safeScreenWidth = useSharedValue(INITIAL_WIDTH);

  useEffect(() => {
    safeScreenWidth.value = windowWidth;
  }, [windowWidth]);

  // Shared Value for the offsets OF THE CURRENT WINDOW ONLY
  const windowWordOffsets = useSharedValue<number[]>([]);
  const activeWindowStartWord = useSharedValue(0);



  // Initialize window when content loads
  useEffect(() => {
    if (content.length > 0) {
      updateWindow(0); // This is cheap now (slice only)
    }
  }, [content.length]);

  // Drive window updates from progress (throttled by window bounds)
  const lastWindowStart = useSharedValue(0);
  
  useAnimatedReaction(
    () => Math.floor(progress.value),
    (idx, prevIdx) => {
      // Logic inside worklet
      const start = lastWindowStart.value;
      const end = start + WINDOW_WORDS;
      
      // If we leave the safe window, we need to update
      if (idx < start + WINDOW_BACK * 0.5 || idx > end - WINDOW_BACK * 0.5) {
        // Only trigger update if we actually changed significantly or initialized
        // const newStart = Math.max(0, idx - WINDOW_BACK);
        // lastWindowStart.value = newStart; 
        // We update the shared value but we really just need to call JS.
        // Actually, let's just delegate calculation to JS to ensure sync
        runOnJS(updateWindow)(idx);
        lastWindowStart.value = Math.max(0, idx - WINDOW_BACK);
      }
    },
    [progress, WINDOW_WORDS, WINDOW_BACK]
  );

  const charWidth = fontSize * CHAR_W_MULTIPLIER;
  const fontFamily = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  // Windowed text state
  const [windowText, setWindowText] = useState('');
  const [windowStartWord, setWindowStartWord] = useState(0);
  const [windowStartChar, setWindowStartChar] = useState(0);

  // Helper to update window state on JS thread
  const updateWindow = React.useCallback((centerWord: number) => {
    // Safety check for content (might be empty during init)
    if (!content || content.length === 0) return;
    
    // Define window bounds
    const start = Math.max(0, centerWord - WINDOW_BACK);
    const end = Math.min(content.length, start + WINDOW_WORDS);
    
    // Slice content
    const wordsSlice = content.slice(start, end);
    const textSlice = wordsSlice.join(' ');
    
    // Calculate LOCAL offsets for this slice
    // This assumes the text rendered starts at 0 relative pixels
    // We strictly map word index i (relative to start) to char offset
    const localOffsets = new Array(wordsSlice.length);
    let acc = 0;
    for (let i = 0; i < wordsSlice.length; i++) {
        localOffsets[i] = acc;
        acc += wordsSlice[i].length + 1; // +1 for space
    }
    
    // Update Shared Values
    windowWordOffsets.value = localOffsets;
    activeWindowStartWord.value = start;
    
    // Update State for React Render
    setWindowStartWord(start);
    setWindowStartChar(0); // Not used anymore but kept for state shape consistency if needed
    setWindowText(textSlice);
  }, [content]); // Dependencies for useCallback



  // Pan Responder
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isInteracting.value = true;
      },
      onPanResponderMove: (_, gestureState) => {
        const deltaChars = -gestureState.dx / charWidth;
        const newProgress = Math.max(0, Math.min(progress.value + deltaChars, content.length - 1));
        progress.value = newProgress;
        runOnJS(onScroll || (() => {}))(Math.floor(newProgress));
      },
      onPanResponderRelease: () => {
        isInteracting.value = false;
        runOnJS(onScrollEnd || (() => {}))(Math.floor(progress.value));
      },
      onPanResponderTerminate: () => {
        isInteracting.value = false;
        runOnJS(onScrollEnd || (() => {}))(Math.floor(progress.value));
      },
    })
  ).current;

  // Animation: smooth translation using word fraction
  const containerStyle = useAnimatedStyle(() => {
    const offsets = windowWordOffsets.value;
    const offsetStartWord = activeWindowStartWord.value;
    const screenW = safeScreenWidth.value;

    if (!offsets || offsets.length === 0 || windowText.length === 0) {
      return { transform: [{ translateX: 0 }] };
    }

    const idx = progress.value;
    const floorIdx = Math.floor(idx);
    
    // Calculate local index in the active window
    const localIdx = floorIdx - offsetStartWord;
    
    // Safety check: if we haven't updated yet, fallback
    if (localIdx < 0 || localIdx >= offsets.length) {
       return { transform: [{ translateX: screenW/2 }] };
    }

    const fraction = idx - floorIdx;
    
    // Get offsets (local to the rendered string)
    const baseChar = offsets[localIdx]; 
    
    let wordLen = 5;
    if (localIdx < offsets.length - 1) {
       wordLen = Math.max(1, offsets[localIdx + 1] - baseChar - 1);
    } 

    // The rendered text always starts at x=0 in its container
    // So we just need to shift left by the current char position
    const globalCharPos = baseChar + (wordLen * fraction);
    
    const translation = (screenW / 2) - (globalCharPos * charWidth);

    return {
      transform: [{ translateX: translation }]
    };
  });

  // Single long line rendering (no chunks)
  const renderedLine = (
    <Text
      style={{
        position: 'absolute',
        left: 0,
        top: '50%',
        marginTop: -fontSize,
        fontSize,
        lineHeight: fontSize * 1.4,
        height: fontSize * 2,
        color: theme.text,
        fontFamily,
        fontWeight: (theme.fontWeight as any) || '500',
        includeFontPadding: false,
        textAlignVertical: 'center',
        width: windowText.length * charWidth,
        minWidth: windowText.length * charWidth,
        letterSpacing: 0,
      }}
      numberOfLines={1}
      selectable={false}
    >
      {windowText}
    </Text>
  );

  return (
    <View style={[styles.container, { width: windowWidth }]} {...panResponder.panHandlers}>
      <View style={[styles.cursor, { backgroundColor: theme.dimText || '#007AFF' }]} />
      
      {/* 
        The "Belt" layer. 
        It contains absolute positioned chunks.
        The container itself is translated.
      */}
      <Animated.View style={[styles.belt, containerStyle]}>
        {renderedLine}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  cursor: {
    position: 'absolute',
    width: 2,
    height: 40,
    top: '50%',
    marginTop: -20,
    left: '50%',
    marginLeft: -1,
    zIndex: 10,
  },
  belt: {
    // Zero-width anchor; text inside carries its own width
    width: 0,
    height: '100%',
    position: 'absolute',
    left: 0,
    top: 0
  }
});
