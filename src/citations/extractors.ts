/**
 * Citation Extractors
 *
 * Tool-specific extractors that convert tool outputs into citation sources.
 */

import type { CitationExtractor, CitationSource } from './types.js';

/**
 * Web search result structure
 */
interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface WebSearchOutput {
  query: string;
  provider: string;
  results: WebSearchResult[];
  totalResults: number;
  answerBox?: { title?: string; answer?: string };
  knowledgeGraph?: { title?: string; description?: string };
}

/**
 * Extractor for native web_search tool
 */
export const webSearchExtractor: CitationExtractor = {
  pattern: /^web_search$/,

  extract(
    requestId: string,
    toolName: string,
    _parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[] {
    const data = output as WebSearchOutput;
    if (!data?.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((result, index) => {
      let domain = '';
      try {
        domain = new URL(result.link).hostname.replace(/^www\./, '');
      } catch {
        domain = 'unknown';
      }

      return {
        id: `${requestId}-${index}`,
        type: 'web',
        toolName,
        toolRequestId: requestId,
        uri: result.link,
        title: result.title,
        domain,
        snippet: result.snippet,
        timestamp: new Date().toISOString(),
      };
    });
  },
};

/**
 * Web scrape output structure
 */
interface WebScrapeOutput {
  url: string;
  title?: string;
  metaDescription?: string;
  contentType: string;
  outputMode: string;
  summary?: string;
  content?: string;
  contentLength: number;
}

/**
 * Extractor for native web_scrape tool
 */
export const webScrapeExtractor: CitationExtractor = {
  pattern: /^web_scrape$/,

  extract(
    requestId: string,
    toolName: string,
    _parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[] {
    const data = output as WebScrapeOutput;
    if (!data?.url) {
      return [];
    }

    let domain = '';
    try {
      domain = new URL(data.url).hostname.replace(/^www\./, '');
    } catch {
      domain = 'unknown';
    }

    // Use meta description or first part of content as snippet
    const snippet =
      data.metaDescription ||
      (data.summary
        ? data.summary.slice(0, 200)
        : data.content?.slice(0, 200)) ||
      '';

    return [
      {
        id: `${requestId}-0`,
        type: 'web',
        toolName,
        toolRequestId: requestId,
        uri: data.url,
        title: data.title,
        domain,
        snippet: snippet.length > 200 ? snippet.slice(0, 200) + '...' : snippet,
        fullContent: data.content || data.summary,
        timestamp: new Date().toISOString(),
      },
    ];
  },
};

/**
 * RAG query result structure
 */
interface RAGQueryResult {
  documentPath: string;
  text: string;
  score: number;
  chunkIndex: number;
  metadata?: Record<string, unknown>;
}

interface RAGQueryOutput {
  projectId: string;
  query: string;
  results: RAGQueryResult[];
  totalResults: number;
  queryTimeMs: number;
}

/**
 * Extractor for native query_rag_project tool
 */
export const ragQueryExtractor: CitationExtractor = {
  pattern: /^query_rag_project$/,

  extract(
    requestId: string,
    toolName: string,
    _parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[] {
    const data = output as RAGQueryOutput;
    if (!data?.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((result, index) => {
      // Extract filename from path
      const pathParts = result.documentPath.split(/[/\\]/);
      const filename = pathParts[pathParts.length - 1] || result.documentPath;

      // Extract page number from metadata if available
      const pageNumber = result.metadata?.pageNumber as number | undefined;

      return {
        id: `${requestId}-${index}`,
        type: 'file',
        toolName,
        toolRequestId: requestId,
        uri: result.documentPath,
        title: filename,
        snippet: result.text.slice(0, 200) + (result.text.length > 200 ? '...' : ''),
        fullContent: result.text,
        pageNumber,
        timestamp: new Date().toISOString(),
      };
    });
  },
};

/**
 * Wikipedia search result structure
 */
interface WikipediaSearchOutput {
  query: string;
  results: Array<{
    title: string;
    pageid: number;
    snippet: string;
    url?: string;
  }>;
}

/**
 * Extractor for native wikipedia_search tool
 */
export const wikipediaSearchExtractor: CitationExtractor = {
  pattern: /^wikipedia_search$/,

  extract(
    requestId: string,
    toolName: string,
    _parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[] {
    const data = output as WikipediaSearchOutput;
    if (!data?.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((result, index) => ({
      id: `${requestId}-${index}`,
      type: 'web',
      toolName,
      toolRequestId: requestId,
      uri:
        result.url ||
        `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`,
      title: result.title,
      domain: 'wikipedia.org',
      snippet: result.snippet.replace(/<[^>]*>/g, ''), // Strip HTML tags from snippet
      timestamp: new Date().toISOString(),
    }));
  },
};

/**
 * HTTP client output structure
 */
interface HttpClientOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  url: string;
}

/**
 * Extractor for native http_client tool
 */
export const httpClientExtractor: CitationExtractor = {
  pattern: /^http_client$/,

  extract(
    requestId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[] {
    const data = output as HttpClientOutput;
    const url = (parameters.url as string) || data?.url;

    if (!url) {
      return [];
    }

    let domain = '';
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      domain = 'unknown';
    }

    return [
      {
        id: `${requestId}-0`,
        type: 'api',
        toolName,
        toolRequestId: requestId,
        uri: url,
        title: `API: ${url}`,
        domain,
        snippet:
          typeof data?.body === 'string'
            ? data.body.slice(0, 200) + (data.body.length > 200 ? '...' : '')
            : undefined,
        fullContent: typeof data?.body === 'string' ? data.body : undefined,
        timestamp: new Date().toISOString(),
      },
    ];
  },
};

/**
 * Generic MCP tool extractor
 * Attempts to extract citation-worthy sources from MCP tool outputs
 */
export const mcpToolExtractor: CitationExtractor = {
  pattern: /^mcp\..+__.+$/, // Matches MCP pattern: mcp.serverId__toolName

  extract(
    requestId: string,
    toolName: string,
    _parameters: Record<string, unknown>,
    output: unknown
  ): CitationSource[] {
    // Try to extract sources from various output formats
    const sources: CitationSource[] = [];

    if (!output || typeof output !== 'object') {
      return sources;
    }

    const data = output as Record<string, unknown>;

    // Check for URL-like fields
    const urlFields = ['url', 'uri', 'link', 'href', 'source'];
    for (const field of urlFields) {
      if (typeof data[field] === 'string' && data[field]) {
        let domain = '';
        try {
          domain = new URL(data[field] as string).hostname.replace(/^www\./, '');
        } catch {
          // Not a valid URL, might be a file path
          domain = 'mcp';
        }

        sources.push({
          id: `${requestId}-0`,
          type: 'mcp',
          toolName,
          toolRequestId: requestId,
          uri: data[field] as string,
          title: (data.title as string) || (data.name as string) || toolName,
          domain,
          snippet:
            (data.content as string)?.slice(0, 200) ||
            (data.text as string)?.slice(0, 200) ||
            (data.description as string)?.slice(0, 200),
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    // Check for array of results with URLs
    const resultFields = ['results', 'items', 'data', 'entries'];
    for (const field of resultFields) {
      if (Array.isArray(data[field])) {
        const items = data[field] as Array<Record<string, unknown>>;
        for (let i = 0; i < items.length && i < 10; i++) {
          const item = items[i];
          if (typeof item === 'object' && item) {
            const url =
              (item.url as string) ||
              (item.uri as string) ||
              (item.link as string) ||
              (item.href as string);
            if (url) {
              let domain = '';
              try {
                domain = new URL(url).hostname.replace(/^www\./, '');
              } catch {
                domain = 'mcp';
              }

              sources.push({
                id: `${requestId}-${i}`,
                type: 'mcp',
                toolName,
                toolRequestId: requestId,
                uri: url,
                title:
                  (item.title as string) ||
                  (item.name as string) ||
                  `Result ${i + 1}`,
                domain,
                snippet:
                  (item.content as string)?.slice(0, 200) ||
                  (item.text as string)?.slice(0, 200) ||
                  (item.snippet as string)?.slice(0, 200) ||
                  (item.description as string)?.slice(0, 200),
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
        if (sources.length > 0) break;
      }
    }

    return sources;
  },
};

/**
 * Get all default extractors
 */
export function getDefaultExtractors(): CitationExtractor[] {
  return [
    webSearchExtractor,
    webScrapeExtractor,
    ragQueryExtractor,
    wikipediaSearchExtractor,
    httpClientExtractor,
    mcpToolExtractor,
  ];
}
