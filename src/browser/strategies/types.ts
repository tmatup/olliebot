/**
 * Browser Strategy Interfaces
 *
 * Defines the strategy pattern interfaces for browser automation.
 */

import type { Page } from 'playwright';
import type {
  BrowserAction,
  ActionResult,
  InstructionContext,
  BrowserStrategyType,
} from '../types.js';

/**
 * Configuration passed to strategy on initialization.
 */
export interface StrategyConfig {
  /** Viewport dimensions for coordinate calculations */
  viewport: {
    width: number;
    height: number;
  };

  /** Optional provider-specific configuration */
  providerConfig?: Record<string, unknown>;
}

/**
 * Core strategy interface that all browser strategies must implement.
 *
 * The strategy pattern allows swapping between:
 * - Computer Use: Screenshot-based with coordinate actions
 * - DOM: Playwright selectors with LLM reasoning
 */
export interface IBrowserStrategy {
  /** Strategy name for identification */
  readonly name: string;

  /** Strategy type */
  readonly type: BrowserStrategyType;

  /**
   * Initializes the strategy with a Playwright page.
   *
   * @param page - Playwright page instance
   * @param config - Strategy configuration
   */
  initialize(page: Page, config: StrategyConfig): Promise<void>;

  /**
   * Executes a natural language instruction.
   *
   * The strategy determines how to translate the instruction into browser actions.
   * For Computer Use: analyzes screenshot and returns coordinate-based action
   * For DOM: reasons about selectors and executes via Playwright
   *
   * @param instruction - Natural language instruction (e.g., "Click the Sign Up button")
   * @param context - Current browser context (screenshot, URL, etc.)
   * @returns The action taken and its result
   */
  executeInstruction(
    instruction: string,
    context: InstructionContext
  ): Promise<ActionResult>;

  /**
   * Executes a specific action directly.
   *
   * Used when the caller knows exactly what action to perform.
   *
   * @param action - The action to execute
   * @returns The action result
   */
  executeAction(action: BrowserAction): Promise<ActionResult>;

  /**
   * Captures a screenshot of the current page.
   *
   * @param fullPage - Whether to capture the entire scrollable page
   * @returns Base64-encoded screenshot
   */
  captureScreenshot(fullPage?: boolean): Promise<string>;

  /**
   * Cleans up strategy resources.
   */
  dispose(): Promise<void>;
}

/**
 * LLM service interface for strategy use.
 */
export interface IStrategyLLMService {
  /**
   * Generates a response from the LLM.
   */
  generate(
    messages: Array<{ role: string; content: string | ContentBlock[] }>,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
      tools?: ToolDefinition[];
    }
  ): Promise<LLMResponse>;
}

/**
 * Content block for multimodal messages.
 */
export interface ContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/**
 * Tool definition for LLM tool use.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * LLM response.
 */
export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
}
