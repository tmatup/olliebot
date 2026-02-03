/**
 * OpenAI Computer Use Provider
 *
 * Implements Computer Use using OpenAI's computer-use-preview model.
 * Also serves as base class for Azure OpenAI provider.
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
 * - OPENAI_BASE_URL: Optional base URL override
 * - BROWSER_MODEL: Model name (defaults to computer-use-preview)
 */
export class OpenAIComputerUseProvider implements IComputerUseProvider {
  readonly name: 'openai' | 'azure_openai' = 'openai';

  protected apiKey: string;
  protected endpoint: string;
  protected model: string;
  protected maxTokens: number;
  private pendingSafetyChecks?: PendingSafetyCheck[];

  constructor(config: ComputerUseProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.endpoint = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
    this.model = config.model || process.env.BROWSER_MODEL || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || 1024;
  }

  /** Provider name for logging */
  protected get providerName(): string {
    return 'OpenAI';
  }

  /** Auth header name */
  protected get authHeader(): string {
    return 'Authorization';
  }

  /** Auth header value */
  protected get authValue(): string {
    return `Bearer ${this.apiKey}`;
  }

  /** Whether to include max_output_tokens in requests */
  protected get includeMaxTokens(): boolean {
    return true;
  }

  /** Screenshot output type in follow-up requests */
  protected get screenshotOutputType(): 'computer_screenshot' | 'input_image' {
    return 'computer_screenshot';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getAction(params: GetActionParams): Promise<ComputerUseResponse> {
    if (!this.isAvailable()) {
      throw new Error(`${this.providerName} API not configured`);
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

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [this.authHeader]: this.authValue,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${this.providerName} CU] API error:`, response.status, errorText);
        throw new Error(`${this.providerName} API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as ResponsesAPIResponse;
      if (data.error) {
        const errorMessage = data.error.message || JSON.stringify(data.error);
        console.error(`[${this.providerName} CU] API error body:`, data.error);
        throw new Error(`${this.providerName} API error: ${errorMessage}`);
      }

      console.log(`[${this.providerName} CU] ${previousResponseId ? 'follow-up' : 'initial'} request -> response: ${data.id}`);

      return this.parseResponse(data);
    } catch (error) {
      console.error(`[${this.providerName} CU] Error getting action:`, error);
      throw error;
    }
  }

  /**
   * Builds the request body for the Responses API.
   */
  private buildRequestBody(
    instruction: string,
    screenshot: string,
    screenSize: { width: number; height: number },
    previousResponseId?: string,
    previousCallId?: string
  ): ResponsesAPIRequest {
    const tools: Tool[] = [
      {
        type: 'computer_use_preview',
        display_width: screenSize.width,
        display_height: screenSize.height,
        environment: 'browser',
      },
    ];

    const baseRequest: ResponsesAPIRequest = {
      model: this.model,
      tools,
      truncation: 'auto',
      input: [],
    };

    if (this.includeMaxTokens) {
      baseRequest.max_output_tokens = this.maxTokens;
    }

    // Follow-up request: use previous_response_id and computer_call_output
    if (previousResponseId && previousCallId) {
      // Send full safety check objects for acknowledgement
      const acknowledgedChecks = this.pendingSafetyChecks;

      if (acknowledgedChecks?.length) {
        console.log(`[${this.providerName} CU] Acknowledging safety checks:`, acknowledgedChecks.map(sc => sc.id));
      }

      return {
        ...baseRequest,
        previous_response_id: previousResponseId,
        input: [
          {
            type: 'computer_call_output',
            call_id: previousCallId,
            ...(acknowledgedChecks?.length && { acknowledged_safety_checks: acknowledgedChecks }),
            output: {
              type: this.screenshotOutputType,
              image_url: `data:image/png;base64,${screenshot}`,
            },
          },
        ],
      };
    }

    // Initial request: send instruction with screenshot
    return {
      ...baseRequest,
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
    };
  }

  /**
   * Parses the Responses API response.
   */
  private parseResponse(data: ResponsesAPIResponse): ComputerUseResponse {
    const computerCall = data.output?.find(
      (item): item is ComputerCallOutput => item.type === 'computer_call'
    );

    const reasoningItem = data.output?.find(
      (item): item is ReasoningOutput => item.type === 'reasoning'
    );

    const textMessage = data.output?.find(
      (item): item is MessageOutput => item.type === 'message'
    );

    // Extract reasoning from reasoning item or text message
    let reasoning: string | undefined;
    if (reasoningItem?.summary?.length) {
      const summaryText = reasoningItem.summary.find(item => item.type === 'summary_text');
      reasoning = summaryText?.text;
    }
    if (!reasoning && textMessage?.content) {
      const textContent = textMessage.content.find(item => item.type === 'output_text');
      reasoning = textContent?.text;
    }

    // If no computer call, task is complete
    if (!computerCall) {
      return {
        isComplete: true,
        reasoning: reasoning || 'No action required',
        result: reasoning,
        rawResponse: data,
        responseId: data.id,
      };
    }

    // Store pending safety checks for acknowledgement in next request
    this.pendingSafetyChecks = computerCall.pending_safety_checks;

    if (this.pendingSafetyChecks?.length) {
      console.log(`[${this.providerName} CU] Pending safety checks to acknowledge:`, this.pendingSafetyChecks.map(sc => sc.id));
    }

    const action = this.parseComputerAction(computerCall.action);

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
  private parseComputerAction(apiAction: ComputerAction): ComputerUseAction {
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
        console.warn(`[${this.providerName} CU] Unknown action type:`, apiAction.type);
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

interface ResponsesAPIRequest {
  model: string;
  input: InputItem[];
  tools: Tool[];
  truncation?: 'auto' | 'disabled';
  previous_response_id?: string;
  max_output_tokens?: number;
}

type InputItem = MessageInput | ComputerCallOutputInput;

interface MessageInput {
  type: 'message';
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
}

interface ComputerCallOutputInput {
  type: 'computer_call_output';
  call_id: string;
  acknowledged_safety_checks?: PendingSafetyCheck[];
  output: {
    type: 'computer_screenshot' | 'input_image';
    image_url: string;
  };
}

interface ContentPart {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
}

interface Tool {
  type: 'computer_use_preview';
  display_width: number;
  display_height: number;
  environment: 'browser' | 'desktop' | 'mobile';
}

interface PendingSafetyCheck {
  id: string;
  code?: string;
  message?: string;
}

interface ResponsesAPIResponse {
  id?: string;
  output?: OutputItem[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

type OutputItem = ComputerCallOutput | MessageOutput | ReasoningOutput;

interface ComputerCallOutput {
  type: 'computer_call';
  call_id: string;
  action: ComputerAction;
  pending_safety_checks?: PendingSafetyCheck[];
}

interface MessageOutput {
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'output_text';
    text: string;
  }>;
}

interface ReasoningOutput {
  type: 'reasoning';
  summary?: Array<{
    type: 'summary_text';
    text: string;
  }>;
}

interface ComputerAction {
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
