import React, { useState, useEffect, useRef } from "react";
import { RetellWebClient } from "retell-client-js-sdk";
import { motion } from "framer-motion";
import { Podcast, Share2 } from "lucide-react";
import { auth, db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Navbar from "./Navbar";
import CallerConfigurationModal from "./CallerConfigurationModal";
import EditRestaurantInfo from "./EditRestaurantInfo";
import {
  Button,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  VStack,
  Text,
  Input,
  InputGroup,
  InputRightElement,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  useClipboard,
  Box,
  Link as ChakraLink,
  Code,
} from "@chakra-ui/react";
import { useMode } from "../contexts/ModeContext";

const webClient = new RetellWebClient();
const YOUR_API_KEY = "key_1d2025c27c6328b3f9840255e4df";

export default function Dashboard() {
  const [restaurantName, setRestaurantName] = useState<string>("");
  const [beginMessage, setBeginMessage] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [botName, setBotName] = useState<string>("");
  const [tone, setTone] = useState<string>("");
  const [callTransferNumber, setCallTransferNumber] = useState<string>("");
  const [llmData, setLLMData] = useState<any>(null);
  const [agentData, setAgentData] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<
    "not-started" | "active" | "inactive"
  >("not-started");
  const [isLoading, setIsLoading] = useState(true);
  const [showCallerConfig, setShowCallerConfig] = useState(false);
  const [showEditRestaurantInfo, setShowEditRestaurantInfo] = useState(false);
  const [isNavbarExpanded, setIsNavbarExpanded] = useState(true);
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [embedCode, setEmbedCode] = useState("");
  const { selectedMode, setSelectedMode } = useMode();

  const currentCallIdRef = useRef<string | null>(null);
  const toast = useToast();
  const { hasCopied: hasLinkCopied, onCopy: copyLink } = useClipboard(shareUrl);
  const { hasCopied: hasEmbedCopied, onCopy: copyEmbed } =
    useClipboard(embedCode);

  useEffect(() => {
    currentCallIdRef.current = currentCallId;
  }, [currentCallId]);

  useEffect(() => {
    const loadUserData = async () => {
      const user = auth.currentUser;
      if (user) {
        const userDocRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setRestaurantName(data.restaurantName || "");
          setBeginMessage(data[`${selectedMode}BeginMessage`] || "");
          setModel(data[`${selectedMode}Model`] || "");
          setBotName(data[`${selectedMode}BotName`] || "");
          setTone(data[`${selectedMode}Tone`] || "");
          setCallTransferNumber(data.callTransferNumber || "");
          setLLMData(data[`${selectedMode}LlmData`] || null);
          setAgentData(data[`${selectedMode}AgentData`] || null);
        }
        setIsLoading(false);
      }
    };

    loadUserData();
  }, [selectedMode]);

  useEffect(() => {
    const handleConversationStarted = () => {
      console.log("Conversation started");
      setCallStatus("active");
    };

    const handleConversationEnded = ({
      code,
      reason,
    }: {
      code: any;
      reason: any;
    }) => {
      console.log("Conversation ended with code:", code, ", reason:", reason);
      setCallStatus("inactive");
      if (currentCallIdRef.current) {
        saveCallAnalytics(currentCallIdRef.current);
      }
    };

    const handleError = (error: any) => {
      console.error("An error occurred:", error);
      setCallStatus("inactive");
    };

    const handleUpdate = (update: any) => {
      if (update.type === "transcript" && update.transcript) {
        console.log(`${update.transcript.speaker}: ${update.transcript.text}`);
      }
    };

    webClient.on("conversationStarted", handleConversationStarted);
    webClient.on("conversationEnded", handleConversationEnded);
    webClient.on("error", handleError);
    webClient.on("update", handleUpdate);

    return () => {
      webClient.off("conversationStarted", handleConversationStarted);
      webClient.off("conversationEnded", handleConversationEnded);
      webClient.off("error", handleError);
      webClient.off("update", handleUpdate);
    };
  }, []);

  const saveCallAnalytics = async (callId: string) => {
    try {
      let analyticsData = null;
      let attempts = 0;
      const maxAttempts = 10;
      const delay = 5000;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempts += 1;

        const response = await fetch(
          `https://api.retellai.com/v2/get-call/${callId}`,
          {
            headers: {
              Authorization: `Bearer ${YOUR_API_KEY}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        analyticsData = await response.json();
        if (analyticsData && Object.keys(analyticsData).length > 0) break;
      }

      if (!analyticsData) {
        throw new Error("Failed to get analytics data after maximum attempts");
      }

      const user = auth.currentUser;
      if (user) {
        const userDocRef = doc(db, "users", user.uid);
        await setDoc(
          userDocRef,
          {
            analytics: {
              [selectedMode]: {
                [callId]: analyticsData
              }
            }
          },
          { merge: true }
        );
      }
    } catch (error) {
      console.error("Error saving call analytics:", error);
    }
  };

  const toggleConversation = async () => {
    if (callStatus === "active") {
      try {
        await webClient.stopCall();
        setCallStatus("inactive");
        if (currentCallIdRef.current) {
          saveCallAnalytics(currentCallIdRef.current);
        }
      } catch (error) {
        console.error("Error stopping call:", error);
      }
    } else {
      if (!agentData) {
        console.error("Agent not created yet");
        return;
      }

      try {
        const response = await fetch(
          "https://api.retellai.com/v2/create-web-call",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${YOUR_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agent_id: agentData.agent_id,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setCurrentCallId(data.call_id);

        await webClient.startCall({
          accessToken: data.access_token,
          callId: data.call_id,
          sampleRate: 16000,
          enableUpdate: true,
        });
        setCallStatus("active");
      } catch (error) {
        console.error("Error starting call:", error);
      }
    }
  };

  const handleShare = () => {
    const user = auth.currentUser;
    if (user) {
      const baseUrl = window.location.origin;
      const directUrl = `${baseUrl}/shared/${user.uid}/${selectedMode}`;
      const embedCodeText = `<iframe
  src="${baseUrl}/shared/${user.uid}/${selectedMode}?embed=true"
  width="100%"
  height="600"
  frameborder="0"
  allow="microphone"
  style="border-radius: 10px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);"
></iframe>`;

      setShareUrl(directUrl);
      setEmbedCode(embedCodeText);
      setIsShareModalOpen(true);
    }
  };

  const handleRestaurantNameUpdate = (newName: string) => {
    setRestaurantName(newName);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-50">
        <p className="text-xl font-semibold text-blue-800">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-blue-50">
      <Navbar
        onOpenCallerConfig={() => setShowCallerConfig(true)}
        onOpenEditRestaurantInfo={() => setShowEditRestaurantInfo(true)}
        isExpanded={isNavbarExpanded}
        setIsExpanded={setIsNavbarExpanded}
        selectedMode={selectedMode}
        onModeChange={setSelectedMode}
      />
      <div
        className={`flex-grow p-8 transition-all duration-300 ${isNavbarExpanded ? "ml-64" : "ml-20"}`}
      >
        <div className="text-center mb-8 pt-2">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-blue-900">
              {restaurantName}'s Virtual Assistant
            </h1>
            <div className="flex items-center gap-4">
              <span className="px-4 py-2 bg-blue-100 text-blue-800 rounded-full font-semibold capitalize">
                {selectedMode} Mode
              </span>
              <Button
                leftIcon={<Share2 size={20} />}
                colorScheme="blue"
                variant="outline"
                onClick={handleShare}
              >
                Share Assistant
              </Button>
            </div>
          </div>
        </div>
        <div className="flex justify-center items-center h-[calc(100vh-12rem)]">
          <div
            className="relative cursor-pointer z-10"
            onClick={toggleConversation}
          >
            <motion.div
              animate={{
                scale: callStatus === "active" ? [1, 1.1, 1] : 1,
              }}
              transition={{
                duration: 0.5,
                repeat: callStatus === "active" ? Infinity : 0,
                repeatType: "reverse",
              }}
            >
              <div
                className={`rounded-full p-16 ${
                  callStatus === "active" ? "bg-[#92d0ff]" : "bg-white"
                } shadow-lg ${
                  callStatus === "active"
                    ? "shadow-[#92d0ff]"
                    : "shadow-blue-200"
                }`}
              >
                <motion.div
                  animate={{
                    rotate: callStatus === "active" ? [0, 360] : 0,
                  }}
                  transition={{
                    duration: 2,
                    repeat: callStatus === "active" ? Infinity : 0,
                    ease: "linear",
                  }}
                >
                  <Podcast
                    size={110}
                    color={callStatus === "active" ? "white" : "#92d0ff"}
                  />
                </motion.div>
              </div>
            </motion.div>
            {callStatus === "active" && (
              <motion.div
                className="absolute -inset-3 rounded-full bg-[#92d0ff] opacity-50"
                animate={{
                  scale: [1, 1.2, 1],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  repeatType: "reverse",
                }}
              />
            )}
          </div>
        </div>
      </div>

      {showCallerConfig && (
        <CallerConfigurationModal
          isOpen={showCallerConfig}
          onClose={() => setShowCallerConfig(false)}
          beginMessage={beginMessage}
          model={model}
          botName={botName}
          tone={tone}
          callTransferNumber={callTransferNumber}
          llmData={llmData}
          setBeginMessage={setBeginMessage}
          setModel={setModel}
          setBotName={setBotName}
          setTone={setTone}
          setCallTransferNumber={setCallTransferNumber}
          setLLMData={setLLMData}
          mode={selectedMode}
        />
      )}

      {showEditRestaurantInfo && (
        <EditRestaurantInfo
          onClose={() => setShowEditRestaurantInfo(false)}
          onUpdateRestaurantName={handleRestaurantNameUpdate}
        />
      )}

      <Modal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        size="xl"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Share Your Assistant</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <Tabs variant="soft-rounded" colorScheme="blue">
              <TabList mb={4}>
                <Tab gap={2}>
                  <Share2 size={18} />
                  <Text>Direct Link</Text>
                </Tab>
                <Tab gap={2}>
                  <Code>{"</>"}</Code>
                  <Text>Embed Code</Text>
                </Tab>
              </TabList>
              <TabPanels>
                <TabPanel>
                  <VStack align="stretch" spacing={4}>
                    <Text fontSize="sm" color="gray.600">
                      Share this link to give others access to your{" "}
                      {selectedMode} assistant:
                    </Text>
                    <InputGroup size="md">
                      <Input pr="4.5rem" value={shareUrl} readOnly />
                      <InputRightElement width="4.5rem">
                        <Button
                          h="1.75rem"
                          size="sm"
                          onClick={copyLink}
                          colorScheme={hasLinkCopied ? "green" : "blue"}
                        >
                          {hasLinkCopied ? "Copied!" : "Copy"}
                        </Button>
                      </InputRightElement>
                    </InputGroup>
                  </VStack>
                </TabPanel>
                <TabPanel>
                  <VStack align="stretch" spacing={4}>
                    <Text fontSize="sm" color="gray.600">
                      Add this code to embed the {selectedMode} assistant in
                      your website:
                    </Text>
                    <Box
                      p={4}
                      bg="gray.50"
                      borderRadius="md"
                      fontFamily="mono"
                      fontSize="sm"
                      position="relative"
                    >
                      <pre
                        style={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {embedCode}
                      </pre>
                      <Button
                        position="absolute"
                        top={2}
                        right={2}
                        size="sm"
                        onClick={copyEmbed}
                        colorScheme={hasEmbedCopied ? "green" : "blue"}
                      >
                        {hasEmbedCopied ? "Copied!" : "Copy"}
                      </Button>
                    </Box>
                  </VStack>
                </TabPanel>
              </TabPanels>
            </Tabs>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}