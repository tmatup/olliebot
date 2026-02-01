/**
 * Browser Session Manager
 *
 * Manages browser automation sessions, including lifecycle, events, and WebChannel broadcasting.
 */

import { chromium, type Browser } from 'playwright';
import { v4 as uuid } from 'uuid';

import type {
  BrowserConfig,
  BrowserSession,
  BrowserAction,
  ActionResult,
} from './types.js';
import { DEFAULT_BROWSER_CONFIG } from './types.js';
import { BrowserSessionInstance } from './session.js';
import {
  createSessionCreatedEvent,
  createSessionUpdatedEvent,
  createSessionClosedEvent,
  createScreenshotEvent,
  createActionStartedEvent,
  createActionCompletedEvent,
  createClickMarkerEvent,
  type BrowserEvent,
} from './events.js';
import { createStrategy } from './strategies/index.js';
import type { IBrowserStrategy } from './strategies/types.js';

/**
 * Interface for WebChannel-like broadcast capability.
 */
export interface IBroadcaster {
  broadcast(data: unknown): void;
}

/**
 * Interface for LLM service (needed by strategies).
 */
export interface ILLMService {
  generate(
    messages: Array<{ role: string; content: string | unknown[] }>,
    options?: { systemPrompt?: string; maxTokens?: number }
  ): Promise<{ content: string }>;
}

export interface BrowserSessionManagerConfig {
  /** Default browser configuration */
  defaultConfig?: Partial<BrowserConfig>;
  /** WebChannel for broadcasting events */
  webChannel?: IBroadcaster;
  /** LLM service for strategies */
  llmService?: ILLMService;
}

/**
 * Manages browser automation sessions.
 *
 * Responsibilities:
 * - Creating and closing browser sessions
 * - Managing Playwright browser instance
 * - Broadcasting events to WebChannel
 * - Session lifecycle management
 */
export class BrowserSessionManager {
  private sessions: Map<string, BrowserSessionInstance> = new Map();
  private browser: Browser | null = null;
  private config: BrowserConfig;
  private webChannel?: IBroadcaster;
  private llmService?: ILLMService;
  private isInitialized = false;

  constructor(managerConfig: BrowserSessionManagerConfig = {}) {
    this.config = {
      ...DEFAULT_BROWSER_CONFIG,
      ...managerConfig.defaultConfig,
    };
    this.webChannel = managerConfig.webChannel;
    this.llmService = managerConfig.llmService;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initializes the Playwright browser instance.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('[Browser] Initializing browser manager...');

    // Launch browser with configuration
    const headless = this.config.debugMode ? false : this.config.headless;

    this.browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    this.isInitialized = true;
    console.log(`[Browser] Browser launched (headless: ${headless})`);
  }

  /**
   * Shuts down the browser manager and closes all sessions.
   */
  async shutdown(): Promise<void> {
    console.log('[Browser] Shutting down browser manager...');

    // Close all sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((id) => this.closeSession(id)));

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.isInitialized = false;
    console.log('[Browser] Browser manager shut down');
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Creates a new browser session.
   */
  async createSession(
    name?: string,
    configOverrides?: Partial<BrowserConfig>
  ): Promise<BrowserSession> {
    // Ensure browser is initialized
    if (!this.browser) {
      await this.initialize();
    }

    if (!this.browser) {
      throw new Error('Failed to initialize browser');
    }

    // Merge config
    const sessionConfig: BrowserConfig = {
      ...this.config,
      ...configOverrides,
    };

    // Create strategy
    const strategy = this.createStrategyForConfig(sessionConfig);

    // Create session instance
    const sessionName = name || `Session ${this.sessions.size + 1}`;
    const session = new BrowserSessionInstance({
      name: sessionName,
      config: sessionConfig,
      strategy,
      browser: this.browser,
    });

    // Wire up event handlers
    this.setupSessionEventHandlers(session);

    // Store session
    this.sessions.set(session.id, session);

    // Initialize the session
    await session.initialize();

    // Get session info and broadcast creation event
    const sessionInfo = await session.getSessionInfo();
    this.broadcast(createSessionCreatedEvent(sessionInfo));

    console.log(`[Browser] Created session: ${session.id} (${sessionName})`);
    return sessionInfo;
  }

  /**
   * Gets a session by ID.
   */
  getSession(sessionId: string): BrowserSessionInstance | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Gets session info by ID.
   */
  async getSessionInfo(sessionId: string): Promise<BrowserSession | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    return session.getSessionInfo();
  }

  /**
   * Lists all active sessions.
   */
  async listSessions(): Promise<BrowserSession[]> {
    const sessions: BrowserSession[] = [];
    for (const session of this.sessions.values()) {
      sessions.push(await session.getSessionInfo());
    }
    return sessions;
  }

  /**
   * Closes a session by ID.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[Browser] Session not found: ${sessionId}`);
      return;
    }

    await session.close();
    this.sessions.delete(sessionId);
    this.broadcast(createSessionClosedEvent(sessionId));

    console.log(`[Browser] Closed session: ${sessionId}`);
  }

  // ===========================================================================
  // Session Actions
  // ===========================================================================

  /**
   * Executes an instruction on a session.
   */
  async executeInstruction(
    sessionId: string,
    instruction: string
  ): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        action: { type: 'navigate' },
        error: `Session not found: ${sessionId}`,
        durationMs: 0,
      };
    }

    return session.executeInstruction(instruction);
  }

  /**
   * Executes an action on a session.
   */
  async executeAction(
    sessionId: string,
    action: BrowserAction
  ): Promise<ActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        action,
        error: `Session not found: ${sessionId}`,
        durationMs: 0,
      };
    }

    return session.executeAction(action);
  }

  /**
   * Navigates a session to a URL.
   */
  async navigate(sessionId: string, url: string): Promise<ActionResult> {
    return this.executeAction(sessionId, { type: 'navigate', url });
  }

  /**
   * Captures a screenshot from a session.
   */
  async captureScreenshot(
    sessionId: string,
    fullPage = false
  ): Promise<string | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return session.captureScreenshot(fullPage);
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Attaches a WebChannel for broadcasting events.
   * Called by the server after initialization.
   */
  attachWebChannel(webChannel: IBroadcaster): void {
    this.webChannel = webChannel;
    console.log('[Browser] WebChannel attached');
  }

  /**
   * Updates the default configuration.
   */
  updateConfig(configUpdates: Partial<BrowserConfig>): void {
    this.config = {
      ...this.config,
      ...configUpdates,
    };
    console.log('[Browser] Configuration updated');
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): BrowserConfig {
    return { ...this.config };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Creates a strategy based on configuration.
   */
  private createStrategyForConfig(config: BrowserConfig): IBrowserStrategy {
    return createStrategy(config, this.llmService);
  }

  /**
   * Sets up event handlers for a session.
   */
  private setupSessionEventHandlers(session: BrowserSessionInstance): void {
    // Status changes
    session.on('status-changed', async (status, error) => {
      this.broadcast(
        createSessionUpdatedEvent(session.id, { status, error })
      );
    });

    // Screenshots (periodic)
    session.on('screenshot', (screenshot, url, title) => {
      this.broadcast(createScreenshotEvent(session.id, screenshot, url, title));
    });

    // Action events
    session.on('action-started', (actionId, action) => {
      this.broadcast(createActionStartedEvent(session.id, actionId, action));
    });

    session.on('action-completed', (actionId, action, result) => {
      this.broadcast(createActionCompletedEvent(session.id, actionId, action, result));

      // Also send a screenshot update after action
      if (result.screenshot) {
        this.broadcast(
          createScreenshotEvent(
            session.id,
            result.screenshot,
            result.pageUrl || '',
            result.pageTitle || ''
          )
        );
      }
    });

    // Click markers
    session.on('click-marker', (marker) => {
      this.broadcast(createClickMarkerEvent(session.id, marker));
    });

    // Session closed
    session.on('closed', () => {
      // Already handled in closeSession
    });
  }

  /**
   * Broadcasts an event to the WebChannel.
   */
  private broadcast(event: BrowserEvent): void {
    if (this.webChannel) {
      this.webChannel.broadcast(event);
    }
  }
}
