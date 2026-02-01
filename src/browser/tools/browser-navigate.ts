/**
 * Browser Navigate Tool
 *
 * Native tool for navigating browser sessions to URLs.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types.js';
import type { BrowserSessionManager } from '../manager.js';

export class BrowserNavigateTool implements NativeTool {
  readonly name = 'browser_navigate';
  readonly description = `Navigate a browser session to a URL.

Returns a screenshot of the page after navigation.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The browser session ID',
      },
      url: {
        type: 'string',
        description: 'The URL to navigate to',
      },
    },
    required: ['sessionId', 'url'],
  };

  private browserManager: BrowserSessionManager;

  constructor(browserManager: BrowserSessionManager) {
    this.browserManager = browserManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const sessionId = params.sessionId ? String(params.sessionId) : undefined;
    const url = params.url ? String(params.url) : undefined;

    if (!sessionId) {
      return {
        success: false,
        error: `sessionId is required. Received params: ${JSON.stringify(Object.keys(params))}`,
      };
    }

    // Validate sessionId format (should be UUID-like)
    if (sessionId.length < 30 || !sessionId.includes('-')) {
      return {
        success: false,
        error: `Invalid sessionId format: "${sessionId}". Expected a valid UUID.`,
      };
    }

    if (!url) {
      return {
        success: false,
        error: 'url is required',
      };
    }

    try {
      const result = await this.browserManager.navigate(sessionId, url);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Navigation failed',
        };
      }

      return {
        success: true,
        output: {
          message: `Navigated to ${url}`,
          pageUrl: result.pageUrl,
          pageTitle: result.pageTitle,
          screenshot: result.screenshot
            ? `data:image/png;base64,${result.screenshot}`
            : undefined,
          durationMs: result.durationMs,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
