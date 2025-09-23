/* functions/index.js */

// Firebase Functions v2 (Node 20, global fetch available)
const functions = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Load environment variables for local development
// In production, Firebase Functions automatically loads from functions/.env
if (process.env.FUNCTIONS_EMULATOR) {
  require('dotenv').config();
}

// Initialize Admin SDK once
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// ===== Runtime config =====
// Load OpenAI API key from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validate API key on startup
if (!OPENAI_API_KEY) {
  functions.logger.error("Missing or invalid OPENAI_API_KEY environment variable");
}

// ==== Tunables ====
const REGION = "us-central1";
const CORS_ORIGINS = [
  "https://nosabo-miguel.web.app",
  "https://nosabo-miguel.firebaseapp.com", 
  "http://localhost:5173", // dev only
];

// Only permit the models you actually use with /proxyResponses
const ALLOWED_RESPONSE_MODELS = new Set(["gpt-4o-mini", "gpt-4o", "o4-mini", "gpt-3.5-turbo", "gpt-4o-mini-realtime"]);

// Optionally require Firebase App Check (set true after client wiring)
const REQUIRE_APPCHECK = false;

// ===== Robust CORS helper =====
function applyCors(req, res) {
  const origin = req.headers.origin;
  
  // Handle OPTIONS preflight requests
  if (req.method === "OPTIONS") {
    if (origin && CORS_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).send("");
    return true;
  }
  
  // Handle actual requests
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  
  return false;
}

// ===== App Check (optional but recommended) =====
// async function verifyAppCheck(req) {
//   if (!REQUIRE_APPCHECK) return;
//   const token = req.header("X-Firebase-AppCheck");
//   if (!token) {
//     throw new functions.https.HttpsError(
//       "unauthenticated",
//       "Missing App Check token."
//     );
//   }
//   try {
//     await admin.appCheck().verifyToken(token);
//   } catch (e) {
//     throw new functions.https.HttpsError(
//       "permission-denied",
//       "Invalid App Check token."
//     );
//   }
// }

// ===== Helpers =====
function validateApiKey() {
  if (!OPENAI_API_KEY) {
    return { error: "Missing or invalid OPENAI_API_KEY" };
  }
  return null;
}

function badRequest(msg) {
  throw new functions.https.HttpsError("invalid-argument", msg);
}

function authzHeader() {
  return { Authorization: `Bearer ${OPENAI_API_KEY}` };
}

// ======================================================
// 1) Realtime SDP Exchange Proxy
//    Frontend posts SDP offer here instead of OpenAI.
//    Returns the SDP answer (Content-Type: application/sdp)
// ------------------------------------------------------
exports.exchangeRealtimeSDP = onRequest(
  {
    region: REGION,
    maxInstances: 10,
    concurrency: 80,
    cors: false, // manual CORS
    timeoutSeconds: 120, // increased timeout
    memory: "512MiB", // increased memory
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST")
      return res.status(405).send("Method Not Allowed");

    // Validate API key
    const keyError = validateApiKey();
    if (keyError) {
      functions.logger.error("API key validation failed");
      return res.status(500).json(keyError);
    }

    // Accept raw SDP (Content-Type: application/sdp) or JSON { sdp, model }
    const contentType = (req.headers["content-type"] || "").toLowerCase();

    let offerSDP = "";
    let model = "gpt-4o-mini-realtime"; // set your default realtime model
    if (contentType.includes("application/sdp")) {
      offerSDP = req.rawBody?.toString("utf8") || "";
    } else {
      const body = req.body || {};
      offerSDP = (body.sdp || "").toString();
      if (typeof body.model === "string" && body.model.trim()) {
        model = body.model.trim();
      }
    }
    if (!offerSDP) badRequest("Missing SDP offer.");

    const url = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(
      model
    )}`;

    let upstream;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: {
          ...authzHeader(),
          "Content-Type": "application/sdp",
        },
        body: offerSDP,
      });
    } catch (e) {
      functions.logger.error("Realtime upstream fetch failed:", e?.message || e);
      return res.status(502).json({ 
        error: "Upstream connection failed", 
        details: e?.message || "Unknown error" 
      });
    }

    const answerSDP = await upstream.text();
    if (!upstream.ok) {
      functions.logger.error("Realtime upstream error:", upstream.status, answerSDP);
      return res.status(upstream.status).json({ 
        error: "OpenAI API error", 
        details: answerSDP || "Unknown error" 
      });
    }

    res.setHeader("Content-Type", "application/sdp");
    return res.status(200).send(answerSDP);
  }
);

// ======================================================
// 2) Responses API Proxy
//    For translate/judge/next-goal requests.
// ------------------------------------------------------
exports.proxyResponses = onRequest(
  {
    region: REGION,
    maxInstances: 20,
    concurrency: 80,
    cors: false,
    timeoutSeconds: 120, // increased timeout
    memory: "512MiB", // increased memory
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST")
      return res.status(405).send("Method Not Allowed");

    // Validate API key
    const keyError = validateApiKey();
    if (keyError) {
      functions.logger.error("API key validation failed");
      return res.status(500).json(keyError);
    }

    const body = req.body || {};
    const model = (body.model || "").toString();
    if (!model) badRequest("Missing 'model' in request body.");
    if (!ALLOWED_RESPONSE_MODELS.has(model)) {
      badRequest(
        `Model '${model}' not allowed. Allowed: ${Array.from(
          ALLOWED_RESPONSE_MODELS
        ).join(", ")}`
      );
    }

    // (Optional) Inject guardrails/metadata here:
    // body.metadata = { origin: "rbe", ...(body.metadata || {}) };

    let upstream;
    try {
      upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          ...authzHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      functions.logger.error("Responses upstream fetch failed:", e?.message || e);
      return res.status(502).json({ 
        error: "Upstream connection failed", 
        details: e?.message || "Unknown error" 
      });
    }

    const ct = upstream.headers.get("content-type") || "application/json";
    const text = await upstream.text();
    
    if (!upstream.ok) {
      functions.logger.error("Responses upstream error:", upstream.status, text);
      return res.status(upstream.status).json({ 
        error: "OpenAI API error", 
        details: text || "Unknown error" 
      });
    }
    
    res.status(upstream.status);
    res.setHeader("Content-Type", ct);
    return res.send(text);
  }
);

// ======================================================
// 4) Story Generation API
//    Generates Spanish stories with cloze exercises
// ------------------------------------------------------
exports.generateStory = onRequest(
  {
    region: REGION,
    maxInstances: 10,
    concurrency: 40,
    cors: false,
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST")
      return res.status(405).send("Method Not Allowed");

    // Validate API key
    const keyError = validateApiKey();
    if (keyError) {
      functions.logger.error("API key validation failed");
      return res.status(500).json(keyError);
    }

    const body = req.body || {};
    const { userLanguage = "en", level = "beginner", targetLang = "es" } = body;

    // Generate story using OpenAI
    const storyPrompt = `Generate a Spanish story for a ${level} learner. The story should be engaging and educational.

Requirements:
1. Create a story with exactly 4-6 sentences
2. Use simple vocabulary appropriate for ${level} level
3. Make the story engaging and culturally relevant
4. Each sentence should be 8-15 words long for good practice
5. Write each sentence separately, then combine them into a paragraph

IMPORTANT: The sentences array must contain the EXACT same sentences that make up the fullStory paragraph.

Format as JSON with this structure:
{
  "fullStory": {
    "es": "Sentence1. Sentence2. Sentence3. Sentence4.",
    "en": "English translation of the complete story"
  },
  "sentences": [
    {
      "es": "Sentence1.",
      "en": "English translation of sentence 1"
    },
    {
      "es": "Sentence2.", 
      "en": "English translation of sentence 2"
    },
    {
      "es": "Sentence3.",
      "en": "English translation of sentence 3"
    },
    {
      "es": "Sentence4.",
      "en": "English translation of sentence 4"
    }
  ]
}

Generate an engaging Spanish story now:`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          ...authzHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a Spanish language teacher. Generate educational stories with cloze exercises. Always respond with valid JSON only."
            },
            {
              role: "user",
              content: storyPrompt
            }
          ],
          temperature: 0.7,
          max_tokens: 1500
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        functions.logger.error("OpenAI API error:", response.status, errorText);
        return res.status(response.status).json({
          error: "OpenAI API error",
          details: errorText
        });
      }

      const data = await response.json();
      const storyContent = data.choices?.[0]?.message?.content;

      if (!storyContent) {
        return res.status(500).json({
          error: "No story content generated"
        });
      }

      // Parse the JSON response
      let storyData;
      try {
        storyData = JSON.parse(storyContent);
        
        // Validate and fix sentence matching
        if (storyData.fullStory && storyData.sentences && storyData.sentences.length > 0) {
          // Extract sentences from fullStory to ensure they match
          const fullStoryText = storyData.fullStory.es;
          const sentencesFromStory = fullStoryText.split(/[.!?]+/).filter(s => s.trim()).map(s => s.trim() + '.');
          
          // If sentences don't match, reconstruct them from the full story
          if (sentencesFromStory.length === storyData.sentences.length) {
            const reconstructedSentences = [];
            for (let i = 0; i < sentencesFromStory.length; i++) {
              reconstructedSentences.push({
                es: sentencesFromStory[i],
                en: storyData.sentences[i]?.en || `[Translation needed for: ${sentencesFromStory[i]}]`
              });
            }
            storyData.sentences = reconstructedSentences;
            functions.logger.info("Reconstructed sentences to match full story");
          }
        }
        
      } catch (parseError) {
        functions.logger.error("Failed to parse story JSON:", parseError);
        // Fallback story if parsing fails
        storyData = {
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
      }

      res.setHeader("Content-Type", "application/json");
      return res.status(200).json({
        story: storyData,
        metadata: {
          level,
          targetLang,
          userLanguage,
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      functions.logger.error("Story generation error:", error);
      return res.status(500).json({
        error: "Story generation failed",
        details: error.message
      });
    }
  }
);

// ======================================================
// 5) Real-time Story Generation Handler
//    Handles WebRTC data channel messages for story generation
// ------------------------------------------------------
exports.handleRealtimeStory = onRequest(
  {
    region: REGION,
    maxInstances: 10,
    concurrency: 40,
    cors: false,
    timeoutSeconds: 300, // 5 minutes for real-time generation
    memory: "1GiB", // More memory for real-time processing
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "GET")
      return res.status(405).send("Method Not Allowed");

    // Validate API key
    const keyError = validateApiKey();
    if (keyError) {
      functions.logger.error("API key validation failed");
      return res.status(500).json(keyError);
    }

    // Get parameters from query string
    const { level = "beginner", language = "es", userLanguage = "en" } = req.query;

    try {
      // Start generating a story using GPT-4o mini
      await generateRealtimeStory(res, level, language, userLanguage);
    } catch (error) {
      functions.logger.error("Real-time story generation error:", error);
      res.status(500).json({
        error: "Real-time story generation failed",
        details: error.message
      });
    }
  }
);

// Generate story in real-time using streaming
async function generateRealtimeStory(res, level, language, userLanguage) {
  try {
    functions.logger.info(`Starting real-time story generation for ${level} level`);
    
    // Set up Server-Sent Events for real-time streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const storyPrompt = `Generate a Spanish story for a ${level} learner. Create a flowing narrative that tells a complete story.

Requirements:
1. Write in Spanish (${language})
2. Use vocabulary appropriate for ${level} level
3. Create 4-6 sentences that form a complete story
4. Make it engaging and educational
5. Each sentence should be 8-15 words long
6. Include cultural elements when possible

Generate the story sentence by sentence, sending each sentence as it's created. Start with "Había una vez..." or similar story opening.

Format each response as JSON:
{
  "type": "story_text",
  "text": "sentence text here",
  "sentenceNumber": 1
}

When the story is complete, send:
{
  "type": "story_complete",
  "message": "Story generation complete"
}`;

    // Use OpenAI streaming API for real-time generation
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        ...authzHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a Spanish language teacher creating educational stories. Generate stories sentence by sentence, sending each sentence as JSON. Always respond with valid JSON only."
          },
          {
            role: "user",
            content: storyPrompt
          }
        ],
        temperature: 0.8,
        max_tokens: 1000,
        stream: true
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      functions.logger.error("OpenAI streaming error:", response.status, errorText);
      res.write(`data: ${JSON.stringify({ type: "error", message: "Story generation failed" })}\n\n`);
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sentenceCount = 0;
    let currentStory = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Send completion message
              res.write(`data: ${JSON.stringify({ type: "story_complete", message: "Story generation complete" })}\n\n`);
              res.end();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                currentStory += content;
                
                // Check if we have a complete sentence
                if (content.includes('.') || content.includes('!') || content.includes('?')) {
                  const sentences = currentStory.split(/[.!?]+/).filter(s => s.trim());
                  if (sentences.length > sentenceCount + 1) {
                    const newSentence = sentences[sentenceCount].trim();
                    if (newSentence) {
                      sentenceCount++;
                      res.write(`data: ${JSON.stringify({ 
                        type: "story_text", 
                        text: newSentence + '.',
                        sentenceNumber: sentenceCount 
                      })}\n\n`);
                    }
                  }
                }
              }
            } catch (parseError) {
              // Skip invalid JSON lines
              continue;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Send any remaining story content
    if (currentStory.trim()) {
      const sentences = currentStory.split(/[.!?]+/).filter(s => s.trim());
      for (let i = sentenceCount; i < sentences.length; i++) {
        const sentence = sentences[i].trim();
        if (sentence) {
          res.write(`data: ${JSON.stringify({ 
            type: "story_text", 
            text: sentence + '.',
            sentenceNumber: i + 1 
          })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: "story_complete", message: "Story generation complete" })}\n\n`);
    res.end();

  } catch (error) {
    functions.logger.error("Real-time story generation error:", error);
    res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
    res.end();
  }
}

// ======================================================
// 6) OpenAI TTS Proxy
//    Converts text to speech using OpenAI's high-quality voices
// ------------------------------------------------------
exports.proxyTTS = onRequest(
  {
    region: REGION,
    maxInstances: 20,
    concurrency: 80,
    cors: false,
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST")
      return res.status(405).send("Method Not Allowed");

    // Validate API key
    const keyError = validateApiKey();
    if (keyError) {
      functions.logger.error("API key validation failed");
      return res.status(500).json(keyError);
    }

    const body = req.body || {};
    const { input, voice = "alloy", model = "tts-1", response_format = "mp3" } = body;

    if (!input) {
      return res.status(400).json({ error: "Missing 'input' text" });
    }

    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          ...authzHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input,
          voice,
          response_format
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        functions.logger.error("OpenAI TTS error:", response.status, errorText);
        return res.status(response.status).json({
          error: "OpenAI TTS error",
          details: errorText
        });
      }

      const audioBuffer = await response.arrayBuffer();
      
      res.setHeader("Content-Type", `audio/${response_format}`);
      res.setHeader("Content-Length", audioBuffer.byteLength);
      return res.send(Buffer.from(audioBuffer));

    } catch (error) {
      functions.logger.error("TTS proxy error:", error);
      return res.status(500).json({
        error: "TTS generation failed",
        details: error.message
      });
    }
  }
);

// ======================================================
// 7) Health check (handy for debugging)
// ------------------------------------------------------
exports.health = onRequest(
  { 
    region: REGION, 
    cors: false, // manual CORS for testing
    timeoutSeconds: 30,
    memory: "256MiB"
  },
  async (req, res) => {
    if (applyCors(req, res)) return;
    
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(
      JSON.stringify({
        ok: true,
        projectId: functions.params.projectId || admin.app().options.projectId,
        appCheckRequired: REQUIRE_APPCHECK,
        openaiConfigured: Boolean(OPENAI_API_KEY),
        time: new Date().toISOString(),
      })
    );
  }
);
