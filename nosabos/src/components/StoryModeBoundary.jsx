import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  Text,
  Button,
  VStack,
  HStack,
  Center,
  IconButton,
  Spacer,
  Badge,
  Progress,
  useToast,
  motion
} from '@chakra-ui/react';
import { FaArrowLeft, FaVolumeUp, FaBookOpen } from 'react-icons/fa';
import { PiMicrophoneStageDuotone } from 'react-icons/pi';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { database } from '../firebaseResources/firebaseResources';
import useUserStore from '../hooks/useUserStore';
import { translations } from '../utils/translation';

// Boundary-driven word highlighting with TTS sync
export default function StoryModeBoundary({ userLanguage = "en" }) {
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

  // Boundary-driven highlighting state
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [highlightedWordIndex, setHighlightedWordIndex] = useState(-1);
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

  const t = translations[userLanguage] || translations.en;

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

  // Auto-play narration with boundary-driven highlighting
  const playNarrationWithHighlighting = (text) => {
    // Cancel any ongoing speech first
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
    
    setIsAutoPlaying(true);
    setIsPlayingSpanish(true);
    
    // Setup boundary highlighting
    const { handleBoundary, fallbackTiming, tokenMap } = setupBoundaryHighlighting(text, () => {
      setIsAutoPlaying(false);
      setIsPlayingSpanish(false);
    });
    
    // Play TTS with boundary events
    if ('speechSynthesis' in window) {
      // Get available voices and prefer Spanish voices
      const voices = speechSynthesis.getVoices();
      const spanishVoices = voices.filter(voice => 
        voice.lang.startsWith('es') || voice.lang.includes('Spanish')
      );
      
      // Prefer female Spanish voices for better sound
      const preferredVoice = spanishVoices.find(voice => 
        voice.name.includes('female') || voice.name.includes('Female') || 
        voice.name.includes('Maria') || voice.name.includes('Monica')
      ) || spanishVoices[0] || voices.find(voice => voice.lang.startsWith('es'));
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES';
      utterance.rate = 0.7;
      utterance.pitch = 1.1;
      utterance.volume = 0.9;
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        console.log('Using Spanish voice:', preferredVoice.name);
      }
      
      // Store utterance reference for cleanup
      currentUtteranceRef.current = utterance;
      
      // Event handlers
      utterance.onstart = () => {
        setIsPlayingSpanish(true);
        console.log('TTS started, boundary support:', !!utterance.onboundary);
        setBoundarySupported(!!utterance.onboundary);
        
        if (!utterance.onboundary) {
          console.log('Boundary events not supported, using fallback timing');
          fallbackTiming();
        }
      };
      
      utterance.onboundary = (event) => {
        console.log('Boundary event:', event.name, 'at char:', event.charIndex);
        handleBoundary(event);
      };
      
      utterance.onend = () => {
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
        currentUtteranceRef.current = null;
        console.log('TTS ended');
      };
      
      utterance.onerror = (event) => {
        console.error('TTS error:', event.error);
        setIsPlayingSpanish(false);
        setIsAutoPlaying(false);
        currentUtteranceRef.current = null;
      };
      
      speechSynthesis.speak(utterance);
    }
  };

  // Cleanup TTS when component unmounts or page changes
  useEffect(() => {
    const cleanup = () => {
      // Stop any ongoing speech synthesis
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }
      
      // Clear any intervals/timeouts (for word highlighting)
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
      setIsRecording(false);
      setHighlightedWordIndex(-1);
    };

    // Add beforeunload listener to cleanup on page refresh/close
    window.addEventListener('beforeunload', cleanup);
    
    // Cleanup on component unmount
    return () => {
      cleanup();
      window.removeEventListener('beforeunload', cleanup);
    };
  }, []);

  // Render tokenized text with highlighting
  const renderTokenizedText = () => {
    if (!tokenizedText) {
      return storyData?.fullStory?.es || '';
    }
    
    return tokenizedText.map((token, index) => {
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
    });
  };

  return (
    <Box minH="100vh" bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)">
      {/* Header */}
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
          Story Mode (Boundary)
        </Text>
        <Spacer />
        <Badge colorScheme="purple" variant="subtle" fontSize="sm">
          {xpEarned} XP
        </Badge>
      </HStack>

      {/* Story Content */}
      <Box px={4} py={6}>
        <VStack spacing={6} align="stretch">
          {/* Story Content */}
          <Box
            bg="rgba(255, 255, 255, 0.05)"
            p={6}
            rounded="20px"
            border="1px solid rgba(255, 255, 255, 0.1)"
            backdropFilter="blur(20px)"
          >
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
                  {renderTokenizedText()}
                </Text>
                <Text
                  fontSize="md"
                  color="#94a3b8"
                  lineHeight="1.6"
                >
                  {storyData?.fullStory?.en}
                </Text>
              </Box>

              {/* Audio Controls */}
              <HStack spacing={3} justify="center">
                <Button
                  onClick={() => playNarrationWithHighlighting(storyData?.fullStory?.es)}
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
                  onClick={() => {
                    if ('speechSynthesis' in window) {
                      speechSynthesis.cancel();
                      const utterance = new SpeechSynthesisUtterance(storyData?.fullStory?.en);
                      utterance.lang = 'en-US';
                      utterance.rate = 0.7;
                      speechSynthesis.speak(utterance);
                    }
                  }}
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
              </HStack>

              {/* Debug Info */}
              <Box p={2} bg="rgba(0, 0, 0, 0.2)" rounded="md">
                <Text fontSize="xs" color="#94a3b8">
                  Boundary Support: {boundarySupported === null ? 'Unknown' : boundarySupported ? 'Yes' : 'No'} | 
                  Current Word: {highlightedWordIndex} | 
                  Total Words: {tokenizedText?.filter(t => t.isWord).length || 0}
                </Text>
              </Box>
            </VStack>
          </Box>
        </VStack>
      </Box>
    </Box>
  );
}
