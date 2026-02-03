/**
 * RAG Projects Module
 * Folder-based RAG (Retrieval-Augmented Generation) project management.
 */

// Types
export type {
  RAGProject,
  RAGProjectDetails,
  RAGDocument,
  ProjectSettings,
  ProjectManifest,
  IndexingProgress,
  QueryRequest,
  QueryResponse,
  SearchResult,
  VectorRecord,
  DocumentChunk,
  EmbeddingProvider,
  DocumentStatus,
} from './types.js';

export { DEFAULT_PROJECT_SETTINGS } from './types.js';

// Service
export { RAGProjectService } from './service.js';

// Routes
export { createRAGProjectRoutes } from './routes.js';

// Document loading
export {
  loadDocument,
  loadAndChunkDocument,
  isSupportedFile,
  getMimeType,
  SUPPORTED_EXTENSIONS,
} from './document-loader.js';

// Vector store
export { LanceStore, createLanceStore } from './lance-store.js';

// Data manager for system prompt injection
export { RagDataManager } from './data-manager.js';

// Embedding providers
export {
  GoogleEmbeddingProvider,
  OpenAIEmbeddingProvider,
  AzureOpenAIEmbeddingProvider,
  VoyageEmbeddingProvider,
} from './embedding-providers.js';
