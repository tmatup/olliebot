/**
 * Browser Screenshot Tool
 *
 * Native tool for capturing screenshots from browser sessions.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types.js';
import type { BrowserSessionManager } from '../manager.js';

export class BrowserScreenshotTool implements NativeTool {
  readonly name = 'browser_screenshot';
  readonly description = `Capture a screenshot from a browser session.

Returns the screenshot as a base64 data URL.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The browser session ID',
      },
      fullPage: {
        type: 'boolean',
        description: 'Whether to capture the entire scrollable page (default: false)',
      },
    },
    required: ['sessionId'],
  };

  private browserManager: BrowserSessionManager;

  constructor(browserManager: BrowserSessionManager) {
    this.browserManager = browserManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const sessionId = params.sessionId ? String(params.sessionId) : undefined;
    const fullPage = params.fullPage === true;

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

    try {
      const screenshot = await this.browserManager.captureScreenshot(sessionId, fullPage);

      if (!screenshot) {
        return {
          success: false,
          error: 'Failed to capture screenshot',
        };
      }

      // Get session info for additional context
      const sessionInfo = await this.browserManager.getSessionInfo(sessionId);

      return {
        success: true,
        output: {
          screenshot: `data:image/png;base64,${screenshot}`,
          pageUrl: sessionInfo?.currentUrl,
          pageTitle: sessionInfo?.currentTitle,
          fullPage,
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
