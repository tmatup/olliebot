/**
 * Google Gemini Computer Use Provider
 *
 * Implements Computer Use using Google's Gemini 2.5 Computer Use model.
 *
 * Key characteristics:
 * - Uses normalized 1000x1000 grid coordinate system
 * - Cheapest option (~$1.25/M input tokens)
 * - Fastest latency (~225ms model inference)
 * - Optimized for web browsers
 */

import type {
  IComputerUseProvider,
  GetActionParams,
  ComputerUseResponse,
  ComputerUseAction,
  ComputerUseProviderConfig,
} from './types.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-preview-04-17';

/**
 * Google Gemini Computer Use Provider.
 *
 * Uses shared Google credentials from environment:
 * - GOOGLE_API_KEY: API key
 * - BROWSER_MODEL: Model name (defaults to gemini-2.5-flash-preview-04-17)
 */

/**
 * System prompt for Gemini Computer Use.
 */
const SYSTEM_PROMPT = `You are a browser automation assistant that can see screenshots and interact with web pages.

When given an instruction and a screenshot, analyze the page and determine the single best action to take.

You must respond with a JSON object in this exact format:
{
  "reasoning": "Brief explanation of what you see and why you're taking this action",
  "action": {
    "type": "click" | "type" | "scroll" | "key" | "wait",
    ... action-specific fields
  },
  "isComplete": false
}

Or if the task is complete:
{
  "reasoning": "Brief explanation of what you accomplished",
  "action": null,
  "isComplete": true,
  "result": "Description of the result"
}

Action types and their fields:
- click: { "type": "click", "x": number, "y": number }
  - Coordinates are in the 0-1000 normalized grid (will be scaled to actual viewport)
- type: { "type": "type", "text": "text to type" }
  - Types the specified text (assumes an input is focused)
- scroll: { "type": "scroll", "direction": "up" | "down", "amount": 300 }
- key: { "type": "key", "key": "Enter" | "Tab" | "Escape" | etc }
- wait: { "type": "wait", "duration": 1000 }

Important:
- Return ONLY the JSON object, no markdown or additional text
- Coordinates use a normalized 1000x1000 grid
- Take ONE action at a time
- If you need to click on something before typing, first return a click action`;

/**
 * Google Gemini Computer Use Provider.
 */
export class GoogleComputerUseProvider implements IComputerUseProvider {
  readonly name = 'google' as const;

  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(config: ComputerUseProviderConfig = {}) {
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || '';
    this.model = config.model || process.env.BROWSER_MODEL || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || 1024;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getAction(params: GetActionParams): Promise<ComputerUseResponse> {
    if (!this.isAvailable()) {
      throw new Error('Google API key not configured');
    }

    const { screenshot, instruction, screenSize, history } = params;

    // Build the request
    const contents = this.buildContents(instruction, screenshot, history);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents,
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
            generationConfig: {
              maxOutputTokens: this.maxTokens,
              temperature: 0.1, // Low temperature for consistent actions
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as GeminiResponse;
      return this.parseResponse(data, screenSize);
    } catch (error) {
      console.error('[GoogleCU] Error getting action:', error);
      throw error;
    }
  }

  /**
   * Builds the contents array for the Gemini API request.
   */
  private buildContents(
    instruction: string,
    screenshot: string,
    history?: GetActionParams['history']
  ): GeminiContent[] {
    const contents: GeminiContent[] = [];

    // Add history if available
    if (history) {
      for (const item of history) {
        if (item.role === 'user') {
          contents.push({
            role: 'user',
            parts: typeof item.content === 'string'
              ? [{ text: item.content }]
              : this.convertContentBlocks(item.content),
          });
        } else if (item.role === 'assistant') {
          contents.push({
            role: 'model',
            parts: typeof item.content === 'string'
              ? [{ text: item.content }]
              : this.convertContentBlocks(item.content),
          });
        }
      }
    }

    // Add current instruction with screenshot
    contents.push({
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: screenshot,
          },
        },
        {
          text: `Instruction: ${instruction}\n\nAnalyze the screenshot and determine the next action to take.`,
        },
      ],
    });

    return contents;
  }

  /**
   * Converts content blocks to Gemini format.
   */
  private convertContentBlocks(
    blocks: Array<{ type: string; text?: string; source?: { data: string; media_type: string } }>
  ): GeminiPart[] {
    return blocks.map((block) => {
      if (block.type === 'image' && block.source) {
        return {
          inlineData: {
            mimeType: block.source.media_type,
            data: block.source.data,
          },
        };
      }
      return { text: block.text || '' };
    });
  }

  /**
   * Parses the Gemini response into a ComputerUseResponse.
   */
  private parseResponse(
    data: GeminiResponse,
    screenSize: { width: number; height: number }
  ): ComputerUseResponse {
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return {
        isComplete: false,
        reasoning: 'No response from model',
        rawResponse: data,
      };
    }

    try {
      // Extract JSON from the response (handle potential markdown wrapping)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          isComplete: false,
          reasoning: `Could not parse response: ${text}`,
          rawResponse: data,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as ParsedAction;

      // Scale coordinates from 1000x1000 grid to actual viewport
      let action: ComputerUseAction | undefined;
      if (parsed.action) {
        action = { ...parsed.action };
        if (action.type === 'click' && action.x !== undefined && action.y !== undefined) {
          action.x = Math.round((action.x / 1000) * screenSize.width);
          action.y = Math.round((action.y / 1000) * screenSize.height);
        }
      }

      return {
        action,
        reasoning: parsed.reasoning,
        isComplete: parsed.isComplete || false,
        result: parsed.result,
        rawResponse: data,
      };
    } catch (parseError) {
      return {
        isComplete: false,
        reasoning: `Failed to parse response: ${text}`,
        rawResponse: data,
      };
    }
  }
}

// =============================================================================
// Types for Gemini API
// =============================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface ParsedAction {
  reasoning?: string;
  action?: ComputerUseAction;
  isComplete?: boolean;
  result?: string;
}
