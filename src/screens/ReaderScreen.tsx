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
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getBookContent, saveBookContent } from '../services/storage';

type ReaderScreenRouteProp = RouteProp<RootStackParamList, 'Reader'>;

export default function ReaderScreen() {
    const route = useRoute<ReaderScreenRouteProp>();
    const navigation = useNavigation();
    const { title, txtUrl, bookId, initialIndex } = route.params;
    const { updateBookProgress, myBooks, t, theme, settings, updateSettings } = useApp();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const isLandscape = windowWidth > windowHeight;

    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState<string[]>([]);
    const [chapters, setChapters] = useState<{ title: string, index: number }[]>([]);
    const [wpm, setWpm] = useState(0);
    const [savedWpm, setSavedWpm] = useState(300);
    const [isTickerMode, setIsTickerMode] = useState(false);
    const isTickerModeRef = useRef(isTickerMode);

    // TTS State
    const [ttsEnabled, setTtsEnabled] = useState(false);
    const [voiceGender, setVoiceGender] = useState<'Male' | 'Female'>('Female');
    const systemVoices = useRef<Speech.Voice[]>([]);

    useEffect(() => {
        isTickerModeRef.current = isTickerMode;
    }, [isTickerMode]);

    const [activeMenu, setActiveMenu] = useState<'size' | 'font' | 'voice' | null>(null);
    const [showChapters, setShowChapters] = useState(false);

    const progress = useSharedValue(initialIndex || 0);
    const isInteracting = useSharedValue(false);
    const isManualTransition = useSharedValue(false);
    const contentLength = useSharedValue(0);
    const isPlaying = useSharedValue(false);

    const waitTimer = useSharedValue(0);
    const targetIndex = useSharedValue(initialIndex || 0);

    const moveStartTimestamp = useSharedValue(-1);
    const startPosition = useSharedValue(0);

    const [baseIndex, setBaseIndex] = useState(initialIndex || 0);
    const startProgressRef = useRef(0);

    const ITEM_HEIGHT = useMemo(() => settings.reader.fontSize * (settings.reader.lineHeightScale || 2.5), [settings.reader.fontSize, settings.reader.lineHeightScale]);
    const ITEM_WIDTH = useMemo(() => Math.max(200, settings.reader.fontSize * 10), [settings.reader.fontSize]);

    useEffect(() => {
        loadBook();
        setupAudio();
        loadVoices();

        return () => {
            Speech.stop();
        };
    }, []);

    const setupAudio = async () => {
        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                staysActiveInBackground: true,
                playsInSilentModeIOS: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
            });
        } catch (e) {
            console.warn("Audio error", e);
        }
    };

    const loadVoices = async () => {
        const voices = await Speech.getAvailableVoicesAsync();
        systemVoices.current = voices;
    };

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

    const pauseReader = useCallback(() => {
        setWpm(0);
        isPlaying.value = false;
        isManualTransition.value = false;
        cancelAnimation(progress);

        const snapped = Math.round(progress.value);
        progress.value = withTiming(snapped, { duration: 100 });
    }, []);

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
                // Throttle updates in both modes to reduce lag
                const diff = Math.abs(current - baseIndex);
                if (diff > (isTickerMode ? 20 : 2)) {
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

    // TTS Logic
    const sliceMap = useRef<number[]>([]);

    const getVoice = () => {
        const lang = 'fr';
        const candidates = systemVoices.current.filter(v =>
            v.language.includes(lang) || v.name.includes('French')
        );
        const pool = candidates.length > 0 ? candidates : systemVoices.current;

        if (voiceGender === 'Female') {
            return pool.find(v =>
                v.name.toLowerCase().includes('amelie') ||
                v.name.toLowerCase().includes('marie') ||
                v.name.toLowerCase().includes('aurélie') ||
                v.name.toLowerCase().includes('siri')
            ) || pool[0];
        } else {
            return pool.find(v =>
                v.name.toLowerCase().includes('thomas') ||
                v.name.toLowerCase().includes('nicolas') ||
                v.name.toLowerCase().includes('daniel')
            ) || pool.find(v => !v.name.toLowerCase().includes('siri')) || pool[0];
        }
    };

    const startSpeaking = useCallback(async () => {
        if (content.length === 0 || !ttsEnabled) {
            Speech.stop();
            return;
        }

        const startIndex = Math.round(progress.value);
        if (startIndex >= content.length) {
            return;
        }

        await Speech.stop();

        const chunkSize = 100;
        const textToRead = content.slice(startIndex, startIndex + chunkSize).join(" ");

        const voice = getVoice();
        const effectiveWpm = wpm > 0 ? wpm : savedWpm;
        const rate = Math.max(0.5, Math.min(2.0, effectiveWpm / 200));

        Speech.speak(textToRead, {
            voice: voice?.identifier,
            rate,
            onBoundary: (ev) => {
                if (isInteracting.value) return;

                const chunkText = textToRead.substring(0, ev.charIndex);
                const wordOffset = chunkText.split(/\s+/).length - 1;
                const globalIndex = startIndex + wordOffset;

                progress.value = globalIndex;
            },
            onDone: () => {
                if (ttsEnabled && startIndex + chunkSize < content.length) {
                    // Small delay before next chunk to allow progress to settle
                    setTimeout(() => startSpeaking(), 50);
                }
            },
            onError: (e) => {
                console.warn("Speech error", e);
            }
        });
    }, [content, wpm, savedWpm, progress, voiceGender, isInteracting, ttsEnabled]);

    useEffect(() => {
        if (ttsEnabled) {
            startSpeaking();
        } else {
            Speech.stop();
        }
    }, [ttsEnabled, voiceGender, savedWpm]); // Restart on toggle, gender, or rate change

    useEffect(() => {
        // Only allow TTS in vertical mode
        if (isTickerMode && ttsEnabled) {
            setTtsEnabled(false);
            Speech.stop();
        }
    }, [isTickerMode]);

    // Resync TTS on manual scroll (debounced to avoid spamming)
    useEffect(() => {
        if (!ttsEnabled || isInteracting.value) return;

        const timeoutId = setTimeout(() => {
            Speech.stop();
            startSpeaking();
        }, 400);

        return () => clearTimeout(timeoutId);
    }, [baseIndex]);

    useFrameCallback((frameInfo) => {
        if (isPlaying.value && !isInteracting.value) {
            if (isTickerMode) {
                const dt = frameInfo.timeSincePreviousFrame || 16;
                const increment = (wpm / 60000) * dt;

                progress.value += increment;
                targetIndex.value = Math.floor(progress.value);

                if (progress.value >= contentLength.value) {
                    isPlaying.value = false;
                    runOnJS(setWpm)(0);
                }
            } else {
                if (targetIndex.value < Math.floor(progress.value)) {
                    targetIndex.value = Math.floor(progress.value) + 1;
                }

                const avgCycle = 60000 / wpm;
                const targetWait = avgCycle;

                if (waitTimer.value < targetWait) {
                    progress.value = targetIndex.value;
                    waitTimer.value += frameInfo.timeSincePreviousFrame || 16;
                } else {
                    waitTimer.value = 0;
                    targetIndex.value += 1;
                    progress.value = targetIndex.value;

                    if (targetIndex.value >= contentLength.value) {
                        isPlaying.value = false;
                        runOnJS(setWpm)(0);
                    }
                }
            }
        } else if (isManualTransition.value && !isInteracting.value) {
            if (moveStartTimestamp.value === -1) {
                moveStartTimestamp.value = frameInfo.timestamp;
                startPosition.value = progress.value;
            }

            const elapsed = frameInfo.timestamp - moveStartTimestamp.value;
            const duration = 160;

            let t = elapsed / duration;
            if (t >= 1) {
                t = 1;
                progress.value = targetIndex.value;
                isManualTransition.value = false;
                moveStartTimestamp.value = -1;
            } else {
                const easedT = -(Math.cos(Math.PI * t) - 1) / 2;
                progress.value = startPosition.value + (targetIndex.value - startPosition.value) * easedT;
            }
        }
    });

    const onArrowClick = (direction: 'up' | 'down') => {
        runOnJS(triggerSelectionHaptic)();
        isPlaying.value = false;
        runOnJS(setWpm)(0);

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

    const togglePlay = () => {
        if (activeMenu) setActiveMenu(null);

        if (wpm > 0) {
            // PAUSE
            pauseReader();
        } else {
            // PLAY
            setWpm(savedWpm);
            isPlaying.value = true;
            targetIndex.value = Math.floor(progress.value);
            waitTimer.value = 0;
            isManualTransition.value = false;
        }
    };

    const updateReaderInternal = (key: keyof ReaderSettings, val: any) => {
        updateSettings({
            reader: {
                ...settings.reader,
                [key]: val
            }
        });
    };

    const snapToNearest = () => {
        'worklet';
        const nearest = Math.round(progress.value);
        progress.value = withTiming(nearest, { duration: 150, easing: Easing.out(Easing.quad) }, (finished) => {
            if (finished) isInteracting.value = false;
        });
    };

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                isInteracting.value = true;
                isPlaying.value = false;
                isManualTransition.value = false;
                setWpm(0);
                cancelAnimation(progress);
                startProgressRef.current = progress.value;
                if (activeMenu) runOnJS(setActiveMenu)(null);
            },
            onPanResponderMove: (_, gestureState) => {
                const sensitivity = 0.02;
                const isTicker = isTickerModeRef.current;

                const delta = isTicker
                    ? -gestureState.dx * sensitivity * 0.2
                    : -gestureState.dy * sensitivity;

                let newVal = startProgressRef.current + delta;
                if (newVal < 0) newVal = 0;
                if (newVal > contentLength.value - 1) newVal = contentLength.value - 1;

                progress.value = newVal;
            },
            onPanResponderRelease: (_, gestureState) => {
                const isTicker = isTickerModeRef.current;
                const velocity = isTicker
                    ? -gestureState.vx * 20
                    : -gestureState.vy * 20;

                if (Math.abs(velocity) < 0.5) {
                    snapToNearest();
                } else {
                    progress.value = withDecay({
                        velocity: velocity,
                        clamp: [0, contentLength.value - 1],
                        deceleration: 0.992
                    }, (finished) => {
                        if (finished) {
                            snapToNearest();
                        }
                    });
                }
            },
            onPanResponderTerminate: () => {
                isInteracting.value = false;
                snapToNearest();
            },
            onPanResponderTerminationRequest: () => false,
        })
    ).current;

    const toggleMenu = (menu: 'size' | 'font' | 'voice') => {
        triggerSelectionHaptic();
        setActiveMenu(activeMenu === menu ? null : menu);
    };

    const selectOption = (type: 'size' | 'font', value: any) => {
        triggerSelectionHaptic();
        if (type === 'size') updateReaderInternal('fontSize', value);
        if (type === 'font') updateReaderInternal('fontFamily', value);

        setActiveMenu(null);
    };

    const toggleBold = () => {
        triggerSelectionHaptic();
        updateReaderInternal('fontWeight', settings.reader.fontWeight === 'bold' ? 'normal' : 'bold');
    };

    const toggleTickerMode = () => {
        triggerSelectionHaptic();

        // CRITICAL: Stop everything and force sync
        Speech.stop();
        setTtsEnabled(false);
        setWpm(0);
        isPlaying.value = false;
        isManualTransition.value = false;
        cancelAnimation(progress);

        // Force snap to integer
        const snapped = Math.round(progress.value);
        progress.value = snapped;
        setBaseIndex(snapped);

        // Small delay before switching mode to ensure state is clean
        setTimeout(() => {
            setIsTickerMode(!isTickerMode);
        }, 50);
    };

    const jumpToChapter = (index: number) => {
        setShowChapters(false);
        setWpm(0);
        isPlaying.value = false;
        cancelAnimation(progress);

        progress.value = index;
        targetIndex.value = index;
        setBaseIndex(index);
    };

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

    const activeWindowIndices = useMemo(() => {
        const indices = [];
        const range = isTickerMode ? 50 : 4;
        for (let i = baseIndex - range; i <= baseIndex + range; i++) {
            if (i >= 0 && i < content.length) indices.push(i);
        }
        return indices;
    }, [baseIndex, content.length, isTickerMode]);

    const averageItemPixelWidth = useMemo(() => settings.reader.fontSize * 4.5, [settings.reader.fontSize]);

    const tickerContainerStyle = useAnimatedStyle(() => {
        'worklet';
        if (!isTickerMode) return {};

        const diff = progress.value - baseIndex;
        // Precisely center the text based on window width
        const centerOffset = windowWidth / 2;
        const translateX = centerOffset - (diff * averageItemPixelWidth);

        return {
            flexDirection: 'row',
            flexWrap: 'nowrap', // Prevent text overlap
            alignItems: 'center',
            justifyContent: 'flex-start',
            transform: [{ translateX }]
        };
    }, [isTickerMode, baseIndex, averageItemPixelWidth, windowWidth]);

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

                        <Animated.View style={[
                            {
                                height: '100%',
                                width: '100%',
                                justifyContent: 'center',
                                alignItems: 'center',
                            },
                            isTickerMode ? tickerContainerStyle : { flexDirection: 'column' }
                        ]}>
                            {activeWindowIndices.map(i => (
                                <PrompterItem
                                    key={i}
                                    index={i}
                                    text={content[i]}
                                    progress={progress}
                                    isInteracting={isInteracting}
                                    isManualTransition={isManualTransition}
                                    isTickerMode={isTickerMode}
                                    theme={theme}
                                    settings={settings.reader}
                                    itemHeight={ITEM_HEIGHT}
                                    itemWidth={ITEM_WIDTH}
                                    averageItemPixelWidth={averageItemPixelWidth}
                                />
                            ))}
                        </Animated.View>
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

                {/* TTS - toggle menu for voice selection */}
                {!isTickerMode && (
                    <View style={styles.sidebarItemContainer}>
                        <TouchableOpacity onPress={() => toggleMenu('voice')} style={[styles.sidebarBtn, { borderColor: theme.text, backgroundColor: ttsEnabled ? '#ccc' : 'transparent' }]}>
                            <Ionicons name={ttsEnabled ? "headset" : "headset-outline"} size={24} color={theme.text} />
                        </TouchableOpacity>
                    </View>
                )}

            </View>

            <View style={[styles.controls, {
                backgroundColor: theme.cardBackground,
                borderTopColor: theme.border,
                paddingBottom: Platform.OS === 'ios' ? (isLandscape ? 20 : 60) : 20,
                marginBottom: isLandscape ? 0 : 0
            }]}>
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
                            setWpm(0);
                            isPlaying.value = false;
                            progress.value = val;
                            setBaseIndex(val);
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
                        <Ionicons name={(wpm > 0 || ttsEnabled) ? "pause-circle" : "play-circle"} size={48} color={theme.tint} />
                    </TouchableOpacity>

                    {ttsEnabled && (
                        <View style={{ marginLeft: 15, padding: 5 }}>
                            <Text style={{ color: theme.subText, fontSize: 11 }}>Voice: {voiceGender}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 5 }}>
                                <TouchableOpacity onPress={() => setVoiceGender('Female')} style={{ padding: 5, marginRight: 5, backgroundColor: voiceGender === 'Female' ? theme.tint : '#ccc', borderRadius: 5 }}>
                                    <Text style={{ color: '#fff', fontSize: 10 }}>F</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setVoiceGender('Male')} style={{ padding: 5, backgroundColor: voiceGender === 'Male' ? theme.tint : '#ccc', borderRadius: 5 }}>
                                    <Text style={{ color: '#fff', fontSize: 10 }}>M</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

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
                                if (wpm > 0) setWpm(val);
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

            {/* Font Size Modal */}
            <Modal visible={activeMenu === 'size'} transparent animationType="slide">
                <TouchableWithoutFeedback onPress={() => setActiveMenu(null)}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.pickerModal, { backgroundColor: theme.cardBackground }]}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Taille du texte</Text>
                                {[16, 20, 24, 28, 32, 40].map(size => (
                                    <TouchableOpacity
                                        key={size}
                                        onPress={() => selectOption('size', size)}
                                        style={[styles.pickerItem, { borderBottomColor: theme.border }]}
                                    >
                                        <Text style={{
                                            color: theme.text,
                                            fontSize: 18,
                                            fontWeight: settings.reader.fontSize === size ? 'bold' : 'normal'
                                        }}>{size}px</Text>
                                        {settings.reader.fontSize === size && (
                                            <Ionicons name="checkmark" size={24} color={theme.tint} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity onPress={() => setActiveMenu(null)} style={[styles.closeBtn, { backgroundColor: theme.tint, marginTop: 10 }]}>
                                    <Text style={{ color: '#fff', fontWeight: '600' }}>Fermer</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* Font Family Modal */}
            <Modal visible={activeMenu === 'font'} transparent animationType="slide">
                <TouchableWithoutFeedback onPress={() => setActiveMenu(null)}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.pickerModal, { backgroundColor: theme.cardBackground }]}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Police</Text>
                                {[
                                    { label: 'Système', value: 'System' },
                                    { label: 'Serif', value: 'Serif' },
                                    { label: 'Monospace', value: 'Monospace' }
                                ].map(({ label, value }) => (
                                    <TouchableOpacity
                                        key={value}
                                        onPress={() => selectOption('font', value)}
                                        style={[styles.pickerItem, { borderBottomColor: theme.border }]}
                                    >
                                        <Text style={{
                                            color: theme.text,
                                            fontSize: 18,
                                            fontWeight: settings.reader.fontFamily === value ? 'bold' : 'normal',
                                            fontFamily: value === 'Monospace' ? 'Courier' : value === 'Serif' ? 'Georgia' : 'System'
                                        }}>{label}</Text>
                                        {settings.reader.fontFamily === value && (
                                            <Ionicons name="checkmark" size={24} color={theme.tint} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity onPress={() => setActiveMenu(null)} style={[styles.closeBtn, { backgroundColor: theme.tint, marginTop: 10 }]}>
                                    <Text style={{ color: '#fff', fontWeight: '600' }}>Fermer</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* Voice Gender Modal */}
            <Modal visible={activeMenu === 'voice'} transparent animationType="slide">
                <TouchableWithoutFeedback onPress={() => setActiveMenu(null)}>
                    <View style={styles.modalOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={[styles.pickerModal, { backgroundColor: theme.cardBackground }]}>
                                <Text style={[styles.modalTitle, { color: theme.text }]}>Selectionner la voix</Text>
                                {[
                                    { label: 'Féminin', value: 'Female' as const, icon: 'woman-outline' },
                                    { label: 'Masculin', value: 'Male' as const, icon: 'man-outline' }
                                ].map(({ label, value, icon }) => (
                                    <TouchableOpacity
                                        key={value}
                                        onPress={() => {
                                            setVoiceGender(value);
                                            setTtsEnabled(true);
                                            setActiveMenu(null);
                                        }}
                                        style={[styles.pickerItem, { borderBottomColor: theme.border }]}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Ionicons name={icon as any} size={24} color={theme.text} style={{ marginRight: 15 }} />
                                            <Text style={{
                                                color: theme.text,
                                                fontSize: 18,
                                                fontWeight: voiceGender === value ? 'bold' : 'normal'
                                            }}>{label}</Text>
                                        </View>
                                        {voiceGender === value && ttsEnabled && (
                                            <Ionicons name="checkmark" size={24} color={theme.tint} />
                                        )}
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity
                                    onPress={() => {
                                        setTtsEnabled(false);
                                        setActiveMenu(null);
                                    }}
                                    style={[styles.pickerItem, { borderBottomColor: theme.border, marginTop: 10 }]}
                                >
                                    <Text style={{ color: '#ff4444', fontSize: 18 }}>Désactiver l'audio</Text>
                                    {!ttsEnabled && <Ionicons name="checkmark" size={24} color="#ff4444" />}
                                </TouchableOpacity>

                                <TouchableOpacity onPress={() => setActiveMenu(null)} style={[styles.closeBtn, { backgroundColor: theme.tint, marginTop: 20 }]}>
                                    <Text style={{ color: '#fff', fontWeight: '600' }}>Fermer</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

        </SafeAreaView >
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

const PrompterItem = React.memo(({ index, text, progress, isInteracting, isManualTransition, isTickerMode, theme, settings, itemHeight, itemWidth, averageItemPixelWidth }: any) => {

    const style = useAnimatedStyle(() => {
        if (isTickerMode) {
            return {
                opacity: 1,
                width: averageItemPixelWidth, // Standardize width for smooth Ticker
                justifyContent: 'center',
                alignItems: 'center',
                transform: [],
                zIndex: 1,
            };
        }

        const diff = index - progress.value;
        const absDiff = Math.abs(diff);
        const translateY = diff * itemHeight;

        let transform = [{ translateY }];
        let opacity = 0;

        if (isInteracting.value || isManualTransition.value) {
            opacity = interpolate(
                absDiff,
                [0, 0.8, 1.5, 2.2],
                [1, 0.6, 0.2, 0],
                Extrapolate.CLAMP
            );
        } else {
            if (absDiff < 0.1) {
                opacity = 1;
            } else {
                opacity = 0;
            }
        }

        const zIndex = 100 - Math.round(absDiff * 10);

        return {
            transform,
            opacity,
            zIndex,
            position: isTickerMode ? 'relative' : 'absolute',
            height: isTickerMode ? 'auto' : itemHeight,
            width: isTickerMode ? 'auto' : '100%',
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
                ellipsizeMode="clip"
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
    header: {
        paddingVertical: 10,
        paddingHorizontal: 15,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        zIndex: 10,
        height: 60
    },
    backButton: { padding: 5, width: 40 },
    headerInfo: { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
    bookTitle: { fontWeight: 'bold', fontSize: 16, textAlign: 'center' },
    chapterTitle: { fontSize: 12, textAlign: 'center' },

    prompterContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
        width: '100%'
    },

    arrowContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 50
    },

    sidebar: {
        position: 'absolute',
        right: 15,
        width: 50,
        alignItems: 'center',
        zIndex: 20
    },
    sidebarItemContainer: {
        position: 'relative',
        marginBottom: 15,
        alignItems: 'center'
    },
    sidebarBtn: {
        padding: 10,
        borderRadius: 25,
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
    },
    customMenu: {
        position: 'absolute',
        padding: 5,
        borderRadius: 8,
        borderWidth: 1,
        elevation: 5,
        minWidth: 100,
        zIndex: 100
    },
    menuItem: {
        paddingVertical: 12,
        paddingHorizontal: 15,
        borderBottomWidth: 0.5,
        borderBottomColor: '#eee'
    },
    menuOverlay: {
        position: 'absolute',
        top: 0, bottom: 0, left: 0, right: 0,
        zIndex: 15,
        backgroundColor: 'transparent'
    },

    controls: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderTopWidth: 1,
    },
    progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    playerRow: { flexDirection: 'row', alignItems: 'center' },
    playButton: {},
    wpmLabel: { fontSize: 12, fontWeight: 'bold', marginBottom: 5 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    chapterBox: { borderRadius: 10, padding: 20, maxHeight: '80%' },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
    chapterItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' },
    closeBtn: { padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 15 },

    // iOS-style picker modals
    pickerModal: {
        borderRadius: 15,
        padding: 20,
        width: '85%',
        maxHeight: '70%',
    },
    pickerItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        paddingHorizontal: 10,
        borderBottomWidth: 1,
    },

});

