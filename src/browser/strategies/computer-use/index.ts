/**
 * Computer Use Browser Strategy
 *
 * Screenshot-based browser automation using Computer Use models.
 * Translates visual understanding into coordinate-based actions.
 */

import type { Page } from 'playwright';
import type {
  BrowserAction,
  ActionResult,
  InstructionContext,
  ComputerUseProvider,
} from '../../types.js';
import type { StrategyConfig, IStrategyLLMService } from '../types.js';
import { BaseBrowserStrategy } from '../base.js';
import {
  createComputerUseProvider,
  type IComputerUseProvider,
  type ComputerUseHistoryItem,
} from './providers/index.js';

export interface ComputerUseStrategyConfig {
  /** Which provider to use */
  provider: ComputerUseProvider;

  /** Optional LLM service (not used directly, but passed through) */
  llmService?: IStrategyLLMService;

  /** Maximum steps before giving up */
  maxSteps?: number;
}

/**
 * Computer Use Browser Strategy.
 *
 * Uses screenshot + AI vision to interact with web pages via coordinates.
 * Supports multiple providers: Google Gemini, Anthropic Claude, OpenAI CUA.
 */
export class ComputerUseBrowserStrategy extends BaseBrowserStrategy {
  readonly name = 'Computer Use';
  readonly type = 'computer-use' as const;

  private cuProvider: IComputerUseProvider;
  private maxSteps: number;
  private conversationHistory: ComputerUseHistoryItem[] = [];

  // Track Azure OpenAI conversation state
  private lastResponseId?: string;
  private lastCallId?: string;

  constructor(strategyConfig: ComputerUseStrategyConfig) {
    super();
    this.cuProvider = createComputerUseProvider(strategyConfig.provider);
    this.maxSteps = strategyConfig.maxSteps || 10;
  }

  async initialize(page: Page, config: StrategyConfig): Promise<void> {
    await super.initialize(page, config);
    this.conversationHistory = [];
    this.lastResponseId = undefined;
    this.lastCallId = undefined;
    console.log(`[ComputerUseStrategy] Initialized with provider: ${this.cuProvider.name}`);
  }

  async dispose(): Promise<void> {
    this.conversationHistory = [];
    this.lastResponseId = undefined;
    this.lastCallId = undefined;
    await super.dispose();
  }

  /**
   * Executes a natural language instruction using the Computer Use model.
   *
   * This runs a loop:
   * 1. Capture screenshot
   * 2. Send to CU model with instruction
   * 3. Execute returned action
   * 4. Repeat until complete or max steps reached
   */
  async executeInstruction(
    instruction: string,
    context: InstructionContext
  ): Promise<ActionResult> {
    if (!this.page || !this.config) {
      return this.errorResult(
        { type: 'navigate' },
        'Strategy not initialized'
      );
    }

    const startTime = Date.now();
    let lastResult: ActionResult | null = null;
    let stepCount = 0;

    // Clear state for new instruction
    this.conversationHistory = [];
    this.lastResponseId = undefined;
    this.lastCallId = undefined;

    while (stepCount < this.maxSteps) {
      stepCount++;

      // Capture current screenshot (take fresh one after action, use context for first)
      let screenshot: string;
      if (lastResult?.screenshot) {
        screenshot = lastResult.screenshot;
      } else if (stepCount === 1 && context.screenshot) {
        screenshot = context.screenshot;
      } else {
        screenshot = await this.captureScreenshot();
      }

      // Get action from Computer Use model
      const cuResponse = await this.cuProvider.getAction({
        screenshot,
        instruction,
        screenSize: this.config.viewport,
        history: this.conversationHistory,
        previousResponseId: this.lastResponseId,
        previousCallId: this.lastCallId,
      });

      // Update tracking for Azure OpenAI conversation linking
      if (cuResponse.responseId) {
        this.lastResponseId = cuResponse.responseId;
      }
      if (cuResponse.callId) {
        this.lastCallId = cuResponse.callId;
      }

      // Check if task is complete
      if (cuResponse.isComplete) {
        console.log(`[ComputerUseStrategy] Task completed in ${stepCount} steps`);
        return {
          success: true,
          action: lastResult?.action || { type: 'screenshot' },
          screenshot,
          pageUrl: this.page.url(),
          pageTitle: await this.page.title(),
          durationMs: Date.now() - startTime,
          extractedData: cuResponse.result,
        };
      }

      // No action returned but not complete - might be an error
      if (!cuResponse.action) {
        console.warn('[ComputerUseStrategy] No action returned, retrying...');
        continue;
      }

      // Log reasoning if available
      const reasoningInfo = cuResponse.reasoning ? `Reasoning: ${cuResponse.reasoning}` : '';
      console.log(`[ComputerUseStrategy] Step ${stepCount}: ${cuResponse.action.type} ${reasoningInfo}`);

      // Convert CU action to BrowserAction
      const browserAction = this.convertToBrowserAction(cuResponse.action);

      // Execute the action
      lastResult = await this.executeAction(browserAction);

      if (!lastResult.success) {
        console.error(`[ComputerUseStrategy] Action failed: ${lastResult.error}`);
        // Don't break - let the model try to recover
      }

      // Small delay between steps for page to settle
      await this.page.waitForTimeout(500);
    }

    // Max steps reached
    console.warn(`[ComputerUseStrategy] Max steps (${this.maxSteps}) reached`);
    return {
      success: false,
      action: lastResult?.action || { type: 'navigate' },
      screenshot: lastResult?.screenshot,
      error: `Max steps (${this.maxSteps}) reached without completing task`,
      pageUrl: this.page?.url(),
      pageTitle: this.page ? await this.page.title() : undefined,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Converts a Computer Use action to a BrowserAction.
   */
  private convertToBrowserAction(
    cuAction: { type: string; x?: number; y?: number; text?: string; key?: string; direction?: string; amount?: number; duration?: number }
  ): BrowserAction {
    switch (cuAction.type) {
      case 'click':
        return {
          type: 'click',
          x: cuAction.x,
          y: cuAction.y,
        };

      case 'type':
        return {
          type: 'type',
          text: cuAction.text,
        };

      case 'scroll':
        return {
          type: 'scroll',
          direction: cuAction.direction as 'up' | 'down' | 'left' | 'right',
          amount: cuAction.amount || 300,
        };

      case 'key':
        return {
          type: 'key',
          key: cuAction.key,
        };

      case 'wait':
        return {
          type: 'wait',
          waitFor: 'timeout',
          waitTimeout: cuAction.duration || 1000,
        };

      case 'screenshot':
        return {
          type: 'screenshot',
        };

      default:
        console.warn(`[ComputerUseStrategy] Unknown action type: ${cuAction.type}`);
        return {
          type: 'wait',
          waitFor: 'timeout',
          waitTimeout: 500,
        };
    }
  }
}
