/**
 * Computer Use Provider Interface
 *
 * Abstracts the differences between Anthropic, OpenAI, and Google
 * computer use implementations.
 */

import type { ComputerUseProvider } from '../../../types.js';

/**
 * Parameters for getting the next action from a Computer Use model.
 */
export interface GetActionParams {
  /** Current screenshot as base64 */
  screenshot: string;

  /** The instruction to execute */
  instruction: string;

  /** Screen dimensions for coordinate scaling */
  screenSize: {
    width: number;
    height: number;
  };

  /** Conversation history for context */
  history?: ComputerUseHistoryItem[];

  /** Previous response ID for Azure OpenAI conversation linking */
  previousResponseId?: string;

  /** Previous call ID for Azure OpenAI computer_call_output */
  previousCallId?: string;
}

/**
 * History item for multi-turn conversations.
 */
export interface ComputerUseHistoryItem {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  toolCallId?: string;
  toolResult?: string;
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
 * Response from a Computer Use model.
 */
export interface ComputerUseResponse {
  /** The action to execute */
  action?: ComputerUseAction;

  /** Reasoning/explanation from the model */
  reasoning?: string;

  /** Whether the task is complete */
  isComplete: boolean;

  /** If complete, the final result/message */
  result?: string;

  /** Raw response for debugging */
  rawResponse?: unknown;

  /** Response ID for Azure OpenAI conversation linking */
  responseId?: string;

  /** Call ID for Azure OpenAI computer_call_output */
  callId?: string;
}

/**
 * Action returned by a Computer Use model.
 */
export interface ComputerUseAction {
  type: 'click' | 'type' | 'scroll' | 'key' | 'wait' | 'screenshot';

  /** For click actions - coordinates */
  x?: number;
  y?: number;

  /** For type actions - text to type */
  text?: string;

  /** For key actions - key to press */
  key?: string;

  /** For scroll actions */
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;

  /** For wait actions */
  duration?: number;
}

/**
 * Interface that all Computer Use providers must implement.
 */
export interface IComputerUseProvider {
  /** Provider identifier */
  readonly name: ComputerUseProvider;

  /**
   * Gets the next action based on screenshot and instruction.
   */
  getAction(params: GetActionParams): Promise<ComputerUseResponse>;

  /**
   * Checks if the provider is available (API key configured, etc.).
   */
  isAvailable(): boolean;
}

/**
 * Configuration for Computer Use providers.
 */
export interface ComputerUseProviderConfig {
  /** API key for the provider */
  apiKey?: string;

  /** Model to use */
  model?: string;

  /** Maximum tokens for response */
  maxTokens?: number;

  /** Azure OpenAI endpoint URL (for azure_openai provider) */
  azureEndpoint?: string;
}
