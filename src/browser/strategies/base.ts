/**
 * Base Browser Strategy
 *
 * Abstract base class with shared Playwright functionality.
 */

import type { Page } from 'playwright';
import type {
  BrowserAction,
  ActionResult,
  InstructionContext,
  BrowserStrategyType,
} from '../types.js';
import type { IBrowserStrategy, StrategyConfig } from './types.js';

/**
 * Abstract base class for browser strategies.
 *
 * Provides common Playwright operations and action execution.
 * Subclasses implement instruction interpretation logic.
 */
export abstract class BaseBrowserStrategy implements IBrowserStrategy {
  abstract readonly name: string;
  abstract readonly type: BrowserStrategyType;

  protected page: Page | null = null;
  protected config: StrategyConfig | null = null;

  async initialize(page: Page, config: StrategyConfig): Promise<void> {
    this.page = page;
    this.config = config;
  }

  abstract executeInstruction(
    instruction: string,
    context: InstructionContext
  ): Promise<ActionResult>;

  async executeAction(action: BrowserAction): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult(action, 'Strategy not initialized');
    }

    const startTime = Date.now();

    try {
      switch (action.type) {
        case 'navigate':
          return await this.executeNavigate(action, startTime);

        case 'click':
          return await this.executeClick(action, startTime);

        case 'type':
          return await this.executeType(action, startTime);

        case 'scroll':
          return await this.executeScroll(action, startTime);

        case 'key':
          return await this.executeKey(action, startTime);

        case 'wait':
          return await this.executeWait(action, startTime);

        case 'screenshot':
          return await this.executeScreenshot(action, startTime);

        case 'extract':
          return await this.executeExtract(action, startTime);

        case 'select':
          return await this.executeSelect(action, startTime);

        default:
          return this.errorResult(
            action,
            `Unknown action type: ${action.type}`,
            startTime
          );
      }
    } catch (error) {
      return this.errorResult(
        action,
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  async captureScreenshot(fullPage = false): Promise<string> {
    if (!this.page) {
      throw new Error('Strategy not initialized');
    }

    const buffer = await this.page.screenshot({
      type: 'png',
      fullPage,
    });

    return buffer.toString('base64');
  }

  async dispose(): Promise<void> {
    this.page = null;
    this.config = null;
  }

  // ===========================================================================
  // Action Implementations
  // ===========================================================================

  protected async executeNavigate(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page || !action.url) {
      return this.errorResult(action, 'URL is required for navigate action', startTime);
    }

    await this.page.goto(action.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Capture screenshot after navigation
    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeClick(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult(action, 'Page not available', startTime);
    }

    let coordinates: { x: number; y: number } | undefined;

    // Coordinate-based click (Computer Use strategy)
    if (action.x !== undefined && action.y !== undefined) {
      coordinates = { x: action.x, y: action.y };
      await this.page.mouse.click(action.x, action.y);
    }
    // Selector-based click (DOM strategy)
    else if (action.selector) {
      const element = await this.page.locator(action.selector).first();
      const box = await element.boundingBox();
      if (box) {
        coordinates = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      }
      await element.click();
    } else {
      return this.errorResult(
        action,
        'Click requires either coordinates (x, y) or selector',
        startTime
      );
    }

    // Wait for potential navigation/updates
    await this.page.waitForTimeout(500);

    // Capture screenshot after click
    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      coordinates,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeType(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page || !action.text) {
      return this.errorResult(action, 'Text is required for type action', startTime);
    }

    let coordinates: { x: number; y: number } | undefined;

    // Coordinate-based typing (click first, then type)
    if (action.x !== undefined && action.y !== undefined) {
      coordinates = { x: action.x, y: action.y };
      await this.page.mouse.click(action.x, action.y);
      await this.page.waitForTimeout(100);
      await this.page.keyboard.type(action.text, { delay: 50 });
    }
    // Selector-based typing
    else if (action.selector) {
      const element = await this.page.locator(action.selector).first();
      const box = await element.boundingBox();
      if (box) {
        coordinates = {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        };
      }
      await element.fill(action.text);
    }
    // Just type without clicking (assumes focus)
    else {
      await this.page.keyboard.type(action.text, { delay: 50 });
    }

    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      coordinates,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeScroll(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult(action, 'Page not available', startTime);
    }

    const amount = action.amount || 500;
    let deltaX = 0;
    let deltaY = 0;

    switch (action.direction) {
      case 'up':
        deltaY = -amount;
        break;
      case 'down':
        deltaY = amount;
        break;
      case 'left':
        deltaX = -amount;
        break;
      case 'right':
        deltaX = amount;
        break;
      default:
        deltaY = amount; // Default to scroll down
    }

    // Scroll at center of viewport or at specified coordinates
    const x = action.x ?? this.config?.viewport.width ?? 512;
    const y = action.y ?? this.config?.viewport.height ?? 384;

    await this.page.mouse.move(x / 2, y / 2);
    await this.page.mouse.wheel(deltaX, deltaY);
    await this.page.waitForTimeout(300);

    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      coordinates: { x: x / 2, y: y / 2 },
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeKey(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page || !action.key) {
      return this.errorResult(action, 'Key is required for key action', startTime);
    }

    await this.page.keyboard.press(action.key);
    await this.page.waitForTimeout(200);

    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeWait(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult(action, 'Page not available', startTime);
    }

    const timeout = action.waitTimeout || 5000;

    switch (action.waitFor) {
      case 'selector':
        if (!action.selector) {
          return this.errorResult(action, 'Selector required for wait', startTime);
        }
        await this.page.waitForSelector(action.selector, { timeout });
        break;

      case 'navigation':
        await this.page.waitForNavigation({ timeout });
        break;

      case 'timeout':
      default:
        await this.page.waitForTimeout(timeout);
        break;
    }

    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeScreenshot(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    const screenshot = await this.captureScreenshot(action.fullPage);

    return {
      success: true,
      action,
      screenshot,
      pageUrl: this.page?.url(),
      pageTitle: this.page ? await this.page.title() : undefined,
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeExtract(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult(action, 'Page not available', startTime);
    }

    const selector = action.extractSelector || action.selector;
    if (!selector) {
      return this.errorResult(action, 'Selector required for extract', startTime);
    }

    const element = await this.page.locator(selector).first();
    let extractedData: unknown;

    if (action.extractAttribute) {
      extractedData = await element.getAttribute(action.extractAttribute);
    } else {
      extractedData = await element.textContent();
    }

    return {
      success: true,
      action,
      extractedData,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  protected async executeSelect(
    action: BrowserAction,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult(action, 'Page not available', startTime);
    }

    if (!action.selector) {
      return this.errorResult(action, 'Selector required for select action', startTime);
    }

    if (!action.value) {
      return this.errorResult(action, 'Value required for select action', startTime);
    }

    const element = await this.page.locator(action.selector).first();
    await element.selectOption(action.value);

    return {
      success: true,
      action,
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      durationMs: Date.now() - startTime,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  protected errorResult(
    action: BrowserAction,
    error: string,
    startTime?: number
  ): ActionResult {
    return {
      success: false,
      action,
      error,
      durationMs: startTime ? Date.now() - startTime : 0,
    };
  }
}
