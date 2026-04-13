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

// IMPROVED: Better answer extraction - preserve full context up to reasonable limit
function extractAnswer(text, maxSentences = 5, maxChars = 500) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  let result = "";
  let count = 0;
  
  for (const sentence of sentences) {
    if (count >= maxSentences || result.length + sentence.length > maxChars) break;
    result += (result ? " " : "") + sentence;
    count++;
  }
  
  return result || text.slice(0, maxChars);
}

// NEW: Check if query is specifically asking for "what is" definition
function isDefinitionQuery(q) {
  return /^(what is|what's|define|explain what|tell me what|describe what)/i.test(q.trim()) 
    && /wepollin/i.test(q);
}

// NEW: Better relevance scoring with fallback
function calculateRelevanceScore(match, query) {
  const vectorScore = match.score || 0;
  const text = (match.metadata?.text || "").toLowerCase();
  const q = query.toLowerCase();
  
  // Boost score if metadata topic matches detected intent
  let topicBoost = 0;
  const topic = match.metadata?.topic;
  
  if (/feature/.test(q) && topic === "features") topicBoost = 0.1;
  else if (/price|cost/.test(q) && topic === "pricing") topicBoost = 0.1;
  else if (/account|login/.test(q) && topic === "account") topicBoost = 0.1;
  else if (/poll/.test(q) && topic === "polls") topicBoost = 0.1;
  else if (/privacy|security/.test(q) && topic === "privacy") topicBoost = 0.1;
  
  return Math.min(vectorScore + topicBoost, 1.0);
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

    const q = query.trim();
    const qLower = q.toLowerCase();

    // =========================================================
    // 1. SMALL TALK / SAFETY GATE
    // =========================================================
    const isWePollinRelated =
      /wepollin|poll|feature|pricing|account|login|signup|privacy|support|help|contact|security/i.test(
        qLower
      );

    const isSmallTalk =
      /^(hi|hello|hey|yo|salam|bye|goodbye|thanks|thank you|ok|okay|nice|great|cool)$/i.test(
        qLower
      );

    if (isSmallTalk && !isWePollinRelated) {
      return res.json({
        answer:
          "I'm here to help you with WePollin-related questions 😊 Ask me about polls, features, pricing, or support.",
      });
    }

    if (isSmallTalk) {
      return res.json({
        answer: "Hey 👋 How can I help you with WePollin today?",
      });
    }

    // =========================================================
    // 2. DIRECT WEPPOLLIN EXPLANATION (only for definition queries)
    // =========================================================
    if (isDefinitionQuery(qLower)) {
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
    // 4. EMBEDDING
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
    // 5. OPTIONAL: SOFT INTENT FILTERING (not hard filter)
    // =========================================================
    // Instead of hard filtering in Pinecone, we'll use metadata 
    // for re-ranking. Hard filtering can miss relevant docs [^3^].
    let preferredTopics = [];
    
    if (/feature/.test(qLower)) preferredTopics.push("features");
    else if (/price|pricing|cost|free|paid/.test(qLower))
      preferredTopics.push("pricing");
    else if (/account|login|signup/.test(qLower))
      preferredTopics.push("account");
    else if (/poll|create poll|vote/.test(qLower)) 
      preferredTopics.push("polls");
    else if (/privacy|secure|security/.test(qLower))
      preferredTopics.push("privacy");
    else if (/error|issue|problem|bug|not working/.test(qLower))
      preferredTopics.push("troubleshooting");
    else if (/support|help|contact|email/.test(qLower))
      preferredTopics.push("support");

    // =========================================================
    // 6. PINECONE QUERY (NO HARD FILTER - let semantic search work)
    // =========================================================
    const result = await index.query({
      vector,
      topK: 10, // Get more candidates for re-ranking
      includeMetadata: true,
      // REMOVED: Hard filter that was fragmenting search results
    });

    let matches = result?.matches || [];

    if (!matches.length) {
      return res.json({
        answer: "I couldn't find relevant information in WePollin docs. Try rephrasing your question?",
      });
    }

    // =========================================================
    // 7. RE-RANK BY RELEVANCE (combining vector score + topic preference)
    // =========================================================
    matches = matches
      .filter(m => m?.metadata?.text)
      .map(m => ({
        ...m,
        adjustedScore: calculateRelevanceScore(m, qLower)
      }))
      .sort((a, b) => b.adjustedScore - a.adjustedScore);

    const best = matches[0];
    const score = best?.adjustedScore || 0;

    // =========================================================
    // 8. ADAPTIVE THRESHOLD (was 0.7, now 0.6 with topic boost consideration)
    // =========================================================
    const RELEVANCE_THRESHOLD = 0.6; // Lowered from 0.7 [^11^]

    if (score < RELEVANCE_THRESHOLD) {
      return res.json({
        answer:
          "I couldn't confidently find a relevant answer. Please ask a more specific WePollin question, or try rephrasing.",
      });
    }

    // =========================================================
    // 9. FIXED: SMART GENERIC DOC DETECTION
    // Only block generic intro if user asked a SPECIFIC follow-up question
    // =========================================================
    const text = best?.metadata?.text?.toLowerCase() || "";
    const isGenericIntroDoc =
      text.includes("wepollin is an interactive polling application") &&
      text.length < 200; // Short generic description

    // Only block if it's generic AND user asked a specific non-definition question
    if (isGenericIntroDoc && !isDefinitionQuery(qLower)) {
      // Check if we have a better match in top 3
      const betterMatch = matches.slice(1, 3).find(m => 
        !(m.metadata?.text?.toLowerCase().includes("wepollin is an interactive polling application") && 
          m.metadata?.text?.length < 200) &&
        m.adjustedScore > score * 0.9 // Within 90% of best score
      );
      
      if (betterMatch) {
        const cleaned = clean(betterMatch.metadata.text);
        const answer = extractAnswer(cleaned);
        return res.json({ answer, source: "re-ranked" });
      }
      
      // If no better match, still return the generic one with a hint
      return res.json({
        answer: "I found general information about WePollin, but your question seems specific. Could you rephrase or ask about a particular feature (like 'how do I create a poll' or 'what are the pricing plans')?",
      });
    }

    // =========================================================
    // 10. FINAL ANSWER
    // =========================================================
    const cleaned = clean(best.metadata.text);
    const answer = extractAnswer(cleaned);

    return res.json({ answer });
  } catch (err) {
    console.error("Query error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
