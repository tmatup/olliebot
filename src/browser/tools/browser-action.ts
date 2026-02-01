/**
 * Browser Action Tool
 *
 * Native tool for executing actions in a browser session.
 * Supports both natural language instructions and direct actions.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types.js';
import type { BrowserSessionManager } from '../manager.js';
import type { BrowserAction } from '../types.js';

export class BrowserActionTool implements NativeTool {
  readonly name = 'browser_action';
  readonly description = `Execute an action in a browser session.

You can either:
1. Provide a natural language instruction (e.g., "Click the Sign Up button")
2. Provide a specific action with parameters

The browser will use its configured strategy (Computer Use or DOM) to execute the instruction.

For Computer Use strategy: Actions are coordinate-based (x, y)
For DOM strategy: Actions use CSS selectors`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The browser session ID',
      },
      instruction: {
        type: 'string',
        description: 'Natural language instruction (e.g., "Click the Sign Up button")',
      },
      action: {
        type: 'string',
        enum: ['click', 'type', 'scroll', 'key', 'wait', 'extract'],
        description: 'Specific action type (alternative to instruction)',
      },
      x: {
        type: 'number',
        description: 'X coordinate for click (Computer Use strategy)',
      },
      y: {
        type: 'number',
        description: 'Y coordinate for click (Computer Use strategy)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for the element (DOM strategy)',
      },
      text: {
        type: 'string',
        description: 'Text to type (for type action)',
      },
      key: {
        type: 'string',
        description: 'Key to press (for key action, e.g., "Enter", "Tab")',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'Scroll direction (for scroll action)',
      },
      amount: {
        type: 'number',
        description: 'Scroll amount in pixels (for scroll action)',
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
      // If instruction is provided, use executeInstruction
      if (params.instruction) {
        const instruction = String(params.instruction);
        const result = await this.browserManager.executeInstruction(sessionId, instruction);

        if (!result.success) {
          return {
            success: false,
            error: result.error || 'Instruction execution failed',
          };
        }

        return {
          success: true,
          output: {
            message: `Executed instruction: ${instruction}`,
            action: result.action,
            pageUrl: result.pageUrl,
            pageTitle: result.pageTitle,
            screenshot: result.screenshot
              ? `data:image/png;base64,${result.screenshot}`
              : undefined,
            coordinates: result.coordinates,
            extractedData: result.extractedData,
            durationMs: result.durationMs,
          },
        };
      }

      // Otherwise, build a BrowserAction from params
      if (!params.action) {
        return {
          success: false,
          error: 'Either instruction or action is required',
        };
      }

      const action: BrowserAction = {
        type: params.action as BrowserAction['type'],
        x: params.x !== undefined ? Number(params.x) : undefined,
        y: params.y !== undefined ? Number(params.y) : undefined,
        selector: params.selector ? String(params.selector) : undefined,
        text: params.text ? String(params.text) : undefined,
        key: params.key ? String(params.key) : undefined,
        direction: params.direction as BrowserAction['direction'],
        amount: params.amount !== undefined ? Number(params.amount) : undefined,
      };

      const result = await this.browserManager.executeAction(sessionId, action);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Action execution failed',
        };
      }

      return {
        success: true,
        output: {
          message: `Executed ${action.type} action`,
          action: result.action,
          pageUrl: result.pageUrl,
          pageTitle: result.pageTitle,
          screenshot: result.screenshot
            ? `data:image/png;base64,${result.screenshot}`
            : undefined,
          coordinates: result.coordinates,
          extractedData: result.extractedData,
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
