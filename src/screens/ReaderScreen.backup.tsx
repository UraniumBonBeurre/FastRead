import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, Switch, Alert, Platform } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { RootStackParamList, ReaderSettings } from '../types';
import { fetchBookContent } from '../services/api';
import { processBookText } from '../utils/textProcessor';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import Slider from '@react-native-community/slider';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    runOnJS,
    useFrameCallback,
    interpolate,
    Extrapolate,
    useAnimatedReaction
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { getBookContent, saveBookContent, deleteBookContent } from '../services/storage';

type ReaderScreenRouteProp = RouteProp<RootStackParamList, 'Reader'>;

export default function ReaderScreen() {
    const route = useRoute<ReaderScreenRouteProp>();
    const navigation = useNavigation();
    const { title, txtUrl, bookId, initialIndex } = route.params;
    const { updateBookProgress, myBooks, t, theme, settings, updateSettings } = useApp();

    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState<string[]>([]);
    const [wpm, setWpm] = useState(0);
    const [savedWpm, setSavedWpm] = useState(300);
    const [showSettings, setShowSettings] = useState(false);

    // TTS State
    const [ttsEnabled, setTtsEnabled] = useState(false);
    const [voiceGender, setVoiceGender] = useState<'Male' | 'Female'>('Female');
    const systemVoices = useRef<Speech.Voice[]>([]);

    // Reanimated Shared Values
    const progress = useSharedValue(initialIndex || 0);
    const isInteracting = useSharedValue(false);
    const contentLength = useSharedValue(0);

    // We mirror the integer index in JS state to limit rendering window
    const [baseIndex, setBaseIndex] = useState(initialIndex || 0);

    const ITEM_HEIGHT = settings.reader.fontSize * 1.5;

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
            if (typeof processed === 'object' && processed.words) {
                words = processed.words;
            } else if (Array.isArray(processed)) {
                words = processed;
            } else {
                words = text.split(/\s+/).filter(w => w.length > 0);
            }

            setContent(words);
            contentLength.value = words.length;
            setLoading(false);

            const exists = myBooks.find(b => b.bookId === String(bookId));
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
            Alert.alert("Error", "Error loading book content. Please try again.");
            setLoading(false);
        }
    };

    const deleteIndex = async () => {
        await deleteBookContent(bookId);
        Alert.alert("Deleted", "Book content removed from device.");
        setShowSettings(false);
        navigation.goBack();
    }

    // Stable Actions
    const pauseReader = useCallback(() => {
        setWpm(0);
    }, []);

    const triggerHaptic = useCallback(() => {
        if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
        }
    }, []);

    const syncState = useCallback((idx: number) => {
        setBaseIndex(idx);
    }, []);

    useAnimatedReaction(
        () => Math.round(progress.value),
        (current, previous) => {
            if (current !== previous) {
                runOnJS(syncState)(current);
                if (isInteracting.value) {
                    runOnJS(triggerHaptic)();
                }
            }
        },
        []
    );

    useEffect(() => {
        if (!loading && content.length > 0) {
            saveCurrentProgress();
        }
    }, [wpm, loading]);

    const saveCurrentProgress = useCallback(() => {
        if (content.length === 0) return;
        updateBookProgress({
            bookId,
            title: title || 'Unknown',
            author: 'Unknown',
            txtUrl,
            totalWords: content.length,
            currentWordIndex: baseIndex,
            progressPercentage: (baseIndex / content.length) * 100,
            lastRead: Date.now()
        });
    }, [baseIndex, content.length, bookId]);

    // TTS Logic
    const sliceMap = useRef<number[]>([]);

    const getVoice = () => {
        const lang = 'fr'; // Prefer French
        const candidates = systemVoices.current.filter(v =>
            v.language.includes(lang) || v.name.includes('French')
        );
        const pool = candidates.length > 0 ? candidates : systemVoices.current;

        if (voiceGender === 'Female') {
            // Heuristic for female voices
            return pool.find(v =>
                v.name.toLowerCase().includes('amelie') ||
                v.name.toLowerCase().includes('marie') ||
                v.name.toLowerCase().includes('aurélie') ||
                v.name.toLowerCase().includes('siri')
            ) || pool[0];
        } else {
            // Heuristic for male voices
            return pool.find(v =>
                v.name.toLowerCase().includes('thomas') ||
                v.name.toLowerCase().includes('nicolas') ||
                v.name.toLowerCase().includes('daniel')
            ) || pool.find(v => !v.name.toLowerCase().includes('siri')) || pool[0];
        }
    };

    const startSpeaking = useCallback(async () => {
        if (content.length === 0) return;
        await Speech.stop();

        const startIndex = Math.floor(progress.value);
        if (startIndex >= content.length) {
            setWpm(0);
            return;
        }

        const textToRead = content.slice(startIndex).join(" ");

        // Build Char Index Map
        let acc = 0;
        const map = [];
        const words = content.slice(startIndex);
        for (let w of words) {
            map.push(acc);
            acc += w.length + 1; // +1 for the joined space
        }
        sliceMap.current = map;

        const voice = getVoice();
        // Rate: 1.0 roughly normal. WPM 300 ~ rate 1.5? 
        // Let's assume wpm 200 = rate 1.0.
        const rate = wpm / 200;

        Speech.speak(textToRead, {
            voice: voice?.identifier,
            rate: Math.min(Math.max(rate, 0.5), 2.0), // Clamp for safety
            onBoundary: (ev) => {
                // Only update if not interacting
                if (isInteracting.value) return;

                const charIdx = ev.charIndex;
                // Find word index
                // Simple linear scan is fast enough for <100k words, but slice is smaller.
                let idx = 0;
                for (let i = 0; i < sliceMap.current.length; i++) {
                    if (sliceMap.current[i] > charIdx) break;
                    idx = i;
                }
                const globalIndex = startIndex + idx;

                // Update progress directly
                progress.value = globalIndex;
            },
            onDone: () => {
                runOnJS(setWpm)(0);
            },
            onError: (e) => {
                console.warn("Speech error", e);
                runOnJS(setWpm)(0);
            }
        });
    }, [content, wpm, progress, voiceGender, isInteracting]);

    const restartTTS = useCallback(() => {
        if (ttsEnabled && wpm > 0) {
            startSpeaking();
        }
    }, [ttsEnabled, wpm, startSpeaking]);

    // Handle WPM changes/Toggle and manual scrolling
    useEffect(() => {
        if (ttsEnabled && wpm > 0) {
            startSpeaking();
        } else if (ttsEnabled && wpm === 0) {
            Speech.stop();
        }
    }, [wpm, ttsEnabled, voiceGender]); // trigger restart on these changes

    // Resync TTS when user manually scrolls
    useEffect(() => {
        if (ttsEnabled && wpm > 0 && !isInteracting.value) {
            // Restart from current position after manual scroll
            Speech.stop();
            startSpeaking();
        }
    }, [baseIndex]);

    useFrameCallback((frameInfo) => {
        if (wpm > 0 && contentLength.value > 0 && !isInteracting.value && !ttsEnabled) {
            const dt = frameInfo.timeSincePreviousFrame || 16;
            const increment = (wpm / 60000) * dt;

            if (progress.value + increment < contentLength.value - 1) {
                progress.value += increment;
            } else {
                runOnJS(setWpm)(0);
            }
        }
    });

    const togglePlay = () => {
        if (wpm > 0) {
            setSavedWpm(wpm);
            setWpm(0);
        } else {
            setWpm(savedWpm);
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

    // Component-based Gesture Handler (Replacing API based)
    const startProgress = useSharedValue(0);
    const pan = Gesture.Pan()
        .onStart(() => {
            isInteracting.value = true;
            startProgress.value = progress.value;
            runOnJS(pauseReader)();
        })
        .onUpdate((event) => {
            const sensitivity = 0.02;
            const delta = -event.translationY * sensitivity;
            let newVal = startProgress.value + delta;

            if (newVal < 0) newVal = 0;
            if (newVal > contentLength.value - 1) newVal = contentLength.value - 1;

            progress.value = newVal;
        })
        .onEnd(() => {
            isInteracting.value = false;
        })
        .onFinalize(() => {
            isInteracting.value = false;
        });

    const activeWindowIndices = useMemo(() => {
        const indices = [];
        const range = 4;
        for (let i = baseIndex - range; i <= baseIndex + range; i++) {
            if (i >= 0 && i < content.length) indices.push(i);
        }
        return indices;
    }, [baseIndex, content.length]);

    if (loading) {
        return (
            <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
                <ActivityIndicator size='large' color={theme.tint} />
                <Text style={{ marginTop: 20, color: theme.text }}>{t.loading}</Text>
            </View>
        );
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaView style={[styles.container, { backgroundColor: theme.readerBackground }]}>

                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <TouchableOpacity onPress={() => { saveCurrentProgress(); navigation.goBack(); }} style={styles.backButton}>
                        <Text style={[styles.backText, { color: theme.tint }]}>← {t.back}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowSettings(true)}>
                        <Ionicons name="settings-outline" size={24} color={theme.text} />
                    </TouchableOpacity>
                </View>

                {/* Prompter Engine */}
                <GestureDetector gesture={pan}>
                    <Animated.View style={styles.prompterContainer}>
                        <View style={{ height: ITEM_HEIGHT * 5, width: '100%', justifyContent: 'center', alignItems: 'center' }}>
                            {activeWindowIndices.map(i => (
                                <PrompterItem
                                    key={i}
                                    index={i}
                                    text={content[i]}
                                    progress={progress}
                                    theme={theme}
                                    settings={settings.reader}
                                    itemHeight={ITEM_HEIGHT}
                                />
                            ))}
                        </View>
                    </Animated.View>
                </GestureDetector>

                {/* Controls */}
                <View style={[styles.controls, { backgroundColor: theme.cardBackground, borderTopColor: theme.border }]}>
                    <View style={styles.infoRow}>
                        <Text style={{ color: theme.subText, fontVariant: ['tabular-nums'] }}>
                            {baseIndex} / {content.length}
                        </Text>
                    </View>

                    <View style={styles.sliderRow}>
                        <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
                            <Ionicons name={wpm > 0 ? "pause" : "play"} size={30} color={theme.tint} />
                        </TouchableOpacity>

                        <View style={{ flex: 1, paddingHorizontal: 10 }}>
                            <Text style={[styles.wpmLabel, { color: theme.subText, textAlign: 'center' }]}>
                                {wpm > 0 ? wpm : 'PAUSE'} WPM
                            </Text>
                            <Slider
                                style={{ width: '100%', height: 40 }}
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

                {/* Settings Modal */}
                <Modal visible={showSettings} animationType="slide" transparent>
                    <View style={styles.modalOverlay}>
                        <View style={[styles.modalContent, { backgroundColor: theme.cardBackground }]}>
                            <Text style={[styles.modalTitle, { color: theme.text }]}>Reader Settings</Text>

                            {/* TTS Toggle */}
                            <View style={styles.settingRow}>
                                <Text style={{ color: theme.text }}>Text-to-Speech</Text>
                                <Switch
                                    value={ttsEnabled}
                                    onValueChange={setTtsEnabled}
                                />
                            </View>

                            {/* Voice Control */}
                            {ttsEnabled && (
                                <View style={styles.settingRow}>
                                    <Text style={{ color: theme.text }}>Voice Type</Text>
                                    <View style={{ flexDirection: 'row' }}>
                                        <TouchableOpacity
                                            onPress={() => setVoiceGender('Female')}
                                            style={[styles.fontBtn, voiceGender === 'Female' && { backgroundColor: theme.tint }]}
                                        >
                                            <Text style={{ color: voiceGender === 'Female' ? '#fff' : theme.text, fontSize: 12 }}>Female</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => setVoiceGender('Male')}
                                            style={[styles.fontBtn, voiceGender === 'Male' && { backgroundColor: theme.tint }]}
                                        >
                                            <Text style={{ color: voiceGender === 'Male' ? '#fff' : theme.text, fontSize: 12 }}>Male</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}

                            {/* Font Size */}
                            <View style={styles.settingRow}>
                                <Text style={{ color: theme.text }}>Size: {settings.reader.fontSize}</Text>
                                <Slider
                                    style={{ flex: 1, marginLeft: 10 }}
                                    minimumValue={12} maximumValue={48} step={2}
                                    value={settings.reader.fontSize}
                                    onValueChange={v => updateReaderInternal('fontSize', v)}
                                />
                            </View>

                            {/* Weight */}
                            <View style={styles.settingRow}>
                                <Text style={{ color: theme.text }}>Bold Text</Text>
                                <Switch
                                    value={settings.reader.fontWeight === 'bold'}
                                    onValueChange={v => updateReaderInternal('fontWeight', v ? 'bold' : 'normal')}
                                />
                            </View>

                            {/* Font Family */}
                            <View style={styles.settingRow}>
                                <Text style={{ color: theme.text }}>Font Family</Text>
                                <View style={{ flexDirection: 'row' }}>
                                    {['System', 'Serif', 'Monospace'].map(f => (
                                        <TouchableOpacity
                                            key={f}
                                            onPress={() => updateReaderInternal('fontFamily', f)}
                                            style={[styles.fontBtn, settings.reader.fontFamily === f && { backgroundColor: theme.tint }]}
                                        >
                                            <Text style={{ color: settings.reader.fontFamily === f ? '#fff' : theme.text, fontSize: 12 }}>{f}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>

                            {/* Cache Manager */}
                            <View style={[styles.settingRow, { marginTop: 20, borderTopWidth: 1, borderTopColor: '#ccc', paddingTop: 20 }]}>
                                <Text style={{ color: theme.text }}>Offline Cache</Text>
                                <TouchableOpacity
                                    onPress={deleteIndex}
                                    style={{ backgroundColor: 'red', padding: 8, borderRadius: 5 }}
                                >
                                    <Text style={{ color: 'white' }}>Delete Book</Text>
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity
                                style={[styles.closeBtn, { backgroundColor: theme.tint }]}
                                onPress={() => setShowSettings(false)}
                            >
                                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>

            </SafeAreaView>
        </GestureHandlerRootView>
    );
}

const PrompterItem = React.memo(({ index, text, progress, theme, settings, itemHeight }: any) => {

    // We remove the derived value inside item if we can, or just make sure it respects dependencies
    const style = useAnimatedStyle(() => {
        // diff = where is the item relative to the center?
        const diff = index - progress.value;

        // Translate Y
        const translateY = diff * itemHeight;

        // Scale & Opacity based on absolute distance
        const absDiff = Math.abs(diff);

        const scale = interpolate(
            absDiff,
            [0, 1, 2],
            [1.5, 1.0, 0.7],
            Extrapolate.CLAMP
        );

        const opacity = interpolate(
            absDiff,
            [0, 0.8, 1.5, 2.2],
            [1, 0.6, 0.2, 0],
            Extrapolate.CLAMP
        );

        const zIndex = 100 - Math.round(absDiff * 10);

        return {
            transform: [
                { translateY },
                { scale }
            ],
            opacity,
            zIndex,
            position: 'absolute',
            height: itemHeight,
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%'
        };
    });

    return (
        <Animated.View style={style}>
            <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                    color: theme.readerText,
                    fontSize: settings.fontSize,
                    fontWeight: settings.fontWeight,
                    fontFamily: settings.fontFamily === 'Monospace' ? 'Courier' : settings.fontFamily === 'Serif' ? 'Georgia' : 'System',
                    textAlign: 'center',
                    width: '100%',
                }}
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
        padding: 15,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
        zIndex: 10
    },
    backButton: { padding: 5 },
    backText: { fontSize: 16 },
    prompterContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    controls: {
        paddingVertical: 20,
        paddingHorizontal: 20,
        borderTopWidth: 1,
    },
    infoRow: { alignItems: 'center', marginBottom: 10 },
    sliderRow: { flexDirection: 'row', alignItems: 'center' },
    playButton: { padding: 10 },
    wpmLabel: { marginBottom: 5, fontWeight: 'bold' },

    // Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
    modalContent: { padding: 20, borderRadius: 10, elevation: 5 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    fontBtn: { padding: 8, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, marginLeft: 5 },
    closeBtn: { padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
});
