import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

// Init Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_KEY,
});
const index = pinecone.index("service-bot");

// Load local MiniLM embedder
let extractor = null;
async function getEmbedder() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

// Clean text before returning
function clean(text) {
  return text
    .replace(/#+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/(General Information|What is WePollin|Frequently Asked Questions)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract first 1-2 sentences
function extractAnswer(text, max = 2) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);

  return sentences.slice(0, max).join(" ");
}

// ------------------------
// MAIN PINECONE QUERY HANDLER
// ------------------------
export const handleQuery = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return res.status(400).json({ error: "Query is required" });
    }

    const normalized = query.trim().toLowerCase();

    // Quick responses for simple greetings / farewells
    if (/^(hi|hello|hey|salam|assalam ?o ?alaikum|assalamu ?alaikum)[!. ]*$/i.test(normalized)) {
      return res.json({
        answer: "Hi! I'm the WePollin assistant. I can help you with questions about features, polls, pricing, privacy, and how to use WePollin.",
      });
    }

    if (/^(bye|goodbye|allah hafiz|ciao|see you)[!. ]*$/i.test(normalized)) {
      return res.json({
        answer: "Goodbye! If you have more questions about WePollin later, just open the chat again.",
      });
    }

    // If the user explicitly asks about WePollin in general, answer directly
    if (normalized.includes("wepollin")) {
      return res.json({
        answer:
          "WePollin is an interactive polling application that lets you create, share, and participate in polls with real-time results, rich analytics, and privacy controls—all in a simple, mobile-friendly interface.",
      });
    }

    // Embed query
    const embedder = await getEmbedder();
    const enhanced = `User question about WePollin: ${query}`;
    const output = await embedder(enhanced, { pooling: "mean", normalize: true });

    // Handle different output shapes from the embedder
    let vector;
    if (Array.isArray(output)) {
      vector = output[0];
    } else if (output && output.data) {
      vector = Array.from(output.data);
    } else {
      vector = output;
    }

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Failed to create embedding vector");
    }

    // Build a simple topic-aware filter based on query keywords
    const q = query.toLowerCase();
    let filter = undefined;

    if (/feature/.test(q)) {
      filter = { topic: "features" };
    } else if (/price|pricing|cost|free|paid|subscription/.test(q)) {
      filter = { topic: "pricing" };
    } else if (/account|sign ?up|login|log in|password/.test(q)) {
      filter = { topic: "account" };
    } else if (/poll/.test(q)) {
      filter = { topic: "polls" };
    } else if (/privacy|data|secure|security/.test(q)) {
      filter = { topic: "privacy" };
    } else if (/trouble|error|issue|problem|not working/.test(q)) {
      filter = { topic: "troubleshooting" };
    } else if (/support|help|contact/.test(q)) {
      filter = { topic: "support" };
    }

    // Query Pinecone
    const result = await index.query({
      vector,
      topK: 5,
      includeMetadata: true,
      ...(filter ? { filter } : {}),
    });

    const matches = Array.isArray(result?.matches) ? result.matches : [];

    if (matches.length === 0) {
      return res.json({
        answer: "I couldn't find an answer for that in the knowledge base.",
      });
    }

    // Sort by score and pick the best
    const sorted = matches
      .filter(m => m && m.metadata && m.metadata.text)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    if (sorted.length === 0) {
      return res.json({
        answer: "I couldn't find an answer for that in the knowledge base.",
      });
    }

    const best = sorted[0];

    // If the best match is not similar enough, treat it as out-of-domain
    const score = typeof best.score === "number" ? best.score : 0;
    const RELEVANCE_THRESHOLD = 0.4; // tune as needed

    if (score < RELEVANCE_THRESHOLD) {
      return res.json({
        answer:
          "I can only answer questions about WePollin (its features, polls, pricing, privacy, and how to use it). Please ask something related to WePollin.",
      });
    }

    const cleaned = clean(best.metadata.text);
    const answer = extractAnswer(cleaned, 2);

    return res.json({ answer });

  } catch (err) {
    console.error("Query error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
