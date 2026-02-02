/**
 * MockedToolRunner - Provides deterministic tool responses for evaluation
 *
 * Implements the same interface patterns as ToolRunner but returns mocked outputs
 * defined in the evaluation file instead of executing real tools.
 */

import { v4 as uuid } from 'uuid';
import type {
  ToolRequest,
  ToolResult,
  LLMTool,
  ToolSource,
} from '../tools/types.js';
import type { ToolRunner } from '../tools/runner.js';
import type { MockedToolOutput } from './types.js';

export interface RecordedToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  timestamp: Date;
  order: number;
}

export class MockedToolRunner {
  private mockedOutputs: Record<string, MockedToolOutput>;
  private recordedCalls: RecordedToolCall[] = [];
  private callOrder = 0;

  constructor(mockedOutputs: Record<string, MockedToolOutput> = {}) {
    this.mockedOutputs = mockedOutputs;
  }

  /**
   * Get tools for LLM - returns real tool definitions from the actual runner
   * This ensures the LLM knows what tools are available
   */
  getToolsForLLM(realToolRunner: ToolRunner): LLMTool[] {
    return realToolRunner.getToolsForLLM();
  }

  /**
   * Execute a tool request with mocked output
   */
  async executeTool(request: ToolRequest): Promise<ToolResult> {
    const startTime = new Date();

    // Record the call for later analysis
    this.recordedCalls.push({
      toolName: request.toolName,
      parameters: request.parameters,
      timestamp: startTime,
      order: this.callOrder++,
    });

    // Find mocked output
    const mocked = this.mockedOutputs[request.toolName];

    // Simulate a small delay for realism
    await new Promise(resolve => setTimeout(resolve, 10));

    const endTime = new Date();

    if (!mocked) {
      // No mock defined - return a default result indicating no mock
      return {
        requestId: request.id,
        toolName: request.toolName,
        success: true,
        output: {
          _mocked: false,
          message: `[No mock defined for ${request.toolName} - returning empty result]`,
        },
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      };
    }

    // Return mocked result
    return {
      requestId: request.id,
      toolName: request.toolName,
      success: mocked.success,
      output: mocked.output,
      error: mocked.error,
      startTime,
      endTime,
      durationMs: endTime.getTime() - startTime.getTime(),
    };
  }

  /**
   * Execute multiple tools (handles same interface as ToolRunner)
   */
  async executeTools(requests: ToolRequest[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const request of requests) {
      const result = await this.executeTool(request);
      results.push(result);
    }

    return results;
  }

  /**
   * Get all recorded tool calls for analysis
   */
  getRecordedCalls(): RecordedToolCall[] {
    return [...this.recordedCalls];
  }

  /**
   * Clear recorded calls (for multiple runs)
   */
  clearRecordedCalls(): void {
    this.recordedCalls = [];
    this.callOrder = 0;
  }

  /**
   * Check if a specific tool was called
   */
  wasToolCalled(toolName: string): boolean {
    return this.recordedCalls.some(call => call.toolName === toolName);
  }

  /**
   * Get calls for a specific tool
   */
  getCallsForTool(toolName: string): RecordedToolCall[] {
    return this.recordedCalls.filter(call => call.toolName === toolName);
  }

  /**
   * Get the number of times a tool was called
   */
  getToolCallCount(toolName: string): number {
    return this.getCallsForTool(toolName).length;
  }

  /**
   * Parse tool name to determine source (same as ToolRunner)
   */
  parseToolName(fullName: string): { source: ToolSource; name: string } {
    if (fullName.startsWith('native__')) {
      return { source: 'native', name: fullName.replace('native__', '') };
    }
    if (fullName.startsWith('user__')) {
      return { source: 'user', name: fullName.replace('user__', '') };
    }
    // Assume MCP tool
    return { source: 'mcp', name: fullName };
  }

  /**
   * Create a tool request (same interface as ToolRunner)
   */
  createRequest(
    toolUseId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    groupId?: string
  ): ToolRequest {
    const { source } = this.parseToolName(toolName);
    return {
      id: toolUseId || uuid(),
      toolName,
      source,
      parameters,
      groupId,
    };
  }

  /**
   * Update mocked outputs (useful for dynamic scenarios)
   */
  setMockedOutput(toolName: string, output: MockedToolOutput): void {
    this.mockedOutputs[toolName] = output;
  }

  /**
   * Remove a mocked output
   */
  removeMockedOutput(toolName: string): void {
    delete this.mockedOutputs[toolName];
  }

  /**
   * Get all mocked outputs
   */
  getMockedOutputs(): Record<string, MockedToolOutput> {
    return { ...this.mockedOutputs };
  }
}
