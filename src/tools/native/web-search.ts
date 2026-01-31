/**
 * Wikipedia Search Native Tool
 *
 * Searches Wikipedia using their free public API.
 * No API key required.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export interface WikipediaSearchResult {
  title: string;
  pageid: number;
  snippet: string;
  url: string;
}

export class WebSearchTool implements NativeTool {
  readonly name = 'web_search';
  readonly description =
    'Search Wikipedia for information. Returns relevant article summaries for the given search query. Use this for factual information, definitions, historical events, people, places, and general knowledge.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      searchText: {
        type: 'string',
        description: 'The search query text',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)',
      },
    },
    required: ['searchText'],
  };

  private baseUrl = 'https://en.wikipedia.org/w/api.php';

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const searchText = String(params.searchText || '');
    const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 10);

    if (!searchText.trim()) {
      return {
        success: false,
        error: 'searchText parameter is required',
      };
    }

    try {
      // Search Wikipedia
      const searchParams = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: searchText,
        srlimit: String(limit),
        format: 'json',
        origin: '*',
      });

      const searchResponse = await fetch(`${this.baseUrl}?${searchParams}`);

      if (!searchResponse.ok) {
        throw new Error(`Wikipedia API error (${searchResponse.status})`);
      }

      const searchData = (await searchResponse.json()) as {
        query?: {
          search?: Array<{
            title: string;
            pageid: number;
            snippet: string;
          }>;
        };
      };

      const searchResults = searchData.query?.search || [];

      if (searchResults.length === 0) {
        return {
          success: true,
          output: {
            query: searchText,
            results: [],
            totalResults: 0,
            message: 'No Wikipedia articles found for this query.',
          },
        };
      }

      // Get extracts for each result
      const pageIds = searchResults.map((r) => r.pageid).join('|');
      const extractParams = new URLSearchParams({
        action: 'query',
        pageids: pageIds,
        prop: 'extracts|info',
        exintro: 'true',
        explaintext: 'true',
        exsentences: '3',
        inprop: 'url',
        format: 'json',
        origin: '*',
      });

      const extractResponse = await fetch(`${this.baseUrl}?${extractParams}`);
      const extractData = (await extractResponse.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              pageid: number;
              title: string;
              extract?: string;
              fullurl?: string;
            }
          >;
        };
      };

      const pages = extractData.query?.pages || {};

      // Combine search results with extracts
      const results: WikipediaSearchResult[] = searchResults.map((sr) => {
        const page = pages[String(sr.pageid)];
        return {
          title: sr.title,
          pageid: sr.pageid,
          snippet: page?.extract || this.stripHtml(sr.snippet),
          url: page?.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(sr.title.replace(/ /g, '_'))}`,
        };
      });

      return {
        success: true,
        output: {
          query: searchText,
          results,
          totalResults: results.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Wikipedia search failed: ${String(error)}`,
      };
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }
}
