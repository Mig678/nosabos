import { useEffect, useRef, useState, useMemo } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  Box,
  HStack,
  Button,
  Text,
  Spacer,
  Badge,
  useToast,
  IconButton,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Flex,
  Divider,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  VStack,
  InputGroup,
  Input,
  InputRightElement,
  Switch,
} from "@chakra-ui/react";
import { SettingsIcon, DeleteIcon } from "@chakra-ui/icons";
import { CiRepeat, CiUser, CiSquarePlus } from "react-icons/ci";
import { MdOutlineFileUpload } from "react-icons/md";
import { IoIosMore } from "react-icons/io";

import { LuBadgeCheck } from "react-icons/lu";
import { GoDownload } from "react-icons/go";

import "./App.css";
import Onboarding from "./components/Onboarding";

import RobotBuddyPro from "./components/RobotBuddyPro";
import { useDecentralizedIdentity } from "./hooks/useDecentralizedIdentity";
import { database } from "./firebaseResources/firebaseResources";
import useUserStore from "./hooks/useUserStore";
import { translations } from "./utils/translation";
import RealTimeTest from "./components/RealTimeTest";

/* ---------------------------
   Helpers
--------------------------- */
const isTrue = (v) => v === true || v === "true" || v === 1 || v === "1";

/* ---------------------------
   Firestore helpers
--------------------------- */
async function ensureOnboardingField(database, id, data) {
  const hasNested = data?.onboarding && typeof data.onboarding === "object";
  const hasCompleted =
    hasNested &&
    Object.prototype.hasOwnProperty.call(data.onboarding, "completed");
  const hasLegacyTopLevel = Object.prototype.hasOwnProperty.call(
    data || {},
    "onboardingCompleted"
  );

  if (!hasCompleted && !hasLegacyTopLevel) {
    await setDoc(
      doc(database, "users", id),
      { onboarding: { completed: false } },
      { merge: true }
    );
    const snap = await getDoc(doc(database, "users", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : data;
  }
  return data;
}

async function loadUserObjectFromDB(database, id) {
  if (!id) return null;
  try {
    const ref = doc(database, "users", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    let userData = { id: snap.id, ...snap.data() };
    userData = await ensureOnboardingField(database, id, userData);
    return userData;
  } catch (e) {
    console.error("loadUserObjectFromDB failed:", e);
    return null;
  }
}

/* ---------------------------
   App
--------------------------- */
export default function App() {
  const [isLoadingApp, setIsLoadingApp] = useState(false);
  const initRef = useRef(false); // guard StrictMode double-run in dev
  const toast = useToast();

  // Reflect local creds so children re-render when keys change
  const [activeNpub, setActiveNpub] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("local_npub") || ""
      : ""
  );
  const [activeNsec, setActiveNsec] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("local_nsec") || ""
      : ""
  );

  // UI/App language state (persisted to Firestore + localStorage)
  const [appLanguage, setAppLanguage] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("appLanguage") || "en"
      : "en"
  );

  // Global user store
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);

  // DID / auth
  const { generateNostrKeys, auth } = useDecentralizedIdentity(
    localStorage.getItem("local_npub"),
    localStorage.getItem("local_nsec")
  );

  /** Establish or sync identity and ensure a user doc exists with onboarding flag */
  const connectDID = async () => {
    setIsLoadingApp(true);
    try {
      let id = (localStorage.getItem("local_npub") || "").trim();
      let userDoc = null;

      if (id) {
        userDoc = await loadUserObjectFromDB(database, id);
        if (!userDoc) {
          // first time syncing a locally-present id → create minimal doc
          const base = {
            local_npub: id,
            createdAt: new Date().toISOString(),
            onboarding: { completed: false },
            appLanguage:
              localStorage.getItem("appLanguage") === "es" ? "es" : "en",
            helpRequest: "", // mirror at top-level
            practicePronunciation: false, // ✅ NEW default mirror
          };
          await setDoc(doc(database, "users", id), base, { merge: true });
          userDoc = await loadUserObjectFromDB(database, id);
        }
      } else {
        // No local id → generate keys, write user doc
        const did = await generateNostrKeys(); // writes npub/nsec to localStorage
        id = did.npub;
        const base = {
          local_npub: id,
          createdAt: new Date().toISOString(),
          onboarding: { completed: false },
          appLanguage:
            localStorage.getItem("appLanguage") === "es" ? "es" : "en",
          helpRequest: "", // mirror at top-level
          practicePronunciation: false, // ✅ NEW default mirror
        };
        await setDoc(doc(database, "users", id), base, { merge: true });
        userDoc = await loadUserObjectFromDB(database, id);
      }

      // Reflect creds
      setActiveNpub(id);
      setActiveNsec(localStorage.getItem("local_nsec") || "");

      // Hydrate store + UI language
      if (userDoc) {
        const uiLang =
          userDoc.appLanguage === "es"
            ? "es"
            : localStorage.getItem("appLanguage") === "es"
            ? "es"
            : "en";
        setAppLanguage(uiLang);
        localStorage.setItem("appLanguage", uiLang);

        setUser?.(userDoc);
      }
    } catch (e) {
      console.error("connectDID error:", e);
    } finally {
      // If no user was set, create a default user to prevent infinite loading
      if (!user) {
        const defaultUser = {
          id: "default",
          local_npub: "",
          createdAt: new Date().toISOString(),
          onboarding: { completed: false },
          appLanguage: "en"
        };
        setUser?.(defaultUser);
      }
      setIsLoadingApp(false);
    }
  };

  /** Persist app language to Firestore + localStorage + store */
  const saveAppLanguage = async (lang = "en") => {
    const id = (localStorage.getItem("local_npub") || "").trim();
    const norm = lang === "es" ? "es" : "en";
    setAppLanguage(norm);
    try {
      localStorage.setItem("appLanguage", norm);
    } catch {}
    if (!id) return;
    try {
      const now = new Date().toISOString();
      await setDoc(
        doc(database, "users", id),
        { appLanguage: norm, updatedAt: now },
        { merge: true }
      );
      if (user) setUser?.({ ...user, appLanguage: norm, updatedAt: now });
    } catch (e) {
      console.error("Failed to save appLanguage:", e);
      const failT = translations[norm];
      toast({
        status: "error",
        title: failT.toast_save_lang_failed,
        description: String(e?.message || e),
      });
    }
  };

  /** Save onboarding payload → progress, flip completed → reload user */
  const handleOnboardingComplete = async (payload = {}) => {
    try {
      const id = (localStorage.getItem("local_npub") || "").trim();
      if (!id) return;

      const safe = (v, fallback) =>
        v === undefined || v === null ? fallback : v;

      // Challenge strings from translation object (keep UI/DB consistent)
      const CHALLENGE = {
        en: translations.en.onboarding_challenge_default,
        es: translations.es.onboarding_challenge_default,
      };

      // Normalize / validate incoming payload
      const normalized = {
        level: safe(payload.level, "beginner"),
        supportLang: ["en", "es", "bilingual"].includes(payload.supportLang)
          ? payload.supportLang
          : "en",
        // ✅ NEW boolean with default false
        practicePronunciation:
          typeof payload.practicePronunciation === "boolean"
            ? payload.practicePronunciation
            : false,
        voice: safe(payload.voice, "alloy"), // GPT Realtime voice ids
        voicePersona: safe(
          payload.voicePersona,
          translations.en.onboarding_persona_default_example
        ),
        targetLang: ["nah", "es", "en"].includes(payload.targetLang)
          ? payload.targetLang
          : "es",
        showTranslations:
          typeof payload.showTranslations === "boolean"
            ? payload.showTranslations
            : true,
        // what the user wants help with (limit length for safety)
        helpRequest: String(safe(payload.helpRequest, "")).slice(0, 600),
        challenge:
          payload?.challenge?.en && payload?.challenge?.es
            ? payload.challenge
            : { ...CHALLENGE },
        xp: 0,
        streak: 0,
      };

      const now = new Date().toISOString();

      // Best available UI language to persist
      const uiLangForPersist =
        (user?.appLanguage === "es" && "es") ||
        (localStorage.getItem("appLanguage") === "es" && "es") ||
        (appLanguage === "es" ? "es" : "en");

      await setDoc(
        doc(database, "users", id),
        {
          local_npub: id,
          updatedAt: now,
          appLanguage: uiLangForPersist, // ✅ persist selected UI language
          onboarding: { completed: true, completedAt: now },
          lastGoal: normalized.challenge.en, // keep English for lastGoal label
          xp: 0,
          streak: 0,
          // mirrors for quick reads
          helpRequest: normalized.helpRequest,
          practicePronunciation: normalized.practicePronunciation, // ✅ NEW mirror
          // progress holds all learning prefs
          progress: { ...normalized },
        },
        { merge: true }
      );

      // Refresh user in store so gating flips and RA loads with the new progress/lang
      const fresh = await loadUserObjectFromDB(database, id);
      if (fresh) setUser?.(fresh);
    } catch (e) {
      console.error("Failed to complete onboarding:", e);
    }
  };

  // Boot once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    connectDID();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync appLanguage from store if it changes elsewhere (e.g. Settings)
  useEffect(() => {
    if (!user) return;
    const fromStore =
      user.appLanguage === "es"
        ? "es"
        : localStorage.getItem("appLanguage") === "es"
        ? "es"
        : "en";
    setAppLanguage(fromStore);
    localStorage.setItem("appLanguage", fromStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.appLanguage]);

  // Gate: only show RealtimeAgent when we *explicitly* see onboarding completed
  const onboardingDone = useMemo(() => {
    const nested = user?.onboarding?.completed;
    const legacy = user?.onboardingCompleted;
    return isTrue(nested) || isTrue(legacy);
  }, [user]);

  const needsOnboarding = useMemo(() => !onboardingDone, [onboardingDone]);

  // Top bar language switch + account controls
  const TopBar = () => {
    const t = translations[appLanguage];
    const [currentId, setCurrentId] = useState(activeNpub || "");
    const [currentSecret, setCurrentSecret] = useState(activeNsec || "");
    const [switchNsec, setSwitchNsec] = useState("");
    const [isSwitching, setIsSwitching] = useState(false);
    const coachSheet = useDisclosure();
    const account = useDisclosure();
    const install = useDisclosure();
    const toast = useToast();

    async function copy(text, label = t.toast_copied) {
      try {
        await navigator.clipboard.writeText(text || "");
        toast({ title: label, status: "success", duration: 1400 });
      } catch (e) {
        toast({
          title: t.toast_copy_failed,
          description: String(e?.message || e),
          status: "error",
        });
      }
    }
    const isoNow = () => {
      try {
        return new Date().toISOString();
      } catch {
        return String(Date.now());
      }
    };

    async function switchAccount() {
      const nsec = (switchNsec || "").trim();
      if (!nsec) {
        toast({ title: t.toast_paste_nsec, status: "warning" });
        return;
      }
      if (!nsec.startsWith("nsec")) {
        toast({
          title: t.toast_invalid_key,
          description: t.toast_must_start_nsec,
          status: "error",
        });
        return;
      }
      setIsSwitching(true);
      try {
        if (typeof auth !== "function")
          throw new Error("auth(nsec) is not available.");
        const res = await auth(nsec);
        const npub = res?.user?.npub || localStorage.getItem("local_npub");
        if (!npub?.startsWith("npub"))
          throw new Error("Could not derive npub from the secret key.");

        await setDoc(
          doc(database, "users", npub),
          { local_npub: npub, createdAt: isoNow() },
          { merge: true }
        );

        // Reflect to localStorage (source of truth for connectDID)
        localStorage.setItem("local_npub", npub);
        localStorage.setItem("local_nsec", nsec);

        // Instant UI reflect
        setActiveNpub(npub);
        setActiveNsec(nsec);
        setCurrentId(npub);
        setCurrentSecret(nsec);
        setSwitchNsec("");

        account.onClose?.();
        toast({ title: t.toast_switched_account, status: "success" });

        // 🔁 Reload user/progress for the new account
        await connectDID();
      } catch (e) {
        console.error("switchAccount error:", e);
        toast({
          title: t.toast_switch_failed,
          description: e?.message || String(e),
          status: "error",
        });
      } finally {
        setIsSwitching(false);
      }
    }

    // Keep TopBar’s local copy in sync with parent state
    useEffect(() => {
      setCurrentId(activeNpub || "");
    }, [activeNpub]);
    useEffect(() => {
      setCurrentSecret(activeNsec || "");
    }, [activeNsec]);

    return (
      <>
        <HStack
          as="header"
          w="100%"
          px={3}
          py={2}
          bg="gray.900"
          color="gray.100"
          borderBottom="1px solid"
          borderColor="gray.700"
          position="sticky"
          top={0}
          zIndex={100}
        >
          <Spacer />
          <HStack spacing={1}>
            <IconButton
              aria-label={t.app_install_aria}
              icon={<GoDownload size={20} />}
              size="md"
              onClick={install.onOpen}
              colorScheme="blue.800"
              mr={1}
            />
            <IconButton
              aria-label={t.app_account_aria}
              icon={<CiUser size={20} />}
              size="md"
              onClick={account.onOpen}
              colorScheme="blue.800"
              mr={2}
            />
            <HStack spacing={2} align="center">
              <Text
                fontSize="sm"
                color={appLanguage === "en" ? "teal.300" : "gray.400"}
              >
                EN
              </Text>
              <Switch
                colorScheme="teal"
                isChecked={appLanguage === "es"}
                onChange={() =>
                  saveAppLanguage(appLanguage === "en" ? "es" : "en")
                }
              />
              <Text
                fontSize="sm"
                color={appLanguage === "es" ? "teal.300" : "gray.400"}
              >
                ES
              </Text>
            </HStack>
          </HStack>
        </HStack>

        <Modal isOpen={install.isOpen} onClose={install.onClose} isCentered>
          <ModalOverlay />
          <ModalContent bg="gray.900" color="gray.100">
            <ModalHeader>{t.app_install_title}</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <Flex direction="column" pb={0}>
                <IoIosMore size={32} />
                <Text mt={2}>{t.app_install_step1}</Text>
              </Flex>
              <Divider my={6} />

              <Flex direction="column" pb={0}>
                <MdOutlineFileUpload size={32} />
                <Text mt={2}>{t.app_install_step2}</Text>
              </Flex>
              <Divider my={6} />

              <Flex direction="column" pb={0}>
                <CiSquarePlus size={32} />
                <Text mt={2}>{t.app_install_step3}</Text>
              </Flex>
              <Divider my={6} />

              <Flex direction="column" pb={0}>
                <LuBadgeCheck size={32} />
                <Text mt={2}>{t.app_install_step4}</Text>
              </Flex>
            </ModalBody>

            <ModalFooter>
              <Button
                variant="ghost"
                onMouseDown={install.onClose}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") install.onClose();
                }}
              >
                {t.app_close}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Drawer
          isOpen={account.isOpen}
          placement="bottom"
          onClose={account.onClose}
        >
          <DrawerOverlay bg="blackAlpha.600" />
          <DrawerContent bg="gray.900" color="gray.100" borderTopRadius="24px">
            <DrawerHeader pb={2}>{t.app_account_title}</DrawerHeader>
            <DrawerBody pb={6}>
              <VStack align="stretch" spacing={3}>
                <Box bg="gray.800" p={3} rounded="md">
                  <Text fontSize="sm" mb={1}>
                    {t.app_your_id}
                  </Text>
                  <InputGroup>
                    <Input
                      value={currentId || ""}
                      readOnly
                      bg="gray.700"
                      placeholder={t.app_id_placeholder}
                    />
                    <InputRightElement width="4.5rem">
                      <Button
                        h="1.75rem"
                        size="sm"
                        onClick={() => copy(currentId, t.toast_id_copied)}
                        isDisabled={!currentId}
                      >
                        {t.app_copy}
                      </Button>
                    </InputRightElement>
                  </InputGroup>
                </Box>

                <Box bg="gray.800" p={3} rounded="md">
                  <Text fontSize="sm" mb={1}>
                    {t.app_secret_key}
                  </Text>
                  <InputGroup>
                    <Input
                      type="password"
                      value={
                        currentSecret ? "••••••••••••••••••••••••••••" : ""
                      }
                      readOnly
                      bg="gray.700"
                      placeholder={t.app_secret_placeholder}
                    />
                    <InputRightElement width="6rem">
                      <Button
                        h="1.75rem"
                        size="sm"
                        colorScheme="orange"
                        onClick={() =>
                          copy(currentSecret, t.toast_secret_copied)
                        }
                        isDisabled={!currentSecret}
                      >
                        {t.app_copy}
                      </Button>
                    </InputRightElement>
                  </InputGroup>
                  <Text fontSize="xs" opacity={0.75} mt={1}>
                    {t.app_secret_note}
                  </Text>
                </Box>

                <Box bg="gray.800" p={3} rounded="md">
                  <Text fontSize="sm" mb={2}>
                    {t.app_switch_account}
                  </Text>
                  <Input
                    value={switchNsec}
                    onChange={(e) => setSwitchNsec(e.target.value)}
                    bg="gray.700"
                    placeholder={t.app_nsec_placeholder}
                  />
                  <HStack mt={2} justify="flex-end">
                    <Button
                      isLoading={isSwitching}
                      loadingText={t.app_switching}
                      onClick={switchAccount}
                      colorScheme="teal"
                    >
                      {t.app_switch}
                    </Button>
                  </HStack>
                  <Text fontSize="xs" opacity={0.75} mt={1}>
                    {t.app_switch_note}
                  </Text>
                </Box>
              </VStack>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </>
    );
  };

  // Loading state
  if (isLoadingApp || !user) {
    return (
      <Box minH="100vh" bg="gray.900">
        {/* <TopBar /> */}
        <Box p={6} color="gray.100">
          <RobotBuddyPro state="Loading" />
        </Box>
      </Box>
    );
  }

  // First-run: show Onboarding
  if (needsOnboarding) {
    return (
      <Box minH="100vh" bg="gray.900">
        {/* <TopBar /> */}
        <Onboarding
          userLanguage={appLanguage}
          npub={activeNpub}
          onComplete={handleOnboardingComplete}
          onAppLanguageChange={saveAppLanguage} // ✅ persist language choice immediately
        />
      </Box>
    );
  }

  // Main app
  return (
    <Box minH="100vh" bg="gray.900">
      <TopBar />
      <RealTimeTest
        userLanguage={appLanguage}
        auth={auth}
        activeNpub={activeNpub}
        activeNsec={activeNsec}
        onSwitchedAccount={async () => {
          await connectDID();
          // reflect latest local storage values
          setActiveNpub(localStorage.getItem("local_npub") || "");
          setActiveNsec(localStorage.getItem("local_nsec") || "");
        }}
      />
    </Box>
  );
}
