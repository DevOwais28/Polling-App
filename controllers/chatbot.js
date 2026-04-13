import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_KEY,
});

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

function extractAnswer(text, maxSentences = 4) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  return sentences.slice(0, maxSentences).join(" ");
}

// IMPROVED: Stricter keyword detection with word boundaries
function isQueryRelatedToWePollin(q) {
  const keywords = [
    /\bwepollin\b/i,  // Exact word match
    /\bpoll\b/i,      // Exact word "poll" (not "polling" unless needed)
    /\bpolls\b/i,
    /\bvoting\b/i,
    /\bvote\b/i,
    /\bsurvey\b/i,
    /\bfeature\b/i,
    /\bpricing\b/i,
    /\bprice\b/i,
    /\bcost\b/i,
    /\bfree\b/i,
    /\baccount\b/i,
    /\blogin\b/i,
    /\bsignup\b/i,
    /\bregister\b/i,
    /\bprivacy\b/i,
    /\bsecurity\b/i,
    /\bsupport\b/i,
    /\bhelp\b/i,
    /\bcontact\b/i,
    /\banalytics\b/i,
    /\bresult\b/i,
    /\bcreate\b/i,    // "create a poll"
    /\bshare\b/i,     // "share poll"
    /\bembed\b/i,
    /\bwidget\b/i
  ];
  
  return keywords.some(regex => regex.test(q));
}

// NEW: Detect if response is generic intro
function isGenericIntro(text) {
  const t = text.toLowerCase();
  return t.includes("wepollin is an interactive polling application") && 
         t.length < 300; // Short generic descriptions only
}

// NEW: Detect if query is asking for definition
function isDefinitionQuery(q) {
  return /^(what is|what's|define|explain what|tell me what)\s+wepollin/i.test(q.trim());
}

export const handleQuery = async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return res.status(400).json({ error: "Query is required" });
    }

    const q = query.trim();
    const qLower = q.toLowerCase();

    // =========================================================
    // 1. SMALL TALK HANDLING
    // =========================================================
    const greetings = /^(hi|hello|hey|yo|salam|good morning|good afternoon|good evening|howdy|greetings)[\s!]*$/i;
    const goodbyes = /^(bye|goodbye|see you|later|cya)[\s!]*$/i;
    
    if (greetings.test(q)) {
      return res.json({
        answer: "Hey there! 👋 I can help you with questions about WePollin features, creating polls, pricing, and support. What would you like to know?"
      });
    }
    
    if (goodbyes.test(q)) {
      return res.json({
        answer: "Goodbye! Feel free to come back if you have any WePollin questions. 👋"
      });
    }

    // =========================================================
    // 2. STRICT OFF-TOPIC GUARD (Fix for "sky is blue")
    // =========================================================
    if (!isQueryRelatedToWePollin(q)) {
      console.log(`Blocked off-topic query: "${q}"`); // Debug logging
      return res.json({
        answer: "I can only answer questions about WePollin - such as creating polls, features, pricing, privacy, and support. How can I help you with WePollin today?"
      });
    }

    // =========================================================
    // 3. DIRECT DEFINITION HANDLER
    // =========================================================
    if (isDefinitionQuery(q)) {
      return res.json({
        answer: "WePollin is an interactive polling application that lets users create, share, and participate in polls with real-time results, analytics, and privacy controls."
      });
    }

    // =========================================================
    // 4. EMBEDDING SEARCH
    // =========================================================
    const embedder = await getEmbedder();
    const output = await embedder(q, { pooling: "mean", normalize: true });
    
    let vector = Array.isArray(output) ? output[0] : 
                 output?.data ? Array.from(output.data) : output;
    
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Embedding failed");
    }

    // Query Pinecone without hard filters (let semantic search work)
    const result = await index.query({
      vector,
      topK: 5,
      includeMetadata: true
    });

    let matches = result?.matches || [];

    if (!matches.length) {
      return res.json({
        answer: "I couldn't find specific information about that. Could you rephrase your question about WePollin?"
      });
    }

    // Filter and sort by score
    matches = matches.filter(m => m?.metadata?.text);
    const best = matches[0];
    const score = best?.score || 0;

    // =========================================================
    // 5. RELEVANCE THRESHOLD CHECK
    // =========================================================
    if (score < 0.6) {
      return res.json({
        answer: "I'm not sure I understood that correctly. Could you ask about specific WePollin features, how to create a poll, or our pricing plans?"
      });
    }

    // =========================================================
    // 6. SAFETY NET: Prevent generic response for specific questions
    // =========================================================
    const text = best.metadata.text || "";
    
    // If we got the generic intro but user didn't ask "what is wepollin"
    if (isGenericIntro(text) && !isDefinitionQuery(q)) {
      // Try to find a better match in top 3
      const betterMatch = matches.slice(1, 3).find(m => 
        !isGenericIntro(m.metadata?.text || "")
      );
      
      if (betterMatch && betterMatch.score > 0.5) {
        return res.json({ 
          answer: extractAnswer(clean(betterMatch.metadata.text)) 
        });
      }
      
      // If no better match, guide user to be specific
      return res.json({
        answer: "I found general information, but your question seems specific. Could you clarify? For example: 'How do I create a poll?' or 'What are the pricing plans?'"
      });
    }

    // =========================================================
    // 7. RETURN ANSWER
    // =========================================================
    return res.json({
      answer: extractAnswer(clean(text))
    });

  } catch (err) {
    console.error("Query error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
