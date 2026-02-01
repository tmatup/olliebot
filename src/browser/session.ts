/**
 * Browser Session
 *
 * Represents a single browser automation session wrapping a Playwright page.
 */

import { EventEmitter } from 'events';
import type { Page, Browser, BrowserContext } from 'playwright';
import { v4 as uuid } from 'uuid';

import type {
  BrowserSession,
  BrowserSessionStatus,
  BrowserConfig,
  BrowserAction,
  ActionResult,
  ClickMarker,
  InstructionContext,
} from './types.js';
import type { IBrowserStrategy } from './strategies/types.js';

export interface BrowserSessionInstanceConfig {
  /** Session display name */
  name: string;
  /** Browser configuration */
  config: BrowserConfig;
  /** The strategy to use for this session */
  strategy: IBrowserStrategy;
  /** Playwright browser instance */
  browser: Browser;
}

/**
 * Events emitted by BrowserSessionInstance.
 */
export interface BrowserSessionEvents {
  'status-changed': (status: BrowserSessionStatus, error?: string) => void;
  'screenshot': (screenshot: string, url: string, title: string) => void;
  'action-started': (actionId: string, action: BrowserAction) => void;
  'action-completed': (actionId: string, action: BrowserAction, result: ActionResult) => void;
  'click-marker': (marker: ClickMarker) => void;
  'closed': () => void;
}

/**
 * A browser session instance that manages a Playwright page and strategy.
 */
export class BrowserSessionInstance extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly config: BrowserConfig;
  readonly strategy: IBrowserStrategy;
  readonly createdAt: Date;

  private _status: BrowserSessionStatus = 'starting';
  private _error?: string;
  private _lastActivityAt: Date;
  private _lastScreenshot?: string;
  private _lastScreenshotAt?: Date;

  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private browser: Browser;
  private screenshotIntervalId?: ReturnType<typeof setInterval>;

  constructor(instanceConfig: BrowserSessionInstanceConfig) {
    super();
    this.id = uuid();
    this.name = instanceConfig.name;
    this.config = instanceConfig.config;
    this.strategy = instanceConfig.strategy;
    this.browser = instanceConfig.browser;
    this.createdAt = new Date();
    this._lastActivityAt = new Date();
  }

  // ===========================================================================
  // Getters
  // ===========================================================================

  get status(): BrowserSessionStatus {
    return this._status;
  }

  get error(): string | undefined {
    return this._error;
  }

  get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  get lastScreenshot(): string | undefined {
    return this._lastScreenshot;
  }

  get lastScreenshotAt(): Date | undefined {
    return this._lastScreenshotAt;
  }

  /**
   * Gets the current page URL.
   */
  get currentUrl(): string | undefined {
    return this.page?.url();
  }

  /**
   * Gets the Playwright page instance.
   */
  getPage(): Page | null {
    return this.page;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Initializes the browser session by creating a new context and page.
   */
  async initialize(): Promise<void> {
    try {
      this.setStatus('starting');

      // Create isolated browser context
      // Note: In debug mode (headful), setting deviceScaleFactor: 2 prevents content
      // resizing/flickering on high-DPI displays when taking screenshots (see playwright#2576)
      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
        userAgent: this.config.userAgent,
        ...(this.config.debugMode && { deviceScaleFactor: 2 }),
      });

      // Create new page
      this.page = await this.context.newPage();

      // Initialize the strategy with the page
      await this.strategy.initialize(this.page, {
        viewport: this.config.viewport,
      });

      // Start periodic screenshots if debug mode is enabled
      if (this.config.debugMode && this.config.screenshotInterval) {
        this.startPeriodicScreenshots(this.config.screenshotInterval);
      }

      this.setStatus('active');
      console.log(`[Browser] Session ${this.id} initialized`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setStatus('error', errorMessage);
      throw error;
    }
  }

  /**
   * Closes the browser session and releases resources.
   */
  async close(): Promise<void> {
    try {
      // Stop periodic screenshots
      if (this.screenshotIntervalId) {
        clearInterval(this.screenshotIntervalId);
        this.screenshotIntervalId = undefined;
      }

      // Dispose strategy
      await this.strategy.dispose();

      // Close page and context
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }

      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }

      this.setStatus('closed');
      this.emit('closed');
      console.log(`[Browser] Session ${this.id} closed`);
    } catch (error) {
      console.error(`[Browser] Error closing session ${this.id}:`, error);
    }
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  /**
   * Executes a natural language instruction.
   */
  async executeInstruction(instruction: string): Promise<ActionResult> {
    if (!this.page || this._status !== 'active') {
      return {
        success: false,
        action: { type: 'navigate' },
        error: 'Session is not active',
        durationMs: 0,
      };
    }

    this.updateActivity();

    // Build context for the strategy
    const context: InstructionContext = {
      screenshot: await this.captureScreenshot(),
      url: this.page.url(),
      title: await this.page.title(),
    };

    // Execute via strategy
    const result = await this.strategy.executeInstruction(instruction, context);

    // Emit click marker if applicable
    if (result.coordinates && this.config.showClickMarkers) {
      this.emitClickMarker(result.action.type as 'click' | 'type' | 'scroll', result.coordinates);
    }

    return result;
  }

  /**
   * Executes a specific browser action.
   */
  async executeAction(action: BrowserAction): Promise<ActionResult> {
    if (!this.page || this._status !== 'active') {
      return {
        success: false,
        action,
        error: 'Session is not active',
        durationMs: 0,
      };
    }

    this.updateActivity();
    const actionId = uuid();

    this.emit('action-started', actionId, action);

    const startTime = Date.now();
    const result = await this.strategy.executeAction(action);
    result.durationMs = Date.now() - startTime;

    // Add page info to result
    result.pageUrl = this.page.url();
    result.pageTitle = await this.page.title();

    // Emit click marker if applicable
    if (result.coordinates && this.config.showClickMarkers) {
      this.emitClickMarker(action.type as 'click' | 'type' | 'scroll', result.coordinates);
    }

    this.emit('action-completed', actionId, action, result);

    return result;
  }

  /**
   * Navigates to a URL.
   */
  async navigate(url: string): Promise<ActionResult> {
    return this.executeAction({ type: 'navigate', url });
  }

  /**
   * Captures a screenshot of the current page.
   */
  async captureScreenshot(fullPage = false): Promise<string> {
    if (!this.page) {
      throw new Error('No page available');
    }

    const buffer = await this.page.screenshot({
      type: 'png',
      fullPage,
    });

    const base64 = buffer.toString('base64');

    // Update cached screenshot
    this._lastScreenshot = base64;
    this._lastScreenshotAt = new Date();

    return base64;
  }

  // ===========================================================================
  // Session Info
  // ===========================================================================

  /**
   * Gets the session metadata as a BrowserSession object.
   */
  async getSessionInfo(): Promise<BrowserSession> {
    return {
      id: this.id,
      name: this.name,
      status: this._status,
      strategy: this.config.strategy,
      provider:
        this.config.strategy === 'computer-use'
          ? this.config.computerUseProvider
          : this.config.domProvider,
      currentUrl: this.page?.url(),
      currentTitle: this.page ? await this.page.title() : undefined,
      lastScreenshot: this._lastScreenshot,
      lastScreenshotAt: this._lastScreenshotAt,
      createdAt: this.createdAt,
      lastActivityAt: this._lastActivityAt,
      error: this._error,
      viewport: this.config.viewport,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private setStatus(status: BrowserSessionStatus, error?: string): void {
    this._status = status;
    this._error = error;
    this.emit('status-changed', status, error);
  }

  private updateActivity(): void {
    this._lastActivityAt = new Date();
  }

  private startPeriodicScreenshots(intervalMs: number): void {
    this.screenshotIntervalId = setInterval(async () => {
      if (this._status !== 'active' || !this.page) {
        return;
      }

      try {
        const screenshot = await this.captureScreenshot();
        const url = this.page.url();
        const title = await this.page.title();
        this.emit('screenshot', screenshot, url, title);
      } catch (error) {
        // Ignore screenshot errors during periodic updates
      }
    }, intervalMs);
  }

  private emitClickMarker(
    actionType: 'click' | 'type' | 'scroll',
    coordinates: { x: number; y: number }
  ): void {
    const marker: ClickMarker = {
      id: uuid(),
      sessionId: this.id,
      x: coordinates.x,
      y: coordinates.y,
      timestamp: new Date(),
      actionType,
    };
    this.emit('click-marker', marker);
  }
}
