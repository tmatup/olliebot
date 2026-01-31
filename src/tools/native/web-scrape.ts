/**
 * Web Scrape Native Tool
 *
 * Scrapes a single URL and returns a summary of the content.
 * Supports short and detailed summary modes.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export type WebScrapeOutputMode = 'short_summary' | 'detailed_summary';

export interface WebScrapeConfig {
  /** LLM service for generating summaries */
  llmService: LLMServiceInterface;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

interface LLMServiceInterface {
  generate(
    messages: Array<{ role: string; content: string }>,
    options?: { systemPrompt?: string; maxTokens?: number }
  ): Promise<{ content: string }>;
}

export class WebScrapeTool implements NativeTool {
  readonly name = 'web_scrape';
  readonly description =
    'Scrape a web page and get a summary of its content. Use this when you need to read and understand the content of a specific URL. Returns either a short summary (key points) or detailed summary (comprehensive overview).';
  readonly inputSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to scrape',
      },
      outputMode: {
        type: 'string',
        enum: ['short_summary', 'detailed_summary'],
        description: 'Output mode: "short_summary" for key points (2-3 sentences), "detailed_summary" for comprehensive overview (default: short_summary)',
      },
    },
    required: ['url'],
  };

  private llmService: LLMServiceInterface;
  private timeout: number;

  constructor(config: WebScrapeConfig) {
    this.llmService = config.llmService;
    this.timeout = config.timeout || 30000;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const url = String(params.url || '');
    const outputMode = (params.outputMode as WebScrapeOutputMode) || 'short_summary';

    if (!url.trim()) {
      return {
        success: false,
        error: 'url parameter is required',
      };
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return {
        success: false,
        error: 'Invalid URL. Must be a valid http or https URL.',
      };
    }

    try {
      // Fetch the page
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OllieBot/1.0; +https://github.com/olliebot)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
        return {
          success: false,
          error: `Unsupported content type: ${contentType}. Only HTML and plain text are supported.`,
        };
      }

      const html = await response.text();

      // Extract text content from HTML
      const textContent = this.extractText(html);

      if (!textContent.trim()) {
        return {
          success: false,
          error: 'No text content found on the page',
        };
      }

      // Extract metadata
      const title = this.extractTitle(html);
      const description = this.extractMetaDescription(html);

      // Generate summary using LLM
      const summary = await this.generateSummary(textContent, outputMode, title, url);

      return {
        success: true,
        output: {
          url,
          title: title || undefined,
          metaDescription: description || undefined,
          outputMode,
          summary,
          contentLength: textContent.length,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${this.timeout}ms`,
        };
      }
      return {
        success: false,
        error: `Web scrape failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Extract text content from HTML
   */
  private extractText(html: string): string {
    // Remove script and style elements
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

    // Remove HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');

    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = this.decodeHtmlEntities(text);

    // Normalize whitespace
    text = text
      .replace(/\s+/g, ' ')
      .trim();

    // Limit content length for LLM processing
    const maxLength = 50000;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }

    return text;
  }

  /**
   * Extract page title
   */
  private extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match) {
      return this.decodeHtmlEntities(match[1]).trim();
    }
    return null;
  }

  /**
   * Extract meta description
   */
  private extractMetaDescription(html: string): string | null {
    const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    if (match) {
      return this.decodeHtmlEntities(match[1]).trim();
    }
    return null;
  }

  /**
   * Decode common HTML entities
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&apos;': "'",
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™',
      '&ndash;': '–',
      '&mdash;': '—',
      '&lsquo;': '\u2018',
      '&rsquo;': '\u2019',
      '&ldquo;': '\u201C',
      '&rdquo;': '\u201D',
      '&bull;': '•',
      '&hellip;': '…',
    };

    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'g'), char);
    }

    // Handle numeric entities
    result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
    result = result.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    return result;
  }

  /**
   * Generate summary using LLM
   */
  private async generateSummary(
    content: string,
    outputMode: WebScrapeOutputMode,
    title: string | null,
    url: string
  ): Promise<string> {
    const systemPrompt = outputMode === 'short_summary'
      ? `You are a concise summarizer. Provide a brief summary of the web page content in 2-3 sentences, capturing only the most essential information. Be direct and factual.`
      : `You are a thorough summarizer. Provide a detailed summary of the web page content, covering all main topics, key points, and important details. Use bullet points or sections where appropriate to organize the information clearly. Aim for a comprehensive overview that captures the full scope of the content.`;

    const userPrompt = `Summarize the following web page content:

URL: ${url}
${title ? `Title: ${title}\n` : ''}
Content:
${content}`;

    const response = await this.llmService.generate(
      [{ role: 'user', content: userPrompt }],
      {
        systemPrompt,
        maxTokens: outputMode === 'short_summary' ? 200 : 1000,
      }
    );

    return response.content;
  }
}
