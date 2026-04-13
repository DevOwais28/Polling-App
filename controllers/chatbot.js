import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

// ------------------------
// INIT
// ------------------------
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_KEY,
});

const index = pinecone.index("service-bot");

let extractor = null;

async function getEmbedder() {
  if (!extractor) {
    extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }
  return extractor;
}

// ------------------------
// HELPERS
// ------------------------
function clean(text) {
  return text
    .replace(/#+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/(General Information|What is WePollin|Frequently Asked Questions)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAnswer(text, max = 2) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  return sentences.slice(0, max).join(" ");
}

// ------------------------
// MAIN HANDLER
// ------------------------
export const handleQuery = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return res.status(400).json({ error: "Query is required" });
    }

    const normalized = query.trim().toLowerCase();
    const q = normalized;

    // ------------------------
    // 1. SMALL TALK / GREETING (BLOCK BEFORE EVERYTHING)
    // ------------------------
    if (/^(hi|hello|hey|yo|salam|assalam.*|assalamu.*)$/i.test(q)) {
      return res.json({
        answer:
          "Hey! 👋 I’m the WePollin assistant. Ask me about polls, features, pricing, or support.",
      });
    }

    if (/^(bye|goodbye|allah hafiz|see you|ciao)$/i.test(q)) {
      return res.json({
        answer: "Goodbye! 👋 Feel free to ask anytime about WePollin.",
      });
    }

    // ------------------------
    // 2. DIRECT WEPPOLLIN QUESTION
    // ------------------------
    if (q.includes("wepollin")) {
      return res.json({
        answer:
          "WePollin is an interactive polling application that lets users create, share, and participate in polls with real-time results, analytics, and privacy controls.",
      });
    }

    // ------------------------
    // 3. EMBEDDING (NO BIAS)
    // ------------------------
    const embedder = await getEmbedder();
    const output = await embedder(q, {
      pooling: "mean",
      normalize: true,
    });

    let vector;

    if (Array.isArray(output)) {
      vector = output[0];
    } else if (output?.data) {
      vector = Array.from(output.data);
    } else {
      vector = output;
    }

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Embedding failed");
    }

    // ------------------------
    // 4. INTENT FILTERING
    // ------------------------
    let filter;

    if (/feature/.test(q)) filter = { topic: "features" };
    else if (/price|pricing|cost|free|paid/.test(q))
      filter = { topic: "pricing" };
    else if (/account|login|sign/.test(q)) filter = { topic: "account" };
    else if (/poll/.test(q)) filter = { topic: "polls" };
    else if (/privacy|secure|data/.test(q)) filter = { topic: "privacy" };
    else if (/error|issue|problem/.test(q))
      filter = { topic: "troubleshooting" };
    else if (/support|help|contact/.test(q))
      filter = { topic: "support" };

    // ------------------------
    // 5. PINECONE QUERY
    // ------------------------
    const result = await index.query({
      vector,
      topK: 5,
      includeMetadata: true,
      ...(filter ? { filter } : {}),
    });

    const matches = result?.matches || [];

    if (!matches.length) {
      return res.json({
        answer: "I couldn't find anything in the WePollin knowledge base.",
      });
    }

    const sorted = matches
      .filter(m => m?.metadata?.text)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    if (!sorted.length) {
      return res.json({
        answer: "I couldn't find anything in the WePollin knowledge base.",
      });
    }

    const best = sorted[0];
    const score = best?.score || 0;

    // ------------------------
    // 6. STRONG RELEVANCE THRESHOLD (FIXED)
    // ------------------------
    const RELEVANCE_THRESHOLD = 0.65;

    if (score < RELEVANCE_THRESHOLD) {
      return res.json({
        answer:
          "I can only answer WePollin-related questions. Please ask about features, polls, pricing, or support.",
      });
    }

    // ------------------------
    // 7. BLOCK GENERIC DOC TAKEOVER (CRITICAL FIX)
    // ------------------------
    const text = best?.metadata?.text?.toLowerCase() || "";

    const isGenericDoc =
      text.includes("wepollin is an interactive polling application");

    if (isGenericDoc && !q.includes("what is wepollin")) {
      return res.json({
        answer:
          "Ask something specific about WePollin like features, polls, pricing, or support.",
      });
    }

    // ------------------------
    // 8. FINAL ANSWER
    // ------------------------
    const cleaned = clean(best.metadata.text);
    const answer = extractAnswer(cleaned, 2);

    return res.json({ answer });
  } catch (err) {
    console.error("Query error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
