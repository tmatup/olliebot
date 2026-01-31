/**
 * Tool Runner - Executes tools and emits events
 *
 * Central runtime for tool execution that:
 * - Registers native tools
 * - Integrates with MCP client and skill manager
 * - Handles sequential and parallel execution
 * - Emits events for UI updates
 */

import { v4 as uuid } from 'uuid';
import type {
  ToolDefinition,
  ToolRequest,
  ToolResult,
  ToolEvent,
  ToolEventCallback,
  ToolSource,
  LLMTool,
} from './types.js';
import type { NativeTool } from './native/types.js';
import type { MCPClient } from '../mcp/client.js';

export interface ToolRunnerConfig {
  mcpClient?: MCPClient;
  nativeTools?: Map<string, NativeTool>;
}

export class ToolRunner {
  private mcpClient: MCPClient | null;
  private nativeTools: Map<string, NativeTool>;
  private userTools: Map<string, NativeTool>;
  private eventListeners: Set<ToolEventCallback> = new Set();

  constructor(config: ToolRunnerConfig = {}) {
    this.mcpClient = config.mcpClient || null;
    this.nativeTools = config.nativeTools || new Map();
    this.userTools = new Map();
  }

  /**
   * Register a native tool
   */
  registerNativeTool(tool: NativeTool): void {
    this.nativeTools.set(tool.name, tool);
    console.log(`[ToolRunner] Registered native tool: ${tool.name}`);
  }

  /**
   * Register a user-defined tool
   */
  registerUserTool(tool: NativeTool): void {
    this.userTools.set(tool.name, tool);
    console.log(`[ToolRunner] Registered user tool: ${tool.name}`);
  }

  /**
   * Subscribe to tool events
   * Returns unsubscribe function
   */
  onToolEvent(callback: ToolEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ToolEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ToolRunner] Event listener error:', error);
      }
    }
  }

  /**
   * Get all available tools formatted for LLM API
   */
  getToolsForLLM(): LLMTool[] {
    const tools: LLMTool[] = [];

    // Add native tools
    for (const [name, tool] of this.nativeTools) {
      tools.push({
        name: `native__${name}`,
        description: tool.description,
        input_schema: tool.inputSchema,
      });
    }

    // Add user-defined tools
    for (const [name, tool] of this.userTools) {
      tools.push({
        name: `user__${name}`,
        description: tool.description,
        input_schema: tool.inputSchema,
      });
    }

    // Add MCP tools
    if (this.mcpClient) {
      const mcpTools = this.mcpClient.getToolsForLLM();
      for (const tool of mcpTools) {
        tools.push({
          name: tool.name, // Already prefixed with serverId__
          description: tool.description,
          input_schema: tool.input_schema,
        });
      }
    }

    // Note: Skills are not exposed as tools
    // Per Agent Skills spec, skills are injected into the system prompt
    // and agents read/execute them via filesystem access (bash tools)

    return tools;
  }

  /**
   * Get all tool definitions (full info)
   */
  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    // Add native tools
    for (const [name, tool] of this.nativeTools) {
      tools.push({
        name: `native__${name}`,
        description: tool.description,
        source: 'native',
        inputSchema: tool.inputSchema,
      });
    }

    // Add user-defined tools
    for (const [name, tool] of this.userTools) {
      tools.push({
        name: `user__${name}`,
        description: tool.description,
        source: 'user',
        inputSchema: tool.inputSchema,
      });
    }

    // Add MCP tools
    if (this.mcpClient) {
      const mcpTools = this.mcpClient.getToolsForLLM();
      for (const tool of mcpTools) {
        const [serverId] = tool.name.split('__');
        tools.push({
          name: tool.name,
          description: tool.description,
          source: 'mcp',
          inputSchema: tool.input_schema,
          serverId,
        });
      }
    }

    // Note: Skills are not exposed as tools
    // Per Agent Skills spec, skills are injected into the system prompt

    return tools;
  }

  /**
   * Execute a single tool
   */
  async executeTool(request: ToolRequest): Promise<ToolResult> {
    const startTime = new Date();

    // Emit tool_requested event
    this.emitEvent({
      type: 'tool_requested',
      requestId: request.id,
      toolName: request.toolName,
      source: request.source,
      parameters: request.parameters,
      timestamp: new Date(),
    });

    let result: ToolResult;

    try {
      const output = await this.invokeToolBySource(request);
      const endTime = new Date();

      result = {
        requestId: request.id,
        toolName: request.toolName,
        success: true,
        output,
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      };

    } catch (error) {
      const endTime = new Date();

      result = {
        requestId: request.id,
        toolName: request.toolName,
        success: false,
        error: String(error),
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      };

    }

    // Emit tool_execution_finished event
    this.emitEvent({
      type: 'tool_execution_finished',
      requestId: result.requestId,
      toolName: result.toolName,
      source: request.source,
      success: result.success,
      parameters: request.parameters,
      result: result.output,
      error: result.error,
      startTime: result.startTime,
      endTime: result.endTime,
      durationMs: result.durationMs,
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * Execute multiple tools
   * Tools with the same groupId run in parallel
   */
  async executeTools(requests: ToolRequest[]): Promise<ToolResult[]> {
    if (requests.length === 0) {
      return [];
    }

    // Group by groupId - same groupId runs in parallel
    const groups = new Map<string, ToolRequest[]>();

    for (const request of requests) {
      // No groupId = sequential (unique group per request)
      const groupId = request.groupId || `seq_${request.id}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push(request);
    }

    const results: ToolResult[] = [];

    // Execute groups sequentially, requests within group in parallel
    for (const [_groupId, groupRequests] of groups) {
      if (groupRequests.length === 1) {
        // Single request - execute directly
        const result = await this.executeTool(groupRequests[0]);
        results.push(result);
      } else {
        // Multiple requests in group - execute in parallel
        const groupResults = await Promise.all(
          groupRequests.map((req) => this.executeTool(req))
        );
        results.push(...groupResults);
      }
    }

    return results;
  }

  /**
   * Route tool execution to appropriate handler based on source
   */
  private async invokeToolBySource(request: ToolRequest): Promise<unknown> {
    const { toolName, source, parameters } = request;

    switch (source) {
      case 'native': {
        const nativeName = toolName.replace('native__', '');
        const tool = this.nativeTools.get(nativeName);
        if (!tool) {
          throw new Error(`Native tool not found: ${nativeName}`);
        }
        const result = await tool.execute(parameters);
        if (!result.success) {
          throw new Error(result.error || 'Tool execution failed');
        }
        return result.output;
      }

      case 'user': {
        const userName = toolName.replace('user__', '');
        const tool = this.userTools.get(userName);
        if (!tool) {
          throw new Error(`User tool not found: ${userName}`);
        }
        const result = await tool.execute(parameters);
        if (!result.success) {
          throw new Error(result.error || 'Tool execution failed');
        }
        return result.output;
      }

      case 'mcp': {
        if (!this.mcpClient) {
          throw new Error('MCP client not configured');
        }
        // Parse serverId__toolName format
        const [serverId, ...nameParts] = toolName.split('__');
        const mcpToolName = nameParts.join('__');
        const result = await this.mcpClient.invokeTool({
          serverId,
          toolName: mcpToolName,
          input: parameters,
        });
        if (!result.success) {
          throw new Error(result.error || 'MCP tool execution failed');
        }
        return result.output;
      }

      default:
        throw new Error(`Unknown tool source: ${source}`);
    }
  }

  /**
   * Parse tool name to determine source
   */
  parseToolName(fullName: string): { source: ToolSource; name: string } {
    if (fullName.startsWith('native__')) {
      return { source: 'native', name: fullName.replace('native__', '') };
    }
    if (fullName.startsWith('user__')) {
      return { source: 'user', name: fullName.replace('user__', '') };
    }
    // Assume MCP tool (format: serverId__toolName)
    return { source: 'mcp', name: fullName };
  }

  /**
   * Create a tool request from LLM tool_use block
   */
  createRequest(
    toolUseId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    groupId?: string
  ): ToolRequest {
    const { source } = this.parseToolName(toolName);
    return {
      id: toolUseId,
      toolName,
      source,
      parameters,
      groupId,
    };
  }
}
