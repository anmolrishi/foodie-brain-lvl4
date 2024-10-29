import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import Navbar from './Navbar';
import { useMode } from '../contexts/ModeContext';
import { updateLLM, generatePrompt } from '../utils/llmUtils';
import {
  Box,
  Heading,
  Select,
  VStack,
  Text,
  Divider,
  Badge,
  Container,
  Flex,
  Input,
  InputGroup,
  InputLeftElement,
  Button,
  Checkbox,
  useToast,
  HStack,
} from '@chakra-ui/react';
import { Search, Calendar, Brain } from 'lucide-react';
import ReactAudioPlayer from 'react-audio-player';

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY;

export default function EditBrain() {
  const [isNavbarExpanded, setIsNavbarExpanded] = useState(true);
  const { selectedMode, setSelectedMode } = useMode();
  const [analytics, setAnalytics] = useState<any>({});
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCallerConfig, setShowCallerConfig] = useState(false);
  const [showEditRestaurantInfo, setShowEditRestaurantInfo] = useState(false);
  const [selectedTranscripts, setSelectedTranscripts] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const fetchAnalytics = async () => {
      const user = auth.currentUser;
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setAnalytics(data.analytics?.[selectedMode] || {});
        }
      }
    };
    fetchAnalytics();
  }, [selectedMode]);

  const handleTranscriptSelect = (callId: string) => {
    setSelectedTranscripts(prev => {
      if (prev.includes(callId)) {
        return prev.filter(id => id !== callId);
      }
      if (prev.length >= 5) {
        toast({
          title: "Selection limit reached",
          description: "You can select up to 5 transcripts for analysis",
          status: "warning",
          duration: 3000,
          isClosable: true,
        });
        return prev;
      }
      return [...prev, callId];
    });
  };

  const analyzeTranscripts = async () => {
    if (selectedTranscripts.length === 0) {
      toast({
        title: "No transcripts selected",
        description: "Please select at least one transcript for analysis",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsAnalyzing(true);

    try {
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
      const currentPrompt = userData[`${selectedMode}GeneralPrompt`] || generatePrompt(userData, selectedMode);

      const selectedTranscriptsData = selectedTranscripts.map(callId => {
        const callData = analytics[callId];
        return {
          transcript: callData.transcript,
          sentiment: callData.call_analysis.user_sentiment,
          summary: callData.call_analysis.call_summary,
        };
      });

      const systemPrompt = `You are a prompt engineer analyzing call transcripts to improve the AI assistant's performance. Your task is to analyze the provided transcripts and suggest improvements to the current prompt while preserving all variables (marked with {{}}).

IMPORTANT: 
- DO NOT modify or remove any variables or their placeholders
- DO NOT change core functionality or remove existing information
- DO NOT overfit to specific scenarios from the transcripts
- Focus on enhancing the prompt's effectiveness based on patterns and insights from the transcripts
- Maintain the original structure and purpose of the prompt
- Return ONLY the improved prompt with no additional text or explanations

Current prompt:
${currentPrompt}

Transcripts for analysis:
${JSON.stringify(selectedTranscriptsData, null, 2)}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      const improvedPrompt = data.choices[0].message.content;

      // Update the prompt in Firestore
      await updateDoc(userDocRef, {
        [`${selectedMode}GeneralPrompt`]: improvedPrompt,
      });

      // Update the LLM
      await updateLLM(user.uid, selectedMode);

      toast({
        title: "Analysis Complete",
        description: "The prompt has been updated based on the transcript analysis",
        status: "success",
        duration: 5000,
        isClosable: true,
      });

      // Clear selections after successful analysis
      setSelectedTranscripts([]);

    } catch (error) {
      console.error('Error analyzing transcripts:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to analyze transcripts",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const filteredTranscripts = Object.entries(analytics).filter(([_, data]: [string, any]) => {
    const matchesSentiment = sentimentFilter === 'all' || 
      data.call_analysis.user_sentiment.toLowerCase() === sentimentFilter.toLowerCase();
    
    const matchesSearch = searchQuery === '' || 
      data.transcript.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSentiment && matchesSearch;
  });

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
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
      <div className={`flex-grow p-8 transition-all duration-300 ${
        isNavbarExpanded ? 'ml-64' : 'ml-20'
      }`}>
        <Container maxW="container.xl">
          <Flex justify="space-between" align="center" mb={8}>
            <Heading size="xl">Brain Training Data</Heading>
            <HStack spacing={4}>
              <Badge fontSize="lg" colorScheme="purple" p={2} borderRadius="md">
                {selectedMode.toUpperCase()} MODE
              </Badge>
              <Button
                leftIcon={<Brain size={20} />}
                colorScheme="blue"
                isLoading={isAnalyzing}
                loadingText="Analyzing"
                onClick={analyzeTranscripts}
                isDisabled={selectedTranscripts.length === 0}
              >
                Analyze Selected ({selectedTranscripts.length}/5)
              </Button>
            </HStack>
          </Flex>

          <Flex gap={4} mb={8}>
            <InputGroup maxW="400px">
              <InputLeftElement pointerEvents="none">
                <Search color="gray.300" />
              </InputLeftElement>
              <Input
                placeholder="Search transcripts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </InputGroup>
            
            <Select
              value={sentimentFilter}
              onChange={(e) => setSentimentFilter(e.target.value)}
              maxW="200px"
            >
              <option value="all">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </Select>
          </Flex>

          <VStack spacing={6} align="stretch">
            {filteredTranscripts.map(([callId, data]: [string, any]) => (
              <Box
                key={callId}
                bg="white"
                p={6}
                borderRadius="lg"
                shadow="md"
                _hover={{ shadow: 'lg' }}
                transition="all 0.2s"
                borderWidth={selectedTranscripts.includes(callId) ? "2px" : "1px"}
                borderColor={selectedTranscripts.includes(callId) ? "blue.500" : "transparent"}
              >
                <Flex justify="space-between" align="center" mb={4}>
                  <Flex align="center" gap={4}>
                    <Checkbox
                      isChecked={selectedTranscripts.includes(callId)}
                      onChange={() => handleTranscriptSelect(callId)}
                      colorScheme="blue"
                    />
                    <Badge
                      colorScheme={
                        data.call_analysis.user_sentiment === 'Positive'
                          ? 'green'
                          : data.call_analysis.user_sentiment === 'Negative'
                          ? 'red'
                          : 'gray'
                      }
                      fontSize="md"
                      p={2}
                    >
                      {data.call_analysis.user_sentiment}
                    </Badge>
                    <Flex align="center" gap={2} color="gray.600">
                      <Calendar size={16} />
                      <Text fontSize="sm">
                        {formatDate(data.start_timestamp)}
                      </Text>
                    </Flex>
                  </Flex>
                  <Text fontSize="sm" color="gray.500">
                    Duration: {(data.duration_ms / 1000).toFixed(2)}s
                  </Text>
                </Flex>

                <Text fontWeight="bold" mb={2}>
                  Call Summary:
                </Text>
                <Text mb={4} color="gray.700">
                  {data.call_analysis.call_summary}
                </Text>

                <Divider mb={4} />

                <Text fontWeight="bold" mb={2}>
                  Transcript:
                </Text>
                <Box
                  bg="gray.50"
                  p={4}
                  borderRadius="md"
                  maxH="200px"
                  overflowY="auto"
                  mb={4}
                >
                  <Text whiteSpace="pre-wrap">{data.transcript}</Text>
                </Box>

                {data.recording_url && (
                  <Box mt={4}>
                    <Text fontWeight="bold" mb={2}>
                      Recording:
                    </Text>
                    <ReactAudioPlayer
                      src={data.recording_url}
                      controls
                      style={{ width: '100%' }}
                    />
                  </Box>
                )}
              </Box>
            ))}

            {filteredTranscripts.length === 0 && (
              <Box textAlign="center" py={8}>
                <Text fontSize="lg" color="gray.500">
                  No transcripts found matching your criteria
                </Text>
              </Box>
            )}
          </VStack>
        </Container>
      </div>
    </div>
  );
}