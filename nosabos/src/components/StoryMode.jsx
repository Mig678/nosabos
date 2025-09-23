import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Box,
  Button,
  Text,
  VStack,
  HStack,
  Center,
  Spinner,
  useToast,
  Badge,
  Progress,
  IconButton,
  Input,
  Flex,
  Divider,
  Spacer,
} from "@chakra-ui/react";
import { motion, AnimatePresence } from "framer-motion";
import { FaArrowLeft, FaPlay, FaPause, FaVolumeUp, FaStop } from "react-icons/fa";
import { PiMicrophoneStageDuotone } from "react-icons/pi";
import { useNavigate } from "react-router-dom";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { database } from "../firebaseResources/firebaseResources";
import useUserStore from "../hooks/useUserStore";
import { translations } from "../utils/translation";

// Story Mode component
export default function StoryMode({ userLanguage = "en" }) {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useUserStore((s) => s.user);
  
  // State
  const [storyData, setStoryData] = useState(null);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayingSpanish, setIsPlayingSpanish] = useState(false);
  const [isPlayingEnglish, setIsPlayingEnglish] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [xpEarned, setXpEarned] = useState(0);
  const [showFullStory, setShowFullStory] = useState(true);

  // New state for word highlighting
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1);
  
  // Boundary-driven highlighting state
  const [tokenizedText, setTokenizedText] = useState(null);
  const [wordIndexByChar, setWordIndexByChar] = useState(null);
  const [boundarySupported, setBoundarySupported] = useState(null);

  // Refs
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null);
  const storyCacheRef = useRef(null);
  const highlightIntervalRef = useRef(null);
  const currentUtteranceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const currentAudioRef = useRef(null); // Track current audio for cleanup
  const eventSourceRef = useRef(null); // Track EventSource for cleanup
  const hasAutoPlayedRef = useRef(false); // Track if we've already auto-played
  const audioCacheRef = useRef(new Map()); // Cache audio URLs to avoid repeated TTS calls
  const usageStatsRef = useRef({ 
    ttsCalls: 0, 
    storyGenerations: 0, 
    lastResetDate: new Date().toDateString() 
  }); // Track API usage for cost monitoring
  
  // Speech recognition state
  let speechRecognitionCompleted = false;
  let evaluationInProgress = false;
  let evaluationTimeout = null;

  const t = translations[userLanguage] || translations.en;

  // Validate and fix story sentences to match full story
  const validateAndFixStorySentences = (storyData) => {
    if (!storyData || !storyData.fullStory || !storyData.sentences) {
      return storyData;
    }

    const fullStoryText = storyData.fullStory.es;
    const sentences = storyData.sentences;

    console.log('🔍 Validating story sentences:', {
      fullStoryText,
      originalSentences: sentences.map(s => s.es),
      sentencesCount: sentences.length
    });

    // More robust sentence extraction
    const sentencesFromStory = fullStoryText
      .split(/[.!?]+/)
      .filter(s => s.trim().length > 0)
      .map(s => s.trim())
      .map(s => s.endsWith('.') || s.endsWith('!') || s.endsWith('?') ? s : s + '.');

    console.log('🔍 Extracted sentences from full story:', sentencesFromStory);

    // Check if sentences match by comparing the full story reconstruction
    const reconstructedStory = sentencesFromStory.join(' ');
    const originalStory = fullStoryText.trim();
    
    console.log('🔍 Story comparison:', {
      originalStory,
      reconstructedStory,
      matches: reconstructedStory === originalStory
    });

    // If the reconstructed story matches the original, use the extracted sentences
    if (reconstructedStory === originalStory && sentencesFromStory.length === sentences.length) {
      const validatedSentences = sentencesFromStory.map((sentenceText, index) => ({
        es: sentenceText,
        en: sentences[index]?.en || `[Translation needed for: ${sentenceText}]`
      }));

      console.log('✅ Reconstructed sentences to match full story');
      return {
        ...storyData,
        sentences: validatedSentences
      };
    }

    console.log('⚠️ Story reconstruction failed, using original sentences');
    return storyData;
  };

  // Stop all audio and speech synthesis
  const stopAllAudio = () => {
    console.log('🛑 Stopping all audio...');
    
    // Stop speech synthesis
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
    
    // Stop any ongoing audio playback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    
    // Stop any ongoing utterance
    if (currentUtteranceRef.current) {
      currentUtteranceRef.current = null;
    }
    
    // Clear highlighting intervals
    if (highlightIntervalRef.current) {
      clearTimeout(highlightIntervalRef.current);
      highlightIntervalRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Reset states
    setIsPlayingSpanish(false);
    setIsPlayingEnglish(false);
    setIsAutoPlaying(false);
    setHighlightedWordIndex(-1);
    
    console.log('✅ All audio stopped');
  };

  // Robust tokenizer utility
  const createTokenMap = useCallback((text) => {
    const tokens = [];
    const wordIndexByChar = new Map();
    let charIndex = 0;
    let wordIndex = 0;
    
    // Regex to match words and separators (preserves punctuation and spaces)
    const tokenRegex = /(\S+|\s+|[^\w\s])/g;
    let match;
    
    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      const isWord = /\S/.test(token) && !/[^\w\s]/.test(token);
      
      tokens.push({
        text: token,
        isWord: isWord,
        startChar: charIndex,
        endChar: charIndex + token.length
      });
      
      // Map character indices to word indices
      for (let i = 0; i < token.length; i++) {
        if (isWord) {
          wordIndexByChar.set(charIndex + i, wordIndex);
        }
      }
      
      if (isWord) {
        wordIndex++;
      }
      
      charIndex += token.length;
    }
    
    return {
      tokens,
      wordIndexByChar: (charIndex) => wordIndexByChar.get(charIndex) ?? -1,
      totalWords: wordIndex
    };
  }, []);

  // Boundary-driven word highlighting with TTS sync
  const setupBoundaryHighlighting = useCallback((text, onComplete) => {
    // Create token map for the text
    const tokenMap = createTokenMap(text);
    setTokenizedText(tokenMap.tokens);
    setWordIndexByChar(() => tokenMap.wordIndexByChar);
    
    // Reset highlighting state
    setHighlightedWordIndex(-1);
    setCurrentWordIndex(0);
    
    // Clear any existing timeouts/intervals
    if (highlightIntervalRef.current) {
      clearTimeout(highlightIntervalRef.current);
      highlightIntervalRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Performance-optimized highlight update
    const updateHighlight = (wordIndex) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      animationFrameRef.current = requestAnimationFrame(() => {
        setHighlightedWordIndex(wordIndex);
        setCurrentWordIndex(wordIndex);
      });
    };
    
    // Boundary event handler
    const handleBoundary = (event) => {
      if (event.name === 'word' || event.name === 'sentence') {
        const wordIndex = tokenMap.wordIndexByChar(event.charIndex);
        if (wordIndex >= 0) {
          updateHighlight(wordIndex);
        }
      }
    };
    
    // Fallback heuristic timing (if boundary events not supported)
    const fallbackTiming = () => {
      let currentIndex = 0;
      const words = text.split(/\s+/);
      
      const highlightNext = () => {
        if (currentIndex >= words.length) {
          onComplete?.();
          return;
        }
        
        updateHighlight(currentIndex);
        
        // Calculate timing based on word length and TTS rate
        const word = words[currentIndex];
        const baseTime = 200;
        const lengthMultiplier = word.length * 50;
        const timing = Math.max(150, Math.min(800, baseTime + lengthMultiplier));
        
        currentIndex++;
        highlightIntervalRef.current = setTimeout(highlightNext, timing);
      };
      
      highlightNext();
    };
    
    return { handleBoundary, fallbackTiming, tokenMap };
  }, [createTokenMap]);

  // Load story progress from Firestore
  const loadStoryProgress = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const docRef = doc(database, "users", user.id);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        const progress = data.storyProgress || { currentSegmentIndex: 0, xpEarned: 0, completedSegments: [] };
        setStoryProgress(progress);
        setCurrentSegmentIndex(progress.currentSegmentIndex);
        setXpEarned(progress.xpEarned);
      }
    } catch (error) {
      console.error("Error loading story progress:", error);
    }
  }, [user?.id]);

  // Save story progress to Firestore
  const saveStoryProgress = useCallback(async (progress) => {
    if (!user?.id) return;
    
    try {
      const docRef = doc(database, "users", user.id);
      await setDoc(docRef, { storyProgress: progress }, { merge: true });
    } catch (error) {
      console.error("Error saving story progress:", error);
    }
  }, [user?.id]);

  // Generate story using GPT-4o mini (simplified approach)
  const generateStory = async () => {
    setIsLoading(true);
    try {
      console.log('🎬 Generating story with GPT-4o mini...');
      
      // Track story generation usage for cost monitoring
      usageStatsRef.current.storyGenerations++;
      console.log(`💰 Story generation #${usageStatsRef.current.storyGenerations} (estimated cost: ~$0.0001)`);
      
      // Use the existing Firebase function for story generation
      const storyUrl = 'https://generatestory-xeujgchwja-uc.a.run.app';
      
      const response = await fetch(storyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userLanguage: userLanguage,
          level: user?.progress?.level || "beginner",
          targetLang: "es"
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Story generation response:', data);
      
      const storySegments = data.story || data;
      
      // Validate and ensure sentences match the full story
      const validatedStory = validateAndFixStorySentences(storySegments);
      
      setStoryData(validatedStory);
      storyCacheRef.current = validatedStory;
      
      // Reset progress for new story
      setCurrentSentenceIndex(0);
      setXpEarned(0);
      setShowFullStory(true);
      setHighlightedWordIndex(-1);
      
      // Reset auto-play flag for new story
      hasAutoPlayedRef.current = false;
      
      console.log('✅ Story loaded successfully:', storySegments);
      
    } catch (error) {
      console.error("Error generating story:", error);
      
      // Fallback story if API fails
      const fallbackStory = {
        fullStory: {
          es: "Había una vez un pequeño pueblo en México llamado San Miguel. El pueblo tenía una plaza muy bonita donde los niños jugaban todos los días. En la plaza, había una fuente antigua que siempre tenía agua fresca. Los adultos se sentaban alrededor de la fuente para hablar y descansar después del trabajo.",
          en: "Once upon a time, there was a small town in Mexico called San Miguel. The town had a very beautiful square where the children played every day. In the square, there was an old fountain that always had fresh water. The adults sat around the fountain to talk and rest after work."
        },
        sentences: [
          {
            es: "Había una vez un pequeño pueblo en México llamado San Miguel.",
            en: "Once upon a time, there was a small town in Mexico called San Miguel."
          },
          {
            es: "El pueblo tenía una plaza muy bonita donde los niños jugaban todos los días.",
            en: "The town had a very beautiful square where the children played every day."
          },
          {
            es: "En la plaza, había una fuente antigua que siempre tenía agua fresca.",
            en: "In the square, there was an old fountain that always had fresh water."
          },
          {
            es: "Los adultos se sentaban alrededor de la fuente para hablar y descansar después del trabajo.",
            en: "The adults sat around the fountain to talk and rest after work."
          }
        ]
      };
      
      // Validate and ensure sentences match the full story
      const validatedFallback = validateAndFixStorySentences(fallbackStory);
      
      setStoryData(validatedFallback);
      storyCacheRef.current = validatedFallback;
      
      // Reset auto-play flag for fallback story
      hasAutoPlayedRef.current = false;
      
      toast({
        title: "Using Demo Story",
        description: "API unavailable. Using demo story for testing.",
        status: "info",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
    }
  };


  // Boundary-driven word highlighting with TTS sync
  const highlightWords = (text, onComplete) => {
    const words = text.split(' ');
    setHighlightedWordIndex(-1);
    setCurrentWordIndex(0);
    
    // Clear any existing interval
    if (highlightIntervalRef.current) {
      clearInterval(highlightIntervalRef.current);
    }
    
    // Calculate dynamic timing based on word length and TTS rate
    const calculateWordTiming = (word) => {
      // Base timing: longer words get more time
      const baseTime = 200; // Base 200ms
      const lengthMultiplier = word.length * 50; // 50ms per character
      const minTime = 150; // Minimum 150ms
      const maxTime = 800; // Maximum 800ms
      
      return Math.max(minTime, Math.min(maxTime, baseTime + lengthMultiplier));
    };
    
    let currentIndex = 0;
    
    const highlightNextWord = () => {
      if (currentIndex >= words.length) {
        onComplete?.();
        return;
      }
      
      setHighlightedWordIndex(currentIndex);
      setCurrentWordIndex(currentIndex);
      
      const currentWord = words[currentIndex];
      const timing = calculateWordTiming(currentWord);
      
      currentIndex++;
      
      highlightIntervalRef.current = setTimeout(highlightNextWord, timing);
    };
    
    // Start highlighting
    highlightNextWord();
  };

  // Enhanced narration with OpenAI TTS (same as RealTimeTest) - WITH SMART FALLBACK
  const playNarrationWithHighlighting = async (text) => {
    console.log('🎤 Starting narration with text:', text);
    console.log('🎤 Text length:', text?.length);
    
    // Stop ALL existing audio and speech first
    stopAllAudio();
    
    setIsAutoPlaying(true);
    setIsPlayingSpanish(true);
    
    try {
      // For short text (< 50 characters), use Web Speech API to save costs
      if (text.length < 50) {
        console.log('🎤 Using Web Speech API for short text (cost efficient)');
        await playEnhancedWebSpeech(text);
        return;
      }
      
      // For longer text, use OpenAI TTS for high-quality voice (same as RealTimeTest)
      await playWithOpenAITTS(text);
    } catch (error) {
      console.error('❌ OpenAI TTS failed, using fallback:', error);
      // Stop any partial audio from OpenAI TTS before trying fallback
      stopAllAudio();
      await playEnhancedWebSpeech(text);
    }
  };

  // Play with OpenAI TTS (same high-quality voices as RealTimeTest) - WITH CACHING
  const playWithOpenAITTS = async (text) => {
    try {
      console.log('🎵 Using OpenAI TTS for high-quality voice...');
      
      // Stop any existing audio first
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      
      // Use the same voice selection as RealTimeTest
      const voice = user?.progress?.voice || "alloy"; // Default to alloy like RealTimeTest
      
      // Check cache first to avoid repeated API calls
      const cacheKey = `${text}-${voice}`;
      let audioUrl;
      
      if (audioCacheRef.current.has(cacheKey)) {
        console.log('🎵 Using cached audio for cost efficiency');
        audioUrl = audioCacheRef.current.get(cacheKey);
      } else {
        console.log('🎵 Generating new audio (not cached)');
        
        // Track TTS usage for cost monitoring
        usageStatsRef.current.ttsCalls++;
        console.log(`💰 TTS API call #${usageStatsRef.current.ttsCalls} (estimated cost: ~$0.003)`);
        
        // Call OpenAI TTS API through Firebase proxy
        const response = await fetch('https://us-central1-nosabo-miguel.cloudfunctions.net/proxyTTS', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          voice: voice, // Use the same voices as RealTimeTest
          model: "tts-1",
          response_format: "mp3"
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI TTS API error: ${response.status}`);
      }
      
        const audioBlob = await response.blob();
        audioUrl = URL.createObjectURL(audioBlob);
        
        // Cache the audio URL for future use
        audioCacheRef.current.set(cacheKey, audioUrl);
        console.log('🎵 Audio cached for future use');
      }
      
      // Setup boundary-driven highlighting
      const { handleBoundary, fallbackTiming, tokenMap } = setupBoundaryHighlighting(text, () => {
        console.log('🎤 Highlighting completed');
        setIsAutoPlaying(false);
        setIsPlayingSpanish(false);
      });
      
      // Use fallback timing since we can't get boundary events from audio
      fallbackTiming();
      
      // Play the high-quality audio
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio; // Store reference for cleanup
      
      audio.onended = () => {
        console.log('🔊 OpenAI TTS playback ended');
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
        // Don't revoke URL if it's cached - keep it for reuse
        if (!audioCacheRef.current.has(cacheKey)) {
          URL.revokeObjectURL(audioUrl);
        }
        currentAudioRef.current = null;
      };
      
      audio.onerror = (error) => {
        console.error('❌ OpenAI TTS playback error:', error);
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
        // Don't revoke URL if it's cached
        if (!audioCacheRef.current.has(cacheKey)) {
          URL.revokeObjectURL(audioUrl);
        }
        currentAudioRef.current = null;
        throw error;
      };
      
      await audio.play();
      
    } catch (error) {
      console.error('OpenAI TTS error:', error);
      throw error;
    }
  };

  // Synthesize speech using Web Speech API with enhanced settings
  const synthesizeSpeech = async (text) => {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('Speech synthesis not supported'));
        return;
      }

      // Wait for voices to load
      const loadVoices = () => {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) {
          setTimeout(loadVoices, 100);
          return;
        }

        // Find the best Spanish voice
        const spanishVoices = voices.filter(voice => 
          voice.lang.startsWith('es') || 
          voice.lang.includes('Spanish') ||
          voice.name.toLowerCase().includes('spanish')
        );
        
        // Prefer neural voices for better quality
        const neuralVoices = spanishVoices.filter(voice => 
          voice.name.toLowerCase().includes('neural') ||
          voice.name.toLowerCase().includes('premium') ||
          voice.name.toLowerCase().includes('enhanced')
        );
        
        // Prefer female voices for more natural sound
        const femaleVoices = (neuralVoices.length > 0 ? neuralVoices : spanishVoices).filter(voice =>
          voice.name.toLowerCase().includes('female') ||
          voice.name.toLowerCase().includes('maria') ||
          voice.name.toLowerCase().includes('monica') ||
          voice.name.toLowerCase().includes('sofia')
        );
        
        const preferredVoice = femaleVoices[0] || neuralVoices[0] || spanishVoices[0];
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.rate = 0.75; // Optimal rate for comprehension
        utterance.pitch = 1.05; // Slightly higher for more natural sound
        utterance.volume = 0.95;
        
        if (preferredVoice) {
          utterance.voice = preferredVoice;
          console.log('🎵 Using enhanced voice:', preferredVoice.name);
        }
        
        // Enhanced event handlers
        utterance.onstart = () => {
          console.log('🔊 Enhanced TTS started');
          setIsPlayingSpanish(true);
        };
        
        utterance.onend = () => {
          console.log('🔊 Enhanced TTS ended');
          setIsPlayingSpanish(false);
          setIsAutoPlaying(false);
          resolve();
        };
        
        utterance.onerror = (event) => {
          console.error('❌ Enhanced TTS error:', event.error);
          setIsPlayingSpanish(false);
          setIsAutoPlaying(false);
          reject(new Error(event.error));
        };
        
        speechSynthesis.speak(utterance);
      };
      
      loadVoices();
    });
  };

  // Play audio with word highlighting synchronization
  const playAudioWithHighlighting = async (audioUrl, text) => {
    try {
      const audio = new Audio(audioUrl);
      
      // Setup boundary-driven highlighting
      const { handleBoundary, fallbackTiming, tokenMap } = setupBoundaryHighlighting(text, () => {
        console.log('🎤 Highlighting completed');
        setIsAutoPlaying(false);
        setIsPlayingSpanish(false);
      });
      
      // Use fallback timing since we can't get boundary events from audio
      fallbackTiming();
      
      audio.onended = () => {
        console.log('🔊 Audio playback ended');
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
      };
      
      audio.onerror = (error) => {
        console.error('❌ Audio playback error:', error);
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
      };
      
      await audio.play();
      
    } catch (error) {
      console.error('Audio playback error:', error);
      throw error;
    }
  };

  // Enhanced Web Speech API fallback
  const playEnhancedWebSpeech = async (text) => {
    console.log('🎤 Using enhanced Web Speech API fallback');
    
    // Setup boundary-driven highlighting
    const { handleBoundary, fallbackTiming, tokenMap } = setupBoundaryHighlighting(text, () => {
      console.log('🎤 Highlighting completed');
      setIsAutoPlaying(false);
      setIsPlayingSpanish(false);
    });
    
    // Play TTS with enhanced voice selection
    if ('speechSynthesis' in window) {
      // Wait for voices to load
      const voices = speechSynthesis.getVoices();
      if (voices.length === 0) {
        // Wait for voices to load
        speechSynthesis.addEventListener('voiceschanged', () => {
          playEnhancedWebSpeech(text);
        });
        return;
      }
      
      // Enhanced voice selection
      const spanishVoices = voices.filter(voice => 
        voice.lang.startsWith('es') || 
        voice.lang.includes('Spanish') ||
        voice.name.toLowerCase().includes('spanish')
      );
      
      // Prefer neural/premium voices
      const neuralVoices = spanishVoices.filter(voice => 
        voice.name.toLowerCase().includes('neural') ||
        voice.name.toLowerCase().includes('premium') ||
        voice.name.toLowerCase().includes('enhanced')
      );
      
      // Prefer female voices
      const femaleVoices = (neuralVoices.length > 0 ? neuralVoices : spanishVoices).filter(voice =>
        voice.name.toLowerCase().includes('female') ||
        voice.name.toLowerCase().includes('maria') ||
        voice.name.toLowerCase().includes('monica') ||
        voice.name.toLowerCase().includes('sofia')
      );
      
      const preferredVoice = femaleVoices[0] || neuralVoices[0] || spanishVoices[0];
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 0.75; // Optimal rate
      utterance.pitch = 1.05; // More natural pitch
      utterance.volume = 0.95;
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        console.log('🎵 Using enhanced fallback voice:', preferredVoice.name);
      }
      
      // Store utterance reference for cleanup
      currentUtteranceRef.current = utterance;
      
      // Event handlers with boundary support
      utterance.onstart = () => {
        console.log('🔊 Enhanced TTS started, boundary support:', !!utterance.onboundary);
        setIsPlayingSpanish(true);
        setBoundarySupported(!!utterance.onboundary);
        
        if (!utterance.onboundary) {
          console.log('⚠️ Boundary events not supported, using fallback timing');
          fallbackTiming();
        }
      };
      
      utterance.onboundary = (event) => {
        console.log('📍 Boundary event:', event.name, 'at char:', event.charIndex);
        handleBoundary(event);
      };
      
      utterance.onend = () => {
        console.log('🔊 Enhanced TTS ended');
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
        currentUtteranceRef.current = null;
      };
      
      utterance.onerror = (event) => {
        console.error('❌ Enhanced TTS error:', event.error);
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
        currentUtteranceRef.current = null;
      };
      
      speechSynthesis.speak(utterance);
    } else {
      setIsPlayingSpanish(false);
      setIsAutoPlaying(false);
    }
  };

  // Text-to-speech for Spanish using OpenAI TTS
  const playSpanishTTS = async (text) => {
    if (!text) return;
    
    // Stop all existing audio first
    stopAllAudio();
    
    setIsPlayingSpanish(true);
    
    try {
      // Use OpenAI TTS for high-quality voice
      await playWithOpenAITTS(text);
    } catch (error) {
      console.error('OpenAI TTS failed, using fallback:', error);
      
      // Stop any partial audio before fallback
      stopAllAudio();
      
      // Fallback to Web Speech API
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.rate = 0.8;
        utterance.pitch = 1;
        
        utterance.onend = () => setIsPlayingSpanish(false);
        utterance.onerror = () => setIsPlayingSpanish(false);
        
        speechSynthesis.speak(utterance);
      } else {
        setIsPlayingSpanish(false);
      }
    }
  };

  // Text-to-speech for English
  const playEnglishTTS = (text) => {
    if (!text) return;
    
    // Cancel any ongoing speech first
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
    
    setIsPlayingEnglish(true);
    
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.8;
      utterance.pitch = 1;
      
      utterance.onend = () => setIsPlayingEnglish(false);
      utterance.onerror = () => setIsPlayingEnglish(false);
      
      speechSynthesis.speak(utterance);
    } else {
      setIsPlayingEnglish(false);
    }
  };

  // Start recording for pronunciation evaluation
  const startRecording = async () => {
    // Prevent multiple evaluations
    if (evaluationInProgress) {
      console.log('⚠️ Evaluation already in progress, skipping');
      return;
    }
    
    try {
      evaluationInProgress = true;
      speechRecognitionCompleted = false;
      
      // Set a timeout to prevent evaluation from running too long
      evaluationTimeout = setTimeout(() => {
        if (evaluationInProgress) {
          console.warn('⚠️ Evaluation timeout, forcing completion');
          evaluationInProgress = false;
          handleEvaluationResult({
            score: 60, // Give a decent score for effort
            recognizedText: '[Evaluation Timeout]',
            confidence: 0.4,
            alternatives: [],
            method: 'timeout-fallback'
          });
        }
      }, 15000); // 15 second timeout
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      // Start live speech recognition immediately
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        startLiveSpeechRecognition();
      }
      
      const audioChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        
        // If speech recognition didn't complete, use audio analysis
        if (!speechRecognitionCompleted) {
          await evaluateWithAudioAnalysis(audioBlob);
        }
        
        stream.getTracks().forEach(track => track.stop());
        evaluationInProgress = false; // Reset flag
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      
      // Auto-stop after 10 seconds if no speech recognition
      setTimeout(() => {
        if (!speechRecognitionCompleted) {
          console.log('🔄 Auto-stopping recording after 10 seconds');
          stopRecording();
        }
      }, 10000);
      
      // If speech recognition didn't complete, use audio analysis
      if (!speechRecognitionCompleted) {
        setTimeout(() => {
          if (!speechRecognitionCompleted && evaluationInProgress) {
            console.log('🔄 Using audio analysis fallback');
            stopRecording();
          }
        }, 12000);
      }
      
    } catch (error) {
      console.error("Error starting recording:", error);
      evaluationInProgress = false; // Reset flag on error
      toast({
        title: "Error",
        description: "Could not access microphone. Please check permissions.",
        status: "error",
        duration: 3000,
      });
    }
  };

  // Live speech recognition during recording
  const startLiveSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.lang = 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;
    
    let recognitionResult = null;
    speechRecognitionCompleted = false;
    
    recognition.onresult = (event) => {
      // Only process if evaluation is still in progress
      if (!evaluationInProgress) {
        console.log('⚠️ Evaluation no longer in progress, ignoring result');
        return;
      }
      
      const result = event.results[0];
      recognitionResult = result;
      speechRecognitionCompleted = true;
      evaluationInProgress = false; // Mark evaluation as complete
      
      // Clear timeout since evaluation completed
      if (evaluationTimeout) {
        clearTimeout(evaluationTimeout);
        evaluationTimeout = null;
      }
      
      console.log('🎯 Live recognition result:', {
        transcript: result[0].transcript,
        confidence: result[0].confidence,
        alternatives: Array.from(result).map(alt => alt.transcript)
      });
      
      // Calculate score immediately
      const score = calculateImprovedSimilarityScore(result, currentSentence?.es);
      handleEvaluationResult({
        score: score,
        recognizedText: result[0].transcript,
        confidence: result[0].confidence,
        alternatives: Array.from(result).map(alt => alt.transcript),
        method: 'live-speech-api'
      });
    };
    
    recognition.onerror = (event) => {
      console.warn('⚠️ Live recognition error:', event.error);
      speechRecognitionCompleted = true;
      
      // Only handle error if evaluation is still in progress
      if (!evaluationInProgress) {
        console.log('⚠️ Evaluation no longer in progress, ignoring error');
        return;
      }
      
      evaluationInProgress = false; // Mark evaluation as complete
      
      // Clear timeout since evaluation completed
      if (evaluationTimeout) {
        clearTimeout(evaluationTimeout);
        evaluationTimeout = null;
      }
      
      // Give a reasonable score based on error type
      let fallbackScore = 50;
      if (event.error === 'no-speech') {
        fallbackScore = 30;
      } else if (event.error === 'audio-capture') {
        fallbackScore = 40;
      } else if (event.error === 'not-allowed') {
        fallbackScore = 20;
      }
      
      handleEvaluationResult({
        score: fallbackScore,
        recognizedText: `[Error: ${event.error}]`,
        confidence: 0.3,
        alternatives: [],
        method: 'error-fallback'
      });
    };
    
    recognition.onend = () => {
      if (!speechRecognitionCompleted && evaluationInProgress) {
        console.warn('⚠️ Live recognition ended without result');
        speechRecognitionCompleted = true;
        evaluationInProgress = false; // Mark evaluation as complete
        
        // Clear timeout since evaluation completed
        if (evaluationTimeout) {
          clearTimeout(evaluationTimeout);
          evaluationTimeout = null;
        }
        
        handleEvaluationResult({
          score: 45,
          recognizedText: '[No Result]',
          confidence: 0.2,
          alternatives: [],
          method: 'no-result-fallback'
        });
      }
    };
    
    try {
      recognition.start();
      console.log('🎤 Starting live speech recognition...');
    } catch (error) {
      console.error('❌ Failed to start live recognition:', error);
      speechRecognitionCompleted = true;
      handleEvaluationResult({
        score: 40,
        recognizedText: '[Start Failed]',
        confidence: 0.1,
        alternatives: [],
        method: 'start-failed'
      });
    }
  };

  // Audio analysis fallback
  const evaluateWithAudioAnalysis = async (audioBlob) => {
    // Only proceed if evaluation is still in progress
    if (!evaluationInProgress) {
      console.log('⚠️ Evaluation no longer in progress, skipping audio analysis');
      return;
    }
    
    console.log('🔄 Using audio analysis fallback');
    evaluationInProgress = false; // Mark evaluation as complete
    
    // Clear timeout since evaluation completed
    if (evaluationTimeout) {
      clearTimeout(evaluationTimeout);
      evaluationTimeout = null;
    }
    
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const duration = audioBuffer.duration;
      const sampleRate = audioBuffer.sampleRate;
      const channelData = audioBuffer.getChannelData(0);
      
      const rms = calculateRMS(channelData);
      const zeroCrossings = calculateZeroCrossings(channelData);
      const spectralCentroid = calculateSpectralCentroid(channelData, sampleRate);
      
      const score = estimatePronunciationScore({
        duration,
        rms,
        zeroCrossings,
        spectralCentroid,
        targetLength: currentSentence?.es?.length || 0
      });
      
      handleEvaluationResult({
        score: score,
        recognizedText: '[Audio Analysis]',
        confidence: 0.5,
        alternatives: [],
        method: 'fallback',
        audioMetrics: { duration, rms, zeroCrossings, spectralCentroid }
      });
      
    } catch (error) {
      console.error('❌ Audio analysis error:', error);
      handleEvaluationResult({
        score: Math.random() * 30 + 50,
        recognizedText: '[Analysis Failed]',
        confidence: 0.4,
        alternatives: [],
        method: 'ultimate-fallback'
      });
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };



  // Improved similarity scoring with better algorithms
  const calculateImprovedSimilarityScore = (recognitionResult, targetSentence) => {
    const recognizedText = recognitionResult[0].transcript.toLowerCase().trim();
    const targetText = targetSentence.toLowerCase().trim();
    
    console.log('📊 Improved similarity analysis:', {
      recognized: recognizedText,
      target: targetText,
      confidence: recognitionResult[0].confidence
    });
    
    // Method 1: Exact match (highest score)
    if (recognizedText === targetText) {
      console.log('✅ Exact match!');
      return Math.min(100, 95 + (recognitionResult[0].confidence * 5));
    }
    
    // Method 2: Check alternatives for better matches
    let bestScore = 0;
    for (let i = 0; i < recognitionResult.length; i++) {
      const altText = recognitionResult[i].transcript.toLowerCase().trim();
      const altConfidence = recognitionResult[i].confidence || 0.5;
      
      if (altText === targetText) {
        console.log(`✅ Alternative ${i} exact match!`);
        return Math.min(100, 90 + (altConfidence * 10));
      }
      
      const altScore = calculateWordBasedSimilarity(altText, targetText, altConfidence);
      bestScore = Math.max(bestScore, altScore);
    }
    
    // Method 3: Word-based similarity (more forgiving)
    const wordScore = calculateWordBasedSimilarity(recognizedText, targetText, recognitionResult[0].confidence);
    bestScore = Math.max(bestScore, wordScore);
    
    // Method 4: Phonetic similarity for Spanish words
    const phoneticScore = calculatePhoneticSimilarity(recognizedText, targetText, recognitionResult[0].confidence);
    bestScore = Math.max(bestScore, phoneticScore);
    
    console.log('📊 Final score:', bestScore.toFixed(1));
    return Math.min(100, Math.max(0, bestScore));
  };

  // Phonetic similarity for Spanish pronunciation
  const calculatePhoneticSimilarity = (recognizedText, targetText, confidence) => {
    // Common Spanish pronunciation variations
    const phoneticMappings = {
      'c': ['k', 's', 'z'],
      'z': ['s', 'th'],
      'll': ['y', 'j'],
      'ñ': ['n', 'ny'],
      'rr': ['r'],
      'qu': ['k'],
      'h': [''],
      'v': ['b'],
      'b': ['v'],
      'g': ['j', 'h'],
      'j': ['h', 'g'],
      'x': ['ks', 's'],
      'y': ['i', 'll']
    };
    
    let normalizedRecognized = recognizedText;
    let normalizedTarget = targetText;
    
    // Apply phonetic normalizations
    for (const [original, variations] of Object.entries(phoneticMappings)) {
      const regex = new RegExp(original, 'g');
      normalizedRecognized = normalizedRecognized.replace(regex, `(${original}|${variations.join('|')})`);
      normalizedTarget = normalizedTarget.replace(regex, `(${original}|${variations.join('|')})`);
    }
    
    // Calculate similarity with phonetic considerations
    const distance = levenshteinDistance(recognizedText, targetText);
    const maxLength = Math.max(recognizedText.length, targetText.length);
    const phoneticSimilarity = maxLength > 0 ? (maxLength - distance) / maxLength : 0;
    
    // Apply confidence weighting
    const confidenceWeight = Math.max(0.7, confidence); // More generous for phonetic matching
    const finalScore = phoneticSimilarity * 100 * confidenceWeight;
    
    console.log('📊 Phonetic analysis:', {
      recognized: recognizedText,
      target: targetText,
      phoneticSimilarity: phoneticSimilarity.toFixed(3),
      confidenceWeight: (confidenceWeight * 100).toFixed(1) + '%',
      finalScore: finalScore.toFixed(1)
    });
    
    return finalScore;
  };

  // Word-based similarity calculation (more forgiving than character-based)
  const calculateWordBasedSimilarity = (recognizedText, targetText, confidence) => {
    const recognizedWords = recognizedText.split(/\s+/).filter(w => w.length > 0);
    const targetWords = targetText.split(/\s+/).filter(w => w.length > 0);
    
    // Calculate word-level similarity
    let matches = 0;
    let partialMatches = 0;
    let totalWords = Math.max(recognizedWords.length, targetWords.length);
    
    // Check for word matches (exact and fuzzy)
    for (const targetWord of targetWords) {
      const bestMatch = recognizedWords.find(recWord => {
        // Exact match
        if (recWord === targetWord) return true;
        
        // Fuzzy match (for common mispronunciations)
        const similarity = calculateWordSimilarity(recWord, targetWord);
        return similarity > 0.6; // Lowered threshold to 60%
      });
      
      if (bestMatch) {
        const similarity = calculateWordSimilarity(bestMatch, targetWord);
        if (similarity >= 0.8) {
          matches++; // Full match
        } else {
          partialMatches++; // Partial match
        }
      }
    }
    
    // Calculate score with partial matches
    const wordSimilarity = ((matches + partialMatches * 0.5) / totalWords) * 100;
    
    // Apply confidence weighting but be more generous
    const confidenceWeight = Math.max(0.8, confidence); // Increased minimum to 80%
    const finalScore = wordSimilarity * confidenceWeight;
    
    console.log('📊 Word-based analysis:', {
      recognizedWords: recognizedWords.length,
      targetWords: targetWords.length,
      matches,
      partialMatches,
      wordSimilarity: wordSimilarity.toFixed(1) + '%',
      confidenceWeight: (confidenceWeight * 100).toFixed(1) + '%',
      finalScore: finalScore.toFixed(1)
    });
    
    return finalScore;
  };

  // Calculate similarity between two words
  const calculateWordSimilarity = (word1, word2) => {
    const distance = levenshteinDistance(word1, word2);
    const maxLength = Math.max(word1.length, word2.length);
    return maxLength > 0 ? (maxLength - distance) / maxLength : 0;
  };

  // Levenshtein distance calculation
  const levenshteinDistance = (str1, str2) => {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  };

  // Audio analysis helper functions
  const calculateRMS = (channelData) => {
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) {
      sum += channelData[i] * channelData[i];
    }
    return Math.sqrt(sum / channelData.length);
  };

  const calculateZeroCrossings = (channelData) => {
    let crossings = 0;
    for (let i = 1; i < channelData.length; i++) {
      if ((channelData[i] >= 0) !== (channelData[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings;
  };

  const calculateSpectralCentroid = (channelData, sampleRate) => {
    // Simplified spectral centroid calculation
    let weightedSum = 0;
    let magnitudeSum = 0;
    
    for (let i = 0; i < channelData.length; i++) {
      const magnitude = Math.abs(channelData[i]);
      weightedSum += i * magnitude;
      magnitudeSum += magnitude;
    }
    
    return magnitudeSum > 0 ? (weightedSum / magnitudeSum) * (sampleRate / channelData.length) : 0;
  };

  // More generous pronunciation score estimation based on audio characteristics
  const estimatePronunciationScore = ({ duration, rms, zeroCrossings, spectralCentroid, targetLength }) => {
    let score = 70; // Even higher base score to be more encouraging
    
    // Duration analysis (more forgiving)
    const expectedDuration = targetLength * 0.1; // Faster estimate: 100ms per character
    const durationRatio = duration / expectedDuration;
    if (durationRatio > 0.3 && durationRatio < 3.0) {
      score += 20; // Good duration - very generous range
    } else if (durationRatio < 0.15 || durationRatio > 5.0) {
      score -= 15; // Less harsh penalty
    }
    
    // RMS analysis (volume/energy) - more forgiving
    if (rms > 0.003 && rms < 0.5) {
      score += 25; // Good energy level - very wide range
    } else if (rms < 0.001) {
      score -= 10; // Less harsh penalty for quiet
    } else if (rms > 0.8) {
      score -= 5; // Less harsh penalty for loud
    }
    
    // Zero crossings analysis (speech vs noise) - more forgiving
    const crossingsPerSecond = zeroCrossings / duration;
    if (crossingsPerSecond > 600 && crossingsPerSecond < 8000) {
      score += 20; // Good speech characteristics - very wide range
    } else if (crossingsPerSecond < 200) {
      score -= 5; // Less harsh penalty
    }
    
    // Spectral centroid (voice quality) - more forgiving
    if (spectralCentroid > 200 && spectralCentroid < 5000) {
      score += 15; // Good voice frequency range - very wide range
    }
    
    // Bonus for any speech-like characteristics
    if (duration > 0.3 && rms > 0.005 && crossingsPerSecond > 300) {
      score += 15; // Bonus for having basic speech characteristics
    }
    
    // Additional bonus for longer recordings (effort)
    if (duration > 1.0) {
      score += 10; // Bonus for longer effort
    }
    
    console.log('📊 Audio analysis:', {
      duration: duration.toFixed(2) + 's',
      rms: rms.toFixed(4),
      crossingsPerSecond: crossingsPerSecond.toFixed(0),
      spectralCentroid: spectralCentroid.toFixed(0),
      finalScore: score.toFixed(1)
    });
    
    return Math.min(100, Math.max(50, score)); // Minimum 50% score
  };

  // Handle evaluation result and provide feedback
  const handleEvaluationResult = (result) => {
    const { score, recognizedText, confidence, method } = result;
    
    console.log('📊 Evaluation result:', {
      score: score.toFixed(1),
      method,
      confidence: (confidence * 100).toFixed(1) + '%',
      recognizedText
    });
    
    const meaningOk = score > 60;
    const isExcellent = score > 85;
    const isGood = score > 75;
    
    let feedbackMessage = "";
    let status = "warning";
    
    if (isExcellent) {
      feedbackMessage = `¡Excelente! Perfect pronunciation! Score: ${Math.round(score)}%`;
      status = "success";
    } else if (isGood) {
      feedbackMessage = `¡Muy bien! Great pronunciation! Score: ${Math.round(score)}%`;
      status = "success";
    } else if (meaningOk) {
      feedbackMessage = `¡Bien! Good effort! Score: ${Math.round(score)}%`;
      status = "success";
    } else {
      feedbackMessage = `Keep practicing! Try speaking more clearly. Score: ${Math.round(score)}%`;
      status = "warning";
    }
    
    // Add method info for debugging
    if (method === 'fallback') {
      feedbackMessage += " (Audio analysis)";
    } else if (method === 'ultimate-fallback') {
      feedbackMessage += " (Basic analysis)";
    }
    
    if (meaningOk) {
      setXpEarned(prev => prev + 15);
    }
    
    toast({
      title: meaningOk ? "¡Bien hecho!" : "Keep practicing!",
      description: feedbackMessage,
      status: status,
      duration: 4000,
    });
    
    // Move to next sentence after delay
    setTimeout(() => {
      if (currentSentenceIndex < storyData.sentences.length - 1) {
        setCurrentSentenceIndex(prev => prev + 1);
        // Reset recording state for next sentence
        setIsRecording(false);
        evaluationInProgress = false;
        speechRecognitionCompleted = false;
        console.log('🔄 Reset recording state for next sentence');
      } else {
        // Story completed
        toast({
          title: "¡Felicidades!",
          description: `Story completed! You earned ${xpEarned + (meaningOk ? 15 : 0)} XP total.`,
          status: "success",
          duration: 3000,
        });
        setShowFullStory(true);
        setCurrentSentenceIndex(0);
        // Reset recording state when returning to full story
        setIsRecording(false);
        evaluationInProgress = false;
        speechRecognitionCompleted = false;
      }
    }, 2000);
  };


  // Initialize story on component mount
  useEffect(() => {
    // Generate story if not cached
    if (!storyCacheRef.current) {
      generateStory();
    } else {
      setStoryData(storyCacheRef.current);
    }
  }, []);

  // Reset recording state when sentence changes
  useEffect(() => {
    if (!showFullStory) {
      // Reset recording state when moving to a new sentence
      setIsRecording(false);
      evaluationInProgress = false;
      speechRecognitionCompleted = false;
      console.log('🔄 Reset recording state for sentence', currentSentenceIndex + 1);
    }
  }, [currentSentenceIndex, showFullStory]);

  // Auto-play Spanish narration when showing full story (only once, not during practice)
  useEffect(() => {
    console.log('🎬 Auto-play effect triggered');
    console.log('🎬 storyData:', storyData);
    console.log('🎬 showFullStory:', showFullStory);
    console.log('🎬 currentSentenceIndex:', currentSentenceIndex);
    console.log('🎬 isPlayingSpanish:', isPlayingSpanish);
    console.log('🎬 isAutoPlaying:', isAutoPlaying);
    console.log('🎬 hasAutoPlayed:', hasAutoPlayedRef.current);
    
    // Only auto-play if ALL conditions are met:
    // 1. Story data exists
    // 2. We're showing the full story (not practicing sentences)
    // 3. We're at the beginning (currentSentenceIndex === 0)
    // 4. No audio is currently playing
    // 5. We haven't already auto-played this story
    // 6. We're not in the middle of sentence practice
    // 7. The story has been fully loaded (not loading)
    if (storyData && 
        showFullStory && 
        storyData.fullStory && 
        storyData.fullStory.es && 
        currentSentenceIndex === 0 && 
        !isLoading && // Don't auto-play while loading
        !isPlayingSpanish && 
        !isPlayingEnglish && 
        !isAutoPlaying && 
        !hasAutoPlayedRef.current) {
      
      console.log('🎬 Starting auto-play in 1500ms');
      hasAutoPlayedRef.current = true; // Mark as auto-played
      
      const timeoutId = setTimeout(() => {
        // Triple-check that conditions are still valid before starting
        if (!isLoading &&
            !isPlayingSpanish && 
            !isPlayingEnglish && 
            !isAutoPlaying && 
            currentSentenceIndex === 0 && 
            showFullStory &&
            storyData && 
            storyData.fullStory && 
            storyData.fullStory.es) {
          playNarrationWithHighlighting(storyData.fullStory.es);
        } else {
          console.log('🎬 Auto-play cancelled - conditions changed');
        }
      }, 1500);
      
      // Cleanup timeout if component unmounts or dependencies change
      return () => {
        clearTimeout(timeoutId);
      };
    } else {
      console.log('🎬 Auto-play conditions not met or audio already playing');
    }
  }, [storyData, showFullStory, currentSentenceIndex, isPlayingSpanish, isPlayingEnglish, isAutoPlaying, isLoading]);

  // Cleanup TTS when component unmounts or page changes
  useEffect(() => {
    const cleanup = () => {
      console.log('🧹 Cleaning up StoryMode...');
      
      // Stop all audio and speech
      stopAllAudio();
      
      // Close EventSource connection if it exists
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      
      if (audioRef.current) {
        clearInterval(audioRef.current);
      }
      
      // Stop any ongoing recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      
      // Reset additional states
      setIsRecording(false);
      
      // Reset auto-play flag
      hasAutoPlayedRef.current = false;
      
      // Clean up audio cache to free memory
      audioCacheRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      audioCacheRef.current.clear();
      
      console.log('✅ StoryMode cleanup complete');
    };

    // Add beforeunload listener to cleanup on page refresh/close
    window.addEventListener('beforeunload', cleanup);
    
    // Cleanup on component unmount
    return () => {
      cleanup();
      window.removeEventListener('beforeunload', cleanup);
    };
  }, []);

  const currentSentence = storyData?.sentences?.[currentSentenceIndex];
  const progressPercentage = storyData ? ((currentSentenceIndex + 1) / storyData.sentences.length) * 100 : 0;

  // Check for reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined' && 
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (isLoading) {
    return (
      <Box minH="100vh" bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)">
        <Center h="100vh">
          <VStack spacing={6}>
            {/* Animated Loading Spinner */}
            <Box position="relative">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                style={{ width: "60px", height: "60px" }}
              >
                <Box
                  w="60px"
                  h="60px"
                  border="4px solid rgba(20, 184, 166, 0.2)"
                  borderTop="4px solid #14b8a6"
                  borderRadius="50%"
                />
              </motion.div>
            </Box>
            
            {/* Loading Text */}
            <VStack spacing={2}>
              <Text color="white" fontSize="xl" fontWeight="600">
                Generating your story with AI
              </Text>
              <Text color="#94a3b8" fontSize="sm" textAlign="center">
                Creating a personalized Spanish story for you
              </Text>
              <Text color="#8b5cf6" fontSize="xs" textAlign="center" mt={2}>
                Using advanced AI for natural storytelling
              </Text>
            </VStack>
          </VStack>
        </Center>
      </Box>
    );
  }

  if (!storyData) {
    return (
      <Box minH="100vh" bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)">
        <Center h="100vh">
          <VStack spacing={6}>
            <VStack spacing={2}>
              <Text color="white" fontSize="xl" fontWeight="600">
                Story Not Loaded
              </Text>
              <Text color="#94a3b8" fontSize="sm" textAlign="center">
                Something went wrong loading your story
              </Text>
            </VStack>
            
            <VStack spacing={3}>
              <Button 
                onClick={generateStory} 
                size="lg"
                px={8}
                bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)"
                color="white"
                _hover={{
                  bg: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                }}
              >
                Generate New Story
              </Button>
              
              <Button 
                onClick={() => {
                  console.log('Testing API call...');
                  fetch('https://generatestory-xeujgchwja-uc.a.run.app', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userLanguage: 'en', level: 'beginner', targetLang: 'es' })
                  })
                  .then(r => r.json())
                  .then(d => console.log('API Response:', d))
                  .catch(e => console.error('API Error:', e));
                }}
                variant="outline"
                borderColor="rgba(255, 255, 255, 0.3)"
                color="white"
                _hover={{
                  bg: "rgba(255, 255, 255, 0.1)",
                }}
              >
                Test API Call
              </Button>
              <Button
                size="xs"
                mt={2}
                onClick={() => {
                  console.log('Testing sentence validation...');
                  if (storyData) {
                    const validated = validateAndFixStorySentences(storyData);
                    console.log('Validation result:', validated);
                    setStoryData(validated);
                  }
                }}
                variant="outline"
                borderColor="rgba(255, 255, 255, 0.3)"
                color="white"
                _hover={{
                  bg: "rgba(255, 255, 255, 0.1)",
                }}
              >
                Test Validation
              </Button>
            </VStack>
          </VStack>
        </Center>
      </Box>
    );
  }

  return (
    <Box minH="100vh" bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)">
      {/* Header */}
      <motion.div
        initial={prefersReducedMotion ? {} : { y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={prefersReducedMotion ? {} : { duration: 0.6, ease: "easeOut" }}
      >
        <HStack
          as="header"
          w="100%"
          px={4}
          py={3}
          bg="rgba(15, 15, 35, 0.8)"
          backdropFilter="blur(20px)"
          color="white"
          borderBottom="1px solid"
          borderColor="rgba(255, 255, 255, 0.1)"
          position="sticky"
          top={0}
          zIndex={100}
          boxShadow="0 4px 6px -1px rgba(0, 0, 0, 0.3)"
        >
          <IconButton
            aria-label="Back to practice"
            icon={<FaArrowLeft />}
            size="md"
            onClick={() => navigate('/')}
            bg="rgba(255, 255, 255, 0.05)"
            border="1px solid rgba(255, 255, 255, 0.1)"
            color="white"
            _hover={{
              bg: "rgba(20, 184, 166, 0.1)",
              borderColor: "rgba(20, 184, 166, 0.3)",
            }}
          />
          <Text fontSize="lg" fontWeight="700" color="#8b5cf6" letterSpacing="0.5px">
            Story Mode
          </Text>
          <Spacer />
          <Badge colorScheme="purple" variant="subtle" fontSize="sm">
            {xpEarned} XP
          </Badge>
        </HStack>
      </motion.div>

      {/* Progress Bar */}
      <Box px={4} py={3}>
        <VStack spacing={2}>
          <HStack w="100%" justify="space-between">
            <Text fontSize="sm" color="#94a3b8">
              Progress
            </Text>
            <Text fontSize="sm" color="#94a3b8">
              {showFullStory ? 'Story' : `${currentSentenceIndex + 1} / ${storyData?.sentences?.length || 0}`}
            </Text>
          </HStack>
          <Progress
            value={progressPercentage}
            w="100%"
            h="8px"
            borderRadius="full"
            bg="rgba(255, 255, 255, 0.1)"
            sx={{
              "& > div": {
                bg: "linear-gradient(90deg, #8b5cf6 0%, #7c3aed 100%)",
              },
            }}
          />
        </VStack>
      </Box>


      {/* Story Content */}
      <Box px={4} py={6}>
        <motion.div
          key={showFullStory ? 'full-story' : `sentence-${currentSentenceIndex}`}
          initial={prefersReducedMotion ? {} : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={prefersReducedMotion ? {} : { duration: 0.5 }}
        >
          <VStack spacing={6} align="stretch">
            {/* Story Content */}
            <Box
              bg="rgba(255, 255, 255, 0.05)"
              p={6}
              rounded="20px"
              border="1px solid rgba(255, 255, 255, 0.1)"
              backdropFilter="blur(20px)"
            >
              {showFullStory ? (
                <VStack spacing={4} align="stretch">
                  {/* Full Story with Word Highlighting */}
                  <Box>
                    <Text
                      fontSize="lg"
                      fontWeight="500"
                      color="#f8fafc"
                      mb={3}
                      lineHeight="1.8"
                    >
                      {tokenizedText ? (
                        tokenizedText.map((token, index) => {
                          if (token.isWord) {
                            const wordIndex = tokenizedText.slice(0, index).filter(t => t.isWord).length;
                            return (
                              <Text
                                key={index}
                                as="span"
                                bg={highlightedWordIndex === wordIndex ? "rgba(139, 92, 246, 0.3)" : "transparent"}
                                px={1}
                                borderRadius="4px"
                                transition="background-color 0.1s ease"
                              >
                                {token.text}
                              </Text>
                            );
                          } else {
                            return (
                              <Text key={index} as="span">
                                {token.text}
                              </Text>
                            );
                          }
                        })
                      ) : (
                        storyData.fullStory.es.split(' ').map((word, index) => (
                          <Text
                            key={index}
                            as="span"
                            bg={highlightedWordIndex === index ? "rgba(139, 92, 246, 0.3)" : "transparent"}
                            px={1}
                            borderRadius="4px"
                            transition="background-color 0.3s ease"
                          >
                            {word}{' '}
                          </Text>
                        ))
                      )}
                    </Text>
                    <Text
                      fontSize="md"
                      color="#94a3b8"
                      lineHeight="1.6"
                    >
                      {storyData.fullStory.en}
                    </Text>
                  </Box>

                  {/* Audio Controls */}
                  <HStack spacing={3} justify="center">
                    <Button
                      onClick={() => playNarrationWithHighlighting(storyData.fullStory.es)}
                      isLoading={isPlayingSpanish || isAutoPlaying}
                      loadingText="Playing..."
                      leftIcon={<FaVolumeUp />}
                      bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)"
                      color="white"
                      _hover={{
                        bg: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                      }}
                    >
                      {isAutoPlaying ? "Playing..." : "Replay Spanish"}
                    </Button>
                    <Button
                      onClick={() => playEnglishTTS(storyData.fullStory.en)}
                      isLoading={isPlayingEnglish}
                      loadingText="Playing..."
                      leftIcon={<FaVolumeUp />}
                      variant="outline"
                      borderColor="rgba(255, 255, 255, 0.3)"
                      color="white"
                      _hover={{
                        bg: "rgba(255, 255, 255, 0.1)",
                      }}
                    >
                      English
                    </Button>
                    {(isPlayingSpanish || isPlayingEnglish || isAutoPlaying) && (
                      <Button
                        onClick={stopAllAudio}
                        leftIcon={<FaStop />}
                        variant="outline"
                        borderColor="rgba(239, 68, 68, 0.5)"
                        color="#ef4444"
                        _hover={{
                          bg: "rgba(239, 68, 68, 0.1)",
                        }}
                      >
                        Stop
                      </Button>
                    )}
                  </HStack>


                  {/* Debug Info */}
                  <Box p={3} bg="rgba(0, 0, 0, 0.3)" rounded="md" fontSize="xs">
                    <Text color="#94a3b8" mb={2}>
                      <strong>Debug Info:</strong>
                    </Text>
                    <Text color="#94a3b8">
                      Story Data: {storyData ? '✅ Loaded' : '❌ Missing'} | 
                      Full Story: {storyData?.fullStory ? '✅' : '❌'} | 
                      Sentences: {storyData?.sentences?.length || 0} | 
                      Tokenized: {tokenizedText ? tokenizedText.length : 0} tokens | 
                      Current Word: {highlightedWordIndex} | 
                      Boundary Support: {boundarySupported === null ? 'Unknown' : boundarySupported ? 'Yes' : 'No'} | 
                      Speech Recognition: {'webkitSpeechRecognition' in window || 'SpeechRecognition' in window ? '✅ Available' : '❌ Not Available'}
                      <br />
                      API Usage Today: {usageStatsRef.current.storyGenerations} stories, {usageStatsRef.current.ttsCalls} TTS calls
                      <br />
                      Estimated Cost: ~${(usageStatsRef.current.storyGenerations * 0.0001 + usageStatsRef.current.ttsCalls * 0.003).toFixed(4)}
                    </Text>
                    <Button
                      size="xs"
                      mt={2}
                      onClick={() => {
                        console.log('🔍 Manual test - Current state:', {
                          storyData,
                          tokenizedText,
                          highlightedWordIndex,
                          boundarySupported,
                          isPlayingSpanish,
                          isAutoPlaying
                        });
                        if (storyData?.fullStory?.es) {
                          playNarrationWithHighlighting(storyData.fullStory.es);
                        }
                      }}
                    >
                      Test Highlighting
                    </Button>
                  </Box>

                  {/* Start Practice Button */}
                  <Center>
                    <Button
                      onClick={() => {
                        // Stop any ongoing audio before starting practice
                        stopAllAudio();
                        setShowFullStory(false);
                        setCurrentSentenceIndex(0);
                        setXpEarned(0);
                        setHighlightedWordIndex(-1);
                        // Reset recording state for practice
                        setIsRecording(false);
                        evaluationInProgress = false;
                        speechRecognitionCompleted = false;
                        // Reset auto-play flag so it can play again if user goes back to full story
                        hasAutoPlayedRef.current = false;
                        console.log('🔄 Reset recording state for sentence practice');
                      }}
                      size="lg"
                      px={8}
                      rounded="full"
                      bg="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                      color="white"
                      fontWeight="600"
                      _hover={{
                        bg: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                        transform: "translateY(-2px)",
                      }}
                      _active={{
                        transform: "translateY(0)",
                      }}
                      transition="all 0.2s ease"
                    >
                      Start Sentence Practice
                    </Button>
                  </Center>
                </VStack>
              ) : (
                <VStack spacing={4} align="stretch">
                  {/* Sentence Practice */}
                  <Box>
                    <Text
                      fontSize="lg"
                      fontWeight="500"
                      color="#f8fafc"
                      mb={3}
                    >
                      Practice this sentence:
                    </Text>
                    <Text
                      fontSize="xl"
                      fontWeight="600"
                      color="white"
                      lineHeight="1.6"
                      mb={2}
                      textAlign="center"
                    >
                      {currentSentence?.es}
                    </Text>
                    <Text
                      fontSize="md"
                      color="#94a3b8"
                      lineHeight="1.5"
                      textAlign="center"
                    >
                      {currentSentence?.en}
                    </Text>
                    <Text
                      fontSize="sm"
                      color="#64748b"
                      textAlign="center"
                      mt={2}
                    >
                      Sentence {currentSentenceIndex + 1} of {storyData.sentences.length}
                    </Text>
                  </Box>

                  {/* Recording Controls */}
                  <VStack spacing={4}>
                    <Center>
                      <Button
                        onClick={isRecording ? stopRecording : startRecording}
                        size="lg"
                        height="60px"
                        px={8}
                        rounded="full"
                        bg={isRecording 
                          ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                          : "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                        }
                        color="white"
                        fontWeight="600"
                        fontSize="lg"
                        leftIcon={<PiMicrophoneStageDuotone />}
                        _hover={{
                          bg: isRecording 
                            ? "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)"
                            : "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                          transform: "translateY(-2px)",
                        }}
                        _active={{
                          transform: "translateY(0)",
                        }}
                        transition="all 0.2s ease"
                      >
                        {isRecording ? "Stop Recording" : "Record Sentence"}
                      </Button>
                    </Center>
                    <HStack spacing={3}>
                      <Button
                        onClick={() => playSpanishTTS(currentSentence?.es)}
                        leftIcon={<FaVolumeUp />}
                        variant="outline"
                        borderColor="rgba(255, 255, 255, 0.3)"
                        color="white"
                        _hover={{
                          bg: "rgba(255, 255, 255, 0.1)",
                        }}
                        size="sm"
                      >
                        Listen
                      </Button>
                      <Button
                        onClick={() => {
                          if (currentSentenceIndex < storyData.sentences.length - 1) {
                            setCurrentSentenceIndex(prev => prev + 1);
                          } else {
                            // Story completed
                            toast({
                              title: "¡Felicidades!",
                              description: `Story completed! You earned ${xpEarned} XP total.`,
                              status: "success",
                              duration: 3000,
                            });
                            setShowFullStory(true);
                            setCurrentSentenceIndex(0);
                          }
                        }}
                        variant="outline"
                        borderColor="rgba(255, 255, 255, 0.3)"
                        color="white"
                        _hover={{
                          bg: "rgba(255, 255, 255, 0.1)",
                        }}
                        size="sm"
                      >
                        {currentSentenceIndex < storyData.sentences.length - 1 ? "Skip Sentence" : "Finish Story"}
                      </Button>
                    </HStack>
                  </VStack>
                </VStack>
              )}
            </Box>
          </VStack>
        </motion.div>
      </Box>
    </Box>
  );
}
