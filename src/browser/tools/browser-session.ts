/**
 * Browser Session Tool
 *
 * Native tool for creating and managing browser sessions.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types.js';
import type { BrowserSessionManager } from '../manager.js';
import type { BrowserStrategyType, ComputerUseProvider, DOMProvider } from '../types.js';

export class BrowserSessionTool implements NativeTool {
  readonly name = 'browser_session';
  readonly description = `Create, list, or close browser automation sessions.

Actions:
- create: Create a new browser session
- list: List all active sessions
- close: Close a specific session
- get: Get details of a specific session

When creating a session, you can optionally specify strategy and provider.
If not specified, defaults from server configuration (BROWSER_PROVIDER, BROWSER_STRATEGY) are used.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'close', 'get'],
        description: 'The action to perform',
      },
      sessionId: {
        type: 'string',
        description: 'Session ID (required for close/get actions)',
      },
      name: {
        type: 'string',
        description: 'Session name (optional for create action)',
      },
      strategy: {
        type: 'string',
        enum: ['computer-use', 'dom'],
        description: 'Browser strategy (optional, uses server default from BROWSER_STRATEGY)',
      },
      provider: {
        type: 'string',
        enum: ['azure_openai', 'google', 'anthropic', 'openai'],
        description: 'Provider for the strategy (optional, uses server default from BROWSER_PROVIDER)',
      },
    },
    required: ['action'],
  };

  private browserManager: BrowserSessionManager;

  constructor(browserManager: BrowserSessionManager) {
    this.browserManager = browserManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const action = String(params.action);

    try {
      switch (action) {
        case 'create':
          return await this.createSession(params);

        case 'list':
          return await this.listSessions();

        case 'close':
          return await this.closeSession(params);

        case 'get':
          return await this.getSession(params);

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async createSession(
    params: Record<string, unknown>
  ): Promise<NativeToolResult> {
    const name = params.name ? String(params.name) : undefined;
    const strategy = params.strategy as BrowserStrategyType | undefined;
    const provider = params.provider as ComputerUseProvider | DOMProvider | undefined;

    const config: Record<string, unknown> = {};
    if (strategy) {
      config.strategy = strategy;
    }
    if (provider) {
      if (strategy === 'computer-use' || !strategy) {
        config.computerUseProvider = provider;
      } else {
        config.domProvider = provider;
      }
    }

    const session = await this.browserManager.createSession(name, config as any);

    return {
      success: true,
      output: {
        message: `Browser session created: ${session.id}`,
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          strategy: session.strategy,
          provider: session.provider,
        },
      },
    };
  }

  private async listSessions(): Promise<NativeToolResult> {
    const sessions = await this.browserManager.listSessions();

    return {
      success: true,
      output: {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status,
          strategy: s.strategy,
          provider: s.provider,
          currentUrl: s.currentUrl,
        })),
      },
    };
  }

  private async closeSession(
    params: Record<string, unknown>
  ): Promise<NativeToolResult> {
    const sessionId = params.sessionId ? String(params.sessionId) : undefined;

    if (!sessionId) {
      return {
        success: false,
        error: 'sessionId is required for close action',
      };
    }

    await this.browserManager.closeSession(sessionId);

    return {
      success: true,
      output: {
        message: `Browser session closed: ${sessionId}`,
      },
    };
  }

  private async getSession(
    params: Record<string, unknown>
  ): Promise<NativeToolResult> {
    const sessionId = params.sessionId ? String(params.sessionId) : undefined;

    if (!sessionId) {
      return {
        success: false,
        error: 'sessionId is required for get action',
      };
    }

    const session = await this.browserManager.getSessionInfo(sessionId);

    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    return {
      success: true,
      output: {
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          strategy: session.strategy,
          provider: session.provider,
          currentUrl: session.currentUrl,
          currentTitle: session.currentTitle,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          viewport: session.viewport,
        },
      },
    };
  }
}
