import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { database } from "../firebaseResources/firebaseResources";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { Box, Button, Input, Text, VStack, HStack, Link, useToast } from "@chakra-ui/react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLinkIcon, LockIcon } from "@chakra-ui/icons";
import translations from "../utils/translation";

export const PasscodePage = ({
  isOldAccount,
  userLanguage,
  setShowPasscodeModal,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState("");
  const [isValid, setIsValid] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  
  // Get the appropriate language for translations
  const lang = userLanguage === "es" ? "es" : "en";
  const t = translations[lang];

  const bannedUserList = [
    "npub1cfyf77uc459arthry2y6ndj8dr2t7fjn6rl5feakghv884f8s73qe9dayg",
    "npub1m5kwfzjcn7k7uwadmvqwvkryfcy7rttnjfe3cl4cpm205eehe5fs2sx53h",
    "npub1xld6g6tsdddtkpmspawl30prf2py9wdqqwk43sxyy92updqvr62qxt53qk",
  ];

  const correctPasscode = import.meta.env.VITE_PATREON_PASSCODE;

  const showAlert = (status, message) => {
    toast({
      title: status === "error" ? "Error" : "Success",
      description: message,
      status: status,
      duration: 5000,
      isClosable: true,
    });
  };

  const checkPasscode = async () => {
    if (
      input === correctPasscode &&
      bannedUserList.find((item) => item === localStorage.getItem("local_npub"))
    ) {
      showAlert(
        "error",
        "You have been banned and the passcode has been changed. Contact the application owner on Patreon if this is a mistake."
      );
    } else {
      if (input === correctPasscode) {
        setIsSubmitting(true);
        try {
          localStorage.setItem("passcode", input);
          localStorage.setItem("features_passcode", input);

          const userId = localStorage.getItem("local_npub");
          const userDocRef = doc(database, "users", userId);
          const userSnapshot = await getDoc(userDocRef);

          if (userSnapshot.exists()) {
            await updateDoc(userDocRef, {
              hasSubmittedPasscode: true,
            });
            setShowPasscodeModal(false);
            showAlert("success", "Passcode verified successfully!");
          } else {
            console.log("User document not found");
          }
        } catch (error) {
          console.error("Error updating passcode:", error);
          showAlert("error", "Failed to verify passcode. Please try again.");
        } finally {
          setIsSubmitting(false);
        }
      } else {
        setIsValid(false);
        showAlert("error", "Invalid passcode. Please check your Patreon welcome message.");
      }
    }
  };

  useEffect(() => {
    console.log("INPUT", input);
    localStorage.setItem("passcode", input);
    if (localStorage.getItem("passcode") === correctPasscode) {
      checkPasscode(); // Auto-check if passcode is already stored
    }
  }, [input]);

  useEffect(() => {
    setIsLoading(true);
    const checkUser = async () => {
      const userId = localStorage.getItem("local_npub"); // Replace with actual user ID if needed
      const userDocRef = doc(database, "users", userId);
      const userSnapshot = await getDoc(userDocRef);

      if (userSnapshot.exists()) {
        // console.log("User document exists");
        const userData = userSnapshot.data();
        const hasSubscribed = userData?.hasSubmittedPasscode;

        if (hasSubscribed) {
          console.log("HAS SUBSCRIBED", import.meta.env.VITE_PATREON_PASSCODE);
          localStorage.setItem(
            "passcode",
            import.meta.env.VITE_PATREON_PASSCODE
          );
          localStorage.setItem(
            "features_passcode",
            import.meta.env.VITE_PATREON_PASSCODE
          );

          setIsLoading(false);
          setShowPasscodeModal(true);
        } else {
          setIsLoading(false);
        }
      }
    };

    checkUser();
  }, []);

  if (isLoading) {
    return (
      <Box 
        minH="100vh" 
        bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)"
        display="flex"
        alignItems="center"
        justifyContent="center"
        color="white"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <VStack spacing={4}>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            >
              <LockIcon boxSize={8} color="#14b8a6" />
            </motion.div>
            <Text fontSize="lg" fontWeight="500">Loading...</Text>
          </VStack>
        </motion.div>
      </Box>
    );
  }

  return (
    <Box 
      minH="100vh" 
      bg="linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)"
      display="flex" 
      justifyContent="center"
      alignItems="center"
      p={4}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Box
          maxWidth="700px"
          width="100%"
          bg="rgba(255, 255, 255, 0.05)"
          backdropFilter="blur(20px)"
          border="1px solid rgba(255, 255, 255, 0.1)"
          borderRadius="24px"
          p={8}
          boxShadow="0 25px 50px -12px rgba(0, 0, 0, 0.5)"
        >
          <VStack spacing={6} align="stretch">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <VStack spacing={3} textAlign="center">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  transition={{ duration: 0.2 }}
                >
                  <Box
                    p={4}
                    borderRadius="16px"
                    bg="rgba(20, 184, 166, 0.1)"
                    border="1px solid rgba(20, 184, 166, 0.2)"
                  >
                    <LockIcon boxSize={8} color="#14b8a6" />
                  </Box>
                </motion.div>
                <Text fontSize="2xl" fontWeight="700" color="#14b8a6">
                  Premium Access
                </Text>
                <Text fontSize="lg" color="#cbd5e1" maxWidth="500px">
                  {t["passcode.instructions"] || "Enter your passcode to continue. If you're a Patreon supporter, check your welcome message for the code."}
                </Text>
              </VStack>
            </motion.div>

            {/* Benefits Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Box
                bg="rgba(255, 255, 255, 0.05)"
                borderRadius="16px"
                p={6}
                border="1px solid rgba(255, 255, 255, 0.1)"
              >
                <Text fontSize="lg" fontWeight="600" color="#14b8a6" mb={4}>
                  Subscribe to Patreon for Full Access
                </Text>
                <VStack spacing={3} align="stretch">
                  {[
                    "Access to 10 different education apps",
                    "Get access to crash courses, stock market, entrepreneurship, and startup development content",
                    "Keep the coding education app free for everyone",
                    "Access more advanced software engineering content and projects",
                    "Help our community create scholarships",
                    "Receive personal tutoring/entrepreneurial support (soon)"
                  ].map((benefit, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + index * 0.1 }}
                    >
                      <HStack spacing={3}>
                        <Box
                          w={2}
                          h={2}
                          borderRadius="50%"
                          bg="#14b8a6"
                          flexShrink={0}
                        />
                        <Text color="#cbd5e1" fontSize="sm">
                          {benefit}
                        </Text>
                      </HStack>
                    </motion.div>
                  ))}
                </VStack>
              </Box>
            </motion.div>

            {/* Links */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              <VStack spacing={3}>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link
                    href="https://patreon.com/notesandotherstuff"
                    isExternal
                    color="#14b8a6"
                    fontSize="md"
                    fontWeight="500"
                    _hover={{ color: "#0d9488" }}
                    display="flex"
                    alignItems="center"
                    gap={2}
                  >
                    Go To Patreon
                    <ExternalLinkIcon />
                  </Link>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link
                    href="https://www.patreon.com/posts/start-learning-86153437?utm_medium=clipboard_copy&utm_source=copyLink&utm_campaign=postshare_creator&utm_content=join_link"
                    isExternal
                    color="#14b8a6"
                    fontSize="md"
                    fontWeight="500"
                    _hover={{ color: "#0d9488" }}
                    display="flex"
                    alignItems="center"
                    gap={2}
                  >
                    Link To Subscriber Passcode
                    <ExternalLinkIcon />
                  </Link>
                </motion.div>
              </VStack>
            </motion.div>

            {/* Passcode Input */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <VStack spacing={4}>
                <Text fontSize="md" fontWeight="500" color="#14b8a6">
                  {t["passcode.label"] || "Subscriber Passcode"}
                </Text>
                <HStack spacing={3} width="100%">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value.toUpperCase())}
                    bg="rgba(255, 255, 255, 0.05)"
                    border="1px solid rgba(255, 255, 255, 0.1)"
                    borderRadius="12px"
                    color="white"
                    fontSize="lg"
                    fontWeight="500"
                    textAlign="center"
                    letterSpacing="0.1em"
                    _focus={{
                      borderColor: "#14b8a6",
                      boxShadow: "0 0 0 3px rgba(20, 184, 166, 0.3)",
                    }}
                    _placeholder={{
                      color: "#94a3b8",
                    }}
                    placeholder="Enter passcode..."
                    isInvalid={isValid === false}
                    errorBorderColor="red.400"
                  />
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Button
                      onClick={checkPasscode}
                      isLoading={isSubmitting}
                      loadingText="Verifying..."
                      bg="linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)"
                      color="white"
                      border="none"
                      borderRadius="12px"
                      fontWeight="600"
                      px={8}
                      _hover={{
                        bg: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
                        transform: "translateY(-1px)",
                        boxShadow: "0 4px 12px rgba(20, 184, 166, 0.3)",
                      }}
                      _active={{
                        transform: "translateY(0)",
                      }}
                      transition="all 0.2s ease"
                      isDisabled={!input.trim()}
                    >
                      Verify
                    </Button>
                  </motion.div>
                </HStack>
                {isValid === false && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Text color="red.400" fontSize="sm" textAlign="center">
                      Invalid passcode. Please check your Patreon welcome message.
                    </Text>
                  </motion.div>
                )}
              </VStack>
            </motion.div>
          </VStack>
        </Box>
      </motion.div>
    </Box>
  );
};
