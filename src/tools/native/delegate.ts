/**
 * Delegate Tool
 *
 * Allows the supervisor to delegate tasks to specialist agents.
 * This tool validates the delegation parameters - actual delegation
 * is performed by the supervisor after detecting this tool was called.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export interface DelegationParams {
  type: string;
  mission: string;
  rationale?: string;
  customName?: string;
  customEmoji?: string;
}

export class DelegateTool implements NativeTool {
  readonly name = 'delegate';
  readonly description = `Delegate a task to a specialist agent. Use this when the task requires specialized expertise. Available types:
- researcher: For research, information gathering, learning about topics
- coder: For writing code, debugging, technical implementation
- writer: For writing documents, editing text, content creation
- planner: For planning, organizing, breaking down projects`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['researcher', 'coder', 'writer', 'planner', 'custom'],
        description: 'The type of specialist agent to spawn',
      },
      mission: {
        type: 'string',
        description: 'The specific task for the agent to complete',
      },
      rationale: {
        type: 'string',
        description: 'Brief explanation of why this agent type was chosen',
      },
      customName: {
        type: 'string',
        description: 'Optional custom name for the agent',
      },
      customEmoji: {
        type: 'string',
        description: 'Optional emoji for the agent',
      },
    },
    required: ['type', 'mission'],
  };

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const { type, mission, rationale, customName, customEmoji } = params;

    // Validate type
    const validTypes = ['researcher', 'coder', 'writer', 'planner', 'custom'];
    if (!validTypes.includes(type as string)) {
      return {
        success: false,
        error: `Invalid agent type: ${type}. Must be one of: ${validTypes.join(', ')}`,
      };
    }

    if (!mission || (mission as string).trim().length === 0) {
      return {
        success: false,
        error: 'Mission is required',
      };
    }

    // Return success with delegation params
    // Actual delegation is performed by the supervisor
    return {
      success: true,
      output: {
        delegated: true,
        type,
        mission,
        rationale,
        customName,
        customEmoji,
      },
    };
  }
}
