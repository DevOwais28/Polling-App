import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_KEY });
const index = pinecone.index("service-bot");
let extractor = null;

async function getEmbedder() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

function clean(text) {
  return text
    .replace(/#+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/(General Information|What is WePollin|Frequently Asked Questions)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// STRICT: Exact word matching only
function containsWePollinKeyword(q) {
  const keywords = [
    'wepollin', 'poll', 'polls', 'polling', 'voting', 'vote', 'voter',
    'survey', 'feature', 'features', 'pricing', 'price', 'cost', 'plan', 'plans',
    'account', 'login', 'signup', 'sign up', 'register', 'password', 'email',
    'privacy', 'private', 'secure', 'security', 'protected',
    'support', 'help', 'contact', 'customer service',
    'analytics', 'results', 'stats', 'statistics', 'reports',
    'create', 'share', 'embed', 'widget', 'dashboard',
    'user', 'admin', 'settings', 'profile', 'subscription', 'upgrade'
  ];
  
  const words = q.toLowerCase().split(/\s+/);
  const found = keywords.some(kw => words.includes(kw) || q.toLowerCase().includes(kw));
  
  console.error(`[KEYWORD_CHECK] Query: "${q}" | Found keyword: ${found} | Words: [${words.join(', ')}]`);
  return found;
}

function isDefinitionQuery(q) {
  const isDef = /^(what is|what's|define|explain what|tell me what|describe what|how does).*wepollin/i.test(q.trim());
  console.error(`[DEF_CHECK] Query: "${q}" | Is definition: ${isDef}`);
  return isDef;
}

function isGenericResponse(text) {
  const t = text.toLowerCase();
  const isGeneric = t.includes("wepollin is an interactive polling application") && t.length < 250;
  console.error(`[GENERIC_CHECK] Text preview: "${t.substring(0, 50)}..." | Is generic: ${isGeneric}`);
  return isGeneric;
}

// =========================================================
// DEBUG ENDPOINT - Add this to your routes to verify deployment
// =========================================================
export const getVersion = (req, res) => {
  res.json({ 
    version: "2.0-debug", 
    timestamp: new Date().toISOString(),
    node_env: process.env.NODE_ENV || 'development'
  });
};

// =========================================================
// REQUEST LOGGER MIDDLEWARE - Add this before your routes
// =========================================================
export const requestLogger = (req, res, next) => {
  console.error(`[REQUEST] ${req.method} ${req.path} | Body:`, JSON.stringify(req.body));
  
  // Log response status when finished
  res.on('finish', () => {
    console.error(`[RESPONSE] ${req.method} ${req.path} | Status: ${res.statusCode}`);
  });
  
  next();
};

// =========================================================
// MAIN HANDLER WITH DEBUGGING
// =========================================================
export const handleQuery = async (req, res) => {
  // Force no-cache headers to prevent CDN/stale responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  
  console.error(`\n========== NEW REQUEST ==========`);
  console.error(`[TIME] ${new Date().toISOString()}`);
  
  try {
    const { query } = req.body;
    
    console.error(`[RAW_BODY]`, JSON.stringify(req.body));
    console.error(`[EXTRACTED_QUERY] "${query}" | Type: ${typeof query}`);

    if (!query || typeof query !== "string" || query.trim().length < 1) {
      console.error(`[GUARD_HIT] Empty or invalid query`);
      return res.status(400).json({ error: "Query is required" });
    }

    const rawQuery = query.trim();
    const qLower = rawQuery.toLowerCase();

    console.error(`[PROCESSING] "${rawQuery}"`);

    // EMERGENCY HARD BLOCK - For testing if code is deployed
    if (qLower === 'sky is blue' || qLower === 'blue' || qLower.includes('sky')) {
      console.error(`[EMERGENCY_BLOCK] Blocked off-topic query: "${rawQuery}"`);
      return res.json({
        answer: "🚫 BLOCKED: I can only answer WePollin questions.",
        debug: "If you see this message, the NEW code is running correctly!",
        query_received: rawQuery
      });
    }

    // Layer 1: Empty check
    if (rawQuery.length < 2) {
      console.error(`[LAYER_1] Too short`);
      return res.json({
        answer: "Please type a full question about WePollin."
      });
    }

    // Layer 2: Small talk
    const smallTalk = ['hi', 'hello', 'hey', 'yo', 'salam', 'good morning', 'good afternoon', 'good evening', 'howdy', 'greetings', 'bye', 'goodbye', 'see you', 'thanks', 'thank you'];
    if (smallTalk.includes(qLower)) {
      console.error(`[LAYER_2] Small talk detected`);
      return res.json({
        answer: "Hello! 👋 I'm your WePollin assistant. Ask me about creating polls, features, pricing, or how to use the platform!"
      });
    }

    // Layer 3: Keyword check
    console.error(`[LAYER_3] Checking keywords...`);
    const isRelated = containsWePollinKeyword(rawQuery);
    
    if (!isRelated) {
      console.error(`[LAYER_3_BLOCK] Query failed keyword check`);
      return res.json({
        answer: "I can only answer questions about WePollin - such as creating polls, features, pricing, privacy, and support. How can I help you today?",
        debug_info: { query: rawQuery, reason: "no_keywords_matched" }
      });
    }
    console.error(`[LAYER_3_PASS] Keywords matched`);

    // Layer 4: Definition query
    if (isDefinitionQuery(rawQuery)) {
      console.error(`[LAYER_4] Definition query - returning static response`);
      return res.json({
        answer: "WePollin is an interactive polling application that lets users create, share, and participate in polls with real-time results, analytics, and privacy controls."
      });
    }

    // Layer 5: Vector search
    console.error(`[LAYER_5] Starting vector search...`);
    const embedder = await getEmbedder();
    console.error(`[LAYER_5] Embedder ready`);
    
    const output = await embedder(rawQuery, { pooling: "mean", normalize: true });
    console.error(`[LAYER_5] Embedding generated`);
    
    let vector = Array.isArray(output) ? output[0] : 
                 output?.data ? Array.from(output.data) : output;
    
    if (!Array.isArray(vector) || vector.length === 0) {
      console.error(`[LAYER_5_ERROR] Embedding failed`);
      throw new Error("Embedding failed");
    }

    console.error(`[LAYER_5] Querying Pinecone...`);
    const result = await index.query({
      vector,
      topK: 5,
      includeMetadata: true
    });
    console.error(`[LAYER_5] Pinecone returned ${result?.matches?.length || 0} matches`);

    const matches = result?.matches?.filter(m => m?.metadata?.text) || [];
    
    if (matches.length === 0) {
      console.error(`[LAYER_5] No matches found`);
      return res.json({
        answer: "I couldn't find information about that specific topic."
      });
    }

    const bestMatch = matches[0];
    const score = bestMatch?.score || 0;
    const text = bestMatch?.metadata?.text || "";

    console.error(`[LAYER_6] Best match score: ${score}`);
    console.error(`[LAYER_6] Best match text preview: "${text.substring(0, 80)}..."`);

    // Layer 6: Relevance check
    if (score < 0.6) {
      console.error(`[LAYER_6_BLOCK] Score ${score} below threshold 0.6`);
      return res.json({
        answer: "I'm not sure I understood that correctly. Could you rephrase or ask about a specific WePollin feature?"
      });
    }

    // Layer 7: Generic response check
    console.error(`[LAYER_7] Checking if response is generic...`);
    if (isGenericResponse(text) && !isDefinitionQuery(rawQuery)) {
      console.error(`[LAYER_7_BLOCK] Generic response detected for non-definition query`);
      
      // Try next best match
      const nextBest = matches.slice(1).find(m => !isGenericResponse(m.metadata?.text));
      if (nextBest && nextBest.score > 0.5) {
        console.error(`[LAYER_7_FALLBACK] Using next best match with score ${nextBest.score}`);
        return res.json({ 
          answer: clean(nextBest.metadata.text).substring(0, 500),
          source: "fallback_match"
        });
      }
      
      console.error(`[LAYER_7_FAIL] No better match available`);
      return res.json({
        answer: "Could you be more specific? You can ask about: creating polls, sharing options, pricing plans, privacy settings, or analytics features."
      });
    }

    // Layer 8: Return response
    console.error(`[LAYER_8] Returning successful response`);
    const cleaned = clean(text);
    const answer = cleaned.length > 600 ? cleaned.substring(0, 600) + "..." : cleaned;
    
    console.error(`[SUCCESS] Response length: ${answer.length}`);
    console.error(`========== END REQUEST ==========\n`);
    
    return res.json({ answer });

  } catch (err) {
    console.error(`[ERROR]`, err);
    console.error(`[STACK]`, err.stack);
    return res.status(500).json({ 
      error: "Server error",
      message: err.message,
      answer: "Sorry, I'm having trouble processing your question."
    });
  }
};
