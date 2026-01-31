/**
 * Remember Tool
 *
 * Allows the agent to save important information to long-term memory.
 * Should be used VERY selectively for truly important information.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MemoryService } from '../../memory/service.js';

export class RememberTool implements NativeTool {
  readonly name = 'remember';
  readonly description = `Save important information to long-term memory. Use this VERY SELECTIVELY - only for critical information that will be valuable in future conversations. Examples: user preferences, important project details, key decisions made. Do NOT use for: temporary information, things that can be easily re-asked, or trivial details.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember. Keep it concise and factual.',
      },
      category: {
        type: 'string',
        description: 'Optional category for organization (e.g., "preference", "project", "person", "decision")',
      },
    },
    required: ['content'],
  };

  private memoryService: MemoryService;

  constructor(memoryService: MemoryService) {
    this.memoryService = memoryService;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const content = params.content as string;
    const category = params.category as string | undefined;

    if (!content || content.trim().length === 0) {
      return {
        success: false,
        error: 'Content is required',
      };
    }

    if (content.length > 500) {
      return {
        success: false,
        error: 'Memory content too long. Keep it under 500 characters for efficiency.',
      };
    }

    try {
      const entry = this.memoryService.remember(content, category);
      return {
        success: true,
        output: {
          message: 'Saved to memory',
          category: entry.t || 'general',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save memory: ${error}`,
      };
    }
  }
}
