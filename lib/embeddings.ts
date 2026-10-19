// SERVER-SIDE ONLY — embeddings via Cloudflare Workers AI
// Model: BAAI/bge-small-en-v1.5 → 384-dimensional vectors (matches drawing_embeddings.embedding)

import { cfEmbed } from './cloudflare-ai';

export async function generateEmbedding(text: string): Promise<number[]> {
  return cfEmbed(text);
}

export async function embedQuery(query: string): Promise<number[]> {
  // bge models recommend this prefix for retrieval queries
  return cfEmbed(`Represent this sentence for searching relevant passages: ${query}`);
}
