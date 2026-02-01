/**
 * Selector Reasoner
 *
 * Uses LLM to reason about which CSS selector to use for an action.
 */

import type { IStrategyLLMService } from '../types.js';

/**
 * System prompt for selector reasoning.
 */
const SELECTOR_SYSTEM_PROMPT = `You are a web automation assistant that analyzes HTML and determines the best CSS selector to interact with elements.

When given an instruction and page HTML, determine:
1. What element the user wants to interact with
2. The best CSS selector to target that element

Respond with a JSON object:
{
  "reasoning": "Brief explanation of which element you identified and why",
  "selector": "the CSS selector",
  "action": "click" | "type" | "select",
  "text": "text to type (only for type action)"
}

Selector preference order:
1. data-testid or data-test attributes: [data-testid="submit-btn"]
2. Unique IDs: #login-button
3. Semantic selectors: button[type="submit"], input[name="email"]
4. Text content: text=Sign Up, :has-text("Login")
5. Class combinations: .btn.btn-primary.submit
6. XPath only as last resort

Important:
- Return ONLY the JSON object
- Prefer stable selectors that won't break when CSS changes
- Use :has-text() for text matching when appropriate`;

/**
 * Result from selector reasoning.
 */
export interface SelectorReasoningResult {
  selector: string;
  action: 'click' | 'type' | 'select';
  text?: string;
  reasoning?: string;
}

/**
 * Uses LLM to determine the best selector for an action.
 */
export class SelectorReasoner {
  private llmService: IStrategyLLMService;

  constructor(llmService: IStrategyLLMService) {
    this.llmService = llmService;
  }

  /**
   * Reasons about which selector to use for an instruction.
   */
  async reason(
    instruction: string,
    pageHtml: string,
    pageUrl: string
  ): Promise<SelectorReasoningResult> {
    // Truncate HTML if too long
    const truncatedHtml = this.truncateHtml(pageHtml, 50000);

    const response = await this.llmService.generate(
      [
        {
          role: 'user',
          content: `Page URL: ${pageUrl}

HTML:
\`\`\`html
${truncatedHtml}
\`\`\`

Instruction: ${instruction}

Determine the best CSS selector and action to take.`,
        },
      ],
      {
        systemPrompt: SELECTOR_SYSTEM_PROMPT,
        maxTokens: 500,
      }
    );

    return this.parseResponse(response.content);
  }

  /**
   * Reasons about a selector with both HTML and screenshot context.
   */
  async reasonWithScreenshot(
    instruction: string,
    pageHtml: string,
    screenshot: string,
    pageUrl: string
  ): Promise<SelectorReasoningResult> {
    // Truncate HTML if too long
    const truncatedHtml = this.truncateHtml(pageHtml, 30000);

    const response = await this.llmService.generate(
      [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: screenshot,
              },
            },
            {
              type: 'text',
              text: `Page URL: ${pageUrl}

HTML (truncated):
\`\`\`html
${truncatedHtml}
\`\`\`

Instruction: ${instruction}

Look at the screenshot and HTML, then determine the best CSS selector and action to take.`,
            },
          ],
        },
      ],
      {
        systemPrompt: SELECTOR_SYSTEM_PROMPT,
        maxTokens: 500,
      }
    );

    return this.parseResponse(response.content);
  }

  /**
   * Parses the LLM response into a SelectorReasoningResult.
   */
  private parseResponse(content: string): SelectorReasoningResult {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        selector?: string;
        action?: string;
        text?: string;
        reasoning?: string;
      };

      if (!parsed.selector) {
        throw new Error('No selector in response');
      }

      return {
        selector: parsed.selector,
        action: (parsed.action as 'click' | 'type' | 'select') || 'click',
        text: parsed.text,
        reasoning: parsed.reasoning,
      };
    } catch (error) {
      console.error('[SelectorReasoner] Failed to parse response:', content);
      throw new Error(`Failed to parse selector reasoning: ${error}`);
    }
  }

  /**
   * Truncates HTML to a maximum length, trying to preserve structure.
   */
  private truncateHtml(html: string, maxLength: number): string {
    if (html.length <= maxLength) {
      return html;
    }

    // Try to truncate at a tag boundary
    const truncated = html.substring(0, maxLength);
    const lastTagEnd = truncated.lastIndexOf('>');

    if (lastTagEnd > maxLength * 0.8) {
      return truncated.substring(0, lastTagEnd + 1) + '\n<!-- truncated -->';
    }

    return truncated + '\n<!-- truncated -->';
  }
}
