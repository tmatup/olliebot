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

    console.log(`[Browser] Navigating to: ${action.url}`);

    await this.page.goto(action.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log(`[Browser] Navigation complete: ${action.url}`);

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

      // Draw visual click marker before clicking
      await this.drawClickMarker(action.x, action.y);

      // Get viewport info for debugging
      const viewportSize = this.page.viewportSize();
      console.log(`[Browser] Click at (${action.x}, ${action.y}) - viewport: ${viewportSize?.width}x${viewportSize?.height}`);

      // Check what element is at these coordinates before clicking
      const elementAtPoint = await this.page.evaluate(`
        (function(x, y) {
          var el = document.elementFromPoint(x, y);
          if (!el) return { tag: 'none', info: 'No element at coordinates' };
          var id = el.id ? '#' + el.id : '';
          var cls = el.className ? '.' + String(el.className).split(' ').join('.') : '';
          var text = (el.textContent || '').substring(0, 50).replace(/\\n/g, ' ');

          // For select elements, also get the available options
          var options = [];
          if (el.tagName === 'SELECT') {
            var opts = el.querySelectorAll('option');
            for (var i = 0; i < opts.length; i++) {
              if (opts[i].value) {
                options.push({ value: opts[i].value, text: opts[i].textContent });
              }
            }
          }

          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            info: el.tagName.toLowerCase() + id + cls + ' - text: "' + text + '"',
            options: options
          };
        })(${action.x}, ${action.y})
      `) as { tag: string; id: string | null; info: string; options?: Array<{ value: string; text: string }> };

      console.log(`[Browser] Element at click point: ${elementAtPoint.info}`);

      // Special handling for <select> elements - use selectOption() for reliability
      if (elementAtPoint.tag === 'select' && elementAtPoint.id && elementAtPoint.options?.length) {
        const selector = `#${elementAtPoint.id}`;
        const firstOption = elementAtPoint.options[0];
        console.log(`[Browser] Detected <select> element, using selectOption() with value: "${firstOption.value}"`);

        await this.page.selectOption(selector, firstOption.value);

        // Verify selection
        const selectedValue = await this.page.locator(selector).inputValue();
        console.log(`[Browser] Select completed - selected value: "${selectedValue}"`);
      } else {
        // Use true coordinate-based mouse click for Computer Use strategy
        await this.page.mouse.click(action.x, action.y);

        // Verify click worked by checking focus
        const focusedAfter = await this.page.evaluate(`
          (function() {
            var el = document.activeElement;
            if (!el || el === document.body) return 'No element focused';
            return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' - value: "' + (el.value || '').substring(0, 30) + '"';
          })()
        `);
        console.log(`[Browser] Click completed at (${action.x}, ${action.y}) - focused: ${focusedAfter}`);
      }
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
        // Draw visual click marker
        await this.drawClickMarker(coordinates.x, coordinates.y);
        console.log(`[Browser] Click on selector "${action.selector}" at (${coordinates.x}, ${coordinates.y})`);
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

    // Capture screenshot after click (marker will be visible)
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

  /**
   * Draws a visual click marker on the page for debugging.
   * The marker persists until the page navigates or is refreshed.
   */
  protected async drawClickMarker(x: number, y: number): Promise<void> {
    if (!this.page) return;

    await this.page.evaluate(`
      (function(x, y) {
        let container = document.getElementById('__browser_click_markers__');
        if (!container) {
          container = document.createElement('div');
          container.id = '__browser_click_markers__';
          container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;';
          document.body.appendChild(container);
        }
        const marker = document.createElement('div');
        marker.className = '__click_marker__';
        marker.style.cssText = 'position:absolute;left:' + (x - 15) + 'px;top:' + (y - 15) + 'px;width:30px;height:30px;border:3px solid red;border-radius:50%;background:rgba(255,0,0,0.2);pointer-events:none;';
        const hLine = document.createElement('div');
        hLine.style.cssText = 'position:absolute;left:0;top:50%;width:100%;height:2px;background:red;transform:translateY(-50%);';
        const vLine = document.createElement('div');
        vLine.style.cssText = 'position:absolute;top:0;left:50%;width:2px;height:100%;background:red;transform:translateX(-50%);';
        marker.appendChild(hLine);
        marker.appendChild(vLine);
        const existingMarkers = container.querySelectorAll('.__click_marker__');
        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;top:-20px;left:50%;transform:translateX(-50%);background:red;color:white;font-size:12px;font-weight:bold;padding:2px 6px;border-radius:3px;font-family:monospace;';
        label.textContent = String(existingMarkers.length + 1);
        marker.appendChild(label);
        container.appendChild(marker);
      })(${x}, ${y})
    `);
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
      await this.drawTypeMarker(action.x, action.y, action.text);
      console.log(`[Browser] Type "${action.text.substring(0, 50)}${action.text.length > 50 ? '...' : ''}" at (${action.x}, ${action.y})`);

      // Check what element is at these coordinates
      const elementInfo = await this.page.evaluate(`
        (function(x, y) {
          var el = document.elementFromPoint(x, y);
          if (!el) return 'No element at coordinates';
          var tagName = el.tagName.toLowerCase();
          var isInput = tagName === 'input' || tagName === 'textarea' || el.getAttribute('contenteditable') === 'true';
          return tagName + (el.id ? '#' + el.id : '') + ' - isInput: ' + isInput;
        })(${action.x}, ${action.y})
      `);
      console.log(`[Browser] Element at type point: ${elementInfo}`);

      // Use reliable click pattern for headless mode
      await this.page.mouse.move(action.x, action.y, { steps: 10 });
      await this.page.waitForTimeout(100);
      await this.page.mouse.down();
      await this.page.waitForTimeout(100);
      await this.page.mouse.up();
      await this.page.waitForTimeout(200);

      // Now type
      await this.page.keyboard.type(action.text, { delay: 30 });
      console.log(`[Browser] Type completed`);
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
        await this.drawTypeMarker(coordinates.x, coordinates.y, action.text);
      }
      console.log(`[Browser] Type "${action.text.substring(0, 50)}${action.text.length > 50 ? '...' : ''}" in selector "${action.selector}"`);
      await element.fill(action.text);
    }
    // Just type without clicking (assumes focus)
    else {
      // Check what's focused before typing
      const focusedBefore = await this.page.evaluate(`
        (function() {
          var el = document.activeElement;
          if (!el || el === document.body) return null;
          return { tag: el.tagName.toLowerCase(), id: el.id || null, value: el.value || '' };
        })()
      `) as { tag: string; id: string | null; value: string } | null;

      console.log(`[Browser] Type "${action.text.substring(0, 50)}${action.text.length > 50 ? '...' : ''}" - focused: ${focusedBefore ? focusedBefore.tag + (focusedBefore.id ? '#' + focusedBefore.id : '') : 'NOTHING'}`);

      if (!focusedBefore || focusedBefore.tag === 'body') {
        console.warn('[Browser] WARNING: No input element focused - typing may fail');
      }

      // First try keyboard.type()
      await this.page.keyboard.type(action.text, { delay: 30 });

      // Verify text was entered
      const focusedAfter = await this.page.evaluate(`
        (function() {
          var el = document.activeElement;
          if (!el || el === document.body) return { focused: 'No element focused', value: '' };
          return {
            focused: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
            value: el.value || ''
          };
        })()
      `) as { focused: string; value: string };

      console.log(`[Browser] Type completed - element: ${focusedAfter.focused}, value: "${focusedAfter.value.substring(0, 50)}"`);

      // If keyboard.type() didn't work, try setting value via JavaScript
      if (focusedBefore && focusedBefore.tag !== 'body' && !focusedAfter.value) {
        console.log('[Browser] Keyboard type did not work, trying JavaScript fallback...');
        const escapedText = action.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await this.page.evaluate(`
          (function(text) {
            var el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
              el.value = text;
              // Dispatch input event to trigger Angular/React change detection
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          })('${escapedText}')
        `);

        // Verify again
        const valueAfterJs = await this.page.evaluate(`
          (function() {
            var el = document.activeElement;
            return el ? (el.value || '') : '';
          })()
        `);
        console.log(`[Browser] JavaScript fallback result - value: "${String(valueAfterJs).substring(0, 50)}"`);
      }
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

  /**
   * Draws a visual type marker on the page for debugging.
   */
  protected async drawTypeMarker(x: number, y: number, text: string): Promise<void> {
    if (!this.page) return;

    const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const displayText = text.substring(0, 30) + (text.length > 30 ? '...' : '');
    const escapedDisplayText = displayText.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');

    await this.page.evaluate(`
      (function(x, y, displayText) {
        let container = document.getElementById('__browser_click_markers__');
        if (!container) {
          container = document.createElement('div');
          container.id = '__browser_click_markers__';
          container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;';
          document.body.appendChild(container);
        }
        const marker = document.createElement('div');
        marker.className = '__click_marker__';
        marker.style.cssText = 'position:absolute;left:' + (x - 5) + 'px;top:' + (y - 12) + 'px;padding:4px 8px;border:2px solid blue;background:rgba(0,0,255,0.1);pointer-events:none;font-family:monospace;font-size:11px;color:blue;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        marker.textContent = '⌨️ "' + displayText + '"';
        container.appendChild(marker);
      })(${x}, ${y}, '${escapedDisplayText}')
    `);
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

    const scrollX = x / 2;
    const scrollY = y / 2;

    console.log(`[Browser] Scroll ${action.direction || 'down'} by ${amount}px at (${scrollX}, ${scrollY})`);

    await this.page.mouse.move(scrollX, scrollY);
    await this.page.mouse.wheel(deltaX, deltaY);
    await this.page.waitForTimeout(300);

    const screenshot = await this.captureScreenshot();

    return {
      success: true,
      action,
      screenshot,
      coordinates: { x: scrollX, y: scrollY },
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
