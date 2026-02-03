# RAG Project System Design Proposal

## Executive Summary

This document proposes designs for expanding OllieBot's RAG system to support a **Project** concept - a container for multiple documents with sophisticated indexing, local vector storage, and optional vision model support for images in PDFs.

---

## Current State Analysis

### What Exists

OllieBot has a basic but functional RAG implementation in `src/rag/`:

| Component | Implementation | Limitations |
|-----------|---------------|-------------|
| **Chunking** | Structure-preserving (markdown headers, code blocks, paragraphs) | No semantic chunking, no PDF support |
| **Embeddings** | 4 providers (OpenAI, Google, Voyage, Azure) | Working well |
| **Vector Store** | AlaSQL + JSON file (`user/data/olliebot.db.json`) | Linear scan, not scalable |
| **Retrieval** | Cosine similarity with filtering | No hybrid search |
| **Organization** | `source` field as document identifier | No project/folder concept |

### Key Gaps to Address

1. **No Project concept** - documents are flat, identified only by source string
2. **No PDF/binary file support** - only plain text ingestion
3. **Naive chunking** - structure-aware but not semantic
4. **No vision support** - images in documents are ignored
5. **Not scalable** - linear O(n) search across all embeddings

---

## Proposed Architecture

### Core Concept: Project

```
Project
├── id: string (uuid)
├── name: string
├── description?: string
├── createdAt: Date
├── updatedAt: Date
├── settings: ProjectSettings
└── documents: Document[]

Document
├── id: string (uuid)
├── projectId: string
├── name: string
├── type: 'text' | 'pdf' | 'markdown' | 'code'
├── path: string (relative to project folder)
├── status: 'pending' | 'indexing' | 'indexed' | 'failed'
├── stats: { chunks: number, tokens: number, images: number }
└── metadata: Record<string, unknown>
```

### File System Structure

```
user/
└── projects/
    └── {project-id}/
        ├── project.json          # Project metadata
        ├── documents/            # Original files
        │   ├── doc1.pdf
        │   ├── doc2.md
        │   └── notes.txt
        ├── extracted/            # Extracted images/content
        │   └── doc1/
        │       ├── page_1.png
        │       └── images/
        └── index/                # Vector index files
            └── vectors.lance     # or vectors.db
```

---

## Design Options

I propose three design options with increasing sophistication:

---

## Option A: Enhanced Current Implementation (Minimal Changes)

**Philosophy**: Upgrade the existing system incrementally with better libraries.

### Changes

1. **Replace AlaSQL vector store with LanceDB**
   - Embedded, serverless, Rust-based
   - HNSW index for fast similarity search
   - Hybrid search (vector + full-text) built-in

2. **Add PDF parsing with `unpdf`**
   - Modern, pure-JS PDF text extraction
   - Works in all JS runtimes

3. **Add semantic chunking from LangChain**
   - Use `RecursiveCharacterTextSplitter` for 80% of cases
   - Optionally add `SemanticChunker` for premium mode

4. **Keep existing embedding providers**
   - Already working well

### New Dependencies

```json
{
  "@lancedb/lancedb": "^0.8.0",
  "unpdf": "^0.12.0",
  "@langchain/textsplitters": "^0.1.0"
}
```

### Pros
- Minimal disruption to existing code
- LanceDB is production-ready and fast
- Lower learning curve

### Cons
- No vision/image support
- Less sophisticated than full framework
- Manual integration work

### Estimated Complexity: **Low-Medium**

---

## Option B: LlamaIndex.TS Integration (Recommended)

**Philosophy**: Adopt a purpose-built RAG framework with sophisticated indexing strategies.

### Why LlamaIndex.TS?

- **Purpose-built for RAG** - not a general LLM framework
- **Sophisticated chunking**: Semantic splitter, hierarchical nodes, auto-merging retriever
- **Vision support**: Built-in CLIP embeddings, multimodal indexing
- **Active development**: TypeScript-first, works with all JS runtimes
- **Flexible storage**: Can use multiple vector stores including LanceDB

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ProjectService                           │
├─────────────────────────────────────────────────────────────┤
│  create() | get() | list() | delete() | addDocument()       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DocumentProcessor                        │
├─────────────────────────────────────────────────────────────┤
│  Handles: .txt, .md, .pdf, .docx, .json, .csv               │
│  Uses: LlamaIndex SimpleDirectoryReader + PDF parser        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              LlamaIndex Ingestion Pipeline                  │
├─────────────────────────────────────────────────────────────┤
│  1. Document Loading (SimpleDirectoryReader)                │
│  2. Node Parsing (SentenceSplitter or SemanticSplitter)    │
│  3. Embedding (OpenAI/Google via existing providers)        │
│  4. Storage (LanceDB VectorStore)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  LanceDB Vector Store                       │
├─────────────────────────────────────────────────────────────┤
│  Per-project index: user/projects/{id}/index/vectors.lance  │
│  HNSW indexing, hybrid search, metadata filtering           │
└─────────────────────────────────────────────────────────────┘
```

### Chunking Strategy Options

LlamaIndex provides multiple strategies that can be configured per-project:

```typescript
interface ProjectSettings {
  chunkingStrategy: 'sentence' | 'semantic' | 'hierarchical';
  chunkSize: number;        // default: 512 tokens
  chunkOverlap: number;     // default: 50 tokens
  enableVision: boolean;    // process images with vision model
  embeddingProvider: 'openai' | 'google' | 'voyage';
}
```

| Strategy | Best For | How It Works |
|----------|----------|--------------|
| `sentence` | General text, fast | Splits at sentence boundaries, respects chunk size |
| `semantic` | Knowledge bases | Uses embeddings to detect topic shifts |
| `hierarchical` | Complex docs | Creates parent/child chunk relationships |

### Sample Implementation

```typescript
// src/projects/service.ts
import { Document, VectorStoreIndex, SentenceSplitter } from 'llamaindex';
import { LanceDBVectorStore } from '@llamaindex/lancedb';

export class ProjectService {
  async indexDocument(projectId: string, filePath: string) {
    const project = await this.getProject(projectId);

    // Load document
    const documents = await this.loadDocument(filePath);

    // Create node parser based on project settings
    const nodeParser = this.createNodeParser(project.settings);

    // Get or create vector store for this project
    const vectorStore = new LanceDBVectorStore({
      uri: `user/projects/${projectId}/index`,
      tableName: 'vectors',
    });

    // Create index and add documents
    const index = await VectorStoreIndex.fromDocuments(documents, {
      vectorStore,
      nodeParser,
      // Use existing embedding provider
      embedModel: this.getEmbedModel(project.settings.embeddingProvider),
    });

    return index;
  }

  async query(projectId: string, query: string, options?: QueryOptions) {
    const vectorStore = new LanceDBVectorStore({
      uri: `user/projects/${projectId}/index`,
      tableName: 'vectors',
    });

    const index = await VectorStoreIndex.fromVectorStore(vectorStore);
    const retriever = index.asRetriever({ similarityTopK: options?.topK ?? 5 });

    return retriever.retrieve(query);
  }
}
```

### New Dependencies

```json
{
  "llamaindex": "^0.8.0",
  "@llamaindex/openai": "^0.2.0",
  "@llamaindex/lancedb": "^0.1.0",
  "unpdf": "^0.12.0",
  "pdf2pic": "^3.1.0"  // optional: for vision processing
}
```

### Vision Support (Optional Add-on)

For PDFs with images, two approaches:

**Approach 1: Vision LLM Summarization**
```typescript
// Convert PDF page to image, send to GPT-4V/Claude for description
const image = await pdf2pic.convert(pdfPath, { page: 1 });
const description = await visionLLM.describe(image);
// Embed the description alongside text content
```

**Approach 2: CLIP Multimodal Embeddings**
```typescript
// LlamaIndex has built-in CLIP support
import { CLIPEmbedding } from 'llamaindex';

const embedModel = new CLIPEmbedding();
// Embeds both images and text in same vector space
```

### Pros
- Sophisticated chunking strategies built-in
- Vision/multimodal support available
- Active community and documentation
- Handles edge cases (long documents, mixed content)

### Cons
- Larger dependency footprint
- Learning curve for LlamaIndex concepts
- Some Python features may lag in TS version

### Estimated Complexity: **Medium**

---

## Option C: Maximum Sophistication (Docling + LlamaIndex)

**Philosophy**: Use IBM's Docling for document understanding, then LlamaIndex for retrieval.

### Why Docling?

Docling is IBM's open-source toolkit for AI-driven document conversion. It uses:
- **DocLayNet AI model** for layout analysis
- **TableFormer** for table structure recognition
- Preserves document structure (headings, lists, tables, figures)
- Outputs clean Markdown with metadata

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Document Ingestion                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Docling Server                           │
│              (Python, runs as sidecar service)              │
├─────────────────────────────────────────────────────────────┤
│  - PDF/DOCX/PPTX/XLSX parsing                              │
│  - AI-powered layout analysis                               │
│  - Table extraction with structure                          │
│  - Image extraction with captions                           │
│  - Outputs: Markdown + JSON metadata                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 TypeScript RAG Pipeline                     │
├─────────────────────────────────────────────────────────────┤
│  - Receives structured Markdown from Docling               │
│  - LlamaIndex for semantic chunking                         │
│  - Preserves section hierarchy in metadata                  │
│  - Indexes images with vision model descriptions            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     LanceDB Index                           │
│  - Separate table for text chunks                          │
│  - Separate table for images (with descriptions)           │
│  - Hybrid retrieval across both                            │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. **Document Upload**: User adds PDF to project
2. **Docling Processing**: Sidecar service extracts structured content
3. **Content Separation**: Text, tables, images handled separately
4. **Vision Processing**: Images described by vision model (optional)
5. **Unified Indexing**: All content embedded and indexed
6. **Smart Retrieval**: Query returns text chunks + relevant images

### Docling Integration Options

**Option C1: Docling CLI (simplest)**
```typescript
// Call docling CLI via child_process
import { exec } from 'child_process';

async function processDocument(inputPath: string, outputDir: string) {
  await exec(`docling convert ${inputPath} --output ${outputDir} --format md`);
  // Read output markdown and process with LlamaIndex
}
```

**Option C2: Docling Server (production)**
```typescript
// Run docling-serve as Docker container, call via HTTP
const response = await fetch('http://localhost:8080/convert', {
  method: 'POST',
  body: formData, // PDF file
});
const { markdown, images, tables } = await response.json();
```

### New Dependencies

```json
{
  "llamaindex": "^0.8.0",
  "@llamaindex/lancedb": "^0.1.0",
  "docling-sdk": "^0.1.0"  // TypeScript SDK for docling-serve
}
```

Plus: Python environment with `docling` package, or Docker.

### Pros
- State-of-the-art document understanding
- Handles complex layouts (multi-column, figures, tables)
- Image extraction with context preservation
- Best results for PDFs with mixed content

### Cons
- Requires Python sidecar or Docker
- Higher infrastructure complexity
- Slower processing (AI model inference)
- Overkill for simple text documents

### Estimated Complexity: **High**

---

## Comparison Matrix

| Feature | Option A | Option B | Option C |
|---------|----------|----------|----------|
| **Complexity** | Low | Medium | High |
| **PDF Text** | Yes (unpdf) | Yes | Yes (AI-powered) |
| **PDF Images** | No | Optional | Yes (native) |
| **PDF Tables** | Basic | Basic | Excellent |
| **Semantic Chunking** | Optional | Built-in | Built-in |
| **Hierarchical Chunks** | No | Yes | Yes |
| **Vector Search** | Fast (LanceDB) | Fast (LanceDB) | Fast (LanceDB) |
| **Vision Support** | No | Add-on | Native |
| **Dependencies** | 3 npm | 5 npm | 3 npm + Python |
| **Setup Time** | Hours | 1-2 days | 2-3 days |

---

## Recommendation

### Start with Option B (LlamaIndex.TS)

**Rationale:**

1. **Best balance** of sophistication vs. complexity
2. **Future-proof** - easy to add vision support later
3. **Active ecosystem** - good documentation, community support
4. **Proven patterns** - based on successful Python library
5. **Fits your requirements** - local processing, sophisticated chunking

### Migration Path

```
Phase 1: Option B basics (Projects + LlamaIndex + LanceDB)
    │
    ▼
Phase 2: Add semantic chunking (SemanticSplitter)
    │
    ▼
Phase 3: Add vision support (pdf2pic + vision LLM)
    │
    ▼
Phase 4 (optional): Integrate Docling for complex PDFs
```

---

## Implementation Plan

### Phase 1: Core Project System

1. Create `src/projects/` directory structure
2. Implement `ProjectService` with CRUD operations
3. Set up LanceDB as vector store
4. Integrate LlamaIndex document loading
5. Add basic ingestion pipeline
6. Create API endpoints for projects

### Phase 2: PDF Support

1. Add `unpdf` for basic PDF text extraction
2. Implement PDF document loader
3. Handle multi-page documents
4. Store original files in project folder

### Phase 3: Advanced Chunking

1. Add `SemanticSplitter` option
2. Implement chunking strategy selection per-project
3. Add metadata extraction (headings, sections)
4. Test with various document types

### Phase 4: Vision Support (Optional)

1. Add `pdf2pic` for page-to-image conversion
2. Implement vision model integration
3. Index image descriptions alongside text
4. Create hybrid retrieval for text + images

---

## API Design Preview

```typescript
// Project Management
POST   /api/projects                    // Create project
GET    /api/projects                    // List projects
GET    /api/projects/:id                // Get project
DELETE /api/projects/:id                // Delete project
PATCH  /api/projects/:id/settings       // Update settings

// Document Management
POST   /api/projects/:id/documents      // Upload document(s)
GET    /api/projects/:id/documents      // List documents
DELETE /api/projects/:id/documents/:docId // Remove document

// Querying
POST   /api/projects/:id/query          // Query project
POST   /api/projects/:id/chat           // Chat with project context
```

---

## Questions for You

1. **Which option resonates most?** A (minimal), B (recommended), or C (maximum)?

2. **Vision support priority?**
   - Must-have from day 1?
   - Nice-to-have for later?
   - Not needed?

3. **Document types to support initially?**
   - Just text/markdown?
   - Include PDF from start?
   - Need DOCX/XLSX?

4. **Performance requirements?**
   - How many documents per project?
   - Latency expectations for queries?

5. **Integration with existing chat?**
   - Automatic RAG injection?
   - Explicit "search project" tool?
   - Both?

---

## Next Steps

Once you choose a direction, I can:

1. Create the project directory structure
2. Set up the chosen dependencies
3. Implement the core `ProjectService`
4. Add API endpoints
5. Integrate with existing chat/agent system
