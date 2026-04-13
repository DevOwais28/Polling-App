import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

console.error("🚀 CHATBOT MODULE LOADED - VERSION 3.1 CLEAN");
console.error("⏰ Timestamp:", new Date().toISOString());

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_KEY });
const index = pinecone.index("service-bot");
let extractor = null;

async function getEmbedder() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

export const getVersion = (req, res) => {
  res.json({ version: "3.1-clean", time: Date.now() });
};

export const handleQuery = async (req, res) => {
  // No cache
  res.setHeader('Cache-Control', 'no-store');
  
  try {
    const { query } = req.body;
    
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query required" });
    }

    const rawQuery = query.trim();
    const qLower = rawQuery.toLowerCase();

    console.error(`\n[QUERY] "${rawQuery}"`);

    // 1. Small talk
    const smallTalk = ['hi', 'hello', 'hey', 'yo', 'bye', 'goodbye', 'thanks'];
    if (smallTalk.includes(qLower)) {
      return res.json({ answer: "Hello! 👋 Ask me about WePollin features, polls, or pricing." });
    }

    // 2. STRICT KEYWORD CHECK (The fix!)
    const keywords = ['wepollin', 'poll', 'polls', 'voting', 'vote', 'survey', 
                     'feature', 'pricing', 'price', 'cost', 'account', 'login', 
                     'signup', 'privacy', 'security', 'support', 'help', 
                     'create', 'share', 'analytics'];
    
    const hasKeyword = keywords.some(k => qLower.includes(k));
    console.error(`[KEYWORD_CHECK] Has keyword: ${hasKeyword}`);

    if (!hasKeyword) {
      console.error(`[BLOCKED] No keywords matched`);
      return res.json({
        answer: "I can only answer questions about WePollin (polls, features, pricing, support, etc.). How can I help you today?"
      });
    }

    // 3. Definition query check
    if (/^(what is|what's|define).*wepollin/i.test(rawQuery)) {
      return res.json({
        answer: "WePollin is an interactive polling application that lets users create, share, and participate in polls with real-time results and analytics."
      });
    }

    // 4. Vector search
    console.error(`[SEARCH] Starting vector search...`);
    const embedder = await getEmbedder();
    const output = await embedder(rawQuery, { pooling: "mean", normalize: true });
    const vector = Array.isArray(output) ? output[0] : Array.from(output.data);
    
    const result = await index.query({ 
      vector, 
      topK: 5, 
      includeMetadata: true 
    });

    const matches = result?.matches?.filter(m => m?.metadata?.text) || [];
    console.error(`[SEARCH] Found ${matches.length} matches`);

    if (matches.length === 0) {
      return res.json({ answer: "I couldn't find specific information about that." });
    }

    // 5. Score check and generic blocker
    const best = matches[0];
    const score = best.score || 0;
    const text = best.metadata.text;
    
    console.error(`[RESULT] Score: ${score}, Text: "${text.substring(0, 50)}..."`);

    if (score < 0.6) {
      return res.json({ answer: "I'm not sure about that. Try asking about specific features or how to create a poll." });
    }

    // Block generic intro for non-definition queries
    const isGeneric = text.toLowerCase().includes("wepollin is an interactive polling application") && text.length < 250;
    
    if (isGeneric && !/what.*wepollin/i.test(rawQuery)) {
      console.error(`[GENERIC_BLOCK] Prevented generic response`);
      // Try next match
      const next = matches.slice(1).find(m => 
        !(m.metadata.text.toLowerCase().includes("wepollin is an interactive polling application") && m.metadata.text.length < 250)
      );
      
      if (next && next.score > 0.5) {
        return res.json({ answer: next.metadata.text.substring(0, 500) });
      }
      
      return res.json({
        answer: "Could you be more specific? Ask about creating polls, pricing, features, or privacy settings."
      });
    }

    // Return answer
    const answer = text.length > 600 ? text.substring(0, 600) + "..." : text;
    return res.json({ answer });

  } catch (err) {
    console.error(`[ERROR]`, err.message);
    return res.status(500).json({ error: "Server error", answer: "Something went wrong. Please try again." });
  }
};
