import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, PanResponder, Platform, FlatList, Modal, TouchableWithoutFeedback, useWindowDimensions } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { RootStackParamList, ReaderSettings } from '../types';
import { fetchBookContent } from '../services/api';
import { processBookText } from '../utils/textProcessor';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import Slider from '@react-native-community/slider';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    runOnJS,
    runOnUI,
    useFrameCallback,
    interpolate,
    Extrapolate,
    useAnimatedReaction,
    withDecay,
    cancelAnimation,
    withTiming,
    Easing
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getBookContent, saveBookContent } from '../services/storage';
import { HeadlinesRenderer } from '../components/HeadlinesRenderer';

type ReaderScreenRouteProp = RouteProp<RootStackParamList, 'Reader'>;

export default function ReaderScreen() {
    const route = useRoute<ReaderScreenRouteProp>();
    const navigation = useNavigation();
    const { title, txtUrl, bookId, initialIndex } = route.params;
    const { updateBookProgress, myBooks, t, theme, settings, updateSettings } = useApp();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const isLandscape = windowWidth > windowHeight;

    // ==================== STATE ====================
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState<string[]>([]);
    const [chapters, setChapters] = useState<{ title: string, index: number }[]>([]);
    const [wpm, setWpm] = useState(0);
    const [savedWpm, setSavedWpm] = useState(300);
    const [isTickerMode, setIsTickerMode] = useState(false);
    const [activeMenu, setActiveMenu] = useState<'size' | 'font' | null>(null);
    const [showChapters, setShowChapters] = useState(false);

    // ==================== SHARED VALUES ====================
    const progress = useSharedValue(initialIndex || 0);
    const isInteracting = useSharedValue(false);
    const isManualTransition = useSharedValue(false);
    const contentLength = useSharedValue(0);
    const waitTimer = useSharedValue(0);
    const targetIndex = useSharedValue(initialIndex || 0);
    const moveStartTimestamp = useSharedValue(-1);
    const startPosition = useSharedValue(0);
    const windowStartIndex = useSharedValue(0);
    const itemLayouts = useSharedValue<Record<number, { width: number }>>({});

    // ==================== REFS ====================
    const [baseIndex, setBaseIndex] = useState(initialIndex || 0);
    const startProgressRef = useRef(0);
    const isTickerModeRef = useRef(isTickerMode);
    const wasPlayingBeforeModeSwitch = useRef(false);

    useEffect(() => {
        isTickerModeRef.current = isTickerMode;
    }, [isTickerMode]);

    // ==================== CONSTANTS ====================
    const ITEM_HEIGHT = useMemo(() => settings.reader.fontSize * (settings.reader.lineHeightScale || 2.5), [settings.reader.fontSize, settings.reader.lineHeightScale]);

    // ==================== LOAD BOOK ====================
    useEffect(() => {
        loadBook();
    }, []);

    const loadBook = async () => {
        try {
            if (!txtUrl) throw new Error("No URL provided");

            let text = await getBookContent(bookId);

            if (!text) {
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000));
                const fetcher = fetchBookContent(txtUrl);
                text = await Promise.race([fetcher, timeout]) as string;
                await saveBookContent(bookId, text);
            }

            const processed = processBookText(text);
            let words: string[] = [];
            let chaps: any[] = [];

            if (typeof processed === 'object' && processed.words) {
                words = processed.words;
                chaps = processed.chapters;
            } else if (Array.isArray(processed)) {
                words = processed;
            } else {
                words = text.split(/\s+/).filter(w => w.length > 0);
            }

            setContent(words);
            setChapters(chaps);
            contentLength.value = words.length;
            setLoading(false);

            const exists = myBooks.find(b => b.bookId === bookId);
            if (!exists) {
                updateBookProgress({
                    bookId,
                    title: title || 'Unknown',
                    author: 'Unknown',
                    txtUrl,
                    totalWords: words.length,
                    currentWordIndex: initialIndex || 0,
                    progressPercentage: ((initialIndex || 0) / words.length) * 100,
                    lastRead: Date.now()
                });
            }
        } catch (error) {
            console.error("Error loading book:", error);
            setLoading(false);
        }
    };

    // ==================== HAPTIC FEEDBACK ====================
    const triggerHaptic = useCallback((style = Haptics.ImpactFeedbackStyle.Light) => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(style).catch(() => { });
        }
    }, []);

    const triggerSelectionHaptic = useCallback(() => {
        if (Platform.OS !== 'web') {
            Haptics.selectionAsync().catch(() => { });
        }
    }, []);

    // ==================== PROGRESS TRACKING ====================
    const saveCurrentProgress = useCallback(() => {
        const currentIndex = Math.round(progress.value);
        updateBookProgress({
            bookId,
            title,
            author: 'Unknown',
            txtUrl,
            totalWords: content.length,
            currentWordIndex: currentIndex,
            progressPercentage: (currentIndex / content.length) * 100,
            lastRead: Date.now()
        });
    }, [progress, content.length, bookId]);

    const syncState = useCallback((val: number) => {
        setBaseIndex(val);
        saveCurrentProgress();
    }, [saveCurrentProgress]);

    useAnimatedReaction(
        () => Math.round(progress.value),
        (current, previous) => {
            if (current !== previous) {
                const diff = Math.abs(current - baseIndex);
                // Reduce threshold to sync more frequently
                if (diff > (isTickerMode ? 50 : 1)) {
                    runOnJS(syncState)(current);
                }
                if (isInteracting.value) {
                    runOnJS(triggerHaptic)(Haptics.ImpactFeedbackStyle.Medium);
                }
            }
        },
        [isTickerMode, baseIndex]
    );

    useEffect(() => {
        saveCurrentProgress();
    }, [baseIndex, content.length, bookId]);

    // ==================== ANIMATION LOOP ====================
    useFrameCallback((frameInfo) => {
        // Only animate if playing AND not interacting
        if (wpm === 0 || isInteracting.value) {
            return;
        }

        if (isTickerMode) {
            // TICKER MODE: Smoother simple increment for Monospace renderer
            const dt = frameInfo.timeSincePreviousFrame || 16;
            const safeDt = Math.min(dt, 50);
            
            // Simple WPM based increment:
            // Words per second = wpm / 60
            // Increment per ms = (wpm / 60) / 1000
            // Increment = Increment per ms * dt
            const increment = (wpm / 60000) * safeDt;

            if (increment === increment && isFinite(increment)) {
                progress.value += increment;
                
                if (progress.value < 0) progress.value = 0;
                if (progress.value >= contentLength.value - 1) {
                    progress.value = contentLength.value - 1;
                    runOnJS(setWpm)(0);
                }
                targetIndex.value = Math.floor(progress.value);
            }
        } else {
            // RSVP MODE: Constant time per word
            const avgCycle = 60000 / (wpm || 300);

            if (waitTimer.value < avgCycle) {
                progress.value = targetIndex.value;
                waitTimer.value += frameInfo.timeSincePreviousFrame || 16;
            } else {
                waitTimer.value = 0;
                targetIndex.value += 1;
                progress.value = targetIndex.value;

                if (targetIndex.value >= contentLength.value) {
                    runOnJS(setWpm)(0);
                }
            }
        }
    });

    // ==================== PAN RESPONDER (SWIPE) ====================
    const snapToNearest = () => {
        'worklet';
        const nearest = Math.round(progress.value);
        progress.value = withTiming(nearest, { duration: 150, easing: Easing.out(Easing.quad) }, (finished) => {
            if (finished) {
                isInteracting.value = false;
                // Sync final position after snap
                runOnJS(setBaseIndex)(nearest);
                targetIndex.value = nearest;
            }
        });
    };

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                isInteracting.value = true;
                setWpm(0);
                cancelAnimation(progress);
                startProgressRef.current = progress.value;
                if (activeMenu) runOnJS(setActiveMenu)(null);
            },
            onPanResponderMove: (_, gestureState) => {
                const sensitivity = 0.02;
                const delta = isTickerModeRef.current
                    ? -gestureState.dx * sensitivity * 0.2
                    : -gestureState.dy * sensitivity;

                let newVal = startProgressRef.current + delta;
                if (newVal < 0) newVal = 0;
                if (newVal > contentLength.value - 1) newVal = contentLength.value - 1;

                progress.value = newVal;
            },
            onPanResponderRelease: (_, gestureState) => {
                const velocity = isTickerModeRef.current
                    ? -gestureState.vx * 20
                    : -gestureState.vy * 20;

                if (Math.abs(velocity) < 0.5) {
                    snapToNearest();
                } else {
                    progress.value = withDecay({
                        velocity,
                        clamp: [0, contentLength.value - 1],
                        deceleration: 0.992
                    }, (finished) => {
                        if (finished) snapToNearest();
                    });
                }
                
                // Sync the final position immediately for slider
                const finalPosition = Math.round(progress.value);
                targetIndex.value = finalPosition;
                runOnJS(setBaseIndex)(finalPosition);
            },
            onPanResponderTerminate: () => {
                isInteracting.value = false;
                snapToNearest();
            },
            onPanResponderTerminationRequest: () => false,
        })
    ).current;

    // ==================== UI CONTROLS ====================
    const togglePlay = () => {
        if (activeMenu) setActiveMenu(null);
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);

        if (wpm > 0) {
            // PAUSE
            setWpm(0);
        } else {
            // PLAY
            const nextWpm = savedWpm > 0 ? savedWpm : 300;
            setWpm(nextWpm);
        }
    };

    const toggleTickerMode = () => {
        triggerSelectionHaptic();
        
        console.log(`[ReaderScreen] Toggling Ticker Mode. Content Length: ${content.length}`);
        if (content.length > 0) {
             console.log(`[ReaderScreen] First word: ${content[0]}, Last word: ${content[content.length-1]}`);
        }

        // Save current playing state before toggling
        wasPlayingBeforeModeSwitch.current = wpm > 0;
        
        // Reset layouts
        itemLayouts.value = {};
        
        // Toggle mode
        setIsTickerMode(prev => !prev);
    };

    // After mode switch, restore the playing state
    useEffect(() => {
        if (wasPlayingBeforeModeSwitch.current && wpm === 0) {
            // Restore the saved WPM
            const nextWpm = savedWpm > 0 ? savedWpm : 300;
            setWpm(nextWpm);
            wasPlayingBeforeModeSwitch.current = false;
        }
    }, [isTickerMode]);

    const onArrowClick = (direction: 'up' | 'down') => {
        triggerSelectionHaptic();
        setWpm(0);

        const current = Math.round(progress.value);
        let next = direction === 'down' ? current + 1 : current - 1;

        if (next < 0) next = 0;
        if (next >= contentLength.value) next = contentLength.value - 1;

        if (next !== current) {
            targetIndex.value = next;
            isManualTransition.value = true;
            moveStartTimestamp.value = -1;
        }
    };

    const updateReaderInternal = (key: keyof ReaderSettings, val: any) => {
        updateSettings({
            reader: { ...settings.reader, [key]: val }
        });
    };

    const toggleBold = () => {
        triggerSelectionHaptic();
        updateReaderInternal('fontWeight', settings.reader.fontWeight === 'bold' ? 'normal' : 'bold');
    };

    const toggleMenu = (menu: 'size' | 'font') => {
        triggerSelectionHaptic();
        setActiveMenu(activeMenu === menu ? null : menu);
    };

    const selectOption = (type: 'size' | 'font', value: any) => {
        triggerSelectionHaptic();
        if (type === 'size') updateReaderInternal('fontSize', value);
        if (type === 'font') updateReaderInternal('fontFamily', value);
        setActiveMenu(null);
    };

    const jumpToChapter = (index: number) => {
        setShowChapters(false);
        setWpm(0);
        cancelAnimation(progress);
        progress.value = index;
        targetIndex.value = index;
        setBaseIndex(index);
    };

    // ==================== MEMOIZED VALUES ====================
    const activeWindowIndices = useMemo(() => {
        const indices = [];
        const range = isTickerMode ? 60 : 5;
        for (let i = baseIndex - range; i <= baseIndex + range; i++) {
            if (i >= 0 && i < content.length) indices.push(i);
        }
        return indices;
    }, [baseIndex, content.length, isTickerMode]);

    useEffect(() => {
        if (activeWindowIndices.length > 0) {
            windowStartIndex.value = activeWindowIndices[0];
        }
    }, [activeWindowIndices]);

    const currentChapter = useMemo(() => {
        if (chapters.length === 0) return null;
        let current = null;
        for (let i = 0; i < chapters.length; i++) {
            if (chapters[i].index <= baseIndex) {
                current = chapters[i];
            } else {
                break;
            }
        }
        return current;
    }, [baseIndex, chapters]);

    // ==================== LAYOUT HANDLING ====================
    const updateItemLayoutUI = useCallback((index: number, width: number) => {
        'worklet';
        const currentWidth = itemLayouts.value[index]?.width;
        if (!currentWidth || Math.abs(currentWidth - width) > 0.5) {
            const currentMap = itemLayouts.value;
            currentMap[index] = { width };
            itemLayouts.value = { ...currentMap };
        }
    }, []);

    const onItemLayout = useCallback((index: number, layout: { width: number }) => {
        runOnUI(updateItemLayoutUI)(index, layout.width);
    }, [updateItemLayoutUI]);

    // ==================== TICKER ANIMATION STYLE ====================
    const tickerContainerStyle = useAnimatedStyle(() => {
        if (!isTickerMode) return { transform: [{ translateX: 0 }] };

        const currentIdx = Math.floor(progress.value);
        const remainder = progress.value - currentIdx;
        const safeStartIdx = windowStartIndex.value;
        const widthMap = itemLayouts.value;

        if (!widthMap[currentIdx]?.width) {
            return { 
                flexDirection: 'row',
                height: '100%',
                transform: [{ translateX: 0 }]
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
            height: '100%',
            transform: [{ translateX: targetX }]
        };
    }, [isTickerMode, windowWidth, itemLayouts, windowStartIndex]);

    // ==================== RENDER ====================
    if (loading) {
        return (
            <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
                <ActivityIndicator size='large' color={theme.tint} />
                <Text style={{ marginTop: 20, color: theme.text }}>{t.loading}</Text>
            </View>
        );
    }

    const getWpmStatus = () => {
        let val = wpm > 0 ? wpm : savedWpm;
        if (val < 350) return { text: "Rythme normal", color: '#4CAF50' };
        if (val <= 600) return { text: "Rythme rapide", color: '#FFC107' };
        return { text: "Rythme très rapide", color: '#FF9800' };
    };
    const status = getWpmStatus();

    return (
        <SafeAreaView edges={['top', 'left', 'right']} style={[styles.container, { backgroundColor: theme.readerBackground }]}>
            {!isLandscape && (
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity onPress={() => { saveCurrentProgress(); navigation.goBack(); }} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={28} color={theme.tint} />
                    </TouchableOpacity>
                    <View style={styles.headerInfo}>
                        <Text style={[styles.bookTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
                    </View>
                    <View style={{ width: 40 }} />
                </View>
            )}

            {isLandscape && (
                <TouchableOpacity onPress={() => { saveCurrentProgress(); navigation.goBack(); }} style={{ position: 'absolute', top: 20, left: 20, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 5 }}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
            )}

            <View style={{ flex: 1, flexDirection: 'row', position: 'relative' }}>
                <View style={{ flex: 1, zIndex: 1 }} {...panResponder.panHandlers}>
                    <View style={styles.prompterContainer}>
                        {!isTickerMode && (
                            <>
                                <View style={[styles.arrowContainer, { top: '50%', marginTop: -50 - (settings.reader.fontSize * 1.0) }]}>
                                    <ArrowControl direction="up" onPress={() => onArrowClick('up')} theme={theme} isInteracting={isInteracting} />
                                </View>
                                <View style={[styles.arrowContainer, { top: '50%', marginTop: 20 + (settings.reader.fontSize * 1.0) }]}>
                                    <ArrowControl direction="down" onPress={() => onArrowClick('down')} theme={theme} isInteracting={isInteracting} />
                                </View>
                            </>
                        )}

                        {isTickerMode && (
                            <HeadlinesRenderer
                                content={content}
                                progress={progress}
                                isInteracting={isInteracting}
                                fontSize={settings.reader.fontSize}
                                theme={{
                                    text: theme.text,
                                    background: theme.background,
                                    dimText: theme.subText
                                }}
                                onScroll={(index) => {
                                    setBaseIndex(index);
                                    targetIndex.value = index;
                                }}
                                onScrollEnd={(index) => {
                                    setBaseIndex(index);
                                    targetIndex.value = index;
                                    saveCurrentProgress();
                                }}
                            />
                        )}

                        {!isTickerMode && (
                            <View style={{ height: '100%', width: '100%', justifyContent: 'center', alignItems: 'center' }}>
                                {(activeWindowIndices || []).map(i => (
                                    <PrompterItem
                                        key={i}
                                        index={i}
                                        text={content[i]}
                                        progress={progress}
                                        isInteracting={isInteracting}
                                        isManualTransition={isManualTransition}
                                        theme={theme}
                                        settings={settings.reader}
                                        itemHeight={ITEM_HEIGHT}
                                    />
                                ))}
                            </View>
                        )}
                    </View>
                </View>
            </View>

            <View style={[styles.sidebar, { backgroundColor: 'transparent', pointerEvents: 'box-none', right: isLandscape ? 30 : 15, top: isLandscape ? '10%' : '15%' }]}>
                <View style={styles.sidebarItemContainer}>
                    <TouchableOpacity onPress={() => toggleMenu('size')} style={[styles.sidebarBtn, { borderColor: theme.text, backgroundColor: 'transparent' }]}>
                        <Ionicons name="text" size={20} color={theme.text} />
                    </TouchableOpacity>
                </View>

                <View style={styles.sidebarItemContainer}>
                    <TouchableOpacity onPress={toggleBold} style={[styles.sidebarBtn, { borderColor: theme.text, backgroundColor: settings.reader.fontWeight === 'bold' ? '#ccc' : 'transparent' }]}>
                        <MaterialCommunityIcons name="format-bold" size={24} color={theme.text} />
                    </TouchableOpacity>
                </View>

                <View style={styles.sidebarItemContainer}>
                    <TouchableOpacity onPress={toggleTickerMode} style={[styles.sidebarBtn, { borderColor: theme.text, backgroundColor: isTickerMode ? '#ccc' : 'transparent' }]}>
                        <MaterialCommunityIcons name="swap-horizontal" size={24} color={theme.text} />
                    </TouchableOpacity>
                </View>

                <View style={styles.sidebarItemContainer}>
                    <TouchableOpacity onPress={() => toggleMenu('font')} style={[styles.sidebarBtn, { borderColor: theme.text, backgroundColor: 'transparent' }]}>
                        <MaterialCommunityIcons name="format-font" size={24} color={theme.text} />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={[styles.controls, { backgroundColor: theme.cardBackground, borderTopColor: theme.border, paddingBottom: Platform.OS === 'ios' ? (isLandscape ? 20 : 60) : 20 }]}>
                <View style={styles.progressRow}>
                    <Text style={{ color: theme.subText, fontSize: 12, width: 45, textAlign: 'center' }}>
                        {Math.round((baseIndex / content.length) * 100)}%
                    </Text>
                    <Slider
                        style={{ flex: 1, height: 40 }}
                        minimumValue={0}
                        maximumValue={content.length - 1}
                        value={baseIndex}
                        onValueChange={(val) => {
                            // Pause when sliding
                            setWpm(0);
                            const clamped = Math.max(0, Math.min(Math.floor(val), content.length - 1));
                            progress.value = clamped;
                            targetIndex.value = clamped;
                            setBaseIndex(clamped);
                        }}
                        minimumTrackTintColor={theme.tint}
                        thumbTintColor={theme.text}
                    />
                    <Text style={{ color: theme.subText, fontSize: 12, width: 45, textAlign: 'center' }}>
                        100%
                    </Text>
                </View>

                <View style={styles.playerRow}>
                    <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
                        <Ionicons name={wpm > 0 ? "pause-circle" : "play-circle"} size={48} color={theme.tint} />
                    </TouchableOpacity>

                    <View style={{ flex: 1, paddingLeft: 15 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 5 }}>
                            <Text style={[styles.wpmLabel, { color: theme.subText }]}>
                                {wpm > 0 ? wpm : 'PAUSE'} WPM
                            </Text>
                            <Text style={{ color: status.color, fontSize: 12, fontWeight: 'bold' }}>
                                {status.text}
                            </Text>
                        </View>

                        <Slider
                            style={{ width: '100%', height: 30 }}
                            minimumValue={100}
                            maximumValue={1000}
                            step={10}
                            value={wpm > 0 ? wpm : savedWpm}
                            onValueChange={(val) => {
                                // Update WPM live without pausing
                                if (wpm > 0) {
                                    setWpm(val);
                                }
                                setSavedWpm(val);
                            }}
                            minimumTrackTintColor={theme.tint}
                            thumbTintColor={theme.tint}
                        />
                    </View>
                </View>
            </View>

            <Modal visible={showChapters} transparent animationType="slide">
                <TouchableWithoutFeedback onPress={() => setShowChapters(false)}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.chapterBox, { backgroundColor: theme.cardBackground, width: isLandscape ? '50%' : '90%' }]}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Chapitres</Text>
                                <FlatList
                                    data={chapters}
                                    keyExtractor={(item, index) => index.toString()}
                                    style={{ maxHeight: 400 }}
                                    renderItem={({ item }) => (
                                        <TouchableOpacity style={styles.chapterItem} onPress={() => jumpToChapter(item.index)}>
                                            <Text style={{ color: theme.text, fontSize: 16 }} numberOfLines={1}>{item.title}</Text>
                                            {item.index === baseIndex && <Ionicons name="checkmark" size={16} color={theme.tint} />}
                                        </TouchableOpacity>
                                    )}
                                />
                                <TouchableOpacity onPress={() => setShowChapters(false)} style={[styles.closeBtn, { backgroundColor: theme.tint }]}>
                                    <Text style={{ color: '#fff' }}>Fermer</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal visible={activeMenu === 'size'} transparent animationType="slide">
                <TouchableWithoutFeedback onPress={() => setActiveMenu(null)}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.pickerModal, { backgroundColor: theme.cardBackground }]}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Taille du texte</Text>
                                {[16, 20, 24, 28, 32, 40].map(size => (
                                    <TouchableOpacity key={size} onPress={() => selectOption('size', size)} style={[styles.pickerItem, { borderBottomColor: theme.border }]}>
                                        <Text style={{ color: theme.text, fontSize: 18, fontWeight: settings.reader.fontSize === size ? 'bold' : 'normal' }}>{size}px</Text>
                                        {settings.reader.fontSize === size && <Ionicons name="checkmark" size={24} color={theme.tint} />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            <Modal visible={activeMenu === 'font'} transparent animationType="slide">
                <TouchableWithoutFeedback onPress={() => setActiveMenu(null)}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.pickerModal, { backgroundColor: theme.cardBackground }]}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Police</Text>
                                {[{ label: 'Système', value: 'System' }, { label: 'Serif', value: 'Serif' }, { label: 'Monospace', value: 'Monospace' }].map(({ label, value }) => (
                                    <TouchableOpacity key={value} onPress={() => selectOption('font', value)} style={[styles.pickerItem, { borderBottomColor: theme.border }]}>
                                        <Text style={{ color: theme.text, fontSize: 18, fontWeight: settings.reader.fontFamily === value ? 'bold' : 'normal', fontFamily: value === 'Monospace' ? 'Courier' : value === 'Serif' ? 'Georgia' : 'System' }}>{label}</Text>
                                        {settings.reader.fontFamily === value && <Ionicons name="checkmark" size={24} color={theme.tint} />}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </SafeAreaView>
    );
}

const ArrowControl = ({ direction, onPress, theme, isInteracting }: any) => {
    const style = useAnimatedStyle(() => ({
        opacity: isInteracting.value ? withTiming(0, { duration: 200 }) : withTiming(0.4, { duration: 200 }),
        transform: [{ scaleY: direction === 'down' ? 1 : -1 }]
    }));

    return (
        <Animated.View style={[style, { width: 100, height: 40, alignItems: 'center', justifyContent: 'center' }]}>
            <TouchableOpacity onPress={onPress} style={{ padding: 10, width: '100%', alignItems: 'center' }}>
                <Ionicons name="caret-down" size={24} color={theme.subText} />
            </TouchableOpacity>
        </Animated.View>
    );
};

const PrompterItem = React.memo(({ index, text, progress, isInteracting, isManualTransition, theme, settings, itemHeight }: any) => {
    const style = useAnimatedStyle(() => {
        const diff = index - progress.value;
        const absDiff = Math.abs(diff);
        const translateY = diff * itemHeight;

        return {
            position: 'absolute',
            top: '50%',
            marginTop: -itemHeight / 2,
            transform: [{ translateY }],
            opacity: (!isInteracting.value && !isManualTransition.value && absDiff >= 0.1) ? 0 :
                (isInteracting.value || isManualTransition.value) ? interpolate(absDiff, [0, 0.8, 1.5, 2.2], [1, 0.6, 0.2, 0], Extrapolate.CLAMP) : 1,
            zIndex: 100 - Math.round(absDiff * 10),
            height: itemHeight,
            width: '100%',
            justifyContent: 'center',
            alignItems: 'center',
        };
    });

    return (
        <Animated.View style={style}>
            <Text
                style={{
                    color: theme.readerText,
                    fontSize: settings.fontSize,
                    fontWeight: settings.fontWeight,
                    fontFamily: settings.fontFamily === 'Monospace' ? 'Courier' : settings.fontFamily === 'Serif' ? 'Georgia' : 'System',
                    textAlign: 'center',
                }}
                numberOfLines={1}
            >
                {text}
            </Text>
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    container: { flex: 1 },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: { paddingVertical: 10, paddingHorizontal: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, zIndex: 10, height: 60 },
    backButton: { padding: 5, width: 40 },
    headerInfo: { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
    bookTitle: { fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
    prompterContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', position: 'relative', width: '100%' },
    arrowContainer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
    sidebar: { position: 'absolute', right: 15, width: 50, alignItems: 'center', zIndex: 20 },
    sidebarItemContainer: { position: 'relative', marginBottom: 15, alignItems: 'center' },
    sidebarBtn: { padding: 10, borderRadius: 25, width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
    controls: { paddingVertical: 10, paddingHorizontal: 20, borderTopWidth: 1 },
    progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    playerRow: { flexDirection: 'row', alignItems: 'center' },
    playButton: {},
    wpmLabel: { fontSize: 12, fontWeight: 'bold', marginBottom: 5 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    chapterBox: { borderRadius: 10, padding: 20, maxHeight: '80%' },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
    chapterItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' },
    closeBtn: { padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 15 },
    pickerModal: { borderRadius: 15, padding: 20, width: '85%', maxHeight: '70%' },
    pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 10, borderBottomWidth: 1 },
});

