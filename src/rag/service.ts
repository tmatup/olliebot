import type { Chunk, ChunkingOptions, SearchResult, EmbeddingProvider } from './types.js';
import { Chunker } from './chunker.js';
import { VectorStore } from './store.js';

/**
 * RAG Service - Orchestrates chunking, embedding, storage, and retrieval
 */
export class RAGService {
  private chunker: Chunker;
  private store: VectorStore;
  private embeddingProvider: EmbeddingProvider;

  constructor(embeddingProvider: EmbeddingProvider) {
    this.chunker = new Chunker();
    this.store = new VectorStore();
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Ingest a document into the RAG system
   */
  async ingest(
    content: string,
    source: string,
    options?: Partial<ChunkingOptions>
  ): Promise<{ chunksCreated: number; source: string }> {
    // Delete existing chunks for this source
    await this.store.deleteBySource(source);

    // Chunk the document
    const chunks = this.chunker.chunk(content, source, options);

    // Generate embeddings for each chunk
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingProvider.embedBatch(texts);

    // Attach embeddings to chunks
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].embedding = embeddings[i];
    }

    // Store chunks
    await this.store.store(chunks);

    return {
      chunksCreated: chunks.length,
      source,
    };
  }

  /**
   * Query the RAG system
   */
  async query(
    query: string,
    options?: {
      topK?: number;
      minScore?: number;
      source?: string;
    }
  ): Promise<SearchResult[]> {
    // Generate embedding for query
    const queryEmbedding = await this.embeddingProvider.embed(query);

    // Search for similar chunks
    return this.store.search(
      {
        query,
        topK: options?.topK || 5,
        minScore: options?.minScore,
        filter: options?.source ? { source: options.source } : undefined,
      },
      queryEmbedding
    );
  }

  /**
   * Get context for LLM from RAG results
   */
  async getContextForQuery(
    query: string,
    options?: {
      topK?: number;
      minScore?: number;
      source?: string;
      maxContextLength?: number;
    }
  ): Promise<string> {
    const results = await this.query(query, options);

    if (results.length === 0) {
      return '';
    }

    const maxLength = options?.maxContextLength || 3000;
    let context = '';
    let usedResults = 0;

    for (const result of results) {
      const chunkContext = this.formatChunkForContext(result);
      if (context.length + chunkContext.length > maxLength) {
        break;
      }
      context += chunkContext;
      usedResults++;
    }

    return `[Retrieved ${usedResults} relevant passages]\n\n${context}`;
  }

  private formatChunkForContext(result: SearchResult): string {
    const { chunk, score } = result;
    return (
      `--- Source: ${chunk.source} (relevance: ${(score * 100).toFixed(1)}%) ---\n` +
      `${chunk.content.trim()}\n\n`
    );
  }

  /**
   * Delete all data for a source
   */
  async deleteSource(source: string): Promise<number> {
    return this.store.deleteBySource(source);
  }

  /**
   * Get all chunks for a source
   */
  async getChunks(source: string): Promise<Chunk[]> {
    return this.store.getBySource(source);
  }
}

/**
 * Simple embedding provider using Google's API
 * Can be replaced with any embedding service
 */
export class GoogleEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private dimensions = 768;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/models/text-embedding-004:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.embedding?.values || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Google doesn't have a batch endpoint, so we parallelize
    const promises = texts.map((text) => this.embed(text));
    return Promise.all(promises);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * OpenAI embedding provider
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private dimensions = 1536;

  constructor(
    apiKey: string,
    model: string = 'text-embedding-3-small',
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;

    // Update dimensions based on model
    if (model === 'text-embedding-3-large') {
      this.dimensions = 3072;
    } else if (model === 'text-embedding-3-small') {
      this.dimensions = 1536;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data?.map((item: { embedding: number[] }) => item.embedding) || [];
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * Anthropic/Voyage embedding provider
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl = 'https://api.voyageai.com/v1';
  private model: string;
  private dimensions = 1024;

  constructor(apiKey: string, model: string = 'voyage-2') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`Voyage API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
