import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updateLLM, generatePrompt } from '../utils/llmUtils';
import { Mode } from './ModeSelector';
import Navbar from './Navbar';
import CallerConfigurationModal from './CallerConfigurationModal';
import EditRestaurantInfo from './EditRestaurantInfo';
import { RetellWebClient } from 'retell-client-js-sdk';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Box, Input, VStack, Text, useToast } from '@chakra-ui/react';
import { Send, Podcast, Mic, Edit, Brain as BrainIcon } from 'lucide-react';
import { Brain as BrainAnimation } from 'threejs-brain-animation';
import { useMode } from '../contexts/ModeContext';

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const YOUR_API_KEY = 'key_1d2025c27c6328b3f9840255e4df';
const webClient = new RetellWebClient();

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface PromptChangeResponse {
  prompt: string;
  summary: string;
}

export default function Brain() {
  const [isNavbarExpanded, setIsNavbarExpanded] = useState(true);
  const { selectedMode, setSelectedMode } = useMode();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingChange, setPendingChange] =
    useState<PromptChangeResponse | null>(null);
  const [showInterface, setShowInterface] = useState(false);
  const [callStatus, setCallStatus] = useState<
    'not-started' | 'active' | 'inactive'
  >('not-started');
  const [agentData, setAgentData] = useState<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const toast = useToast();

  const [beginMessage, setBeginMessage] = useState('');
  const [model, setModel] = useState('');
  const [botName, setBotName] = useState('');
  const [tone, setTone] = useState('');
  const [callTransferNumber, setCallTransferNumber] = useState('');
  const [llmData, setLLMData] = useState(null);
  const [showCallerConfig, setShowCallerConfig] = useState(false);
  const [showEditRestaurantInfo, setShowEditRestaurantInfo] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const loadUserData = async () => {
      const user = auth.currentUser;
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setAgentData(data[`${selectedMode}AgentData`] || null);
        }
      }
    };
    loadUserData();
  }, [selectedMode]);

  useEffect(() => {
    const loadBotConfig = async () => {
      const user = auth.currentUser;
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setBeginMessage(data[`${selectedMode}BeginMessage`] || '');
          setModel(data[`${selectedMode}Model`] || '');
          setBotName(data[`${selectedMode}BotName`] || '');
          setTone(data[`${selectedMode}Tone`] || '');
          setCallTransferNumber(data.callTransferNumber || '');
          setLLMData(data[`${selectedMode}LlmData`] || null);
        }
      }
    };
    loadBotConfig();
  }, [selectedMode]);

  useEffect(() => {
    const handleConversationStarted = () => {
      setCallStatus('active');
    };

    const handleConversationEnded = () => {
      setCallStatus('inactive');
    };

    const handleError = (error: any) => {
      console.error('An error occurred:', error);
      setCallStatus('inactive');
    };

    webClient.on('conversationStarted', handleConversationStarted);
    webClient.on('conversationEnded', handleConversationEnded);
    webClient.on('error', handleError);

    return () => {
      webClient.off('conversationStarted', handleConversationStarted);
      webClient.off('conversationEnded', handleConversationEnded);
      webClient.off('error', handleError);
    };
  }, []);

  const toggleConversation = async () => {
    if (callStatus === 'active') {
      try {
        await webClient.stopCall();
        setCallStatus('inactive');
      } catch (error) {
        console.error('Error stopping call:', error);
      }
    } else {
      if (!agentData) {
        console.error('Agent not created yet');
        return;
      }

      try {
        const response = await fetch(
          'https://api.retellai.com/v2/create-web-call',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${YOUR_API_KEY}`,
              'Content-Type': 'application/json',
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
        await webClient.startCall({
          accessToken: data.access_token,
          callId: data.call_id,
          sampleRate: 16000,
          enableUpdate: true,
        });
        setCallStatus('active');
      } catch (error) {
        console.error('Error starting call:', error);
      }
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const extractJSONFromResponse = (text: string): PromptChangeResponse => {
    try {
      return JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          if (result.prompt && result.summary) {
            return result;
          }
        } catch (e) {
          throw new Error('Invalid JSON structure in response');
        }
      }
      throw new Error('No valid JSON found in response');
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    try {
      setIsLoading(true);
      setMessages((prev) => [...prev, { role: 'user', content: inputMessage }]);
      setInputMessage('');

      const user = auth.currentUser;
      if (!user) {
        throw new Error('No authenticated user');
      }

      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        throw new Error('User document not found');
      }

      const userData = userDoc.data();
      const currentPrompt =
        userData[`${selectedMode}GeneralPrompt`] ||
        generatePrompt(userData, selectedMode);

      const systemPrompt = `You are a prompt engineer. Your task is to modify the provided prompt while preserving all variables (marked with {{}}) exactly as they are. The user can change anything else in the prompt like timings, greetings, the way agent needs to speak etc . Just except these values-> restaurant name, seating capacity, address, menu, bot name, tone, begin message, or model, EVERYTHING ELSE CAN BE CHANGED AND ARE NOT PART OF THE CORE CONFIGURATION VALUES. 

IMPORTANT: You MUST respond with a valid JSON object in the following format:

For core configuration value changes (restaurant name, seating capacity, address, menu, bot name, tone, begin message, or model):
{
  "prompt": "",
  "summary": "The requested changes involve core configuration values that can only be modified through the dedicated configuration interfaces in the navbar. Please use the Restaurant Info or Bot Config options in the navbar to make these changes.",
  "configurationRequest": true
}

For all other modifications:
{
  "prompt": "the modified prompt with all variables preserved",
  "summary": "a brief summary of the changes made"
}

Do not include any text outside of this JSON structure. Do not include any information about training data or model capabilities in your response.

Current prompt:
${currentPrompt}`;

      //       const userPrompt = `This is the user's input ->  ${inputMessage}.
      // IMPORTANT: You MUST respond with a valid JSON object in the following format:

      // For core configuration value changes (restaurant name, seating capacity, address, menu, bot name, tone, begin message, or model):
      // {
      //   "prompt": "",
      //   "summary": "The requested changes involve core configuration values that can only be modified through the dedicated configuration interfaces in the navbar. Please use the Restaurant Info or Bot Config options in the navbar to make these changes.",
      //   "configurationRequest": true
      // }

      // For all other modifications:
      // {
      //   "prompt": "the modified prompt with all variables preserved",
      //   "summary": "a brief summary of the changes made"
      // }
      // `;

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: inputMessage },
            ],
            temperature: 0.1,
            max_tokens: 2000,
            response_format: { type: 'json_object' },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          `OpenAI API error: ${errorData.error?.message || 'Unknown error'}`
        );
      }

      const data = await response.json();

      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response format from OpenAI');
      }

      const result = extractJSONFromResponse(data.choices[0].message.content);

      setPendingChange(result);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.configurationRequest
            ? result.summary
            : `Here's what I understand you want to change:\n\n${result.summary}\n\nWould you like me to apply these changes?`,
        },
      ]);
    } catch (error) {
      console.error('Error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I encountered an error: ${error.message}. Please try again with a different request.`,
        },
      ]);

      toast({
        title: 'Error',
        description: error.message || 'Failed to process your request',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmChange = async (confirmed: boolean) => {
    if (!confirmed || !pendingChange) {
      setPendingChange(null);
      setMessages([]);
      return;
    }

    // If it's a configuration request, just show the message and reset
    if (pendingChange.configurationRequest) {
      setPendingChange(null);
      setMessages([]);
      return;
    }

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('No authenticated user');
      }

      const userDocRef = doc(db, 'users', user.uid);

      await updateDoc(userDocRef, {
        [`${selectedMode}GeneralPrompt`]: pendingChange.prompt,
      });

      await updateLLM(user.uid, selectedMode);

      toast({
        title: 'Success',
        description: 'Prompt updated successfully',
        status: 'success',
        duration: 3000,
        isClosable: true,
      });

      setPendingChange(null);
      setMessages([]);
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update prompt',
        status: 'error',
        duration: 5000,
        isClosable: true,
      });
    }
  };

  const handleSpeechToText = useCallback(() => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          const audioChunks: Blob[] = [];

          mediaRecorder.addEventListener('dataavailable', (event) => {
            audioChunks.push(event.data);
          });

          mediaRecorder.addEventListener('stop', async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.wav');
            formData.append('model', 'whisper-1');

            try {
              const response = await fetch(
                'https://api.openai.com/v1/audio/transcriptions',
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${OPENAI_KEY}`,
                  },
                  body: formData,
                }
              );

              if (!response.ok) {
                throw new Error('Failed to transcribe audio');
              }

              const data = await response.json();
              setInputMessage(data.text);
            } catch (error) {
              console.error('Error transcribing audio:', error);
              toast({
                title: 'Error',
                description: 'Failed to transcribe audio. Please try again.',
                status: 'error',
                duration: 5000,
                isClosable: true,
              });
            }

            stream.getTracks().forEach((track) => track.stop());
          });

          mediaRecorder.start();
          setIsRecording(true);
        })
        .catch((error) => {
          console.error('Error accessing microphone:', error);
          toast({
            title: 'Error',
            description:
              'Failed to access microphone. Please check your permissions.',
            status: 'error',
            duration: 5000,
            isClosable: true,
          });
        });
    }
  }, [OPENAI_KEY, toast, setInputMessage, isRecording]);

  const handleRestaurantNameUpdate = (newName: string) => {
    // Handle restaurant name update if needed
  };

  return (
    <div className="flex min-h-screen bg-gray-100">
      <Navbar
        onOpenCallerConfig={() => setShowCallerConfig(true)}
        onOpenEditRestaurantInfo={() => setShowEditRestaurantInfo(true)}
        isExpanded={isNavbarExpanded}
        setIsExpanded={setIsNavbarExpanded}
        selectedMode={selectedMode}
        onModeChange={setSelectedMode}
      />
      <div
        className={`flex-grow p-8 transition-all duration-300 ${
          isNavbarExpanded ? 'ml-64' : 'ml-20'
        }`}
      >
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center">
            <h1 className="text-3xl font-bold text-blue-900">
              Neural Network Interface
            </h1>
              <Button
                leftIcon={<Edit size={20} />}
                colorScheme="blue"
                variant="outline"
                onClick={() => navigate('/editbrain')}
                ml={4}
              >
                Edit Brain
              </Button>
            </div>
            <span className="px-4 py-2 bg-blue-100 text-blue-800 rounded-full font-semibold capitalize">
              {selectedMode} Mode
            </span>
          </div>

          <AnimatePresence mode="wait">
            {!showInterface ? (
              <motion.div
                key="brain"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="flex flex-col items-center justify-center space-y-8"
                style={{ minHeight: 'calc(100vh - 200px)' }}
              >
                <motion.div
                  className="cursor-pointer"
                  onClick={() => setShowInterface(true)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <BrainAnimation width={300} height={300} />
                </motion.div>
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-2xl text-gray-700 font-bold tracking-wide"
                >
                  Click the brain to start modifying your AI's neural network
                </motion.p>
              </motion.div>
            ) : (
              <motion.div
                key="interface"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Box
                    bg="white"
                    borderRadius="lg"
                    boxShadow="lg"
                    p={6}
                    height="70vh"
                    display="flex"
                    flexDirection="column"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-semibold text-gray-800">
                        Neural Network Engineer
                      </h2>
                      <Button
                        size="sm"
                        colorScheme="blue"
                        variant="ghost"
                        onClick={() => setShowInterface(false)}
                      >
                        Back to Brain
                      </Button>
                    </div>
                    <VStack
                      flex="1"
                      overflowY="auto"
                      spacing={4}
                      align="stretch"
                      className="custom-scrollbar"
                    >
                      {messages.map((message, index) => (
                        <Box
                          key={index}
                          alignSelf={
                            message.role === 'user' ? 'flex-end' : 'flex-start'
                          }
                          bg={message.role === 'user' ? 'blue.500' : 'gray.100'}
                          color={message.role === 'user' ? 'white' : 'black'}
                          px={4}
                          py={2}
                          borderRadius="lg"
                          maxW="80%"
                        >
                          <Text whiteSpace="pre-wrap">{message.content}</Text>
                        </Box>
                      ))}
                      {pendingChange && (
                        <Box
                          display="flex"
                          justifyContent="center"
                          gap={4}
                          mt={4}
                        >
                          {pendingChange.configurationRequest ? (
                            <Button
                              colorScheme="blue"
                              onClick={() => handleConfirmChange(false)}
                            >
                              Start Over
                            </Button>
                          ) : (
                            <>
                              <Button
                                colorScheme="green"
                                onClick={() => handleConfirmChange(true)}
                              >
                                Yes, apply changes
                              </Button>
                              <Button
                                colorScheme="red"
                                variant="outline"
                                onClick={() => handleConfirmChange(false)}
                              >
                                No, start over
                              </Button>
                            </>
                          )}
                        </Box>
                      )}

                      <div ref={messagesEndRef} />
                    </VStack>

                    <Box pt={4} borderTop="1px" borderColor="gray.200">
                      <div className="flex gap-2">
                        <Input
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          placeholder="Type your prompt modification request..."
                          onKeyPress={(e) =>
                            e.key === 'Enter' && handleSendMessage()
                          }
                          disabled={isLoading || !!pendingChange}
                        />
                        <Button
                          colorScheme="blue"
                          onClick={handleSendMessage}
                          isLoading={isLoading}
                          disabled={!inputMessage.trim() || !!pendingChange}
                        >
                          <Send size={20} />
                        </Button>
                        <Button
                          colorScheme={isRecording ? 'green' : 'purple'}
                          bg={isRecording ? 'green.500' : 'purple.500'}
                          color="white"
                          _hover={{
                            bg: isRecording ? 'green.600' : 'purple.600',
                          }}
                          onClick={handleSpeechToText}
                          disabled={isLoading || !!pendingChange}
                        >
                          <Mic size={20} color="white" />
                        </Button>
                        {isRecording && (
                          <Box
                            position="absolute"
                            bottom="100%"
                            left="50%"
                            transform="translateX(-50%)"
                            bg="green.500"
                            color="white"
                            px={2}
                            py={1}
                            borderRadius="md"
                            fontSize="sm"
                            fontWeight="bold"
                            boxShadow="md"
                          >
                            Recording...
                          </Box>
                        )}
                      </div>
                    </Box>
                  </Box>

                  <Box
                    bg="white"
                    borderRadius="lg"
                    boxShadow="lg"
                    p={6}
                    height="70vh"
                    display="flex"
                    flexDirection="column"
                    justifyContent="center"
                    alignItems="center"
                  >
                    <h2 className="text-xl font-semibold text-gray-800 mb-8">
                      Test Your Neural Network
                    </h2>
                    <div
                      className="relative cursor-pointer"
                      onClick={toggleConversation}
                    >
                      <motion.div
                        animate={{
                          scale: callStatus === 'active' ? [1, 1.1, 1] : 1,
                        }}
                        transition={{
                          duration: 0.5,
                          repeat: callStatus === 'active' ? Infinity : 0,
                          repeatType: 'reverse',
                        }}
                      >
                        <div
                          className={`rounded-full p-16 ${
                            callStatus === 'active'
                              ? 'bg-[#92d0ff]'
                              : 'bg-white'
                          } shadow-lg ${
                            callStatus === 'active'
                              ? 'shadow-[#92d0ff]'
                              : 'shadow-blue-200'
                          }`}
                        >
                          <motion.div
                            animate={{
                              rotate: callStatus === 'active' ? [0, 360] : 0,
                            }}
                            transition={{
                              duration: 2,
                              repeat: callStatus === 'active' ? Infinity : 0,
                              ease: 'linear',
                            }}
                          >
                            <Podcast
                              size={110}
                              color={
                                callStatus === 'active' ? 'white' : '#92d0ff'
                              }
                            />
                          </motion.div>
                        </div>
                      </motion.div>
                      {callStatus === 'active' && (
                        <motion.div
                          className="absolute -inset-3 rounded-full bg-[#92d0ff] opacity-50"
                          animate={{
                            scale: [1, 1.2, 1],
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            repeatType: 'reverse',
                          }}
                        />
                      )}
                    </div>
                    <p className="text-xl text-gray-700 font-semibold mt-8">
                      {callStatus === 'active'
                        ? 'Click to end the call'
                        : 'Click to test your AI assistant'}
                    </p>
                  </Box>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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

      <style>{`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.5);
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
