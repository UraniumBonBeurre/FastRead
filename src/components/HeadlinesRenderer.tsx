import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Platform,
  PanResponder,
} from 'react-native';
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
  };
  onScroll?: (index: number) => void;
  onScrollEnd?: (index: number) => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Monospace Layout Config
const MONOSPACE_RATIO = 0.6; 
// Large buffer for smooth scrolling
const BUFFER_SIZE = 500; 

export const HeadlinesRenderer: React.FC<HeadlinesRendererProps> = ({
  content,
  progress,
  isInteracting,
  fontSize,
  theme,
  onScroll,
  onScrollEnd,
}) => {
  // 1. Calculate Global Offsets
  // Utilizing standard Array to ensure maximum compatibility with Reanimated bridge
  const globalCharOffsets = useMemo(() => {
    if (!content || content.length === 0) return [];
    const offsets = new Array(content.length);
    let acc = 0;
    for (let i = 0; i < content.length; i++) {
        offsets[i] = acc;
        acc += content[i].length + 1; // +1 for space
    }
    return offsets;
  }, [content]);

  // Shared value for the offsets
  const sharedOffsets = useSharedValue<number[]>([]);

  // Update shared value whenever content changes
  useEffect(() => {
    if (globalCharOffsets.length > 0) {
        sharedOffsets.value = globalCharOffsets;
        // console.log("[HeadlinesRenderer] Shared offsets updated, length:", globalCharOffsets.length);
    }
  }, [globalCharOffsets]);

  // Track the START index of the currently rendered window
  const windowStartIndex = useSharedValue(0);
  const [windowInfo, setWindowInfo] = useState({ text: "", startIndex: 0 });

  // Haptics
  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isInteracting.value = true;
      },
      onPanResponderMove: (_, gestureState) => {
        const charWidth = fontSize * MONOSPACE_RATIO;
        const deltaChars = -gestureState.dx / charWidth;
        const newProgress = Math.max(0, Math.min(progress.value + deltaChars, content.length - 1));
        progress.value = newProgress;
        
        if (onScroll) runOnJS(onScroll)(Math.floor(newProgress));
      },
      onPanResponderRelease: () => {
        isInteracting.value = false;
        if (onScrollEnd) runOnJS(onScrollEnd)(Math.floor(progress.value));
      },
      onPanResponderTerminate: () => {
        isInteracting.value = false;
        if (onScrollEnd) runOnJS(onScrollEnd)(Math.floor(progress.value));
      },
    })
  ).current;

  // Window Update Logic
  const updateWindow = (idx: number) => {
    if (!content || content.length === 0) return;

    const safeIdx = Math.max(0, Math.min(idx, content.length - 1));
    const start = Math.max(0, safeIdx - BUFFER_SIZE);
    const end = Math.min(content.length, safeIdx + BUFFER_SIZE);
    
    // Check redundancy to avoid unnecessary state updates (which cause re-renders)
    // We only update if the cursor is nearing the edge of the visible window
    const currentStart = windowInfo.startIndex;
    const currentLength = windowInfo.text ? windowInfo.text.split(' ').length : 0;
    const center = currentStart + (currentLength / 2);
    
    // If we are within 200 words of the center of current window, don't update
    if (windowInfo.text.length > 0 && Math.abs(safeIdx - center) < 200) {
        return;
    }

    const slice = content.slice(start, end);
    const text = slice.join(' ');
    
    setWindowInfo({ text, startIndex: start });
    windowStartIndex.value = start;
  };

  useAnimatedReaction(
    () => Math.floor(progress.value),
    (curr, prev) => {
      if (curr !== prev) {
         runOnJS(triggerHaptic)();
         runOnJS(updateWindow)(curr);
      }
    },
    [content, windowInfo]
  );
  
  // Initial Load - Force ensure text is set
  useEffect(() => {
    updateWindow(Math.floor(progress.value));
  }, [content]);

  const charWidth = fontSize * MONOSPACE_RATIO;
  const fontFamily = Platform.OS === 'ios' ? 'Courier' : 'monospace';

  const animatedStyle = useAnimatedStyle(() => {
    const offsets = sharedOffsets.value;
    
    // Fallback if data isn't ready: don't move, but stay visible at 0
    if (!offsets || offsets.length === 0) {
        return { transform: [{ translateX: 0 }] };
    }

    const idx = progress.value;
    const floorIdx = Math.floor(idx);
    const fraction = idx - floorIdx;
    
    const safeFloorIdx = Math.min(floorIdx, offsets.length - 1);
    
    // Position of the cursor in GLOBAL characters
    const globalStartChar = offsets[safeFloorIdx];
    
    // Calculate current word length safely from offsets
    let wordLen = 0;
    if (safeFloorIdx < offsets.length - 1) {
        wordLen = offsets[safeFloorIdx + 1] - offsets[safeFloorIdx] - 1; // -1 for space
    } else {
        wordLen = 5; // Fallback
    }
    
    const globalCurrentChar = globalStartChar + (wordLen * fraction);

    // Window Start Global Char Key
    const winStartIdx = windowStartIndex.value;
    
    // To calculate local offset: GlobalPos - WindowStartGlobalPos
    const windowStartGlobalChar = (winStartIdx < offsets.length) ? offsets[winStartIdx] : 0;

    // Relative Char Offset
    const relativeCharOffset = globalCurrentChar - windowStartGlobalChar;

    const translateX = (SCREEN_WIDTH / 2) - (relativeCharOffset * charWidth);

    return {
      transform: [{ translateX }]
    };
  });

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={[styles.cursor, { backgroundColor: theme.dimText || '#007AFF' }]} />
      <Animated.View style={[styles.textRow, animatedStyle]}>
        <Text 
            style={[
                styles.text, 
                { 
                    fontSize, 
                    color: theme.text,
                    fontFamily: fontFamily, 
                    fontWeight: '500', 
                    width: 500000, // Giant width
                }
            ]}
            numberOfLines={1}
            selectable={false}
        >
          {windowInfo.text || content.slice(0, 50).join(' ')}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: SCREEN_WIDTH,
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
    opacity: 0.5
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // We don't set a fixed width, just let it grow.
    // The Container overflow:hidden cuts it off.
    minWidth: SCREEN_WIDTH, 
  },
  text: {
    textAlign: 'left',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
