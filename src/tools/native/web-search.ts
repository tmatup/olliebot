/**
 * Web Search Native Tool
 *
 * Searches the web using multiple provider options:
 * - Serper (serper.dev) - Google Search API
 * - Google Custom Search API
 * - Tavily (tavily.com) - AI-powered search with answer generation
 */

import type { NativeTool, NativeToolResult } from './types.js';

export type WebSearchProvider = 'serper' | 'google_custom_search' | 'tavily';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  apiKey: string;
  /** Google Custom Search Engine ID (required for google_custom_search provider) */
  searchEngineId?: string;
}

export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperResponse {
  organic?: Array<{
    title: string;
    link: string;
    snippet: string;
    position: number;
  }>;
  answerBox?: {
    title?: string;
    answer?: string;
    snippet?: string;
  };
  knowledgeGraph?: {
    title?: string;
    description?: string;
  };
}

interface GoogleCustomSearchResponse {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
  }>;
  searchInformation?: {
    totalResults: string;
  };
}

interface TavilyResponse {
  query: string;
  answer?: string;
  results?: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}

export class WebSearchTool implements NativeTool {
  readonly name = 'web_search';
  readonly description =
    'Search the web for current information. Use this for recent news, current events, real-time data, or when Wikipedia might not have the answer. Returns web search results with titles, links, and snippets.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      numResults: {
        type: 'number',
        description: 'Number of results to return (default: 5, max: 10)',
      },
    },
    required: ['query'],
  };

  private config: WebSearchConfig;

  constructor(config: WebSearchConfig) {
    this.config = config;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const query = String(params.query || '');
    const numResults = Math.min(Math.max(Number(params.numResults) || 5, 1), 10);

    if (!query.trim()) {
      return {
        success: false,
        error: 'query parameter is required',
      };
    }

    try {
      let results: WebSearchResult[];
      let additionalInfo: Record<string, unknown> = {};

      switch (this.config.provider) {
        case 'serper':
          ({ results, additionalInfo } = await this.searchWithSerper(query, numResults));
          break;
        case 'google_custom_search':
          results = await this.searchWithGoogleCustomSearch(query, numResults);
          break;
        case 'tavily':
          ({ results, additionalInfo } = await this.searchWithTavily(query, numResults));
          break;
        default:
          return {
            success: false,
            error: `Unknown search provider: ${this.config.provider}`,
          };
      }

      return {
        success: true,
        output: {
          query,
          provider: this.config.provider,
          results,
          totalResults: results.length,
          ...additionalInfo,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Search using Serper API (serper.dev)
   */
  private async searchWithSerper(
    query: string,
    numResults: number
  ): Promise<{ results: WebSearchResult[]; additionalInfo: Record<string, unknown> }> {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': this.config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: numResults,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Serper API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SerperResponse;
    const additionalInfo: Record<string, unknown> = {};

    // Extract answer box if present
    if (data.answerBox) {
      additionalInfo.answerBox = {
        title: data.answerBox.title,
        answer: data.answerBox.answer || data.answerBox.snippet,
      };
    }

    // Extract knowledge graph if present
    if (data.knowledgeGraph) {
      additionalInfo.knowledgeGraph = {
        title: data.knowledgeGraph.title,
        description: data.knowledgeGraph.description,
      };
    }

    const results: WebSearchResult[] = (data.organic || []).map((item, index) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      position: item.position || index + 1,
    }));

    return { results, additionalInfo };
  }

  /**
   * Search using Google Custom Search API
   */
  private async searchWithGoogleCustomSearch(query: string, numResults: number): Promise<WebSearchResult[]> {
    if (!this.config.searchEngineId) {
      throw new Error('searchEngineId is required for Google Custom Search');
    }

    const params = new URLSearchParams({
      key: this.config.apiKey,
      cx: this.config.searchEngineId,
      q: query,
      num: String(numResults),
    });

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Custom Search API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as GoogleCustomSearchResponse;

    return (data.items || []).map((item, index) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      position: index + 1,
    }));
  }

  /**
   * Search using Tavily API (tavily.com)
   */
  private async searchWithTavily(
    query: string,
    numResults: number
  ): Promise<{ results: WebSearchResult[]; additionalInfo: Record<string, unknown> }> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.config.apiKey,
        query,
        max_results: numResults,
        search_depth: "advanced",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tavily API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as TavilyResponse;
    const additionalInfo: Record<string, unknown> = {};

    // Include AI-generated answer if present
    if (data.answer) {
      additionalInfo.answer = data.answer;
    }

    const results: WebSearchResult[] = (data.results || []).map((item, index) => ({
      title: item.title,
      link: item.url,
      snippet: item.content,
      position: index + 1,
    }));

    return { results, additionalInfo };
  }
}
