/**
 * DOM Browser Strategy
 *
 * Playwright selector-based browser automation with LLM reasoning.
 * Faster than Computer Use for known sites with stable selectors.
 */

import type { Page } from 'playwright';
import type {
  BrowserAction,
  ActionResult,
  InstructionContext,
  DOMProvider,
} from '../../types.js';
import type { StrategyConfig, IStrategyLLMService } from '../types.js';
import { BaseBrowserStrategy } from '../base.js';
import { SelectorReasoner, type SelectorReasoningResult } from './selector-reasoner.js';

export interface DOMStrategyConfig {
  /** Which LLM provider to use for selector reasoning */
  provider: DOMProvider;

  /** LLM service for reasoning */
  llmService?: IStrategyLLMService;

  /** Whether to use screenshots in reasoning (slower but more accurate) */
  useScreenshotReasoning?: boolean;
}

/**
 * DOM Browser Strategy.
 *
 * Uses Playwright's DOM APIs with LLM-powered selector reasoning.
 * Generally faster than Computer Use for well-structured pages.
 */
export class DOMBrowserStrategy extends BaseBrowserStrategy {
  readonly name = 'DOM';
  readonly type = 'dom' as const;

  private provider: DOMProvider;
  private llmService?: IStrategyLLMService;
  private selectorReasoner?: SelectorReasoner;
  private useScreenshotReasoning: boolean;

  constructor(strategyConfig: DOMStrategyConfig) {
    super();
    this.provider = strategyConfig.provider;
    this.llmService = strategyConfig.llmService;
    this.useScreenshotReasoning = strategyConfig.useScreenshotReasoning ?? false;

    if (this.llmService) {
      this.selectorReasoner = new SelectorReasoner(this.llmService);
    }
  }

  async initialize(page: Page, config: StrategyConfig): Promise<void> {
    await super.initialize(page, config);
    console.log(`[DOMStrategy] Initialized with provider: ${this.provider}`);
  }

  /**
   * Executes a natural language instruction using DOM selectors.
   *
   * 1. Gets page HTML
   * 2. Uses LLM to reason about the best selector
   * 3. Executes the action via Playwright
   */
  async executeInstruction(
    instruction: string,
    context: InstructionContext
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult({ type: 'navigate' }, 'Strategy not initialized');
    }

    const startTime = Date.now();

    try {
      // If no LLM service, fall back to simple heuristics
      if (!this.selectorReasoner) {
        return await this.executeWithHeuristics(instruction, context, startTime);
      }

      // Get page HTML for reasoning
      const pageHtml = await this.page.content();
      const pageUrl = this.page.url();

      // Use LLM to determine selector and action
      let reasoning: SelectorReasoningResult;

      if (this.useScreenshotReasoning) {
        reasoning = await this.selectorReasoner.reasonWithScreenshot(
          instruction,
          pageHtml,
          context.screenshot,
          pageUrl
        );
      } else {
        reasoning = await this.selectorReasoner.reason(instruction, pageHtml, pageUrl);
      }

      console.log(`[DOMStrategy] Reasoning result:`, reasoning);

      // Convert to BrowserAction
      const action: BrowserAction = {
        type: reasoning.action,
        selector: reasoning.selector,
        text: reasoning.text,
      };

      // Execute the action
      const result = await this.executeAction(action);

      // Add reasoning to result
      if (reasoning.reasoning) {
        (result as ActionResult & { reasoning?: string }).reasoning = reasoning.reasoning;
      }

      return result;
    } catch (error) {
      return this.errorResult(
        { type: 'navigate' },
        error instanceof Error ? error.message : String(error),
        startTime
      );
    }
  }

  /**
   * Fallback execution using simple heuristics when no LLM is available.
   */
  private async executeWithHeuristics(
    instruction: string,
    _context: InstructionContext,
    startTime: number
  ): Promise<ActionResult> {
    if (!this.page) {
      return this.errorResult({ type: 'navigate' }, 'Page not available', startTime);
    }

    const lowerInstruction = instruction.toLowerCase();

    // Simple heuristics for common instructions
    if (lowerInstruction.includes('click')) {
      // Extract what to click from instruction
      const textMatch = instruction.match(/click (?:on |the )?["']?([^"']+)["']?/i);
      if (textMatch) {
        const buttonText = textMatch[1].trim();

        // Try different selector strategies
        const selectors = [
          `:text("${buttonText}")`,
          `button:has-text("${buttonText}")`,
          `a:has-text("${buttonText}")`,
          `[role="button"]:has-text("${buttonText}")`,
        ];

        for (const selector of selectors) {
          try {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 })) {
              return await this.executeAction({ type: 'click', selector });
            }
          } catch {
            // Try next selector
          }
        }
      }
    }

    if (lowerInstruction.includes('type') || lowerInstruction.includes('enter')) {
      // Extract text and field from instruction
      const typeMatch = instruction.match(/(?:type|enter) ["']([^"']+)["'].*?(?:in|into) ["']?([^"']+)["']?/i);
      if (typeMatch) {
        const [, text, fieldHint] = typeMatch;

        const selectors = [
          `input[placeholder*="${fieldHint}" i]`,
          `input[name*="${fieldHint}" i]`,
          `input[id*="${fieldHint}" i]`,
          `textarea[placeholder*="${fieldHint}" i]`,
        ];

        for (const selector of selectors) {
          try {
            const element = this.page.locator(selector).first();
            if (await element.isVisible({ timeout: 1000 })) {
              return await this.executeAction({ type: 'type', selector, text });
            }
          } catch {
            // Try next selector
          }
        }
      }
    }

    if (lowerInstruction.includes('navigate') || lowerInstruction.includes('go to')) {
      const urlMatch = instruction.match(/(?:navigate to|go to) (https?:\/\/[^\s]+)/i);
      if (urlMatch) {
        return await this.executeAction({ type: 'navigate', url: urlMatch[1] });
      }
    }

    // If heuristics fail, return error
    return this.errorResult(
      { type: 'navigate' },
      'Could not determine action from instruction. LLM service not available for advanced reasoning.',
      startTime
    );
  }
}
