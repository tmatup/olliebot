import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import type { Chunk, ChunkMetadata, SearchResult, RAGQuery } from './types.js';

/**
 * Vector Store - Stores and retrieves chunks with embeddings
 *
 * Uses AlaSQL with JSON storage for embeddings.
 * For production, consider using a proper vector database.
 */
export class VectorStore {
  /**
   * Store chunks with their embeddings
   */
  store(chunks: Chunk[]): void {
    const db = getDb();
    const now = new Date().toISOString();

    for (const chunk of chunks) {
      db.embeddings.create({
        id: chunk.id || uuid(),
        source: chunk.source,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: chunk.embedding || [],
        metadata: chunk.metadata,
        createdAt: now,
      });
    }
  }

  /**
   * Search for similar chunks using cosine similarity
   */
  search(query: RAGQuery, queryEmbedding: number[]): SearchResult[] {
    const db = getDb();

    // Get all embeddings (or filter by source)
    let rows = query.filter?.source
      ? db.embeddings.findBySource(query.filter.source)
      : db.embeddings.findAll();

    // Calculate similarity scores
    const results: SearchResult[] = [];

    for (const row of rows) {
      const score = this.cosineSimilarity(queryEmbedding, row.embedding);

      // Apply minimum score filter
      if (query.minScore && score < query.minScore) {
        continue;
      }

      // Apply metadata filter if specified
      if (query.filter?.metadata) {
        let matches = true;
        for (const [key, value] of Object.entries(query.filter.metadata)) {
          if (row.metadata[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      results.push({
        chunk: {
          id: row.id,
          source: row.source,
          chunkIndex: row.chunkIndex,
          content: row.content,
          metadata: row.metadata as ChunkMetadata,
          embedding: row.embedding,
        },
        score,
      });
    }

    // Sort by score descending and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, query.topK);
  }

  /**
   * Delete all chunks for a source
   */
  deleteBySource(source: string): void {
    const db = getDb();
    db.embeddings.deleteBySource(source);
  }

  /**
   * Get all chunks for a source
   */
  getBySource(source: string): Chunk[] {
    const db = getDb();
    const rows = db.embeddings.findBySource(source);

    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      chunkIndex: row.chunkIndex,
      content: row.content,
      metadata: row.metadata as ChunkMetadata,
      embedding: row.embedding,
    }));
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }
}
