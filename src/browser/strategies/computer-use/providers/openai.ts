/**
 * OpenAI Computer Use Provider
 *
 * Implements Computer Use using OpenAI's computer-use-preview model.
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
const DEFAULT_BASE_URL = 'https://api.openai.com/v1/responses';

/**
 * OpenAI Computer Use Provider.
 *
 * Uses shared OpenAI credentials from environment:
 * - OPENAI_API_KEY: API key
 * - OPENAI_BASE_URL: Optional base URL override (defaults to https://api.openai.com/v1/responses)
 * - BROWSER_MODEL: Model name (defaults to computer-use-preview)
 */
export class OpenAIComputerUseProvider implements IComputerUseProvider {
  readonly name = 'openai' as const;

  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;
  private pendingSafetyChecks?: OpenAIPendingSafetyCheck[];

  constructor(config: ComputerUseProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config.model || process.env.BROWSER_MODEL || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || 1024;
    this.baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getAction(params: GetActionParams): Promise<ComputerUseResponse> {
    if (!this.isAvailable()) {
      throw new Error('OpenAI API key not configured');
    }

    const { screenshot, instruction, screenSize, previousResponseId, previousCallId } = params;

    // Reset safety checks for new conversations
    if (!previousResponseId) {
      this.pendingSafetyChecks = undefined;
    }

    try {
      const requestBody = this.buildRequestBody(
        instruction,
        screenshot,
        screenSize,
        previousResponseId,
        previousCallId
      );

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[OpenAI CU] API error:', response.status, errorText);
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as OpenAIResponsesAPIResponse;
      console.log(`[OpenAI CU] ${previousResponseId ? 'follow-up' : 'initial'} request -> response: ${data.id}`);

      return this.parseResponse(data, screenSize);
    } catch (error) {
      console.error('[OpenAI CU] Error getting action:', error);
      throw error;
    }
  }

  /**
   * Builds the request body for OpenAI Responses API.
   */
  private buildRequestBody(
    instruction: string,
    screenshot: string,
    screenSize: { width: number; height: number },
    previousResponseId?: string,
    previousCallId?: string
  ): OpenAIResponsesAPIRequest {
    const tools: OpenAITool[] = [
      {
        type: 'computer_use_preview',
        display_width: screenSize.width,
        display_height: screenSize.height,
        environment: 'browser',
      },
    ];

    if (previousResponseId && previousCallId) {
      return {
        model: this.model,
        max_output_tokens: this.maxTokens,
        previous_response_id: previousResponseId,
        input: [
          {
            type: 'computer_call_output',
            call_id: previousCallId,
            acknowledged_safety_checks: this.pendingSafetyChecks,
            output: {
              type: 'computer_screenshot',
              image_url: `data:image/png;base64,${screenshot}`,
            },
          },
        ],
        tools,
        truncation: 'auto',
      };
    }

    return {
      model: this.model,
      max_output_tokens: this.maxTokens,
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
   * Parses the OpenAI Responses API response.
   */
  private parseResponse(
    data: OpenAIResponsesAPIResponse,
    screenSize: { width: number; height: number }
  ): ComputerUseResponse {
    if (data.error) {
      return {
        isComplete: false,
        reasoning: `API Error: ${data.error.message || JSON.stringify(data.error)}`,
        rawResponse: data,
      };
    }

    const computerCall = data.output?.find(
      (item): item is OpenAIComputerCallOutput => item.type === 'computer_call'
    );

    const reasoningItem = data.output?.find(
      (item): item is OpenAIReasoningOutput => item.type === 'reasoning'
    );

    const textMessage = data.output?.find(
      (item): item is OpenAIMessageOutput => item.type === 'message'
    );

    let reasoning: string | undefined;
    if (reasoningItem?.summary?.length) {
      const summaryText = reasoningItem.summary.find(item => item.type === 'summary_text');
      reasoning = summaryText?.text;
    }

    if (!reasoning && textMessage?.content) {
      const textContent = textMessage.content.find(item => item.type === 'output_text');
      reasoning = textContent?.text;
    }

    if (!computerCall) {
      return {
        isComplete: true,
        reasoning: reasoning || 'No action required',
        result: reasoning,
        rawResponse: data,
        responseId: data.id,
      };
    }

    this.pendingSafetyChecks = computerCall.pending_safety_checks;

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
    apiAction: OpenAIComputerAction,
    _screenSize: { width: number; height: number }
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
        return {
          type: 'click',
          x: apiAction.start_x,
          y: apiAction.start_y,
        };

      default:
        console.warn('[OpenAI CU] Unknown action type:', apiAction.type);
        return {
          type: 'wait',
          duration: 500,
        };
    }
  }

  /**
   * Maps key names to standard key names.
   */
  private mapKey(keys: string[]): string {
    if (keys.length === 0) return 'Enter';

    return keys.map((key) => {
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
// Types for OpenAI Responses API
// =============================================================================

interface OpenAIResponsesAPIRequest {
  model: string;
  input: OpenAIInputItem[];
  tools: OpenAITool[];
  truncation?: 'auto' | 'disabled';
  previous_response_id?: string;
  max_output_tokens?: number;
}

type OpenAIInputItem = OpenAIMessageInput | OpenAIComputerCallOutputInput;

interface OpenAIMessageInput {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

interface OpenAIComputerCallOutputInput {
  type: 'computer_call_output';
  call_id: string;
  acknowledged_safety_checks?: OpenAIPendingSafetyCheck[];
  output: {
    type: 'computer_screenshot';
    image_url: string;
  };
}

interface OpenAIContentPart {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
}

interface OpenAITool {
  type: 'computer_use_preview';
  display_width: number;
  display_height: number;
  environment: 'browser' | 'desktop' | 'mobile';
}

interface OpenAIPendingSafetyCheck {
  id: string;
  code?: string;
  message?: string;
}

interface OpenAIResponsesAPIResponse {
  id?: string;
  output?: OpenAIOutputItem[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

type OpenAIOutputItem =
  | OpenAIComputerCallOutput
  | OpenAIMessageOutput
  | OpenAIReasoningOutput;

interface OpenAIComputerCallOutput {
  type: 'computer_call';
  call_id: string;
  action: OpenAIComputerAction;
  pending_safety_checks?: OpenAIPendingSafetyCheck[];
}

interface OpenAIMessageOutput {
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'output_text';
    text: string;
  }>;
}

interface OpenAIReasoningOutput {
  type: 'reasoning';
  summary?: Array<{
    type: 'summary_text';
    text: string;
  }>;
}

interface OpenAIComputerAction {
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
