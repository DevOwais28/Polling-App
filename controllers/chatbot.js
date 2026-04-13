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
    .replace(
      /(General Information|What is WePollin|Frequently Asked Questions)/gi,
      ""
    )
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

    const q = query.trim().toLowerCase();

    // =========================================================
    // 1. SMALL TALK / SAFETY GATE (BEFORE EVERYTHING)
    // =========================================================
    const isWePollinRelated =
      /wepollin|poll|feature|pricing|account|login|signup|privacy|support|help|contact|security/i.test(
        q
      );

    const isSmallTalk =
      /^(hi|hello|hey|yo|salam|bye|goodbye|are you dumb|wtf|lol|what do you udi)$/i.test(
        q
      );

    if (isSmallTalk && !isWePollinRelated) {
      return res.json({
        answer:
          "I'm here to help you with WePollin-related questions 😊 Ask me about polls, features, pricing, or support.",
      });
    }

    if (isSmallTalk) {
      return res.json({
        answer:
          "Hey 👋 How can I help you with WePollin today?",
      });
    }

    // =========================================================
    // 2. DIRECT WEPPOLLIN EXPLANATION
    // =========================================================
    if (q.includes("wepollin") && q.includes("what")) {
      return res.json({
        answer:
          "WePollin is an interactive polling application that lets users create, share, and participate in polls with real-time results, analytics, and privacy controls.",
      });
    }

    // =========================================================
    // 3. BLOCK COMPLETELY UNRELATED QUERIES
    // =========================================================
    if (!isWePollinRelated) {
      return res.json({
        answer:
          "I can only answer questions about WePollin (features, polls, pricing, accounts, and support).",
      });
    }

    // =========================================================
    // 4. EMBEDDING (NO BIAS)
    // =========================================================
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

    // =========================================================
    // 5. INTENT FILTERING
    // =========================================================
    let filter;

    if (/feature/.test(q)) filter = { topic: "features" };
    else if (/price|pricing|cost|free|paid/.test(q))
      filter = { topic: "pricing" };
    else if (/account|login|signup/.test(q))
      filter = { topic: "account" };
    else if (/poll/.test(q)) filter = { topic: "polls" };
    else if (/privacy|secure|security/.test(q))
      filter = { topic: "privacy" };
    else if (/error|issue|problem/.test(q))
      filter = { topic: "troubleshooting" };
    else if (/support|help|contact/.test(q))
      filter = { topic: "support" };

    // =========================================================
    // 6. PINECONE QUERY
    // =========================================================
    const result = await index.query({
      vector,
      topK: 5,
      includeMetadata: true,
      ...(filter ? { filter } : {}),
    });

    const matches = result?.matches || [];

    if (!matches.length) {
      return res.json({
        answer: "I couldn't find relevant information in WePollin docs.",
      });
    }

    const sorted = matches
      .filter(m => m?.metadata?.text)
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    if (!sorted.length) {
      return res.json({
        answer: "I couldn't find relevant information in WePollin docs.",
      });
    }

    const best = sorted[0];
    const score = best?.score || 0;

    // =========================================================
    // 7. STRONG RELEVANCE CHECK
    // =========================================================
    const RELEVANCE_THRESHOLD = 0.7;

    if (score < RELEVANCE_THRESHOLD) {
      return res.json({
        answer:
          "I couldn't confidently find a relevant answer. Please ask a more specific WePollin question.",
      });
    }

    // =========================================================
    // 8. BLOCK GENERIC DOC TAKEOVER
    // =========================================================
    const text = best?.metadata?.text?.toLowerCase() || "";

    const isGenericDoc =
      text.includes("wepollin is an interactive polling application");

    if (isGenericDoc && !q.includes("what is wepollin")) {
      return res.json({
        answer:
          "Please ask something specific about WePollin features, polls, or support.",
      });
    }

    // =========================================================
    // 9. FINAL ANSWER
    // =========================================================
    const cleaned = clean(best.metadata.text);
    const answer = extractAnswer(cleaned, 2);

    return res.json({ answer });
  } catch (err) {
    console.error("Query error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
