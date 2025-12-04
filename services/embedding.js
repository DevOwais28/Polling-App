import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

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

async function run() {
  const dataPath = path.resolve(__dirname, "./FAQ.json");
  const items = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  console.log("Total FAQ items:", items.length);

  const embedder = await getEmbedder();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.metadata.text;

    const output = await embedder(text, { pooling: "mean", normalize: true });
    const embedding = Array.from(output[0]); // 384 dims

    // ⭐ FINAL WORKING PINECONE UPSERT ⭐
    await index.upsert([
      {
        id: item.id,
        values: embedding,
        metadata: item.metadata,
      },
    ]);

    console.log(`Stored → ${item.id}`);
  }

  console.log("All JSON FAQ items stored in Pinecone!");
}

run();
