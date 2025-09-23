// components/RealtimeAgent.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Center,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  HStack,
  Progress,
  Select,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  SliderTrack,
  Stat,
  StatLabel,
  StatNumber,
  Switch,
  Text,
  VStack,
  Wrap,
  useDisclosure,
  useToast,
  Input,
  Flex,
  IconButton,
  Spinner,
  Textarea,
} from "@chakra-ui/react";
import { SettingsIcon, DeleteIcon } from "@chakra-ui/icons";
import { PiMicrophoneStageDuotone } from "react-icons/pi";
import { FaStop } from "react-icons/fa";
import { CiRepeat } from "react-icons/ci";
import { FaBookOpen } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  getDocs,
  writeBatch,
  increment,
} from "firebase/firestore";
import { database } from "../firebaseResources/firebaseResources";
import useUserStore from "../hooks/useUserStore";
import RobotBuddyPro from "./RobotBuddyPro";
import { translations } from "../utils/translation";
import { PasscodePage } from "./PasscodePage";
import { WaveBar } from "./WaveBar";

// console.log(
//   "VITE_FIREBASE_PUBLIC_API_KEYXXX",
//   import.meta.env.VITE_FIREBASE_PUBLIC_API_KEY
// );

console.log(
  "import.meta?.env?.VITE_RESPONSES_URL",
  import.meta.env.VITE_RESPONSES_URL
);

const REALTIME_MODEL =
  (import.meta.env.VITE_REALTIME_MODEL || "gpt-4o-mini-realtime") + "";

const REALTIME_URL = `${
  import.meta.env.VITE_RESPONSES_URL
}?model=${encodeURIComponent(REALTIME_MODEL)}`;

const RESPONSES_URL = `${import.meta.env.VITE_REALTIME_URL}`;
const TRANSLATE_MODEL =
  import.meta.env.VITE_OPENAI_TRANSLATE_MODEL || "gpt-4o-mini";

/* ---------------------------
   Utils & helpers
--------------------------- */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const MOBILE_TEXT_SX = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  overflowWrap: "break-word",
  hyphens: "auto",
};
const isoNow = () => {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
};

function strongNpub(user) {
  return (
    user?.id ||
    user?.local_npub ||
    localStorage.getItem("local_npub") ||
    ""
  ).trim();
}

async function ensureUserDoc(npub, defaults = {}) {
  if (!npub) return false;
  try {
    const ref = doc(database, "users", npub);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(
        ref,
        {
          local_npub: npub,
          createdAt: isoNow(),
          onboarding: { completed: true },
          xp: 0,
          streak: 0,
          helpRequest: "",
          progress: {
            level: "beginner",
            supportLang: "en",
            voice: "alloy",
            voicePersona: translations.en.onboarding_persona_default_example,
            targetLang: "es",
            showTranslations: true,
            helpRequest: "",
            // ✅ default for new feature:
            practicePronunciation: false,
          },
          ...defaults,
        },
        { merge: true }
      );
    }
    return true;
  } catch {
    return false;
  }
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s !== -1 && e !== -1 && e > s) {
    try {
      return JSON.parse(text.slice(s, e + 1));
    } catch {}
  }
  return null;
}

/* ---------------------------
   Phrase-highlighting helpers
--------------------------- */
const COLORS = [
  "#91E0FF",
  "#A0EBAF",
  "#FFD48A",
  "#C6B7FF",
  "#FF9FB1",
  "#B0F0FF",
];
const colorFor = (i) => COLORS[i % COLORS.length];

function wrapFirst(text, phrase, tokenId) {
  if (!text || !phrase) return [text];
  const idx = text.toLowerCase().indexOf(String(phrase).toLowerCase());
  if (idx < 0) return [text];
  const before = text.slice(0, idx);
  const mid = text.slice(idx, idx + phrase.length);
  const after = text.slice(idx + phrase.length);
  return [
    before,
    <span
      key={`${tokenId}-${idx}`}
      data-token={tokenId}
      style={{ display: "inline", boxShadow: "inset 0 -2px transparent" }}
    >
      {mid}
    </span>,
    ...wrapFirst(after, phrase, tokenId + "_cont"),
  ];
}
function buildAlignedNodes(text, pairs, side /* 'lhs' | 'rhs' */) {
  if (!pairs?.length || !text) return [text];
  const sorted = [...pairs].sort(
    (a, b) => (b?.[side]?.length || 0) - (a?.[side]?.length || 0)
  );
  let nodes = [text];
  sorted.forEach((pair, i) => {
    const phrase = pair?.[side];
    if (!phrase) return;
    const tokenId = `tok_${i}`;
    const next = [];
    nodes.forEach((node) => {
      if (typeof node === "string")
        next.push(...wrapFirst(node, phrase, tokenId));
      else next.push(node);
    });
    nodes = next;
  });
  return nodes;
}

function AlignedBubble({
  primaryLabel,
  secondaryLabel,
  primaryText,
  secondaryText,
  pairs,
  showSecondary,
  isTranslating,
}) {
  const [activeId, setActiveId] = useState(null);
  function decorate(nodes) {
    return React.Children.map(nodes, (node) => {
      if (typeof node === "string" || !node?.props?.["data-token"]) return node;
      const rootId = node.props["data-token"].split("_")[0];
      const i = parseInt(rootId.replace("tok_", "")) || 0;
      const isActive = activeId === rootId;
      const style = {
        boxShadow: isActive
          ? `inset 0 -2px ${colorFor(i)}`
          : "inset 0 -2px transparent",
      };
      return React.cloneElement(node, {
        onMouseEnter: () => setActiveId(rootId),
        onMouseLeave: () => setActiveId(null),
        onClick: () => setActiveId(isActive ? null : rootId),
        style: { ...(node.props.style || {}), ...style },
      });
    });
  }
  const primaryNodes = decorate(buildAlignedNodes(primaryText, pairs, "lhs"));
  const secondaryNodes = decorate(
    buildAlignedNodes(secondaryText, pairs, "rhs")
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <Box
        bg="rgba(255, 255, 255, 0.05)"
        backdropFilter="blur(20px)"
        p={4}
        rounded="20px"
        border="1px solid rgba(255, 255, 255, 0.1)"
        maxW="100%"
        borderBottomLeftRadius="6px"
        boxShadow="0 8px 32px rgba(0, 0, 0, 0.3)"
        _hover={{
          bg: "rgba(255, 255, 255, 0.08)",
          borderColor: "rgba(20, 184, 166, 0.2)",
        }}
        transition="all 0.3s ease"
      >
        <HStack justify="space-between" mb={2}>
          <Badge 
            variant="subtle" 
            bg="rgba(20, 184, 166, 0.1)"
            color="#14b8a6"
            border="1px solid rgba(20, 184, 166, 0.2)"
            borderRadius="8px"
            px={2}
            py={1}
            fontSize="xs"
            fontWeight="500"
          >
            {primaryLabel}
          </Badge>
          <HStack>
            {showSecondary && !!secondaryText && (
              <Badge 
                variant="outline" 
                borderColor="rgba(255, 255, 255, 0.2)"
                color="#cbd5e1"
                borderRadius="8px"
                px={2}
                py={1}
                fontSize="xs"
                fontWeight="500"
              >
                {secondaryLabel}
              </Badge>
            )}
            {showSecondary && isTranslating && (
              <Spinner size="xs" thickness="2px" speed="0.5s" color="#14b8a6" />
            )}
          </HStack>
        </HStack>

        <Box as="p" fontSize="md" lineHeight="1.6" sx={MOBILE_TEXT_SX} color="#f8fafc" fontWeight="500">
          {primaryNodes}
        </Box>

        {showSecondary && !!secondaryText && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Box
              as="p"
              fontSize="sm"
              mt={2}
              lineHeight="1.55"
              sx={MOBILE_TEXT_SX}
              color="#cbd5e1"
              fontWeight="400"
            >
              {secondaryNodes}
            </Box>
          </motion.div>
        )}

        {!!pairs?.length && showSecondary && (
          <Wrap spacing={2} mt={3} shouldWrapChildren>
            {pairs.slice(0, 6).map((p, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 * i }}
              >
                <Badge
                  variant="outline"
                  style={{
                    borderColor: colorFor(i),
                    backgroundColor: `${colorFor(i)}20`,
                    borderWidth: 1,
                    color: colorFor(i),
                    borderRadius: "8px",
                    fontSize: "10px",
                    fontWeight: "500",
                    padding: "4px 8px",
                  }}
                >
                  {p.lhs} → {p.rhs}
                </Badge>
              </motion.div>
            ))}
          </Wrap>
        )}
      </Box>
    </motion.div>
  );
}

/* ---------------------------
   Chat bubble wrappers
--------------------------- */
function RowLeft({ children }) {
  return (
    <HStack w="100%" justify="flex-start" align="flex-start">
      <Box maxW={["95%", "90%"]}>{children}</Box>
    </HStack>
  );
}
function RowRight({ children }) {
  return (
    <HStack w="100%" justify="flex-end" align="flex-start">
      <Box maxW={["95%", "90%"]}>{children}</Box>
    </HStack>
  );
}
function UserBubble({ label, text }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      <Box
        bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)"
        color="white"
        p={4}
        rounded="20px"
        borderBottomRightRadius="6px"
        boxShadow="0 8px 32px rgba(20, 184, 166, 0.3)"
        border="1px solid rgba(255, 255, 255, 0.1)"
        backdropFilter="blur(20px)"
        _hover={{
          transform: "translateY(-2px)",
          boxShadow: "0 12px 40px rgba(20, 184, 166, 0.4)",
        }}
        transition="all 0.3s ease"
      >
        <HStack justify="space-between" mb={2}>
          <Badge 
            variant="solid" 
            bg="rgba(255, 255, 255, 0.2)"
            color="white"
            borderRadius="8px"
            px={2}
            py={1}
            fontSize="xs"
            fontWeight="500"
            border="1px solid rgba(255, 255, 255, 0.3)"
          >
            {label}
          </Badge>
        </HStack>
        <Box as="p" fontSize="md" lineHeight="1.6" sx={MOBILE_TEXT_SX} fontWeight="500">
          {text}
        </Box>
      </Box>
    </motion.div>
  );
}

/* ---------------------------
   IndexedDB audio cache (per message)
--------------------------- */
const IDB_DB = "RBE-AudioCache";
const IDB_STORE = "clips";

function openIDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window))
      return reject(new Error("IndexedDB not supported"));
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IDB open failed"));
  });
}
async function idbPutClip(id, blob, meta = {}) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("IDB put failed"));
    tx.objectStore(IDB_STORE).put({
      id,
      blob,
      createdAt: Date.now(),
      bytes: blob?.size || 0,
      ...meta,
    });
  });
}
async function idbGetClip(id) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    tx.onerror = () => reject(tx.error || new Error("IDB get failed"));
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("IDB get failed"));
  });
}

/* ---------------------------
   Component
--------------------------- */
export default function RealTimeTest({
  auth,
  activeNpub = "",
  activeNsec = "",
  onSwitchedAccount,
  userLanguage = "en",
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const aliveRef = useRef(false);

  // User id
  const user = useUserStore((s) => s.user);
  const currentNpub = activeNpub?.trim?.() || strongNpub(user);

  // Refs for realtime
  const audioRef = useRef(null); // remote stream sink (live AI voice)
  const playbackRef = useRef(null); // local playback for cached clips
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const dcRef = useRef(null);

  // WebAudio capture graph
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const floatBufRef = useRef(null);
  const captureOutRef = useRef(null);
  const audioGraphReadyRef = useRef(false);

  // Cached-clip index
  const audioCacheIndexRef = useRef(new Set());

  // Replay capture maps
  const recMapRef = useRef(new Map());
  const recChunksRef = useRef(new Map());
  const recTailRef = useRef(new Map());
  const replayRidSetRef = useRef(new Set());

  // Guardrails
  const guardrailItemIdsRef = useRef([]);
  const pendingGuardrailTextRef = useRef("");

  // Idle gating
  const isIdleRef = useRef(true);
  const idleWaitersRef = useRef([]);

  // Connection/UI state
  const [status, setStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [uiState, setUiState] = useState("idle");
  const [volume] = useState(0);
  const [mood, setMood] = useState("neutral");
  const [pauseMs, setPauseMs] = useState(800);

  // Learning prefs
  const [level, setLevel] = useState("beginner");
  const [supportLang, setSupportLang] = useState("en");
  const [voice, setVoice] = useState("alloy");
  const [voicePersona, setVoicePersona] = useState(
    translations.en.onboarding_persona_default_example
  );
  const [targetLang, setTargetLang] = useState("es"); // 'es' | 'en' | 'zh'
  const [showTranslations, setShowTranslations] = useState(true);

  // ✅ New: practice pronunciation toggle (persisted)
  const [practicePronunciation, setPracticePronunciation] = useState(
    !!user?.progress?.practicePronunciation
  );
  const practicePronunciationRef = useRef(practicePronunciation);
  useEffect(() => {
    practicePronunciationRef.current = practicePronunciation;
  }, [practicePronunciation]);

  // ✅ Existing: helpRequest (kept)
  const initialHelpRequest = (
    user?.progress?.helpRequest ??
    user?.helpRequest ??
    ""
  ).trim();
  const [helpRequest, setHelpRequest] = useState(initialHelpRequest);
  const helpRequestRef = useRef(helpRequest);
  useEffect(() => {
    helpRequestRef.current = helpRequest;
  }, [helpRequest]);

  // 🎯 Goal engine state
  const [currentGoal, setCurrentGoal] = useState(null);
  const goalRef = useRef(null);
  const [goalFeedback, setGoalFeedback] = useState(""); // short, localized nudge
  const goalBusyRef = useRef(false); // prevent double-advance

  const [showPasscodeModal, setShowPasscodeModal] = useState(false);

  // Live refs
  const voiceRef = useRef(voice);
  const voicePersonaRef = useRef(voicePersona);
  const levelRef = useRef(level);
  const supportLangRef = useRef(supportLang);
  const targetLangRef = useRef(targetLang);
  const pauseMsRef = useRef(pauseMs);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  useEffect(() => {
    voicePersonaRef.current = voicePersona;
  }, [voicePersona]);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  useEffect(() => {
    supportLangRef.current = supportLang;
  }, [supportLang]);
  useEffect(() => {
    targetLangRef.current = targetLang;
  }, [targetLang]);
  useEffect(() => {
    pauseMsRef.current = pauseMs;
  }, [pauseMs]);

  // Tiny UI state to avoid double-taps
  const [replayingMid, setReplayingMid] = useState(null);

  // XP/STREAK
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);

  // Persisted history (newest-first)
  const [history, setHistory] = useState([]);

  // Hydration gating for profile persistence
  const [hydrated, setHydrated] = useState(false);

  // UI strings (app UI) - prioritize passed userLanguage, then user store, then localStorage
  const uiLang =
    userLanguage === "es" ||
    (user?.appLanguage || localStorage.getItem("appLanguage")) === "es"
      ? "es"
      : "en";
  const ui = translations[uiLang];
  const tRepeat = ui?.ra_btn_repeat || (uiLang === "es" ? "Repetir" : "Repeat");

  // ✅ Goal-UI language routing (depends on practice target/support)
  const goalUiLang = (() => {
    const t = targetLangRef.current || targetLang;
    if (t === "es") return "en"; // practicing Spanish → goal UI in English
    if (t === "en") return "es"; // practicing English → goal UI in Spanish
    if (t === "zh") return "en"; // practicing Chinese → goal UI in English
    // Default fallback
    return "en";
  })();
  const gtr = translations[goalUiLang] || translations.en;

  const tGoalLabel =
    translations[uiLang]?.ra_goal_label || (uiLang === "es" ? "Meta" : "Goal");
  const tGoalCompletedToast =
    gtr?.ra_goal_completed ||
    (goalUiLang === "es" ? "¡Meta lograda!" : "Goal completed!");
  const tGoalSkip =
    gtr?.ra_goal_skip || (goalUiLang === "es" ? "Saltar" : "Skip");
  const tGoalCriteria =
    gtr?.ra_goal_criteria || (goalUiLang === "es" ? "Éxito:" : "Success:");
  const tAttempts = goalUiLang === "es" ? "Intentos" : "Attempts";

  // Other app UI strings
  const languageNameFor = (code) =>
    translations[uiLang][`language_${code}`];

  const levelLabel = translations[uiLang][`onboarding_level_${level}`] || level;
  const levelColor =
    level === "beginner"
      ? "green"
      : level === "intermediate"
      ? "orange"
      : "purple";
  const progressPct = Math.min(100, xp % 100);
  const appTitle = ui.ra_title.replace(
    "{language}",
    languageNameFor(targetLang)
  );

  // Secondary language
  const secondaryPref =
    targetLang === "en" ? "es" : supportLang === "es" ? "es" : "en";

  const settings = useDisclosure();

  // Ephemeral chat (user + assistant)
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Maps and debouncers
  const respToMsg = useRef(new Map()); // rid -> mid
  const translateTimers = useRef(new Map());
  const sessionUpdateTimer = useRef(null);
  const profileSaveTimer = useRef(null);
  const DEBOUNCE_MS = 350;
  const lastUserSaveRef = useRef({ text: "", ts: 0 });
  const lastTranscriptRef = useRef({ text: "", ts: 0 });

  // Throttled streaming buffer
  const streamBuffersRef = useRef(new Map()); // mid -> string
  const streamFlushTimerRef = useRef(null);
  function scheduleStreamFlush() {
    if (streamFlushTimerRef.current) return;
    streamFlushTimerRef.current = setTimeout(() => {
      const buffers = streamBuffersRef.current;
      buffers.forEach((buf, mid) => {
        if (!buf) return;
        updateMessage(mid, (m) => ({
          ...m,
          textStream: (m.textStream || "") + buf,
        }));
      });
      streamBuffersRef.current = new Map();
      streamFlushTimerRef.current = null;
    }, 50);
  }

  useEffect(() => {
    // console.log("xpLevelNumber", xpLevelNumber);
    if (
      xpLevelNumber > 4 &&
      localStorage.getItem("passcode") !== import.meta.env.VITE_PATREON_PASSCODE
    ) {
      setShowPasscodeModal(true);
    }
  }, [xp]);

  useEffect(() => () => stop(), []);

  // Keep local_npub cached
  useEffect(() => {
    if (currentNpub) localStorage.setItem("local_npub", currentNpub);
  }, [currentNpub]);

  /* ---------------------------
     Load profile + subscribe history + seed goal
  --------------------------- */
  useEffect(() => {
    if (!currentNpub) return;
    setHydrated(false); // reset hydration when switching accounts
    (async () => {
      try {
        const ok = await ensureUserDoc(currentNpub);
        if (!ok) return;
        const ref = doc(database, "users", currentNpub);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          if (Number.isFinite(data?.xp)) setXp(data.xp);
          if (Number.isFinite(data?.streak)) setStreak(data.streak);
          const p = data?.progress || {};
          if (p.level) setLevel(p.level);
          if (["en", "es", "zh"].includes(p.supportLang))
            setSupportLang(p.supportLang);
          if (p.voice) setVoice(p.voice);
          if (typeof p.voicePersona === "string")
            setVoicePersona(p.voicePersona);
          if (["es", "en", "zh"].includes(p.targetLang))
            setTargetLang(p.targetLang);
          if (typeof p.showTranslations === "boolean")
            setShowTranslations(p.showTranslations);

          // ✅ new: seed practicePronunciation
          if (typeof p.practicePronunciation === "boolean")
            setPracticePronunciation(p.practicePronunciation);

          // helpRequest
          const hr = (p.helpRequest ?? data.helpRequest ?? "").trim();
          if (hr && hr !== helpRequestRef.current) {
            setHelpRequest(hr);
          }

          // 🎯 goal: load or seed
          const goal = await ensureCurrentGoalSeed(currentNpub, data);
          setCurrentGoal(goal);
          goalRef.current = goal;
          scheduleSessionUpdate();
        }
      } catch (e) {
        console.warn("Load profile failed:", e?.message || e);
      } finally {
        // ✅ Mark hydrated after load attempt to prevent default overwrite
        setHydrated(true);
      }
    })();

    const colRef = collection(database, "users", currentNpub, "turns");
    const q = query(colRef, orderBy("createdAtClient", "desc"), limit(500));
    const unsub = onSnapshot(q, (snap) => {
      const turns = snap.docs.map((d) => {
        const v = d.data() || {};
        return {
          id: d.id,
          role: v.role || "assistant",
          lang: v.lang || "es",
          textFinal: v.text || "",
          textStream: "",
          trans_es: v.trans_es || "",
          trans_en: v.trans_en || "",
          pairs: Array.isArray(v.pairs) ? v.pairs : [],
          done: true,
          persisted: true,
          ts: v.createdAtClient || 0,
          hasAudio: false,
        };
      });
      setHistory(turns);
    });
    return () => unsub();
  }, [activeNpub]);

  // ✅ keep helpRequest in sync if store changes elsewhere
  useEffect(() => {
    const fromStore = (
      user?.progress?.helpRequest ??
      user?.helpRequest ??
      ""
    ).trim();
    if (fromStore && fromStore !== helpRequestRef.current) {
      setHelpRequest(fromStore);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.progress?.helpRequest, user?.helpRequest]);

  /* ---------------------------
     Instant-apply settings
  --------------------------- */
  useEffect(() => {
    scheduleSessionUpdate();
    if (!hydrated) return; // ✅ don't auto-save defaults before hydration
    scheduleProfileSave();
  }, [
    voicePersona,
    supportLang,
    showTranslations,
    level,
    pauseMs,
    helpRequest,
    practicePronunciation, // ✅ include
    currentGoal?.title_en, // refresh instructions when goal changes
    hydrated,
  ]);

  useEffect(() => {
    if (!hydrated) return; // ✅ guard until profile loaded
    scheduleProfileSave();
    if (dcRef.current?.readyState === "open") {
      applyVoiceNow({ speakProbe: true });
    }
  }, [voice, hydrated]);

  useEffect(() => {
    applyLanguagePolicyNow();
    if (!hydrated) return; // ✅ guard
    scheduleProfileSave();
  }, [targetLang, hydrated]);

  function scheduleSessionUpdate() {
    clearTimeout(sessionUpdateTimer.current);
    sessionUpdateTimer.current = setTimeout(
      () => sendSessionUpdate(),
      DEBOUNCE_MS
    );
  }
  function scheduleProfileSave() {
    clearTimeout(profileSaveTimer.current);
    profileSaveTimer.current = setTimeout(() => {
      if (!hydrated) return; // ✅ gate saves until after first load
      saveProfile({}).catch(() => {});
    }, 500);
  }

  /* ---------------------------
     Connect / Disconnect
  --------------------------- */
  function safeCancelActiveResponse() {
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    if (isIdleRef.current) return;
    try {
      dcRef.current.send(JSON.stringify({ type: "response.cancel" }));
    } catch {}
  }

  async function start() {
    setErr("");
    setMessages([]);
    respToMsg.current.clear();
    guardrailItemIdsRef.current = [];
    pendingGuardrailTextRef.current = "";
    clearAllDebouncers();
    setStatus("connecting");
    setUiState("idle");
    try {
      //   if (!API_KEY) throw new Error("Missing VITE_OPENAI_API_KEY");

      const npub = strongNpub(user);
      if (npub) await ensureUserDoc(npub);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const remote = new MediaStream();
      if (audioRef.current) {
        audioRef.current.srcObject = remote;
        audioRef.current.autoplay = true;
        audioRef.current.playsInline = true;
      }
      // Add remote tracks and lazily build the AudioContext graph
      pc.ontrack = (e) => {
        e.streams[0].getTracks().forEach((t) => remote.addTrack(t));

        if (!audioGraphReadyRef.current) {
          try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            const ctx = new Ctx();
            const srcNode = ctx.createMediaStreamSource(remote);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.15;

            const dest = ctx.createMediaStreamDestination();
            srcNode.connect(analyser);
            srcNode.connect(dest);

            audioCtxRef.current = ctx;
            analyserRef.current = analyser;
            floatBufRef.current = new Float32Array(analyser.fftSize);
            captureOutRef.current = dest.stream;

            audioGraphReadyRef.current = true;
          } catch (e) {
            console.warn(
              "AudioContext init (ontrack) failed:",
              e?.message || e
            );
          }
        }
      };
      pc.addTransceiver("audio", { direction: "recvonly" });

      const local = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localRef.current = local;
      local.getTracks().forEach((track) => pc.addTrack(track, local));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        const voiceName = voiceRef.current || "alloy";
        const instructions = buildLanguageInstructionsFromRefs();
        const vadMs = pauseMsRef.current || 800;

        dc.send(
          JSON.stringify({
            type: "session.update",
            session: {
              instructions,
              modalities: ["audio", "text"],
              voice: voiceName,
              turn_detection: {
                type: "server_vad",
                silence_duration_ms: vadMs,
                threshold: 0.35,
                prefix_padding_ms: 120,
              },
              input_audio_transcription: { model: "whisper-1" },
              output_audio_format: "pcm16",
            },
          })
        );

        pendingGuardrailTextRef.current = instructions;
        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "system",
              content: [{ type: "input_text", text: instructions }],
            },
          })
        );
      };

      dc.onmessage = handleRealtimeEvent;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const resp = await fetch(REALTIME_URL, {
        method: "POST",
        headers: {
          // No Authorization header; the function holds the server key
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      const answer = await resp.text();
      if (!resp.ok) throw new Error(`SDP exchange failed: HTTP ${resp.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      setStatus("connected");
      aliveRef.current = true;
      setUiState("idle");
    } catch (e) {
      setStatus("disconnected");
      setUiState("idle");
      setErr(e?.message || String(e));
    }
  }

  async function stop() {
    aliveRef.current = false;
    try {
      if (dcRef.current?.readyState === "open") {
        safeCancelActiveResponse();
        dcRef.current.send(
          JSON.stringify({ type: "input_audio_buffer.clear" })
        );
        dcRef.current.send(
          JSON.stringify({
            type: "session.update",
            session: { turn_detection: null },
          })
        );
      }
    } catch {}

    try {
      const a = audioRef.current;
      if (a) {
        try {
          a.pause();
        } catch {}
        const s = a.srcObject;
        if (s) {
          try {
            s.getTracks().forEach((t) => t.stop());
          } catch {}
        }
        a.srcObject = null;
        try {
          a.load?.();
        } catch {}
      }
    } catch {}

    try {
      localRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    localRef.current = null;

    try {
      pcRef.current?.getSenders?.().forEach((s) => s.track && s.track.stop());
      pcRef.current?.getReceivers?.().forEach((r) => r.track && r.track.stop());
    } catch {}

    try {
      dcRef.current?.close();
    } catch {}
    dcRef.current = null;
    try {
      pcRef.current?.close();
    } catch {}
    pcRef.current = null;

    try {
      audioCtxRef.current?.close?.();
    } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;
    floatBufRef.current = null;
    captureOutRef.current = null;
    audioGraphReadyRef.current = false;

    try {
      for (const rec of recMapRef.current.values())
        if (rec?.state === "recording") rec.stop();
    } catch {}
    recMapRef.current.clear();
    recChunksRef.current.clear();
    for (const id of recTailRef.current.values()) clearInterval(id);
    recTailRef.current.clear();
    replayRidSetRef.current.clear();

    clearAllDebouncers();
    respToMsg.current.clear();
    guardrailItemIdsRef.current = [];
    pendingGuardrailTextRef.current = "";
    isIdleRef.current = true;
    idleWaitersRef.current.splice(0).forEach((fn) => {
      try {
        fn();
      } catch {}
    });

    setStatus("disconnected");
    setUiState("idle");
    setMood("neutral");
  }

  /* ---------------------------
     🎯 Goal helpers (seed, persist, evaluate, advance)
  --------------------------- */
  function goalTitlesSeed() {
    return {
      en:
        translations.en.onboarding_challenge_default ||
        "Make a polite request.",
      es:
        translations.es.onboarding_challenge_default ||
        "Haz una petición cortés.",
    };
  }

  async function ensureCurrentGoalSeed(npub, userData) {
    const ref = doc(database, "users", npub);
    const data = userData || (await getDoc(ref)).data() || {};
    if (
      data.currentGoal &&
      data.currentGoal.title_en &&
      data.currentGoal.title_es
    ) {
      return { ...data.currentGoal, attempts: data.currentGoal.attempts || 0 };
    }
    const seedTitles = goalTitlesSeed();
    const seed = {
      id: `goal_${Date.now()}`,
      title_en: seedTitles.en,
      title_es: seedTitles.es,
      rubric_en: "A brief, polite request",
      rubric_es: "Una petición breve y educada",
      attempts: 0,
      status: "active",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    await setDoc(
      ref,
      { currentGoal: seed, lastGoal: seed.title_en },
      { merge: true }
    );
    return seed;
  }

  // ✅ Determine which language the *goal UI* should use, based on practice target/support
  function goalUiLangCode() {
    const t = targetLangRef.current || targetLang;
    if (t === "es") return "en"; // practicing Spanish → goal UI in English
    if (t === "en") return "es"; // practicing English → goal UI in Spanish
    // Default fallback for unsupported languages
    const s = supportLangRef.current || supportLang;
    return s === "es" ? "es" : "en";
  }

  function goalTitleForUI(goal) {
    if (!goal) return "";
    const gLang = goalUiLangCode();
    return gLang === "es"
      ? goal.title_es || goal.title_en || ""
      : goal.title_en || goal.title_es || "";
  }
  function goalRubricForUI(goal) {
    if (!goal) return "";
    const gLang = goalUiLangCode();
    return gLang === "es"
      ? goal.rubric_es || goal.rubric_en || ""
      : goal.rubric_en || goal.rubric_es || "";
  }

  function goalTitleForTarget(goal) {
    if (!goal) return "";
    if (targetLangRef.current === "es") return goal.title_es || goal.title_en;
    if (targetLangRef.current === "zh") return goal.title_en || goal.title_es; // fallback
    return goal.title_en || goal.title_es;
  }
  function goalRubricForTarget(goal) {
    if (!goal) return "";
    return targetLangRef.current === "en"
      ? goal.rubric_es || ""
      : goal.rubric_en || "";
  }

  async function persistCurrentGoal(next) {
    const npub = strongNpub(user);
    if (!npub) return;
    await setDoc(
      doc(database, "users", npub),
      { currentGoal: { ...next, updatedAt: isoNow() } },
      { merge: true }
    );
  }

  async function recordGoalCompletion(prevGoal, confidence = 0) {
    const npub = strongNpub(user);
    if (!npub || !prevGoal) return;
    const payload = {
      ...prevGoal,
      status: "completed",
      completedAt: isoNow(),
      confidence,
    };
    await addDoc(collection(database, "users", npub, "goals"), payload);
    // XP is now awarded dynamically in evaluateAndMaybeAdvanceGoal()
  }

  async function skipCurrentGoal() {
    const npub = strongNpub(user);
    if (!npub || !currentGoal || goalBusyRef.current) return;
    goalBusyRef.current = true;
    try {
      await addDoc(collection(database, "users", npub, "goals"), {
        ...currentGoal,
        status: "skipped",
        skippedAt: isoNow(),
      });
      const nextGoal = await generateNextGoal(currentGoal);
      setCurrentGoal(nextGoal);
      goalRef.current = nextGoal;
      await persistCurrentGoal(nextGoal);
      const gLang = goalUiLangCode();
      toast({
        title: gLang === "es" ? "Nueva meta" : "New goal",
        description: goalTitleForUI(nextGoal),
        status: "info",
      });
      scheduleSessionUpdate();
    } catch (e) {
      console.warn("skipCurrentGoal failed:", e?.message || e);
    } finally {
      goalBusyRef.current = false;
    }
  }

  async function generateNextGoal(prevGoal) {
    const SNIPPET_MAX = 240;
    function snippet(s, n = SNIPPET_MAX) {
      return String(s || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, n);
    }
    function latestTurn(role) {
      // Merge ephemerals + persisted, pick the newest turn for the role
      const all = [...(messagesRef.current || []), ...(history || [])];
      const items = all
        .filter(
          (x) =>
            x.role === role &&
            (String(x.textFinal || "").trim() ||
              String(x.textStream || "").trim())
        )
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!items.length) return null;
      const t = items[0];
      const text = ((t.textFinal || "") + " " + (t.textStream || "")).trim();
      const lang =
        t.lang || (role === "assistant" ? targetLangRef.current : "en");
      return { text, lang };
    }
    // Profile & context
    const profile = {
      level: levelRef.current,
      help: helpRequestRef.current || "",
      targetLang: targetLangRef.current,
    };

    // Pull the most recent user/assistant turns
    const lastUser = latestTurn("user");
    const lastAI = latestTurn("assistant");

    const userLine = lastUser
      ? `Previous user request (${lastUser.lang}): """${snippet(
          lastUser.text
        )}"""`
      : "Previous user request: (none)";
    const aiLine = lastAI
      ? `Previous AI reply (${lastAI.lang}): """${snippet(lastAI.text)}"""`
      : "Previous AI reply: (none)";

    const systemAsk = `
You are a language micro-goal planner. Propose the next tiny **speaking** goal so it feels like a natural continuation of the **previous user–assistant exchange** and is progressive from the prior goal.

Constraints:
- Keep titles ≤ 7 words.
- Keep it practical and conversational.
- Fit the user's level: ${profile.level}.
- Target language: ${profile.targetLang}.
- User focus: ${profile.help || "(none)"}.
Return ONLY JSON (no prose, no markdown):

{
  "title_en": "...",
  "title_es": "...",
  "rubric_en": "... one-sentence success criteria ...",
  "rubric_es": "... una frase con criterios de éxito ..."
}
  `.trim();

    const body = {
      model: TRANSLATE_MODEL,
      text: { format: { type: "text" } },
      input: `${systemAsk}

Previous goal (EN): ${prevGoal?.title_en || ""}
Previous goal (ES): ${prevGoal?.title_es || ""}
${userLine}
${aiLine}
`,
    };

    try {
      const r = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          // No Authorization; backend adds server key
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      const ct = r.headers.get("content-type") || "";
      const payload = ct.includes("application/json")
        ? await r.json()
        : await r.text();

      const mergedText =
        (typeof payload?.output_text === "string" && payload.output_text) ||
        (Array.isArray(payload?.output) &&
          payload.output
            .map((it) =>
              (it?.content || []).map((seg) => seg?.text || "").join("")
            )
            .join(" ")
            .trim()) ||
        (Array.isArray(payload?.content) && payload.content[0]?.text) ||
        (Array.isArray(payload?.choices) &&
          (payload.choices[0]?.message?.content || "")) ||
        "";

      const parsed = safeParseJson(mergedText) || {};
      const title_en = (parsed.title_en || "").trim();
      const title_es = (parsed.title_es || "").trim();
      const rubric_en = (parsed.rubric_en || "").trim();
      const rubric_es = (parsed.rubric_es || "").trim();

      if (title_en || title_es) {
        return {
          id: `goal_${Date.now()}`,
          title_en: title_en || "Ask a follow-up question.",
          title_es: title_es || "Haz una pregunta de seguimiento.",
          rubric_en:
            rubric_en ||
            "One short follow-up question that is on-topic and natural.",
          rubric_es:
            rubric_es ||
            "Una pregunta breve de seguimiento, natural y relacionada.",
          attempts: 0,
          status: "active",
          createdAt: isoNow(),
          updatedAt: isoNow(),
        };
      }
    } catch (e) {
      console.warn("Next goal generation failed:", e?.message || e);
    }

    // Fallback
    return {
      id: `goal_${Date.now()}`,
      title_en: "Ask a follow-up question.",
      title_es: "Haz una pregunta de seguimiento.",
      rubric_en: "One short follow-up question that is on-topic and natural.",
      rubric_es: "Una pregunta breve de seguimiento, natural y relacionada.",
      attempts: 0,
      status: "active",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
  }

  // 🔢 XP helpers — dynamic awards using Responses API signals
  function computeXpDelta({ met, conf, attempts, pron }) {
    const BASE = 5; // small reward for practicing
    const confScore = Math.round(conf * 20); // 0..20
    const effortPenalty = Math.max(0, attempts - 1) * 2; // -2 per extra try
    const metBonus = met ? 20 + Math.max(0, 10 - (attempts - 1) * 3) : 0; // 20.. (less if many attempts)
    const pronBonus = pron ? 3 : 0;
    let delta = BASE + confScore + metBonus + pronBonus - effortPenalty;
    delta = Math.max(1, Math.min(60, delta)); // clamp
    return delta;
  }

  async function awardXp(delta, { reason } = {}) {
    const amt = Math.round(delta || 0);
    if (!amt) return;
    setXp((v) => v + amt);
    try {
      const npub = strongNpub(user);
      if (npub) {
        await setDoc(
          doc(database, "users", npub),
          { xp: increment(amt), updatedAt: isoNow() },
          { merge: true }
        );
      }
    } catch {}
    // Friendly toast
    try {
      //   toast({
      //     title: `+${amt} XP`,
      //     description: reason || undefined,
      //     status: "success",
      //     duration: 1600,
      //   });
    } catch {}
  }

  async function evaluateAndMaybeAdvanceGoal(userUtterance) {
    const goal = goalRef.current;
    if (!goal || goalBusyRef.current) return;

    // Nudge attempt count
    const nextAttempts = (goal.attempts || 0) + 1;
    const patched = { ...goal, attempts: nextAttempts, updatedAt: isoNow() };
    setCurrentGoal(patched);
    goalRef.current = patched;
    await persistCurrentGoal(patched);

    // Ask Responses API to judge the utterance vs goal
    const rubricTL = goalRubricForTarget(goal);

    const gLang = goalUiLangCode();
    const uiLangName = gLang === "es" ? "Spanish" : "English";

    const judgePrompt =
      targetLangRef.current === "es"
        ? `Evalúa si el siguiente enunciado cumple esta meta en español: "${
            goal.title_es
          }". Criterio: ${rubricTL}.
Devuelve SOLO JSON:
{"met":true|false,"confidence":0..1,"feedback_tl":"mensaje breve y amable en el idioma meta (≤12 palabras)","feedback_ui":"mensaje breve y amable en ${
            gLang === "es" ? "español" : "inglés"
          } (≤12 palabras)"}`
        : `Evaluate whether the following utterance meets this goal in ${
            targetLangRef.current === "en" ? "English" : "the target language"
          }: "${goal.title_en}". Criterion: ${rubricTL}.
Return ONLY JSON:
{"met":true|false,"confidence":0..1,"feedback_tl":"short, kind message in the target language (≤12 words)","feedback_ui":"short, kind message in ${uiLangName} (≤12 words)"}`;

    const body = {
      model: TRANSLATE_MODEL,
      text: { format: { type: "text" } },
      input: `${judgePrompt}\n\nUtterance:\n${userUtterance}`,
    };

    try {
      const r = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          // No Authorization; backend adds server key
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      const ct = r.headers.get("content-type") || "";
      const payload = ct.includes("application/json")
        ? await r.json()
        : await r.text();

      const mergedText =
        (typeof payload?.output_text === "string" && payload.output_text) ||
        (Array.isArray(payload?.output) &&
          payload.output
            .map((it) =>
              (it?.content || []).map((seg) => seg?.text || "").join("")
            )
            .join(" ")
            .trim()) ||
        (Array.isArray(payload?.content) && payload.content[0]?.text) ||
        (Array.isArray(payload?.choices) &&
          (payload.choices[0]?.message?.content || "")) ||
        "";
      const parsed = safeParseJson(mergedText) || {};
      const met = !!parsed.met;
      const conf = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
      const fbTL = (parsed.feedback_tl || "").trim();
      const fbUI = (parsed.feedback_ui || "").trim();
      // Prefer goal-UI language for the little nudge shown in the UI
      if (fbUI || fbTL) setGoalFeedback(fbUI || fbTL);

      // 🟢 Dynamic XP award here based on met/confidence/attempts/pronunciation mode
      if (met) {
        const xpGain = computeXpDelta({
          met: true,
          conf,
          attempts: nextAttempts,
          pron: !!practicePronunciationRef.current,
        });
        await awardXp(xpGain, { reason: tGoalCompletedToast });
      }

      if (met) {
        goalBusyRef.current = true;
        // toast({
        //   title: tGoalCompletedToast,
        //   description: goalTitleForUI(goal),
        //   status: "success",
        // });
        await recordGoalCompletion(goal, conf);
        const nextGoal = await generateNextGoal(goal);
        setCurrentGoal(nextGoal);
        goalRef.current = nextGoal;
        await persistCurrentGoal(nextGoal);
        scheduleSessionUpdate();
        goalBusyRef.current = false;
      }
    } catch (e) {
      // Soft fail; do nothing
      console.warn("Goal eval failed:", e?.message || e);
    }
  }

  /* ---------------------------
     Language instructions (now includes helpRequest + pronunciation mode + active goal)
  --------------------------- */
  function buildLanguageInstructionsFromRefs() {
    const persona = String(voicePersonaRef.current || "").slice(0, 240);
    const focus = String(helpRequestRef.current || "").slice(0, 240);
    const tLang = targetLangRef.current;
    const lvl = levelRef.current;
    const pronOn = !!practicePronunciationRef.current;
    const activeGoal = goalTitleForTarget(goalRef.current);

    const strict =
      tLang === "zh"
        ? "Respond ONLY in Chinese. Do not use Spanish or English under any circumstance."
        : tLang === "es"
        ? "Responde ÚNICAMENTE en español. No uses inglés ni chino bajo ninguna circunstancia."
        : "Respond ONLY in English. Do not use Spanish or Chinese under any circumstance.";

    const levelHint =
      lvl === "beginner"
        ? "Lenguaje sencillo y claro; tono amable."
        : lvl === "intermediate"
        ? "Lenguaje natural y conciso."
        : "Lenguaje nativo; respuestas muy breves.";

    const focusLine = focus ? `Focus area: ${focus}.` : "";

    // ✅ Pronunciation coaching: tiny cue + one slowed repetition, keep in target language
    const pronLine = pronOn
      ? "Pronunciation mode: after answering, give a micro pronunciation cue (≤6 words), then repeat the corrected sentence once, slowly, and invite the user to repeat. Keep everything in the target language. Don't be too strict, just accept improvements."
      : "";

    const goalLine = activeGoal
      ? `Active goal: ${activeGoal}. Nudge gently toward completing it.`
      : "";

    return [
      "Actúa como compañero de práctica.",
      strict,
      "Mantén respuestas muy breves (≤25 palabras) y naturales.",
      `PERSONA: ${persona}. Mantén consistentemente ese tono/estilo.`,
      levelHint,
      focusLine,
      pronLine,
      goalLine,
    ]
      .filter(Boolean)
      .join(" ");
  }

  /* ---------------------------
     Idle gating
  --------------------------- */
  function waitUntilIdle(timeoutMs = 800) {
    if (isIdleRef.current) return Promise.resolve();
    return new Promise((resolve) => {
      idleWaitersRef.current.push(resolve);
      setTimeout(resolve, timeoutMs);
    });
  }

  /* ---------------------------
     Session updates
  --------------------------- */
  function applyLanguagePolicyNow() {
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    safeCancelActiveResponse();

    const uniqIds = Array.from(new Set(guardrailItemIdsRef.current));
    for (const id of uniqIds) {
      try {
        dcRef.current.send(
          JSON.stringify({ type: "conversation.item.delete", item_id: id })
        );
      } catch {}
    }
    guardrailItemIdsRef.current = [];

    const voiceName = voiceRef.current || "alloy";
    const instructions = buildLanguageInstructionsFromRefs();
    const vadMs = pauseMsRef.current || 800;

    try {
      dcRef.current.send(
        JSON.stringify({
          type: "session.update",
          session: {
            instructions,
            modalities: ["audio", "text"],
            voice: voiceName,
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: vadMs,
              threshold: 0.35,
              prefix_padding_ms: 120,
            },
            input_audio_transcription: { model: "whisper-1" },
            output_audio_format: "pcm16",
          },
        })
      );
    } catch {}

    try {
      pendingGuardrailTextRef.current = instructions;
      dcRef.current.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text: instructions }],
          },
        })
      );
    } catch {}
  }

  async function applyVoiceNow({ speakProbe = false } = {}) {
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    safeCancelActiveResponse();
    await waitUntilIdle();
    const voiceName = voiceRef.current || "alloy";
    try {
      dcRef.current.send(
        JSON.stringify({
          type: "session.update",
          session: {
            voice: voiceName,
            modalities: ["audio", "text"],
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: pauseMsRef.current || 800,
              threshold: 0.35,
              prefix_padding_ms: 120,
            },
            input_audio_transcription: { model: "whisper-1" },
            output_audio_format: "pcm16",
          },
        })
      );
    } catch {}
    await new Promise((r) => setTimeout(r, 40));
    if (speakProbe) {
      const probeText =
        targetLangRef.current === "es" ? "Voz actualizada." : "Voice updated.";
      try {
        dcRef.current.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio"],
              conversation: "none",
              instructions: `Say exactly: "${probeText}"`,
              cancel_previous: false,
              commit: false,
              metadata: { kind: "voice_probe" },
            },
          })
        );
      } catch {}
    }
  }

  function sendSessionUpdate() {
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    const voiceName = voiceRef.current || "alloy";
    const instructions = buildLanguageInstructionsFromRefs();
    try {
      dcRef.current.send(
        JSON.stringify({
          type: "session.update",
          session: {
            instructions,
            modalities: ["audio", "text"],
            voice: voiceName,
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: pauseMsRef.current || 800,
              threshold: 0.35,
              prefix_padding_ms: 120,
            },
            input_audio_transcription: { model: "whisper-1" },
            output_audio_format: "pcm16",
          },
        })
      );
    } catch {}
  }

  /* ---------------------------
     Replay + recording helpers
  --------------------------- */
  function chooseMime() {
    const cand = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
    ];
    for (const mt of cand)
      if (window.MediaRecorder?.isTypeSupported(mt)) return mt;
    return undefined;
  }

  function getRMS() {
    const analyser = analyserRef.current;
    const buf = floatBufRef.current;
    if (!analyser || !buf) return 0;
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(buf);
    } else {
      const tmp = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(tmp);
      for (let i = 0; i < tmp.length; i++) buf[i] = (tmp[i] - 128) / 128;
    }
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]; // ✅ fix RMS
    return Math.sqrt(sum / buf.length); // 0..1
  }

  function startRecordingForRid(rid, mid) {
    try {
      const stream = captureOutRef.current || audioRef.current?.srcObject;
      const mimeType = chooseMime();
      if (!stream || !mimeType) return;

      const rec = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      rec.ondataavailable = (ev) => {
        if (ev?.data?.size) chunks.push(ev.data);
      };
      rec.onstop = async () => {
        try {
          if (!chunks.length) return;
          const blob = new Blob(chunks, { type: mimeType });
          await idbPutClip(mid, blob, {
            voice: voiceRef.current || "alloy",
            mimeType,
          });

          // Mark in-memory that this message now has a cached clip
          audioCacheIndexRef.current.add(mid);

          updateMessage(mid, (m) => ({ ...m, hasAudio: true }));
        } catch (e) {
          console.warn("IDB save failed:", e?.message || e);
        } finally {
          recChunksRef.current.delete(rid);
          recMapRef.current.delete(rid);
        }
      };
      // timeslice ensures data flushes reliably across browsers
      rec.start(250);
      recMapRef.current.set(rid, rec);
      recChunksRef.current.set(rid, chunks);
    } catch (e) {
      console.warn("Recorder start failed:", e?.message || e);
    }
  }

  function stopRecorderAfterTail(
    rid,
    opts = {
      quietMs: 900,
      maxMs: 20000,
      armThresh: 0.006,
      minActiveMs: 900,
    }
  ) {
    if (recTailRef.current.has(rid)) return; // already scheduled

    const { quietMs, maxMs, armThresh, minActiveMs } = opts;
    const startedAt = Date.now();
    let armed = false;
    let firstVoiceAt = 0;
    let lastLoudAt = Date.now();

    const id = setInterval(() => {
      const now = Date.now();
      const rms = getRMS();

      if (rms >= armThresh) {
        if (!armed) {
          armed = true;
          firstVoiceAt = now;
        }
        lastLoudAt = now;
      }

      const longEnoughSinceVoice = armed && now - firstVoiceAt >= minActiveMs;
      const quietLongEnough = armed && now - lastLoudAt >= quietMs;
      const timedOut = now - startedAt >= maxMs;

      if ((longEnoughSinceVoice && quietLongEnough) || timedOut) {
        clearInterval(id);
        recTailRef.current.delete(rid);
        const rec = recMapRef.current.get(rid);
        if (rec?.state === "recording") rec.stop();
      }
    }, 100);

    recTailRef.current.set(rid, id);
  }

  async function replayMessageAudio(mid, textFallback) {
    if (replayingMid) return;
    setReplayingMid(mid);

    // Some browsers (iOS Safari) require the AudioContext to be "running" after a user gesture
    try {
      await audioCtxRef.current?.resume?.();
    } catch {}

    // Try local cache first
    try {
      const row = await idbGetClip(mid);
      if (row?.blob) {
        const url = URL.createObjectURL(row.blob);
        const a = playbackRef.current;
        if (a) {
          try {
            a.pause();
          } catch {}
          a.src = url;
          a.preload = "auto";
          a.playsInline = true;
          a.onended = () => URL.revokeObjectURL(url);
          a.onpause = () => URL.revokeObjectURL(url);

          try {
            await a.play();
            setReplayingMid(null);
            return;
          } catch (e) {
            // If element refused to play (autoplay policy), fall through to server fallback
            console.warn(
              "Local clip play() failed, falling back:",
              e?.message || e
            );
          }
        }
      }
    } catch (e) {
      // ignore and try fallback
      console.warn("IDB read failed, using fallback:", e?.message || e);
    }

    // Fallback: ask the realtime server to re-say exactly (no new bubble). We record this too.
    if (dcRef.current?.readyState === "open" && textFallback) {
      try {
        dcRef.current.send(
          JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio"],
              conversation: "none",
              instructions: `Say exactly: "${textFallback.replace(
                /"/g,
                '\\"'
              )}"`,
              cancel_previous: false,
              commit: false,
              metadata: { kind: "replay", mid },
            },
          })
        );
        // live audio will come via audioRef (remote stream)
        setReplayingMid(null);
        return;
      } catch (e) {
        console.warn("Replay request failed:", e?.message || e);
      }
    }

    // If we’re here, we can’t replay
    setReplayingMid(null);
  }

  /* ---------------------------
     Event handling
  --------------------------- */
  function extractTextFromItem(item) {
    const parts = Array.isArray(item?.content) ? item.content : [];
    return parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  async function handleRealtimeEvent(evt) {
    if (!aliveRef.current) return;
    let data;
    try {
      data = JSON.parse(evt.data);
    } catch {
      return;
    }
    const t = data?.type;
    const rid = data?.response_id || data?.response?.id || data?.id || null;

    if (t === "conversation.item.created" && data?.item) {
      if (data.item?.role === "system") {
        const text = extractTextFromItem(data.item);
        if (
          text &&
          pendingGuardrailTextRef.current &&
          text === pendingGuardrailTextRef.current
        ) {
          guardrailItemIdsRef.current.push(data.item.id);
          pendingGuardrailTextRef.current = "";
        }
      }
      return;
    }

    // Response lifecycle
    if (t === "response.created") {
      isIdleRef.current = false;

      // Detect replay responses (no new bubble)
      const mdKind = data?.response?.metadata?.kind;
      if (mdKind === "replay") {
        replayRidSetRef.current.add(rid);
        const mid = data?.response?.metadata?.mid;
        if (mid) startRecordingForRid(rid, mid); // record fallback replay too
        setUiState("speaking");
        setMood("happy");
        return;
      }

      const mid = uid();
      respToMsg.current.set(rid, mid);
      setUiState("speaking");
      setMood("happy");

      // Start recording AI voice for this response (cache for replay)
      startRecordingForRid(rid, mid);
      return;
    }

    if (
      (t === "conversation.item.input_audio_transcription.completed" ||
        t === "input_audio_transcription.completed") &&
      data?.transcript
    ) {
      const text = (data.transcript || "").trim();
      if (text) {
        const now = Date.now();
        if (
          text === lastTranscriptRef.current.text &&
          now - lastTranscriptRef.current.ts < 2000
        ) {
          return; // duplicate STT → ignore
        }
        lastTranscriptRef.current = { text, ts: now };

        pushMessage({
          id: uid(),
          role: "user",
          lang: "en",
          textFinal: text,
          textStream: "",
          translation: "",
          pairs: [],
          done: true,
          ts: now,
        });
        await persistUserTurn(text, "en").catch(() => {});
        // 🎯 Evaluate goal on each user utterance (also awards dynamic XP)
        evaluateAndMaybeAdvanceGoal(text).catch(() => {});
      }
      return;
    }

    // Ignore bubble updates for replay-triggered responses
    if (rid && replayRidSetRef.current.has(rid)) {
      if (
        t === "response.completed" ||
        t === "response.done" ||
        t === "response.canceled"
      ) {
        stopRecorderAfterTail(rid); // stop recording with tail for replay
        replayRidSetRef.current.delete(rid);
      }
      return;
    }

    if (
      (t === "response.audio_transcript.delta" ||
        t === "response.output_text.delta" ||
        t === "response.text.delta") &&
      typeof data?.delta === "string"
    ) {
      const mid = ensureMessageForResponse(rid); // creates the bubble on first token
      // Buffer → flush every 50ms
      const prev = streamBuffersRef.current.get(mid) || "";
      streamBuffersRef.current.set(mid, prev + data.delta);
      scheduleStreamFlush();
      return;
    }

    if (
      (t === "response.audio_transcript.done" ||
        t === "response.output_text.done" ||
        t === "response.text.done") &&
      typeof data?.text === "string"
    ) {
      const mid = ensureMessageForResponse(rid);
      // Flush any buffered stream first
      const buf = streamBuffersRef.current.get(mid) || "";
      if (buf) {
        streamBuffersRef.current.set(mid, "");
        updateMessage(mid, (m) => ({
          ...m,
          textStream: (m.textStream || "") + buf,
        }));
      }
      updateMessage(mid, (m) => ({
        ...m,
        textFinal: ((m.textFinal || "").trim() + " " + data.text).trim(),
        textStream: "",
      }));
      scheduleDebouncedTranslate(mid, "final-chunk");
      return;
    }

    if (
      t === "response.completed" ||
      t === "response.done" ||
      t === "response.canceled"
    ) {
      // IMPORTANT: don't stop recorder immediately; stop after silence tail
      stopRecorderAfterTail(rid);

      isIdleRef.current = true;
      idleWaitersRef.current.splice(0).forEach((fn) => {
        try {
          fn();
        } catch {}
      });

      const mid = rid && respToMsg.current.get(rid);
      if (mid) {
        const buf = streamBuffersRef.current.get(mid) || "";
        if (buf) {
          streamBuffersRef.current.set(mid, "");
          updateMessage(mid, (m) => ({
            ...m,
            textStream: "",
            textFinal: ((m.textFinal || "") + " " + buf).trim(),
          }));
        }
        updateMessage(mid, (m) => ({ ...m, done: true }));
        try {
          await translateMessage(mid, "completed");
        } catch {}
        respToMsg.current.delete(rid);
      }
      setUiState("idle");
      setMood("neutral");
      return;
    }

    if (t === "error" && data?.error?.message) {
      const msg = data.error.message || "";
      if (/Cancellation failed/i.test(msg) || /no active response/i.test(msg)) {
        return; // benign cancel noise
      }
      setErr((p) => p || msg);
    }
  }

  // Create assistant bubble lazily on first token/done
  function ensureMessageForResponse(rid) {
    let mid = respToMsg.current.get(rid);
    if (!mid) {
      mid = uid();
      respToMsg.current.set(rid, mid);
    }
    const exists = messagesRef.current.some((m) => m.id === mid);
    if (!exists) {
      pushMessage({
        id: mid,
        role: "assistant",
        lang: targetLangRef.current || "es",
        textFinal: "",
        textStream: "",
        translation: "",
        pairs: [],
        done: false,
        hasAudio: false,
        ts: Date.now(),
      });
    }
    return mid;
  }

  function pushMessage(m) {
    setMessages((p) => [...p, m]);
  }
  function updateMessage(id, updater) {
    setMessages((p) => p.map((m) => (m.id === id ? updater(m) : m)));
  }

  /* ---------------------------
     Translation + PERSIST
  --------------------------- */
  function clearAllDebouncers() {
    for (const t of translateTimers.current.values()) clearTimeout(t);
    translateTimers.current.clear();
    clearTimeout(sessionUpdateTimer.current);
    clearTimeout(profileSaveTimer.current);
  }
  function scheduleDebouncedTranslate(id) {
    const prev = translateTimers.current.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      translateMessage(id).catch(() => {});
    }, 300);
    translateTimers.current.set(id, timer);
  }

  async function translateMessage(id) {
    const m = messagesRef.current.find((x) => x.id === id);
    if (!m) return;
    const src = (m.textFinal + " " + (m.textStream || "")).trim();
    if (!src) return;
    if (m.role !== "assistant") return;

    const effectiveSecondary =
      targetLangRef.current === "en"
        ? "es"
        : supportLangRef.current === "es"
        ? "es"
        : "en";

    const isSpanish = (m.lang || targetLangRef.current) === "es";
    const target = isSpanish ? "en" : effectiveSecondary;

    const prompt =
      target === "es"
        ? `Traduce lo siguiente al español claro y natural. Devuelve SOLO JSON:\n{"translation":"...","pairs":[{"lhs":"<frase original>","rhs":"<frase traducida>"}]}`
        : `Translate the following into natural US English. Return ONLY JSON:\n{"translation":"...","pairs":[{"lhs":"<source phrase>","rhs":"<translated phrase>"}]}`;

    const body = {
      model: TRANSLATE_MODEL,
      text: { format: { type: "text" } },
      input: `${prompt}\n\n${src}`,
    };

    const r = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        // No Authorization; backend adds server key
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const ct = r.headers.get("content-type") || "";
    const payload = ct.includes("application/json")
      ? await r.json()
      : await r.text();
    if (!r.ok) {
      const msg =
        payload?.error?.message ||
        (typeof payload === "string" ? payload : JSON.stringify(payload));
      throw new Error(msg || `Translate HTTP ${r.status}`);
    }

    const mergedText =
      (typeof payload?.output_text === "string" && payload.output_text) ||
      (Array.isArray(payload?.output) &&
        payload.output
          .map((it) =>
            (it?.content || []).map((seg) => seg?.text || "").join("")
          )
          .join(" ")
          .trim()) ||
      (Array.isArray(payload?.content) && payload.content[0]?.text) ||
      (Array.isArray(payload?.choices) &&
        (payload.choices[0]?.message?.content || "")) ||
      "";

    const parsed = safeParseJson(mergedText);
    const translation = (parsed?.translation || mergedText || "").trim();
    const rawPairs = Array.isArray(parsed?.pairs) ? parsed.pairs : [];
    const pairs = rawPairs
      .map((p) => ({
        lhs: String(p?.lhs || "").trim(),
        rhs: String(p?.rhs || "").trim(),
      }))
      .filter((p) => p.lhs && p.rhs)
      .slice(0, 8);

    updateMessage(id, (prev) => ({ ...prev, translation, pairs }));
    await upsertAssistantTurn(id, {
      text: src,
      lang: m.lang || targetLangRef.current || "es",
      translation,
      pairs,
    });
  }

  async function upsertAssistantTurn(mid, { text, lang, translation, pairs }) {
    const npub = strongNpub(user);
    if (!npub) return;
    if (!(await ensureUserDoc(npub))) return;

    const effectiveSecondary =
      targetLangRef.current === "en"
        ? "es"
        : supportLangRef.current === "es"
        ? "es"
        : "en";

    const trans_en =
      lang === "es"
        ? translation || ""
        : effectiveSecondary !== "es"
        ? translation || ""
        : "";

    const trans_es =
      lang !== "es" && effectiveSecondary === "es"
        ? translation || ""
        : lang === "es"
        ? ""
        : "";

    const ref = doc(database, "users", npub, "turns", mid);
    const firstTime = true; // id equals mid (we control it)

    await setDoc(
      ref,
      {
        role: "assistant",
        lang,
        text: String(text || "").trim(),
        trans_en,
        trans_es,
        pairs: Array.isArray(pairs) ? pairs : [],
        origin: "realtime",
        ...(firstTime
          ? { createdAt: serverTimestamp(), createdAtClient: Date.now() }
          : {}),
      },
      { merge: true }
    );

    // Streak bump kept; XP now awarded dynamically elsewhere
    setStreak((v) => v + 1);
    try {
      await setDoc(
        doc(database, "users", npub),
        {
          local_npub: npub,
          updatedAt: isoNow(),
          streak: increment(1),
          helpRequest: helpRequestRef.current || "",
          progress: {
            level: levelRef.current,
            supportLang: supportLangRef.current,
            voice: voiceRef.current,
            voicePersona: voicePersonaRef.current,
            targetLang: targetLangRef.current,
            showTranslations,
            helpRequest: helpRequestRef.current || "",
            practicePronunciation: !!practicePronunciationRef.current, // ✅ persist on each assistant turn too
          },
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("Streak persist failed:", e?.message || e);
    }
  }

  /* ---------------------------
     Persist user turn
  --------------------------- */
  async function persistUserTurn(text, lang = "en") {
    const npub = strongNpub(user);
    if (!npub) return;

    const now = Date.now();
    if (
      lastUserSaveRef.current.text === text &&
      now - (lastUserSaveRef.current.ts || 0) < 1200
    )
      return;

    if (!(await ensureUserDoc(npub))) return;

    await addDoc(collection(database, "users", npub, "turns"), {
      role: "user",
      lang,
      text: text.trim(),
      trans_en: "",
      trans_es: "",
      pairs: [],
      origin: "realtime",
      createdAt: serverTimestamp(),
      createdAtClient: now,
    });

    lastUserSaveRef.current = { text, ts: now };
  }

  /* ---------------------------
     Save profile (includes helpRequest + pronunciation)
  --------------------------- */
  async function saveProfile(partial = {}) {
    if (!hydrated) return; // ✅ don't save until profile is loaded
    const npub = strongNpub(user);
    if (!npub) return;

    const nextProgress = {
      level: partial.level ?? levelRef.current,
      supportLang: partial.supportLang ?? supportLangRef.current,
      voice: partial.voice ?? voiceRef.current,
      voicePersona: partial.voicePersona ?? voicePersonaRef.current,
      targetLang: partial.targetLang ?? targetLangRef.current,
      showTranslations: partial.showTranslations ?? showTranslations,
      helpRequest:
        typeof partial.helpRequest === "string"
          ? partial.helpRequest
          : helpRequestRef.current || "",
      practicePronunciation:
        typeof partial.practicePronunciation === "boolean"
          ? partial.practicePronunciation
          : !!practicePronunciationRef.current,
    };

    await setDoc(
      doc(database, "users", npub),
      {
        local_npub: npub,
        updatedAt: isoNow(),
        helpRequest: nextProgress.helpRequest || "",
        progress: nextProgress,
      },
      { merge: true }
    );

    // ✅ keep the zustand store in sync without clobbering
    try {
      const st = useUserStore.getState?.();
      const mergedProgress = { ...(st?.user?.progress || {}), ...nextProgress };
      if (st?.patchUser) {
        st.patchUser({
          helpRequest: nextProgress.helpRequest || "",
          progress: mergedProgress,
        });
      } else if (st?.setUser) {
        const prev = st.user || {};
        st.setUser({
          ...prev,
          helpRequest: nextProgress.helpRequest || "",
          progress: mergedProgress,
        });
      }
    } catch (e) {
      console.warn("Store sync (progress) skipped:", e?.message || e);
    }
  }

  /* ---------------------------
     Delete conversation
  --------------------------- */
  async function deleteConversation() {
    const npub = strongNpub(user);
    if (!npub) return;
    const confirmed = window.confirm(ui.ra_delete_confirm);
    if (!confirmed) return;

    try {
      const colRef = collection(database, "users", npub, "turns");
      while (true) {
        const snap = await getDocs(query(colRef, limit(500)));
        if (snap.empty) break;
        const batch = writeBatch(database);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      setHistory([]);
      //   toast({ title: ui.ra_toast_delete_success, status: "success" });
    } catch (e) {
      console.error(e);
    }
  }

  /* ---------------------------
     Render helpers
  --------------------------- */
  function isDuplicateOfPersistedUser(ephem) {
    if (!ephem?.textFinal) return false;
    const txt = ephem.textFinal.trim();
    if (!txt) return false;
    const threshold = 4000; // ms
    return history.some(
      (h) =>
        h.role === "user" &&
        (h.textFinal || "").trim() === txt &&
        Math.abs((h.ts || 0) - (ephem.ts || 0)) < threshold
    );
  }

  // Single merged timeline (ephemerals win for same id)
  const timeline = useMemo(() => {
    const map = new Map();
    // seed with persisted
    for (const h of history) map.set(h.id, { ...h, source: "hist" });
    // overlay ephemerals (skip dup user messages)
    for (const m of messages) {
      if (m.role === "user" && isDuplicateOfPersistedUser(m)) continue;
      map.set(m.id, { ...(map.get(m.id) || {}), ...m, source: "ephem" });
    }
    return Array.from(map.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  }, [messages, history]);

  /* ---------------------------
     UI strings (more)
  --------------------------- */
  const toggleLabel =
    translations[uiLang].onboarding_translations_toggle?.replace(
      "{language}",
      translations[uiLang][`language_${secondaryPref}`]
    ) || (uiLang === "es" ? "Mostrar traducción" : "Show translation");

  const tHelpLabel =
    ui?.ra_help_label ||
    (uiLang === "es"
      ? "¿En qué te gustaría ayuda?"
      : "What would you like help with?");
  const tHelpHelp =
    ui?.ra_help_help ||
    (uiLang === "es"
      ? "Describe tu meta o contexto (esto guía la experiencia)."
      : "Describe your goal or context (this guides the experience).");
  const tHelpPlaceholder =
    ui?.ra_help_placeholder ||
    (uiLang === "es"
      ? "Ej.: practicar conversación para entrevistas de trabajo; repasar tiempos pasados; español para turismo…"
      : "e.g., conversational practice for job interviews; past tenses review; travel Spanish…");

  // ✅ Pronunciation strings (fallbacks)
  const tPronLabel =
    ui?.ra_pron_label ||
    (uiLang === "es" ? "Practicar pronunciación" : "Practice pronunciation");
  const tPronHelp =
    ui?.ra_pron_help ||
    (uiLang === "es"
      ? "Añade una micro-pista y una repetición lenta en cada turno."
      : "Adds a tiny cue and one slow repetition each turn.");

  const xpLevelNumber = Math.floor(xp / 100) + 1; // Level increases every 100 XP
  const xpRemainingToLevel = 100 - (xp % 100);

  if (showPasscodeModal) {
    return (
      <PasscodePage
        userLanguage={uiLang}
        setShowPasscodeModal={setShowPasscodeModal}
      />
    );
  }
  return (
    <Box
      minH="100vh"
      bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)"
      color="white"
      position="relative"
      pb="120px"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Text
          fontSize={["lg", "xl"]}
          fontWeight="700"
          noOfLines={1}
          flex="1"
          mr={2}
          px={4}
          pt={4}
          color="#14b8a6"
          textAlign="center"
        >
          {appTitle} (BETA)
        </Text>
      </motion.div>

      <Flex px={4} pt={2} align="center" justify="space-between" gap={2}></Flex>

      {/* Status pills */}
      <Box px={4} mt={2}>
        <HStack
          spacing={2}
          overflowX="auto"
          pb={1}
          sx={{
            "::-webkit-scrollbar": { display: "none" },
            msOverflowStyle: "none",
            scrollbarWidth: "none",
          }}
        >
          {/* Commented out badges for cleaner look */}
        </HStack>
      </Box>

      {/* Robot */}
      <VStack align="stretch" spacing={3} px={4} mt={2}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <RobotBuddyPro
            state={uiState}
            loudness={uiState === "listening" ? volume : 0}
            mood={mood}
            variant="abstract"
          />
        </motion.div>
      </VStack>

      <HStack spacing={2} display="flex" justifyContent={"center"} mt={6}>
        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <IconButton
            aria-label={ui.ra_btn_settings}
            color="white"
            icon={<SettingsIcon />}
            size="sm"
            bg="rgba(255, 255, 255, 0.05)"
            border="1px solid rgba(255, 255, 255, 0.1)"
            borderRadius="12px"
            _hover={{
              bg: "rgba(20, 184, 166, 0.1)",
              borderColor: "rgba(20, 184, 166, 0.3)",
              transform: "translateY(-1px)",
            }}
            onClick={settings.onOpen}
            mr={3}
            width="40px"
            height="40px"
          />
        </motion.div>
        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <IconButton
            aria-label={ui.ra_btn_delete_convo}
            icon={<DeleteIcon />}
            size="sm"
            bg="rgba(239, 68, 68, 0.1)"
            border="1px solid rgba(239, 68, 68, 0.2)"
            color="#ef4444"
            borderRadius="12px"
            _hover={{
              bg: "rgba(239, 68, 68, 0.2)",
              borderColor: "rgba(239, 68, 68, 0.3)",
              transform: "translateY(-1px)",
            }}
            onClick={deleteConversation}
            width="40px"
            height="40px"
          />
        </motion.div>
      </HStack>

      {/* 🎯 Active goal display */}
      <Box px={4} mt={3} display="flex" justifyContent="center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Box
            bg="rgba(255, 255, 255, 0.05)"
            backdropFilter="blur(20px)"
            p={5}
            rounded="20px"
            border="1px solid rgba(255, 255, 255, 0.1)"
            width="100%"
            maxWidth="400px"
            boxShadow="0 8px 32px rgba(0, 0, 0, 0.3)"
            _hover={{
              bg: "rgba(255, 255, 255, 0.08)",
              borderColor: "rgba(20, 184, 166, 0.2)",
            }}
            transition="all 0.3s ease"
          >
            <HStack justify="space-between" align="center" mb={2}>
              <HStack>
                <Badge 
                  colorScheme="yellow" 
                  variant="subtle" 
                  fontSize="10px"
                  bg="rgba(251, 191, 36, 0.1)"
                  color="#fbbf24"
                  border="1px solid rgba(251, 191, 36, 0.2)"
                  borderRadius="8px"
                  px={2}
                  py={1}
                >
                  {tGoalLabel}
                </Badge>
                <Text fontSize="xs" color="#cbd5e1" fontWeight="500">
                  {goalTitleForUI(currentGoal) || "—"}
                </Text>
              </HStack>
              <HStack>
                {/* Commented out for cleaner look */}
              </HStack>
            </HStack>
            {!!currentGoal && (
              <Text fontSize="xs" color="#94a3b8" mb={3}>
                <strong style={{ color: "#14b8a6" }}>{tGoalCriteria}</strong>{" "}
                {goalRubricForUI(currentGoal)}
              </Text>
            )}
            {goalFeedback ? (
              <Text fontSize="xs" mt={2} color="#cbd5e1" bg="rgba(20, 184, 166, 0.1)" p={2} rounded="8px" border="1px solid rgba(20, 184, 166, 0.2)">
                💡 {goalFeedback}
              </Text>
            ) : null}

            {/* 🆕 Level progress bar under goal UI */}
            <Box mt={4}>
              <HStack justifyContent="space-between" mb={2}>
                <Badge 
                  colorScheme="cyan" 
                  variant="subtle" 
                  fontSize="10px"
                  bg="rgba(6, 182, 212, 0.1)"
                  color="#06b6d4"
                  border="1px solid rgba(6, 182, 212, 0.2)"
                  borderRadius="8px"
                  px={2}
                  py={1}
                >
                  {uiLang === "es" ? "Nivel" : "Level"} {xpLevelNumber}
                </Badge>
                <Badge 
                  colorScheme="teal" 
                  variant="subtle" 
                  fontSize="10px"
                  bg="rgba(20, 184, 166, 0.1)"
                  color="#14b8a6"
                  border="1px solid rgba(20, 184, 166, 0.2)"
                  borderRadius="8px"
                  px={2}
                  py={1}
                >
                  {ui.ra_label_xp} {xp}
                </Badge>
              </HStack>
              <WaveBar value={progressPct} />
            </Box>
          </Box>
        </motion.div>
      </Box>

      {/* Timeline — newest first */}
      <VStack align="stretch" spacing={4} px={4} mt={4}>
        <AnimatePresence>
          {timeline.map((m, index) => {
            const isUser = m.role === "user";
            if (isUser) {
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 50 }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                >
                  <RowRight>
                    <UserBubble label={ui.ra_label_you} text={m.textFinal} />
                  </RowRight>
                </motion.div>
              );
            }

            const primaryText = (m.textFinal || "") + (m.textStream || "");
            const lang = m.lang || targetLang || "es";
            const primaryLabel = languageNameFor(lang);

            const secondaryText =
              m.source === "hist"
                ? (secondaryPref === "es" ? m.trans_es : m.trans_en) || ""
                : m.translation || "";

            const secondaryLabel =
              lang === "es"
                ? translations[uiLang].language_en
                : translations[uiLang][`language_${secondaryPref}`];

            const isTranslating =
              !secondaryText && !!m.textStream && showTranslations;

            if (!primaryText.trim()) return null;

            const hasCached =
              audioCacheIndexRef.current.has(m.id) || !!m.hasAudio;
            const canReplay = hasCached || status === "connected";

            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -50 }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
              >
                <RowLeft>
                  <Box position="relative">
                    <AlignedBubble
                      primaryLabel={primaryLabel}
                      secondaryLabel={secondaryLabel}
                      primaryText={primaryText}
                      secondaryText={showTranslations ? secondaryText : ""}
                      pairs={m.pairs || []}
                      showSecondary={showTranslations}
                      isTranslating={isTranslating}
                    />
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <IconButton
                        aria-label={tRepeat}
                        title={tRepeat}
                        icon={<CiRepeat />}
                        size="xs"
                        bg="rgba(255, 255, 255, 0.1)"
                        border="1px solid rgba(255, 255, 255, 0.2)"
                        color="white"
                        borderRadius="8px"
                        position="absolute"
                        top="8px"
                        right="8px"
                        opacity={0.9}
                        isDisabled={!canReplay}
                        isLoading={replayingMid === m.id}
                        onClick={() =>
                          replayMessageAudio(
                            m.id,
                            (m.textFinal || "").trim() || (m.textStream || "").trim()
                          )
                        }
                        height="32px"
                        width="32px"
                        _hover={{
                          bg: "rgba(20, 184, 166, 0.2)",
                          borderColor: "rgba(20, 184, 166, 0.3)",
                        }}
                      />
                    </motion.div>
                  </Box>
                </RowLeft>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </VStack>

      {/* Bottom dock */}
      <Center
        position="fixed"
        bottom="22px"
        left="0"
        right="0"
        zIndex={30}
        px={4}
      >
        <HStack spacing={3} w="100%" maxW="560px" justify="center">
          {status !== "connected" ? (
            <>
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                style={{ flex: 1 }}
              >
                <Button
                  onClick={start}
                  size="lg"
                  height="64px"
                  px="8"
                  rounded="full"
                  w="100%"
                  bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)"
                  color="white"
                  fontWeight="600"
                  fontSize="lg"
                  boxShadow="0 10px 30px rgba(20, 184, 166, 0.4)"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                  _hover={{
                    bg: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                    transform: "translateY(-2px)",
                    boxShadow: "0 15px 40px rgba(20, 184, 166, 0.5)",
                  }}
                  _active={{
                    transform: "translateY(0)",
                  }}
                  transition="all 0.2s ease"
                >
                  <PiMicrophoneStageDuotone /> &nbsp;{" "}
                  {status === "connecting"
                    ? ui.ra_btn_connecting
                    : ui.ra_btn_connect}
                </Button>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Button
                  onClick={() => navigate('/story')}
                  size="lg"
                  height="64px"
                  px="6"
                  rounded="full"
                  bg="linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)"
                  color="white"
                  fontWeight="600"
                  fontSize="md"
                  boxShadow="0 10px 30px rgba(139, 92, 246, 0.4)"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                  _hover={{
                    bg: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                    transform: "translateY(-2px)",
                    boxShadow: "0 15px 40px rgba(139, 92, 246, 0.5)",
                  }}
                  _active={{
                    transform: "translateY(0)",
                  }}
                  transition="all 0.2s ease"
                >
                  <FaBookOpen /> &nbsp; Story Mode
                </Button>
              </motion.div>
            </>
          ) : (
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                onClick={stop}
                size="lg"
                height="64px"
                px="8"
                rounded="full"
                w="100%"
                bg="linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                color="white"
                fontWeight="600"
                fontSize="lg"
                boxShadow="0 10px 30px rgba(239, 68, 68, 0.4)"
                border="1px solid rgba(255, 255, 255, 0.1)"
                backdropFilter="blur(20px)"
                _hover={{
                  bg: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
                  transform: "translateY(-2px)",
                  boxShadow: "0 15px 40px rgba(239, 68, 68, 0.5)",
                }}
                _active={{
                  transform: "translateY(0)",
                }}
                transition="all 0.2s ease"
              >
                <FaStop /> &nbsp; {ui.ra_btn_disconnect}
              </Button>
            </motion.div>
          )}
        </HStack>
      </Center>

      {err && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Box px={4} pt={2}>
            <Box
              as="pre"
              bg="rgba(239, 68, 68, 0.1)"
              border="1px solid rgba(239, 68, 68, 0.2)"
              p={4}
              borderRadius="12px"
              whiteSpace="pre-wrap"
              color="#fecaca"
              fontSize="sm"
              backdropFilter="blur(10px)"
            >
              {err}
            </Box>
          </Box>
        </motion.div>
      )}

      {/* Settings */}
      <Drawer
        isOpen={settings.isOpen}
        placement="bottom"
        onClose={settings.onClose}
      >
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
            <DrawerHeader 
              pb={2} 
              fontSize="xl" 
              fontWeight="600"
              color="#14b8a6"
              borderBottom="1px solid rgba(255, 255, 255, 0.1)"
            >
              {ui.ra_settings_title}
            </DrawerHeader>
            <DrawerBody pb={6}>
              <VStack align="stretch" spacing={4}>
                <Wrap spacing={3}>
                    <Select
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius="12px"
                      color="white"
                      size="md"
                      w="auto"
                      _focus={{
                        borderColor: "#14b8a6",
                        boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                      }}
                    >
                      <option value="beginner" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_level_beginner}
                      </option>
                      <option value="intermediate" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_level_intermediate}
                      </option>
                      <option value="advanced" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_level_advanced}
                      </option>
                    </Select>

                    <Select
                      value={supportLang}
                      onChange={(e) => setSupportLang(e.target.value)}
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius="12px"
                      color="white"
                      size="md"
                      w="auto"
                      _focus={{
                        borderColor: "#14b8a6",
                        boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                      }}
                    >
                      <option value="en" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_support_en}
                      </option>
                      <option value="es" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_support_es}
                      </option>
                      <option value="zh" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_support_zh}
                      </option>
                    </Select>

                    <Select
                      value={voice}
                      onChange={(e) => {
                        setVoice(e.target.value);
                        applyVoiceNow({ speakProbe: true });
                      }}
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius="12px"
                      color="white"
                      size="md"
                      w="auto"
                      _focus={{
                        borderColor: "#14b8a6",
                        boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                      }}
                    >
                      <option value="alloy" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_alloy}
                      </option>
                      <option value="ash" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_ash}
                      </option>
                      <option value="ballad" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_ballad}
                      </option>
                      <option value="coral" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_coral}
                      </option>
                      <option value="echo" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_echo}
                      </option>
                      <option value="sage" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_sage}
                      </option>
                      <option value="shimmer" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_shimmer}
                      </option>
                      <option value="verse" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_voice_verse}
                      </option>
                    </Select>

                    <Select
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius="12px"
                      color="white"
                      size="md"
                      w="auto"
                      title={translations[uiLang].onboarding_practice_label_title}
                      _focus={{
                        borderColor: "#14b8a6",
                        boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                      }}
                    >
                      <option value="es" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_practice_es}
                      </option>
                      <option value="en" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_practice_en}
                      </option>
                      <option value="zh" style={{ background: "#0f0f23", color: "white" }}>
                        {translations[uiLang].onboarding_practice_zh}
                      </option>
                    </Select>
                  </Wrap>

                {/* ✅ Pronunciation coaching toggle */}
                <HStack 
                  bg="rgba(255, 255, 255, 0.05)" 
                  p={4} 
                  rounded="16px" 
                  justify="space-between"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                >
                    <Box>
                      <Text fontSize="sm" fontWeight="500" color="#14b8a6" mb={1}>
                        {tPronLabel}
                      </Text>
                      <Text fontSize="xs" color="#94a3b8">
                        {tPronHelp}
                      </Text>
                    </Box>
                    <Switch
                      isChecked={practicePronunciation}
                      onChange={(e) => {
                        setPracticePronunciation(e.target.checked);
                        scheduleSessionUpdate();
                        scheduleProfileSave();
                      }}
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
                  </HStack>

                {/* Persona */}
                <Box 
                  bg="rgba(255, 255, 255, 0.05)" 
                  p={4} 
                  rounded="16px"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                >
                    <Text fontSize="sm" fontWeight="500" color="#14b8a6" mb={2}>
                      {ui.ra_persona_label}
                    </Text>
                    <Input
                      value={voicePersona}
                      onChange={(e) => setVoicePersona(e.target.value)}
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius="12px"
                      color="white"
                      placeholder={
                        ui.ra_persona_placeholder?.replace(
                          "{example}",
                          translations[uiLang].onboarding_persona_default_example
                        ) ||
                        `e.g., ${translations[uiLang].onboarding_persona_default_example}`
                      }
                      _focus={{
                        borderColor: "#14b8a6",
                        boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                      }}
                      _placeholder={{
                        color: "#94a3b8",
                      }}
                    />
                    <Text fontSize="xs" color="#94a3b8" mt={2}>
                      {ui.ra_persona_help}
                    </Text>
                  </Box>

                {/* Help Request field */}
                <Box 
                  bg="rgba(255, 255, 255, 0.05)" 
                  p={4} 
                  rounded="16px"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                >
                    <Text fontSize="sm" fontWeight="500" color="#14b8a6" mb={2}>
                      {tHelpLabel}
                    </Text>
                    <Textarea
                      value={helpRequest}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 600);
                        setHelpRequest(v);
                      }}
                      onBlur={() => {
                        scheduleSessionUpdate();
                        scheduleProfileSave();
                      }}
                      bg="rgba(255, 255, 255, 0.05)"
                      border="1px solid rgba(255, 255, 255, 0.1)"
                      borderRadius="12px"
                      color="white"
                      placeholder={tHelpPlaceholder}
                      minH="100px"
                      _focus={{
                        borderColor: "#14b8a6",
                        boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                      }}
                      _placeholder={{
                        color: "#94a3b8",
                      }}
                    />
                    <Text fontSize="xs" color="#94a3b8" mt={2}>
                      {tHelpHelp}
                    </Text>
                  </Box>

                {/* Translations toggle */}
                <HStack 
                  bg="rgba(255, 255, 255, 0.05)" 
                  p={4} 
                  rounded="16px" 
                  justify="space-between"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                >
                    <Text fontSize="sm" fontWeight="500" color="#14b8a6" mr={2}>
                      {toggleLabel}
                    </Text>
                    <Switch
                      isChecked={showTranslations}
                      onChange={(e) => setShowTranslations(e.target.checked)}
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
                  </HStack>

                {/* VAD slider */}
                <Box 
                  bg="rgba(255, 255, 255, 0.05)" 
                  p={4} 
                  rounded="16px"
                  border="1px solid rgba(255, 255, 255, 0.1)"
                  backdropFilter="blur(20px)"
                >
                    <HStack justify="space-between" mb={3}>
                      <Text fontSize="sm" fontWeight="500" color="#14b8a6">{ui.ra_vad_label}</Text>
                      <Text fontSize="sm" color="#cbd5e1">
                        {pauseMs} ms
                      </Text>
                    </HStack>
                    <Slider
                      aria-label="pause-slider"
                      min={200}
                      max={2000}
                      step={100}
                      value={pauseMs}
                      onChange={(val) => {
                        setPauseMs(val);
                        sendSessionUpdate();
                      }}
                    >
                      <SliderTrack bg="rgba(255, 255, 255, 0.1)">
                        <SliderFilledTrack bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)" />
                      </SliderTrack>
                      <SliderThumb 
                        bg="white" 
                        boxShadow="0 2px 4px rgba(0, 0, 0, 0.3)"
                        _focus={{
                          boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                        }}
                      />
                    </Slider>
                  </Box>
                
                {/* Done Button */}
                <Box pt={4}>
                  <Button
                    size="lg"
                    bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)"
                    color="white"
                    border="none"
                    borderRadius="16px"
                    fontWeight="600"
                    fontSize="lg"
                    py={6}
                    w="100%"
                    onClick={settings.onClose}
                    _hover={{
                      bg: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                      transform: "translateY(-2px)",
                      boxShadow: "0 8px 25px rgba(20, 184, 166, 0.4)",
                    }}
                    _active={{
                      transform: "translateY(0)",
                    }}
                    transition="all 0.2s ease"
                    boxShadow="0 10px 30px rgba(20, 184, 166, 0.4)"
                  >
                    Done
                  </Button>
                </Box>
              </VStack>
            </DrawerBody>
          </DrawerContent>
      </Drawer>

      {/* remote live audio sink */}
      <audio ref={audioRef} />
      {/* local playback for cached clips */}
      <audio ref={playbackRef} />
    </Box>
  );
}
