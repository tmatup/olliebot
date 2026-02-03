# Citation System Design

## Executive Summary

This document defines a comprehensive citation system for OllieBot that enables transparent, verifiable AI responses by automatically tracking and displaying the sources of information used in tool outputs. The system draws from research on how major AI agents (ChatGPT, Claude, Gemini, Perplexity) implement citations, adapting best practices to OllieBot's multi-agent architecture.

**Key Goals:**
1. **Transparency**: Users can verify where information comes from
2. **Trust**: Build confidence through traceable sources
3. **Flexibility**: Generic system supporting all tool types
4. **Performance**: Minimal overhead in token usage and latency

---

## Industry Research

### How Major AI Agents Implement Citations

#### OpenAI ChatGPT

**Implementation:**
- Uses Bing Search as the retrieval backend
- Citations appear as numbered footnotes `[1][2]` linked to open-access sources
- Typically displays 3-6 numbered citations per response
- Agent Mode returns clickable screenshots and direct links

**Source Selection Logic:**
- Doesn't blindly follow Bing rankings - uses "pure AI logic"
- Evaluates readability and how cleanly content can be reused
- Prioritizes recency for time-sensitive queries (e.g., "best tools in 2025")
- Balances freshness with authority

**Known Issues:**
- Citations may be inaccurate or reference non-existent sources
- Users must verify each citation before academic/official use

**Sources:**
- [Inside the Process: How ChatGPT Finds and Cites Content](https://medium.com/@get2vikasjha/inside-the-process-how-chatgpt-finds-and-cites-content-without-guesswork-ebe63ecf9857)
- [Best Practices to Get Cited by ChatGPT in 2025](https://createandgrow.com/best-practices-to-get-cited-by-chatgpt-in-2025/)

---

#### Anthropic Claude

**Implementation:**
- Dedicated Citations API with structured document references
- Web search feature returns inline citations with clickable links
- Top ~10 Brave search results are scanned, filtered, and cited
- No footer list like Perplexity - links are inline in context

**Citations API Structure:**
```json
{
  "citations": [
    {
      "type": "document",
      "document_id": "doc_1",
      "start_index": 0,
      "end_index": 150,
      "cited_text": "The actual text being referenced..."
    }
  ]
}
```

**Key Features:**
- `cited_text` doesn't count toward output tokens (cost savings)
- Designed for RAG applications with precise source tracking
- Works with document content blocks for grounding

**Sources:**
- [Anthropic Citations API](https://platform.claude.com/docs/en/build-with-claude/citations)
- [Claude Web Search Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Introducing Citations on the Anthropic API](https://claude.com/blog/introducing-citations-api)

---

#### Google Gemini

**Implementation:**
- "Grounding with Google Search" feature
- Returns structured `groundingMetadata` with detailed attribution

**GroundingMetadata Structure:**
```json
{
  "webSearchQueries": ["query used"],
  "groundingChunks": [
    { "web": { "uri": "https://...", "title": "Page Title" } }
  ],
  "groundingSupports": [
    {
      "segment": { "startIndex": 0, "endIndex": 100 },
      "groundingChunkIndices": [0, 1],
      "confidenceScores": [0.95, 0.87]
    }
  ],
  "searchEntryPoint": { "renderedContent": "<html>..." }
}
```

**Key Features:**
- Confidence scores (0.0-1.0) for each grounding chunk
- Segment-level mapping: specific text ranges linked to sources
- Search suggestions HTML for required attribution display
- Supports Google Search, Vertex AI Search, and Google Maps as sources

**Known Issues:**
- Empty citations when using `response_schema` for JSON output
- Broken links and irrelevant citations sometimes occur
- Third-party tools like GroundCite exist to fix citation issues

**Sources:**
- [Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search)
- [GroundingMetadata Reference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/GroundingMetadata)
- [Gemini Deep Research Sources Panel](https://skywork.ai/blog/ai-agent/gemini-sources-panel/)

---

#### Perplexity AI

**Implementation:**
- Citation-forward design: live retrieval is core to the product
- Inline `[n]` references with numbered footnotes
- Shows metadata (title, favicon) for quick relevance scanning
- Defaults to APA 7th Edition formatting

**UX Patterns:**
- In-text `[n]` references maintain claim-to-source bond
- Hover for preview, click for full source
- Favicons and site names help judge relevance quickly

**Sources:**
- [AI UX Patterns - Citations](https://www.shapeof.ai/patterns/citations)
- [Perplexity Platform Guide: Citation-Forward Answers](https://www.unusual.ai/blog/perplexity-platform-guide-design-for-citation-forward-answers)

---

### Common Patterns Across Providers

| Feature | ChatGPT | Claude | Gemini | Perplexity |
|---------|---------|--------|--------|------------|
| Citation Format | `[1][2]` footnotes | Inline links | `groundingSupports` | `[n]` with footer |
| Source Display | Numbered list | Inline | Structured metadata | Footer + inline |
| Confidence Scores | No | No | Yes (0.0-1.0) | No |
| Hover Preview | No | No | No | Yes |
| Segment Mapping | Sentence-level | Document-level | Character-level | Sentence-level |
| Required Attribution | No | No | Yes (Search Entry Point) | No |

---

## Proposed Architecture

### Design Principles

1. **Tool-Agnostic**: Works with any tool output (web search, file read, API calls, etc.)
2. **Incremental Adoption**: Can be enabled per-tool without breaking existing functionality
3. **LLM-Assisted**: Model helps identify which parts of response use which sources
4. **Performance-Conscious**: Minimize token overhead and storage requirements
5. **Extensible**: Support for confidence scores, previews, and metadata

---

### Core Data Structures

#### Citation Source

Represents a single citable source from a tool execution:

```typescript
/**
 * A citable source from tool output
 */
interface CitationSource {
  /** Unique identifier for this source */
  id: string;

  /** Type of source */
  type: 'web' | 'file' | 'api' | 'database' | 'memory' | 'skill' | 'mcp';

  /** Tool that produced this source */
  toolName: string;
  toolRequestId: string;

  /** Source identification */
  uri?: string;           // URL or file path
  title?: string;         // Page title or filename
  domain?: string;        // e.g., "example.com"
  favicon?: string;       // Favicon URL for web sources

  /** Content */
  snippet?: string;       // Brief excerpt (for previews)
  fullContent?: string;   // Complete content (for RAG)

  /** Metadata */
  timestamp?: string;     // When source was accessed
  author?: string;        // Content author if known
  publishedDate?: string; // Publication date if known

  /** Quality signals */
  relevanceScore?: number;    // 0.0-1.0, how relevant to query
  credibilityScore?: number;  // 0.0-1.0, source trustworthiness
}
```

#### Citation Reference

Links a span of response text to one or more sources:

```typescript
/**
 * A reference from response text to sources
 */
interface CitationReference {
  /** Unique identifier */
  id: string;

  /** Display index (e.g., [1], [2]) */
  index: number;

  /** Text span in response */
  startIndex: number;
  endIndex: number;
  citedText: string;

  /** Source references */
  sourceIds: string[];

  /** Optional confidence for each source */
  confidenceScores?: number[];
}
```

#### Citation Context

Complete citation data for a response:

```typescript
/**
 * Full citation context for an assistant response
 */
interface CitationContext {
  /** Response message ID */
  messageId: string;

  /** All sources available for this response */
  sources: CitationSource[];

  /** References linking text to sources */
  references: CitationReference[];

  /** Generation metadata */
  generatedAt: string;
  modelUsed?: string;
}
```

---

### Tool Output Enhancement

#### Enhanced Tool Result

Extend existing `ToolResult` to include citation sources:

```typescript
interface ToolResultWithCitations extends ToolResult {
  /** Citation sources extracted from this tool's output */
  citations?: CitationSource[];
}
```

#### Tool-Specific Citation Extractors

Each tool type needs a citation extractor:

```typescript
/**
 * Extracts citation sources from tool output
 */
interface CitationExtractor {
  /** Tool name pattern this extractor handles */
  pattern: string | RegExp;

  /** Extract citations from tool result */
  extract(result: ToolResult): CitationSource[];
}
```

**Example Extractors:**

```typescript
// Web Search Extractor
const webSearchExtractor: CitationExtractor = {
  pattern: /^(native__web_search|mcp__.*search)$/,
  extract(result) {
    const output = result.output as WebSearchResult;
    return output.results.map((r, i) => ({
      id: `${result.requestId}-${i}`,
      type: 'web',
      toolName: result.toolName,
      toolRequestId: result.requestId,
      uri: r.url,
      title: r.title,
      domain: new URL(r.url).hostname,
      snippet: r.snippet,
      relevanceScore: r.relevance,
    }));
  },
};

// File Read Extractor
const fileReadExtractor: CitationExtractor = {
  pattern: /^native__read_file$/,
  extract(result) {
    const params = result.parameters as { path: string };
    return [{
      id: `${result.requestId}-0`,
      type: 'file',
      toolName: result.toolName,
      toolRequestId: result.requestId,
      uri: params.path,
      title: params.path.split('/').pop(),
      fullContent: result.output as string,
    }];
  },
};

// Web Fetch Extractor
const webFetchExtractor: CitationExtractor = {
  pattern: /^native__web_fetch$/,
  extract(result) {
    const params = result.parameters as { url: string };
    return [{
      id: `${result.requestId}-0`,
      type: 'web',
      toolName: result.toolName,
      toolRequestId: result.requestId,
      uri: params.url,
      domain: new URL(params.url).hostname,
      fullContent: result.output as string,
    }];
  },
};
```

---

### Citation Generation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER MESSAGE                                 │
│  "What are the latest React 19 features?"                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    TOOL EXECUTION PHASE                              │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ web_search("React 19 features 2025")                        │   │
│  │                                                              │   │
│  │ Result: [                                                    │   │
│  │   { url: "react.dev/blog/...", title: "React 19", ... },   │   │
│  │   { url: "dev.to/...", title: "What's New", ... },          │   │
│  │   { url: "medium.com/...", title: "Deep Dive", ... }        │   │
│  │ ]                                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Citation Extractor                                           │   │
│  │                                                              │   │
│  │ Sources: [                                                   │   │
│  │   { id: "src-1", uri: "react.dev/...", type: "web", ... }, │   │
│  │   { id: "src-2", uri: "dev.to/...", type: "web", ... },     │   │
│  │   { id: "src-3", uri: "medium.com/...", type: "web", ... }  │   │
│  │ ]                                                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LLM RESPONSE GENERATION                           │
│                                                                      │
│  System prompt includes:                                            │
│  "You have access to the following sources. When using information  │
│   from these sources, include inline citations using [n] format."   │
│                                                                      │
│  Available sources:                                                  │
│  [1] react.dev/blog/react-19 - "React 19"                          │
│  [2] dev.to/react-19-features - "What's New in React 19"           │
│  [3] medium.com/react-deep-dive - "Deep Dive into React 19"        │
│                                                                      │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                      │
│  Generated Response:                                                │
│  "React 19 introduces several major features including the new      │
│   Actions API for handling async operations [1], improved           │
│   Server Components [1][2], and the use() hook for reading          │
│   resources during render [1][3]."                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CITATION POST-PROCESSING                          │
│                                                                      │
│  Parse response to extract citation references:                      │
│                                                                      │
│  References: [                                                       │
│    { index: 1, sourceIds: ["src-1"], citedText: "Actions API..." },│
│    { index: 2, sourceIds: ["src-2"], citedText: "Server Comp..." },│
│    { index: 3, sourceIds: ["src-3"], citedText: "use() hook..." }  │
│  ]                                                                   │
│                                                                      │
│  Final CitationContext saved with message                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

### System Prompt Addition

Add citation instructions to agent system prompts:

```markdown
## Citation Guidelines

When you use information from tool outputs, you MUST cite your sources using inline references.

### Citation Format
- Use bracketed numbers: [1], [2], [3]
- Place citations immediately after the claim they support
- Multiple sources for one claim: [1][2] or [1, 2]
- Don't cite common knowledge or your own analysis

### Examples
- "React 19 introduces the Actions API [1]"
- "Performance improved by 40% [2][3]"
- "This approach is widely recommended [1, 4, 5]"

### Available Sources
{sources_list}

### Important
- Only cite sources that directly support your claims
- If no source supports a claim, state it's your analysis
- Don't fabricate or hallucinate source numbers
```

---

### Citation Service

Central service for managing citations:

```typescript
// src/citations/service.ts

import type { CitationSource, CitationReference, CitationContext } from './types.js';
import type { ToolResult } from '../tools/types.js';

export class CitationService {
  private extractors: Map<string, CitationExtractor> = new Map();

  /**
   * Register a citation extractor for a tool pattern
   */
  registerExtractor(extractor: CitationExtractor): void {
    const key = typeof extractor.pattern === 'string'
      ? extractor.pattern
      : extractor.pattern.source;
    this.extractors.set(key, extractor);
  }

  /**
   * Extract citation sources from tool results
   */
  extractSources(results: ToolResult[]): CitationSource[] {
    const sources: CitationSource[] = [];

    for (const result of results) {
      if (!result.success) continue;

      for (const [key, extractor] of this.extractors) {
        const pattern = typeof extractor.pattern === 'string'
          ? new RegExp(`^${extractor.pattern}$`)
          : extractor.pattern;

        if (pattern.test(result.toolName)) {
          sources.push(...extractor.extract(result));
          break;
        }
      }
    }

    return sources;
  }

  /**
   * Format sources for LLM system prompt
   */
  formatSourcesForPrompt(sources: CitationSource[]): string {
    if (sources.length === 0) return '';

    const lines = sources.map((s, i) => {
      const index = i + 1;
      const domain = s.domain || 'local';
      const title = s.title || s.uri || 'Unknown';
      const snippet = s.snippet ? ` - "${s.snippet.slice(0, 100)}..."` : '';
      return `[${index}] ${domain}: ${title}${snippet}`;
    });

    return `\n### Available Sources\n${lines.join('\n')}`;
  }

  /**
   * Parse citation references from response text
   */
  parseReferences(
    text: string,
    sources: CitationSource[]
  ): CitationReference[] {
    const references: CitationReference[] = [];

    // Match patterns like [1], [2, 3], [1][2]
    const citationPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    let match;

    while ((match = citationPattern.exec(text)) !== null) {
      const indices = match[1].split(',').map(n => parseInt(n.trim()));
      const sourceIds = indices
        .filter(i => i > 0 && i <= sources.length)
        .map(i => sources[i - 1].id);

      if (sourceIds.length > 0) {
        references.push({
          id: `ref-${references.length}`,
          index: references.length + 1,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          citedText: match[0],
          sourceIds,
        });
      }
    }

    return references;
  }

  /**
   * Build complete citation context for a response
   */
  buildContext(
    messageId: string,
    response: string,
    toolResults: ToolResult[]
  ): CitationContext {
    const sources = this.extractSources(toolResults);
    const references = this.parseReferences(response, sources);

    return {
      messageId,
      sources,
      references,
      generatedAt: new Date().toISOString(),
    };
  }
}
```

---

### Database Schema

Add citation storage to the message schema:

```typescript
// Extension to existing message metadata

interface MessageMetadata {
  // ... existing fields ...

  /** Citation context for assistant messages */
  citations?: {
    sources: Array<{
      id: string;
      type: string;
      toolName: string;
      uri?: string;
      title?: string;
      domain?: string;
      snippet?: string;
    }>;
    references: Array<{
      index: number;
      startIndex: number;
      endIndex: number;
      sourceIds: string[];
    }>;
  };
}
```

---

## UX Design

### Information Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ASSISTANT MESSAGE                             │
│                                                                      │
│  React 19 introduces several major features including the new       │
│  Actions API for handling async operations¹, improved Server        │
│  Components¹², and the use() hook for reading resources during      │
│  render¹³.                                                          │
│                                                                      │
│  The new compiler optimizes re-renders automatically², eliminating  │
│  the need for useMemo and useCallback in most cases².               │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 📚 Sources                                           [Hide] │   │
│  │                                                              │   │
│  │  ¹ 🔗 react.dev                                             │   │
│  │    React 19 Official Blog                                   │   │
│  │    "React 19 is now stable! Here's what's new..."          │   │
│  │                                                              │   │
│  │  ² 🔗 dev.to                                                 │   │
│  │    What's New in React 19: A Complete Guide                  │   │
│  │    "The React Compiler is the biggest change..."            │   │
│  │                                                              │   │
│  │  ³ 🔗 medium.com                                             │   │
│  │    Deep Dive into React 19 Features                          │   │
│  │    "The use() hook represents a paradigm shift..."          │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Citation Display Patterns

#### Pattern 1: Inline Superscript (Recommended)

```
The Actions API handles async operations¹ while Server Components²
enable streaming HTML from the server.
```

**Pros:**
- Minimal visual disruption
- Clear claim-to-source bond
- Familiar from academic writing

**Cons:**
- May be missed by users unfamiliar with the pattern

#### Pattern 2: Inline Brackets

```
The Actions API handles async operations [1] while Server Components [2]
enable streaming HTML from the server.
```

**Pros:**
- More visible than superscript
- Standard in AI chat interfaces

**Cons:**
- Slightly more visual noise

#### Pattern 3: Inline Links

```
The Actions API (react.dev) handles async operations while
Server Components (dev.to) enable streaming HTML.
```

**Pros:**
- Immediate source identification
- No need to look up reference

**Cons:**
- Can be verbose for multiple sources
- Breaks reading flow

**Recommendation:** Use **Pattern 2 (Inline Brackets)** as primary, with superscript as optional user preference.

---

### Source Panel Design

#### Collapsed State (Default)

```
┌──────────────────────────────────────────────────────┐
│ 📚 3 sources used                            [Show ▼]│
└──────────────────────────────────────────────────────┘
```

#### Expanded State

```
┌──────────────────────────────────────────────────────┐
│ 📚 Sources                                   [Hide ▲]│
├──────────────────────────────────────────────────────┤
│                                                      │
│  [1] 🌐 react.dev                           [Visit →]│
│      React 19 Official Blog                          │
│      "React 19 is now stable and includes..."        │
│      ─────────────────────────────────────────       │
│      Used for: Actions API, Server Components        │
│                                                      │
│  [2] 🌐 dev.to                              [Visit →]│
│      What's New in React 19: Complete Guide          │
│      "The React Compiler represents the biggest..."  │
│      ─────────────────────────────────────────       │
│      Used for: React Compiler, Server Components     │
│                                                      │
│  [3] 🌐 medium.com                          [Visit →]│
│      Deep Dive into React 19 Features                │
│      "The use() hook enables reading resources..."   │
│      ─────────────────────────────────────────       │
│      Used for: use() hook                            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### Source Card Design

```
┌──────────────────────────────────────────────────────┐
│  [1]  🌐 react.dev                          [Visit →]│
│       ┌─────────────────────────────────────────────│
│       │ React 19 Official Blog                      │
│       │ ─────────────────────────────────────────   │
│       │ "React 19 is now stable! Here's what's     │
│       │  new in this major release..."              │
│       │                                             │
│       │ 🕐 Accessed: 2 min ago                      │
│       │ 📍 Used for: Actions API, Server Components │
│       └─────────────────────────────────────────────│
└──────────────────────────────────────────────────────┘
```

---

### Hover Interaction

When user hovers over a citation reference:

```
                                    ┌────────────────────────────┐
                                    │ 🌐 react.dev               │
The Actions API handles async [1] ─┤ React 19 Official Blog     │
operations efficiently.             │ "React 19 is now stable..."│
                                    │                            │
                                    │ [Click to open source]     │
                                    └────────────────────────────┘
```

**Hover Tooltip Content:**
- Favicon + domain
- Page title
- Snippet (first 100 chars)
- Click action hint

---

### Mobile Considerations

On mobile, hover is not available. Use tap interactions:

1. **First tap on citation**: Show inline expandable preview
2. **Second tap / tap on preview**: Open source in new tab
3. **Swipe left on source card**: Dismiss preview

```
┌─────────────────────────────────────────┐
│ The Actions API handles async [1]        │
│                                          │
│ ┌────────────────────────────────────┐  │
│ │ ¹ react.dev                        │  │
│ │ React 19 Official Blog             │  │
│ │ [Open Source]        [Dismiss ✕]   │  │
│ └────────────────────────────────────┘  │
│                                          │
│ operations efficiently.                  │
└─────────────────────────────────────────┘
```

---

### Source Type Indicators

Different visual indicators for source types:

| Source Type | Icon | Color | Example |
|-------------|------|-------|---------|
| Web page | 🌐 | Blue | External URLs |
| File | 📄 | Gray | Local files |
| API | 🔌 | Purple | API responses |
| Database | 🗄️ | Orange | DB queries |
| Memory | 🧠 | Green | User memory |
| Skill | ⚡ | Yellow | Skill outputs |
| MCP | 🔗 | Teal | MCP tool outputs |

---

### Confidence Indicators (Optional)

If confidence scores are available:

```
┌──────────────────────────────────────────────────────┐
│  [1] 🌐 react.dev                     ████████░░ 85% │
│      React 19 Official Blog                          │
│                                                      │
│  [2] 🌐 dev.to                        ██████░░░░ 62% │
│      What's New in React 19                          │
└──────────────────────────────────────────────────────┘
```

---

### No Citations State

When response has no citations:

```
┌──────────────────────────────────────────────────────┐
│  This response is based on my training data and      │
│  general knowledge. No external sources were used.   │
└──────────────────────────────────────────────────────┘
```

---

## Frontend Implementation

### React Components

#### CitationReference Component

```jsx
// web/src/components/CitationReference.jsx

import React, { useState, useRef } from 'react';

export function CitationReference({ index, sources, onHover, onClick }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const ref = useRef(null);

  return (
    <span
      ref={ref}
      className="citation-ref"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => onClick(sources)}
    >
      [{index}]
      {showTooltip && (
        <CitationTooltip
          sources={sources}
          anchorRef={ref}
        />
      )}
    </span>
  );
}
```

#### SourcePanel Component

```jsx
// web/src/components/SourcePanel.jsx

import React, { useState } from 'react';

export function SourcePanel({ sources, references }) {
  const [expanded, setExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="source-panel">
      <button
        className="source-panel-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        📚 {sources.length} source{sources.length !== 1 ? 's' : ''} used
        <span className="toggle-icon">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="source-list">
          {sources.map((source, i) => (
            <SourceCard
              key={source.id}
              index={i + 1}
              source={source}
              usedIn={getUsedInReferences(source.id, references)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

#### SourceCard Component

```jsx
// web/src/components/SourceCard.jsx

import React from 'react';

const SOURCE_ICONS = {
  web: '🌐',
  file: '📄',
  api: '🔌',
  database: '🗄️',
  memory: '🧠',
  skill: '⚡',
  mcp: '🔗',
};

export function SourceCard({ index, source, usedIn }) {
  const icon = SOURCE_ICONS[source.type] || '📎';

  return (
    <div className="source-card">
      <div className="source-header">
        <span className="source-index">[{index}]</span>
        <span className="source-icon">{icon}</span>
        <span className="source-domain">{source.domain || 'local'}</span>
        {source.uri && (
          <a
            href={source.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
          >
            Visit →
          </a>
        )}
      </div>

      <div className="source-title">{source.title}</div>

      {source.snippet && (
        <div className="source-snippet">"{source.snippet}"</div>
      )}

      {usedIn && usedIn.length > 0 && (
        <div className="source-usage">
          Used for: {usedIn.join(', ')}
        </div>
      )}
    </div>
  );
}
```

### CSS Styles

```css
/* Citation Reference Styles */
.citation-ref {
  color: var(--accent-color, #0066cc);
  cursor: pointer;
  font-size: 0.85em;
  vertical-align: super;
  padding: 0 2px;
  border-radius: 3px;
  transition: background-color 0.15s;
}

.citation-ref:hover {
  background-color: var(--accent-bg, rgba(0, 102, 204, 0.1));
}

/* Source Panel Styles */
.source-panel {
  margin-top: 16px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.source-panel-toggle {
  width: 100%;
  padding: 12px 16px;
  background: var(--panel-bg, #f5f5f5);
  border: none;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.source-list {
  padding: 8px;
}

/* Source Card Styles */
.source-card {
  padding: 12px;
  margin: 8px 0;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 6px;
}

.source-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.source-index {
  font-weight: 600;
  color: var(--accent-color, #0066cc);
}

.source-domain {
  color: var(--text-secondary, #666);
  font-size: 13px;
}

.source-link {
  margin-left: auto;
  font-size: 12px;
}

.source-title {
  font-weight: 500;
  margin-bottom: 4px;
}

.source-snippet {
  color: var(--text-secondary, #666);
  font-size: 13px;
  font-style: italic;
  margin: 8px 0;
}

.source-usage {
  font-size: 12px;
  color: var(--text-tertiary, #888);
  padding-top: 8px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

/* Tooltip Styles */
.citation-tooltip {
  position: absolute;
  background: var(--tooltip-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-width: 300px;
  z-index: 1000;
}
```

---

## WebSocket Events

Extend existing event types for citation data:

```typescript
// Enhanced stream_end event
interface StreamEndEvent {
  type: 'stream_end';
  id: string;
  conversationId?: string;

  // New citation data
  citations?: {
    sources: CitationSource[];
    references: CitationReference[];
  };
}

// Enhanced message event
interface MessageEvent {
  type: 'message';
  id: string;
  content: string;
  // ... existing fields ...

  // New citation data
  citations?: {
    sources: CitationSource[];
    references: CitationReference[];
  };
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

1. Define TypeScript types in `src/citations/types.ts`
2. Implement `CitationService` in `src/citations/service.ts`
3. Create citation extractors for web_search and web_fetch tools
4. Add citation extraction to tool execution flow

### Phase 2: LLM Integration (Week 2)

1. Update system prompts with citation guidelines
2. Modify `formatSourcesForPrompt()` to inject available sources
3. Implement citation parsing from LLM responses
4. Store citations in message metadata

### Phase 3: Frontend Components (Week 3)

1. Create `CitationReference` component
2. Create `SourcePanel` and `SourceCard` components
3. Update `MessageContent` to render citations
4. Add citation tooltip with hover preview

### Phase 4: Enhanced Features (Week 4)

1. Add more citation extractors (file read, API tools, MCP tools)
2. Implement hover tooltips for citations
3. Add mobile-friendly tap interactions
4. Implement confidence score display

### Phase 5: Polish & Testing (Week 5)

1. Accessibility improvements (ARIA labels, keyboard navigation)
2. Animation and transition polish
3. End-to-end testing
4. Documentation

---

## Configuration Options

```typescript
interface CitationConfig {
  /** Enable/disable citation system */
  enabled: boolean;

  /** Citation display format */
  format: 'brackets' | 'superscript' | 'inline-links';

  /** Show source panel by default */
  expandSourcesByDefault: boolean;

  /** Show confidence scores if available */
  showConfidenceScores: boolean;

  /** Max sources to display */
  maxSourcesDisplayed: number;

  /** Tools to extract citations from (glob patterns) */
  enabledTools: string[];

  /** Show hover tooltips */
  enableTooltips: boolean;
}

const DEFAULT_CITATION_CONFIG: CitationConfig = {
  enabled: true,
  format: 'brackets',
  expandSourcesByDefault: false,
  showConfidenceScores: false,
  maxSourcesDisplayed: 10,
  enabledTools: ['*'],
  enableTooltips: true,
};
```

---

## Quality Considerations

### Accuracy
- Only include citations when sources actually support claims
- Parse and validate citation references against available sources
- Flag citations with low confidence scores

### Performance
- Lazy-load source previews
- Cache favicon URLs
- Minimize citation metadata in WebSocket events
- Consider compression for large citation contexts

### Accessibility
- ARIA labels for citation references
- Keyboard navigation for source panel
- Screen reader announcements for citations
- High contrast mode support

### Privacy
- Don't leak internal file paths in web UI
- Sanitize source URLs before display
- Allow users to disable citation tracking

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Citation coverage | >80% of claims cited | Automated analysis |
| Source accuracy | >95% valid links | Link validation |
| User engagement | >50% expand sources | Analytics |
| Performance overhead | <100ms latency added | Timing measurements |
| Accessibility score | WCAG AA compliant | Automated testing |

---

## References

- [Anthropic Citations API](https://platform.claude.com/docs/en/build-with-claude/citations)
- [Google Grounding with Search](https://ai.google.dev/gemini-api/docs/google-search)
- [AI UX Patterns - Citations](https://www.shapeof.ai/patterns/citations)
- [Perplexity Citation-Forward Design](https://www.unusual.ai/blog/perplexity-platform-guide-design-for-citation-forward-answers)
- [ChatGPT Citation Process](https://medium.com/@get2vikasjha/inside-the-process-how-chatgpt-finds-and-cites-content-without-guesswork-ebe63ecf9857)
