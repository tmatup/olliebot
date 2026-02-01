/**
 * Azure OpenAI Computer Use Provider
 *
 * Implements Computer Use using Azure OpenAI's computer-use-preview model.
 * Uses the Responses API format for computer use scenarios.
 */

import type {
  IComputerUseProvider,
  GetActionParams,
  ComputerUseResponse,
  ComputerUseAction,
  ComputerUseProviderConfig,
} from './types.js';

const DEFAULT_MODEL = 'computer-use-preview';

/**
 * Azure OpenAI Computer Use Provider.
 *
 * Uses shared Azure OpenAI credentials from environment:
 * - AZURE_OPENAI_API_KEY: API key
 * - AZURE_OPENAI_ENDPOINT: Base endpoint (will append /openai/responses path)
 * - BROWSER_MODEL: Model/deployment name (defaults to computer-use-preview)
 */
export class AzureOpenAIComputerUseProvider implements IComputerUseProvider {
  readonly name = 'azure_openai' as const;

  private apiKey: string;
  private endpoint: string;
  private model: string;
  private maxTokens: number;

  constructor(config: ComputerUseProviderConfig = {}) {
    // Use shared Azure OpenAI credentials
    this.apiKey = config.apiKey || process.env.AZURE_OPENAI_API_KEY || '';
    this.model = config.model || process.env.BROWSER_MODEL || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || 1024;

    // Build endpoint URL from base endpoint
    const baseEndpoint = config.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT || '';
    this.endpoint = this.buildEndpointUrl(baseEndpoint);
  }

  /**
   * Builds the full endpoint URL for the Responses API.
   */
  private buildEndpointUrl(baseEndpoint: string): string {
    if (!baseEndpoint) return '';

    // If endpoint already contains /openai/responses, use as-is
    if (baseEndpoint.includes('/openai/responses')) {
      return baseEndpoint;
    }

    // Otherwise, append the Responses API path
    const base = baseEndpoint.replace(/\/$/, ''); // Remove trailing slash
    return `${base}/openai/responses?api-version=2025-04-01-preview`;
  }

  isAvailable(): boolean {
    return !!(this.apiKey && this.endpoint);
  }

  async getAction(params: GetActionParams): Promise<ComputerUseResponse> {
    if (!this.isAvailable()) {
      throw new Error('Azure OpenAI API key or endpoint not configured');
    }

    const { screenshot, instruction, screenSize, previousResponseId, previousCallId } = params;

    try {
      // Build the request for Azure OpenAI Responses API
      const requestBody = this.buildRequestBody(
        instruction,
        screenshot,
        screenSize,
        previousResponseId,
        previousCallId
      );

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AzureOpenAI CU] API error:', response.status, errorText);
        throw new Error(`Azure OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as AzureResponsesAPIResponse;
      console.log(`[AzureOpenAI CU] ${previousResponseId ? 'follow-up' : 'initial'} request -> response: ${data.id}`);

      return this.parseResponse(data, screenSize);
    } catch (error) {
      console.error('[AzureOpenAI CU] Error getting action:', error);
      throw error;
    }
  }

  /**
   * Builds the request body for Azure OpenAI Responses API.
   *
   * For initial requests: sends instruction with screenshot.
   * For follow-up requests: uses previous_response_id and computer_call_output.
   */
  private buildRequestBody(
    instruction: string,
    screenshot: string,
    screenSize: { width: number; height: number },
    previousResponseId?: string,
    previousCallId?: string
  ): AzureResponsesAPIRequest {
    const tools: AzureTool[] = [
      {
        type: 'computer_use_preview',
        display_width: screenSize.width,
        display_height: screenSize.height,
        environment: 'browser',
      },
    ];

    // Follow-up request: use previous_response_id and computer_call_output
    if (previousResponseId && previousCallId) {
      return {
        model: this.model,
        previous_response_id: previousResponseId,
        input: [
          {
            type: 'computer_call_output',
            call_id: previousCallId,
            output: {
              type: 'input_image',
              image_url: `data:image/png;base64,${screenshot}`,
            },
          },
        ],
        tools,
        truncation: 'auto',
      };
    }

    // Initial request: send instruction with screenshot
    return {
      model: this.model,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: instruction,
            },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${screenshot}`,
            },
          ],
        },
      ],
      tools,
      truncation: 'auto',
    };
  }

  /**
   * Parses the Azure OpenAI Responses API response.
   */
  private parseResponse(
    data: AzureResponsesAPIResponse,
    screenSize: { width: number; height: number }
  ): ComputerUseResponse {
    // Check for errors
    if (data.error) {
      return {
        isComplete: false,
        reasoning: `API Error: ${data.error.message || JSON.stringify(data.error)}`,
        rawResponse: data,
      };
    }

    // Find computer_call in the output
    const computerCall = data.output?.find(
      (item): item is AzureComputerCallOutput => item.type === 'computer_call'
    );

    // Find text message in the output
    const textMessage = data.output?.find(
      (item): item is AzureMessageOutput => item.type === 'message'
    );

    // Extract reasoning from text message
    let reasoning: string | undefined;
    if (textMessage?.content) {
      const textContent = textMessage.content.find(c => c.type === 'output_text');
      reasoning = textContent?.text;
    }

    // If no computer call, check if task is complete
    if (!computerCall) {
      return {
        isComplete: true,
        reasoning: reasoning || 'No action required',
        result: reasoning,
        rawResponse: data,
        responseId: data.id,
      };
    }

    // Parse the computer action
    const action = this.parseComputerAction(computerCall.action, screenSize);

    return {
      action,
      reasoning,
      isComplete: false,
      rawResponse: data,
      responseId: data.id,
      callId: computerCall.call_id,
    };
  }

  /**
   * Parses a computer action from the API response.
   */
  private parseComputerAction(
    apiAction: AzureComputerAction,
    screenSize: { width: number; height: number }
  ): ComputerUseAction {
    switch (apiAction.type) {
      case 'click':
        return {
          type: 'click',
          x: apiAction.x,
          y: apiAction.y,
        };

      case 'double_click':
        return {
          type: 'click',
          x: apiAction.x,
          y: apiAction.y,
        };

      case 'scroll':
        return {
          type: 'scroll',
          x: apiAction.x,
          y: apiAction.y,
          direction: apiAction.scroll_y && apiAction.scroll_y < 0 ? 'up' : 'down',
          amount: Math.abs(apiAction.scroll_y || apiAction.scroll_x || 300),
        };

      case 'type':
        return {
          type: 'type',
          text: apiAction.text || '',
        };

      case 'keypress':
        return {
          type: 'key',
          key: this.mapKey(apiAction.keys || []),
        };

      case 'wait':
        return {
          type: 'wait',
          duration: 1000,
        };

      case 'screenshot':
        return {
          type: 'screenshot',
        };

      case 'drag':
        // Convert drag to a click at the start position for now
        return {
          type: 'click',
          x: apiAction.start_x,
          y: apiAction.start_y,
        };

      default:
        console.warn('[AzureOpenAI CU] Unknown action type:', apiAction.type);
        return {
          type: 'wait',
          duration: 500,
        };
    }
  }

  /**
   * Maps Azure key names to standard key names.
   */
  private mapKey(keys: string[]): string {
    if (keys.length === 0) return 'Enter';

    // Join multiple keys with + for combinations
    return keys.map(key => {
      // Map Azure key names to standard names
      switch (key.toLowerCase()) {
        case 'enter':
        case 'return':
          return 'Enter';
        case 'tab':
          return 'Tab';
        case 'escape':
        case 'esc':
          return 'Escape';
        case 'backspace':
          return 'Backspace';
        case 'delete':
          return 'Delete';
        case 'space':
          return ' ';
        case 'ctrl':
        case 'control':
          return 'Control';
        case 'alt':
          return 'Alt';
        case 'shift':
          return 'Shift';
        case 'meta':
        case 'cmd':
        case 'command':
          return 'Meta';
        default:
          return key;
      }
    }).join('+');
  }
}

// =============================================================================
// Types for Azure OpenAI Responses API
// =============================================================================

interface AzureResponsesAPIRequest {
  model: string;
  input: AzureInputItem[];
  tools: AzureTool[];
  truncation?: 'auto' | 'disabled';
  previous_response_id?: string;
}

type AzureInputItem = AzureMessageInput | AzureComputerCallOutputInput;

interface AzureMessageInput {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string | AzureContentPart[];
}

interface AzureComputerCallOutputInput {
  type: 'computer_call_output';
  call_id: string;
  output: {
    type: 'input_image';
    image_url: string;
  };
}

interface AzureContentPart {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
}

interface AzureTool {
  type: 'computer_use_preview';
  display_width: number;
  display_height: number;
  environment: 'browser' | 'desktop' | 'mobile';
}

interface AzureResponsesAPIResponse {
  id?: string;
  output?: AzureOutputItem[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

type AzureOutputItem = AzureComputerCallOutput | AzureMessageOutput;

interface AzureComputerCallOutput {
  type: 'computer_call';
  call_id: string;
  action: AzureComputerAction;
  pending_safety_checks?: unknown[];
}

interface AzureMessageOutput {
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'output_text';
    text: string;
  }>;
}

interface AzureComputerAction {
  type: 'click' | 'double_click' | 'scroll' | 'type' | 'keypress' | 'wait' | 'screenshot' | 'drag';
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  scroll_x?: number;
  scroll_y?: number;
  text?: string;
  keys?: string[];
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
}
