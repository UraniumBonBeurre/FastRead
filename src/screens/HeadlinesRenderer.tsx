import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

interface HeadlinesRendererProps {
    activeWindowIndices: number[];
    content: string[];
    progress: any;
    windowStartIndex: any;
    itemLayouts: any;
    windowWidth: number;
    theme: any;
    settings: any;
    onItemLayout: (index: number, layout: { width: number }) => void;
}

export const HeadlinesRenderer = React.memo(({
    activeWindowIndices,
    content,
    progress,
    windowStartIndex,
    itemLayouts,
    windowWidth,
    theme,
    settings,
    onItemLayout
}: HeadlinesRendererProps) => {
    
    // Safety: ensure content exists and is valid
    if (!content || !Array.isArray(content) || content.length === 0) {
        return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} />;
    }

    if (!activeWindowIndices || activeWindowIndices.length === 0) {
        return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }} />;
    }
    
    const containerStyle = useAnimatedStyle(() => {
        const currentIdx = Math.floor(progress.value);
        const remainder = progress.value - currentIdx;
        const safeStartIdx = windowStartIndex.value;
        const widthMap = itemLayouts.value;

        if (!widthMap[currentIdx]?.width) {
            return { 
                flexDirection: 'row',
                paddingVertical: 20,
                backgroundColor: theme.readerBackground
            };
        }

        const currentWidth = widthMap[currentIdx]?.width || 50;
        const nextWidth = widthMap[currentIdx + 1]?.width || 50;

        let offsetToCurrent = 0;
        if (currentIdx > safeStartIdx && (currentIdx - safeStartIdx) < 200) {
            for (let i = safeStartIdx; i < currentIdx; i++) {
                const w = widthMap[i]?.width || 50;
                offsetToCurrent += w;
            }
        }

        let targetX = (windowWidth / 2) - (offsetToCurrent + (currentWidth / 2));
        const distance = ((currentWidth + nextWidth) / 2) || 10;
        targetX -= (remainder * distance);

        return {
            flexDirection: 'row',
            paddingVertical: 20,
            backgroundColor: theme.readerBackground,
            transform: [{ translateX: targetX }]
        };
    }, [theme.readerBackground, windowWidth, itemLayouts, windowStartIndex]);

    return (
        <Animated.View style={[styles.container, containerStyle]}>
            {activeWindowIndices.map(i => {
                // Safety check: ensure index is valid
                if (i < 0 || i >= content.length) {
                    return null;
                }
                
                return (
                    <View
                        key={i}
                        style={styles.wordWrapper}
                        onLayout={(e) => {
                            onItemLayout(i, { width: e.nativeEvent.layout.width });
                        }}
                    >
                        <Text
                            style={{
                                color: theme.readerText,
                                fontSize: settings.fontSize,
                                fontWeight: settings.fontWeight,
                                fontFamily: settings.fontFamily === 'Monospace' ? 'Courier' : settings.fontFamily === 'Serif' ? 'Georgia' : 'System',
                            }}
                            numberOfLines={1}
                        >
                            {content[i]}
                        </Text>
                    </View>
                );
            })}
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    wordWrapper: {
        paddingHorizontal: 8,
        justifyContent: 'center',
        alignItems: 'center',
    }
});
