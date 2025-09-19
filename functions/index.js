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
const ALLOWED_RESPONSE_MODELS = new Set(["gpt-4o-mini", "gpt-4o", "o4-mini"]);

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
    let model = "gpt-4o-realtime-preview"; // set your default realtime model
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
// 3) Health check (handy for debugging)
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
