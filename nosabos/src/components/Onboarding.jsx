// src/components/Onboarding.jsx
import React, { useEffect, useState } from "react";
import {
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  HStack,
  Input,
  Select,
  Switch,
  Text,
  VStack,
  Wrap,
  WrapItem,
  Spacer,
  Textarea, // <-- NEW
} from "@chakra-ui/react";
import { translations } from "../utils/translation";

export default function Onboarding({
  npub = "",
  onComplete,
  userLanguage = "en", // 'en' | 'es' initial UI language from App
  onAppLanguageChange = () => {}, // parent callback that persists to Firestore + store
}) {
  // Local UI language for this panel (instant switch)
  const [appLang, setAppLang] = useState(userLanguage === "es" ? "es" : "en");
  const ui = translations[appLang];

  // Form state mirrors progress shape for Firestore
  const [level, setLevel] = useState("beginner"); // 'beginner' | 'intermediate' | 'advanced'
  const [supportLang, setSupportLang] = useState("en"); // 'en' | 'bilingual' | 'es'
  const [voice, setVoice] = useState("alloy"); // GPT Realtime default voices
  const [targetLang, setTargetLang] = useState("es"); // 'nah' | 'es' | 'en'
  const [practicePronunciation, setPracticePronunciation] = useState(false); // <-- NEW
  const [voicePersona, setVoicePersona] = useState(ui.DEFAULT_PERSONA || "");
  const [showTranslations, setShowTranslations] = useState(true);
  const [helpRequest, setHelpRequest] = useState(""); // <-- NEW
  const [isSaving, setIsSaving] = useState(false);

  const secondaryPref = supportLang === "es" ? "es" : "en";

  // Challenge text from translations (keeps DB/UI aligned)
  const CHALLENGE = {
    en: translations.en.onboarding_challenge_default,
    es: translations.es.onboarding_challenge_default,
  };

  useEffect(() => {
    setVoicePersona(ui.DEFAULT_PERSONA || "");
  }, [appLang]);

  // Inline language switch → call parent persister + update local UI
  const persistAppLanguage = (lang) => {
    const norm = lang === "es" ? "es" : "en";
    setAppLang(norm); // instant panel switch
    try {
      localStorage.setItem("appLanguage", norm); // helpful cache
    } catch {}
    try {
      onAppLanguageChange(norm); // ✅ parent writes to Firestore + store
    } catch {}
  };

  async function handleStart() {
    if (typeof onComplete !== "function") {
      console.error("Onboarding.onComplete is not provided.");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        level,
        supportLang,
        voice, // GPT Realtime voice id (alloy, ash, ballad, coral, echo, sage, shimmer, verse)
        voicePersona,
        targetLang,
        practicePronunciation, // <-- NEW
        showTranslations,
        helpRequest, // <-- NEW
        challenge: { ...CHALLENGE },
      };
      await Promise.resolve(onComplete(payload)); // App.jsx persists & flips onboarding
    } finally {
      setIsSaving(false);
    }
  }

  // UI text helpers (with fallbacks so you’re not blocked by i18n)
  const personaPlaceholder = (
    ui.onboarding_persona_input_placeholder || 'e.g., "{example}"'
  ).replace(
    "{example}",
    ui.onboarding_persona_default_example || "patient, encouraging, playful"
  );

  const toggleLabel = (
    ui.onboarding_translations_toggle || "Show translations in {language}"
  ).replace(
    "{language}",
    ui[`language_${secondaryPref}`] ||
      (secondaryPref === "es" ? "Spanish" : "English")
  );

  const HELP_TITLE =
    ui.onboarding_help_title || "What would you like help with?";
  const HELP_PLACEHOLDER =
    ui.onboarding_help_placeholder ||
    "e.g., conversational practice for job interviews; past tenses review; travel Spanish…";
  const HELP_HINT =
    ui.onboarding_help_hint ||
    "Share topics, goals, or situations. This guides your AI coach.";

  // NEW i18n fallbacks for pronunciation switch
  const PRON_LABEL = ui.onboarding_pron_label || "Practice pronunciation";
  const PRON_HINT =
    ui.onboarding_pron_hint ||
    "When enabled, your coach will prompt you to repeat lines and focus on sounds/intonation.";

  return (
    <Box minH="100vh" bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)" color="white">
      <Drawer isOpen={true} placement="bottom" onClose={() => {}}>
        <DrawerOverlay 
          bg="rgba(0, 0, 0, 0.6)" 
          backdropFilter="blur(8px)"
          sx={{
            transition: 'none !important',
            animation: 'none !important',
          }}
        />
        <DrawerContent 
          bg="rgba(15, 15, 35, 0.95)" 
          color="white" 
          borderTopRadius="24px"
          borderBottomRadius="24px"
          backdropFilter="blur(20px)"
          border="1px solid rgba(255, 255, 255, 0.1)"
          boxShadow="0 -25px 50px -12px rgba(0, 0, 0, 0.5)"
          sx={{
            transition: 'none !important',
            animation: 'none !important',
            transform: 'none !important',
          }}
        >
          <DrawerHeader pb={0}>
            <HStack align="center" w="100%">
              <VStack align="stretch" spacing={2}>
                <Text fontWeight="700" fontSize="xl" color="#14b8a6">
                  {ui.onboarding_title}
                </Text>
                <Text opacity={0.8} fontSize="sm" color="#cbd5e1">
                  {ui.onboarding_subtitle}
                </Text>
              </VStack>

              <Spacer />

              {/* Inline language switch for the onboarding panel */}
              <HStack spacing={3} align="center">
                <Text
                  fontSize="sm"
                  fontWeight="500"
                  color={appLang === "en" ? "#14b8a6" : "#94a3b8"}
                  transition="color 0.2s ease"
                >
                  EN
                </Text>
                <Switch
                  colorScheme="teal"
                  isChecked={appLang === "es"}
                  onChange={() =>
                    persistAppLanguage(appLang === "en" ? "es" : "en")
                  }
                  sx={{
                    "& .chakra-switch__track": {
                      bg: "rgba(255, 255, 255, 0.1)",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                    },
                    "& .chakra-switch__thumb": {
                      bg: "white",
                      boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
                    },
                    "&[data-checked] .chakra-switch__track": {
                      bg: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)",
                      border: "1px solid rgba(20, 184, 166, 0.3)",
                    },
                  }}
                />
                <Text
                  fontSize="sm"
                  fontWeight="500"
                  color={appLang === "es" ? "#14b8a6" : "#94a3b8"}
                  transition="color 0.2s ease"
                >
                  ES
                </Text>
              </HStack>
            </HStack>
          </DrawerHeader>

          <DrawerBody pb={6}>
            <VStack align="stretch" spacing={4}>
              {/* Difficulty & Language */}
              <Box bg="gray.800" p={3} rounded="md">
                <Text fontSize="sm" mb={2} opacity={0.85}>
                  {ui.onboarding_section_difficulty_support}
                </Text>
                <Wrap spacing={2}>
                  <WrapItem>
                    <Select
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      bg="gray.800"
                      size="md"
                      w="auto"
                    >
                      <option value="beginner">
                        {ui.onboarding_level_beginner}
                      </option>
                      <option value="intermediate">
                        {ui.onboarding_level_intermediate}
                      </option>
                      <option value="advanced">
                        {ui.onboarding_level_advanced}
                      </option>
                    </Select>
                  </WrapItem>

                  <WrapItem>
                    <Select
                      value={supportLang}
                      onChange={(e) => setSupportLang(e.target.value)}
                      bg="gray.800"
                      size="md"
                      w="auto"
                    >
                      <option value="en">{ui.onboarding_support_en}</option>
                      <option value="bilingual">
                        {ui.onboarding_support_bilingual}
                      </option>
                      <option value="es">{ui.onboarding_support_es}</option>
                    </Select>
                  </WrapItem>

                  <WrapItem>
                    <Select
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      bg="gray.800"
                      size="md"
                      w="auto"
                      title={ui.onboarding_practice_label_title}
                    >
                      <option value="nah">{ui.onboarding_practice_nah}</option>
                      <option value="es">{ui.onboarding_practice_es}</option>
                      <option value="en">{ui.onboarding_practice_en}</option>
                    </Select>
                  </WrapItem>
                </Wrap>
              </Box>

              {/* NEW: Practice pronunciation (between Difficulty & Voice) */}
              <HStack bg="gray.800" p={3} rounded="md" justify="space-between">
                <Box>
                  <Text fontSize="sm" mr={2}>
                    {PRON_LABEL}
                  </Text>
                  <Text fontSize="xs" opacity={0.7}>
                    {PRON_HINT}
                  </Text>
                </Box>
                <Switch
                  isChecked={practicePronunciation}
                  onChange={(e) => setPracticePronunciation(e.target.checked)}
                  colorScheme="teal"
                />
              </HStack>

              {/* Voice & Persona */}
              <Box bg="gray.800" p={3} rounded="md">
                <Text fontSize="sm" mb={2} opacity={0.85}>
                  {ui.onboarding_section_voice_persona}
                </Text>

                <Wrap spacing={2} mb={2}>
                  <WrapItem>
                    <Select
                      value={voice}
                      onChange={(e) => setVoice(e.target.value)}
                      bg="gray.800"
                      size="md"
                      w="auto"
                    >
                      <option value="alloy">{ui.onboarding_voice_alloy}</option>
                      <option value="ash">{ui.onboarding_voice_ash}</option>
                      <option value="ballad">
                        {ui.onboarding_voice_ballad}
                      </option>
                      <option value="coral">{ui.onboarding_voice_coral}</option>
                      <option value="echo">{ui.onboarding_voice_echo}</option>
                      <option value="sage">{ui.onboarding_voice_sage}</option>
                      <option value="shimmer">
                        {ui.onboarding_voice_shimmer}
                      </option>
                      <option value="verse">{ui.onboarding_voice_verse}</option>
                    </Select>
                  </WrapItem>
                </Wrap>

                <Input
                  value={voicePersona}
                  onChange={(e) => setVoicePersona(e.target.value)}
                  bg="gray.700"
                  placeholder={personaPlaceholder}
                />
                <Text fontSize="xs" opacity={0.7} mt={1}>
                  {ui.onboarding_persona_help_text}
                </Text>

                {/* NEW: Help request */}
                <Text fontSize="sm" mt={4} opacity={0.85}>
                  {HELP_TITLE}
                </Text>
                <Textarea
                  value={helpRequest}
                  onChange={(e) => setHelpRequest(e.target.value)}
                  bg="gray.700"
                  placeholder={HELP_PLACEHOLDER}
                  resize="vertical"
                  minH="80px"
                  mt={1}
                />
                <Text fontSize="xs" opacity={0.7} mt={1}>
                  {HELP_HINT}
                </Text>
              </Box>

              {/* Translations toggle */}
              <HStack bg="gray.800" p={3} rounded="md" justify="space-between">
                <Text fontSize="sm" mr={2}>
                  {toggleLabel}
                </Text>
                <Switch
                  isChecked={showTranslations}
                  onChange={(e) => setShowTranslations(e.target.checked)}
                />
              </HStack>

              {/* First goal preview */}
              <Box bg="gray.800" p={3} rounded="md">
                <Text fontSize="sm" opacity={0.8}>
                  {ui.onboarding_section_first_goal}
                </Text>
                <Text mt={1} whiteSpace="pre-wrap">
                  🎯 {ui.onboarding_challenge_default}
                </Text>
                <Text mt={1} opacity={0.9}>
                  {ui.onboarding_challenge_label_es}{" "}
                  {translations.es.onboarding_challenge_default}
                </Text>
              </Box>

              {/* Submit */}
              <Button
                size="lg"
                colorScheme="teal"
                onClick={handleStart}
                isLoading={isSaving}
                loadingText={ui.common_saving}
              >
                {ui.onboarding_cta_start}
              </Button>
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </Box>
  );
}
