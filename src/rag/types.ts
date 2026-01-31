/**
 * RAG (Retrieval-Augmented Generation) Types
 */

export interface Chunk {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
  embedding?: number[];
}

export interface ChunkMetadata {
  startOffset: number;
  endOffset: number;
  lineStart?: number;
  lineEnd?: number;
  section?: string;
  type?: 'text' | 'code' | 'table' | 'list';
  [key: string]: unknown;
}

export interface ChunkingOptions {
  maxChunkSize: number; // characters
  overlap: number; // characters of overlap between chunks
  preserveStructure: boolean; // try to preserve paragraphs, code blocks
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  highlights?: string[];
}

export interface RAGQuery {
  query: string;
  topK: number;
  minScore?: number;
  filter?: {
    source?: string;
    metadata?: Record<string, unknown>;
  };
}
