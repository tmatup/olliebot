/**
 * RAG Projects Types
 * Types and interfaces for the RAG (Retrieval-Augmented Generation) project system.
 */

/**
 * Status of a document in the indexing pipeline.
 */
export type DocumentStatus = 'pending' | 'indexing' | 'indexed' | 'failed';

/**
 * Represents a document within a RAG project.
 */
export interface RAGDocument {
  /** Relative path from the project's documents folder */
  path: string;
  /** Original filename */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Current indexing status */
  status: DocumentStatus;
  /** Number of chunks created from this document */
  chunkCount?: number;
  /** Last modified time of the source file */
  lastModified: string;
  /** When the document was last indexed */
  indexedAt?: string;
  /** Error message if indexing failed */
  error?: string;
  /** AI-generated summary of the document (from first 10 chunks) */
  summary?: string;
}

/**
 * Project-level settings stored in manifest.json.
 */
export interface ProjectSettings {
  /** Chunk size for text splitting (characters) */
  chunkSize: number;
  /** Overlap between chunks (characters) */
  chunkOverlap: number;
  /** Embedding model identifier */
  embeddingModel: string;
  /** Whether to extract and index images from PDFs */
  indexImages: boolean;
}

/**
 * Default project settings.
 */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  chunkSize: 1000,
  chunkOverlap: 100,
  embeddingModel: 'default',
  indexImages: false,
};

/**
 * Manifest file structure stored in .olliebot/manifest.json.
 */
export interface ProjectManifest {
  /** Project ID (folder name) */
  id: string;
  /** When the project was created */
  createdAt: string;
  /** When the project was last updated */
  updatedAt: string;
  /** Project settings */
  settings: ProjectSettings;
  /** Document status records */
  documents: Record<string, RAGDocument>;
  /** Total number of vectors in the index */
  vectorCount: number;
  /** Last full index timestamp */
  lastIndexedAt?: string;
  /** AI-generated summary of the entire project (from file summaries) */
  summary?: string;
}

/**
 * Represents a RAG project exposed to the API.
 */
export interface RAGProject {
  /** Project ID (folder name) */
  id: string;
  /** Display name (derived from folder name) */
  name: string;
  /** Full path to the project folder */
  path: string;
  /** Number of documents in the project */
  documentCount: number;
  /** Number of indexed documents */
  indexedCount: number;
  /** Total vector count */
  vectorCount: number;
  /** Project settings */
  settings: ProjectSettings;
  /** When the project was last indexed */
  lastIndexedAt?: string;
  /** When the project was created */
  createdAt: string;
  /** When the project was last updated */
  updatedAt: string;
  /** AI-generated summary of the project */
  summary?: string;
}

/**
 * Detailed project info including document list.
 */
export interface RAGProjectDetails extends RAGProject {
  /** List of documents in the project */
  documents: RAGDocument[];
}

/**
 * Summarization provider interface (uses LLMService.fast).
 */
export interface SummarizationProvider {
  /** Summarize text content */
  summarize(content: string, prompt: string): Promise<string>;
}

/**
 * Progress update during indexing.
 */
export interface IndexingProgress {
  /** Project being indexed */
  projectId: string;
  /** Current status */
  status: 'started' | 'processing' | 'completed' | 'error';
  /** Total documents to process */
  totalDocuments: number;
  /** Documents processed so far */
  processedDocuments: number;
  /** Current document being processed */
  currentDocument?: string;
  /** Error message if status is 'error' */
  error?: string;
  /** Timestamp */
  timestamp: string;
}

/**
 * Vector record stored in LanceDB.
 */
export interface VectorRecord {
  /** Unique chunk ID */
  id: string;
  /** Source document path */
  documentPath: string;
  /** Chunk text content */
  text: string;
  /** Embedding vector */
  vector: number[];
  /** Chunk index within the document */
  chunkIndex: number;
  /** Content type: 'text' or 'image' */
  contentType: 'text' | 'image';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Search result from vector query.
 */
export interface SearchResult {
  /** Chunk ID */
  id: string;
  /** Source document path */
  documentPath: string;
  /** Chunk text content */
  text: string;
  /** Similarity score (0-1, higher is better) */
  score: number;
  /** Chunk index within the document */
  chunkIndex: number;
  /** Content type */
  contentType: 'text' | 'image';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query request to the RAG project.
 */
export interface QueryRequest {
  /** Search query text */
  query: string;
  /** Maximum number of results */
  topK?: number;
  /** Minimum similarity threshold (0-1) */
  minScore?: number;
  /** Filter by content type */
  contentType?: 'text' | 'image' | 'all';
}

/**
 * Query response from the RAG project.
 */
export interface QueryResponse {
  /** Search results */
  results: SearchResult[];
  /** Query execution time in ms */
  queryTimeMs: number;
}

/**
 * Embedding provider interface.
 */
export interface EmbeddingProvider {
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;
  /** Generate embeddings for multiple texts (batch) */
  embedBatch?(texts: string[]): Promise<number[][]>;
  /** Get the embedding dimension */
  getDimensions(): number;
}

/**
 * Parsed document chunk ready for embedding.
 */
export interface DocumentChunk {
  /** Chunk text content */
  text: string;
  /** Source document path */
  documentPath: string;
  /** Chunk index within the document */
  chunkIndex: number;
  /** Content type */
  contentType: 'text' | 'image';
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
