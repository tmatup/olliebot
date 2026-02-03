/**
 * LanceDB Vector Store Wrapper
 * Handles per-project vector storage using LanceDB.
 */

import { connect, type Connection, type Table } from '@lancedb/lancedb';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { VectorRecord, SearchResult, EmbeddingProvider } from './types.js';

const VECTOR_TABLE_NAME = 'vectors';

/**
 * LanceDB store for a single RAG project.
 * Each project has its own LanceDB database in .olliebot/index.lance/
 */
export class LanceStore {
  private dbPath: string;
  private connection: Connection | null = null;
  private table: Table | null = null;
  private dimensions: number;
  private embeddingProvider: EmbeddingProvider;

  constructor(dbPath: string, embeddingProvider: EmbeddingProvider) {
    this.dbPath = dbPath;
    this.embeddingProvider = embeddingProvider;
    this.dimensions = embeddingProvider.getDimensions();
  }

  /**
   * Initialize the LanceDB connection and table.
   */
  async init(): Promise<void> {
    // Ensure the directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Connect to LanceDB
    this.connection = await connect(this.dbPath);

    // Check if table exists
    const tableNames = await this.connection.tableNames();
    if (tableNames.includes(VECTOR_TABLE_NAME)) {
      this.table = await this.connection.openTable(VECTOR_TABLE_NAME);
    }
    // Table will be created on first insert if it doesn't exist
  }

  /**
   * Add vectors to the store.
   */
  async addVectors(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    if (!this.connection) {
      throw new Error('LanceStore not initialized. Call init() first.');
    }

    // Transform records to LanceDB format
    const data = records.map((record) => ({
      id: record.id,
      documentPath: record.documentPath,
      text: record.text,
      vector: record.vector,
      chunkIndex: record.chunkIndex,
      contentType: record.contentType,
      metadata: record.metadata ? JSON.stringify(record.metadata) : null,
    }));

    if (!this.table) {
      // Create table with first batch of data
      this.table = await this.connection.createTable(VECTOR_TABLE_NAME, data);
    } else {
      // Add to existing table
      await this.table.add(data);
    }
  }

  /**
   * Search for similar vectors.
   */
  async search(
    queryText: string,
    topK: number = 10,
    minScore: number = 0,
    contentType?: 'text' | 'image' | 'all'
  ): Promise<SearchResult[]> {
    if (!this.table) {
      return [];
    }

    // Generate query embedding
    const queryVector = await this.embeddingProvider.embed(queryText);

    // Build the search query
    let query = this.table.search(queryVector).limit(topK);

    // Apply content type filter if specified
    if (contentType && contentType !== 'all') {
      query = query.where(`contentType = '${contentType}'`);
    }

    // Execute search
    const results = await query.toArray();

    // Transform results
    return results
      .map((row: Record<string, unknown>) => {
        // LanceDB returns _distance (L2 distance), convert to similarity score
        // For normalized vectors, distance = 2 * (1 - cosine_similarity)
        // So cosine_similarity = 1 - distance/2
        const distance = row._distance as number;
        const score = Math.max(0, 1 - distance / 2);

        return {
          id: row.id as string,
          documentPath: row.documentPath as string,
          text: row.text as string,
          score,
          chunkIndex: row.chunkIndex as number,
          contentType: row.contentType as 'text' | 'image',
          metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        };
      })
      .filter((result: SearchResult) => result.score >= minScore);
  }

  /**
   * Delete all vectors for a specific document.
   */
  async deleteByDocument(documentPath: string): Promise<number> {
    if (!this.table) {
      return 0;
    }

    // Count before deletion
    const beforeCount = await this.getVectorCount();

    // Delete matching rows
    await this.table.delete(`documentPath = '${documentPath.replace(/'/g, "''")}'`);

    // Count after deletion
    const afterCount = await this.getVectorCount();

    return beforeCount - afterCount;
  }

  /**
   * Delete all vectors in the store.
   */
  async clear(): Promise<void> {
    if (!this.connection) return;

    const tableNames = await this.connection.tableNames();
    if (tableNames.includes(VECTOR_TABLE_NAME)) {
      await this.connection.dropTable(VECTOR_TABLE_NAME);
      this.table = null;
    }
  }

  /**
   * Get the total number of vectors in the store.
   */
  async getVectorCount(): Promise<number> {
    if (!this.table) {
      return 0;
    }

    const count = await this.table.countRows();
    return count;
  }

  /**
   * Get statistics about the store.
   */
  async getStats(): Promise<{
    vectorCount: number;
    documentCount: number;
  }> {
    if (!this.table) {
      return { vectorCount: 0, documentCount: 0 };
    }

    const vectorCount = await this.table.countRows();

    // Get unique document count
    const allRows = await this.table.query().select(['documentPath']).toArray();
    const uniqueDocs = new Set(allRows.map((row: Record<string, unknown>) => row.documentPath as string));

    return {
      vectorCount,
      documentCount: uniqueDocs.size,
    };
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    this.connection = null;
    this.table = null;
  }
}

/**
 * Create a LanceStore for a project.
 */
export async function createLanceStore(
  projectPath: string,
  embeddingProvider: EmbeddingProvider
): Promise<LanceStore> {
  const dbPath = join(projectPath, '.olliebot', 'index.lance');
  const store = new LanceStore(dbPath, embeddingProvider);
  await store.init();
  return store;
}
