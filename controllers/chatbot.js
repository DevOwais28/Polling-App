import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

// STARTUP LOG - This MUST appear in Railway logs if new code runs
console.error("🚀 CHATBOT MODULE LOADED - VERSION 3.0 DEBUG");
console.error("⏰ Timestamp:", new Date().toISOString());

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_KEY });
const index = pinecone.index("service-bot");
let extractor = null;

async function getEmbedder() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.error("✅ Embedder initialized");
  }
  return extractor;
}

// TEST ENDPOINT - Visit this to verify
export const getVersion = (req, res) => {
  console.error("📍 /api/version HIT");
  res.json({ 
    version: "3.0-emergency", 
    time: Date.now(),
    env: process.env.NODE_ENV 
  });
};

// MAIN HANDLER
export const handleQuery = async (req, res) => {
  // Force no cache
  res.setHeader('Cache-Control', 'no-store');
  
  console.error("\n🔥 HANDLEQUERY CALLED");
  console.error("📨 Body:", JSON.stringify(req.body));
  
  const { query } = req.body;
  
  if (!query) {
    console.error("❌ No query provided");
    return res.status(400).json({ error: "Missing query" });
  }
  
  console.error("📝 Query:", query);
  
  // EMERGENCY BLOCK
  if (query.toLowerCase().includes('sky') || query.toLowerCase() === 'blue') {
    console.error("🚫 EMERGENCY BLOCK TRIGGERED");
    return res.json({ 
      answer: "🚫 BLOCKED: New code is running!",
      query: query
    });
  }
  
  // Check if related
  const keywords = ['wepollin', 'poll', 'feature', 'pricing', 'account', 'vote', 'survey'];
  const isRelated = keywords.some(k => query.toLowerCase().includes(k));
  
  console.error("🔍 isRelated:", isRelated);
  
  if (!isRelated) {
    console.error("❌ Not related - blocking");
    return res.json({
      answer: "I can only answer WePollin questions (polls, features, pricing, etc.)"
    });
  }
  
  // If related, do vector search
  try {
    console.error("🔮 Getting embedding...");
    const embedder = await getEmbedder();
    const output = await embedder(query, { pooling: "mean", normalize: true });
    const vector = Array.isArray(output) ? output[0] : Array.from(output.data);
    
    console.error("🔍 Querying Pinecone...");
    const result = await index.query({ vector, topK: 3, includeMetadata: true });
    
    console.error("📊 Matches:", result.matches?.length || 0);
    
    if (!result.matches?.length) {
      return res.json({ answer: "No relevant info found." });
    }
    
    const best = result.matches[0];
    console.error("⭐ Best score:", best.score);
    
    return res.json({ 
      answer: best.metadata.text.substring(0, 300),
      score: best.score
    });
    
  } catch (err) {
    console.error("💥 ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
