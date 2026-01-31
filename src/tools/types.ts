/**
 * Tool System Types
 *
 * Core type definitions for the tool execution system including
 * tool definitions, requests, results, and events.
 */

// Tool sources (skills are not tools - they're loaded via system prompt)
export type ToolSource = 'native' | 'mcp' | 'user';

// Tool definition for LLM
export interface ToolDefinition {
  name: string;
  description: string;
  source: ToolSource;
  inputSchema: Record<string, unknown>;
  // For MCP tools
  serverId?: string;
}

// Tool invocation request from LLM
export interface ToolRequest {
  id: string;
  toolName: string;
  source: ToolSource;
  parameters: Record<string, unknown>;
  // Tools with same groupId run concurrently
  groupId?: string;
}

// Tool execution result
export interface ToolResult {
  requestId: string;
  toolName: string;
  success: boolean;
  output?: unknown;
  error?: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
}

// Event: Tool requested (emitted when tool execution starts)
export interface ToolRequestedEvent {
  type: 'tool_requested';
  requestId: string;
  toolName: string;
  source: ToolSource;
  parameters: Record<string, unknown>;
  timestamp: Date;
}

// Event: Tool execution finished (emitted when tool completes)
export interface ToolExecutionFinishedEvent {
  type: 'tool_execution_finished';
  requestId: string;
  toolName: string;
  source: ToolSource;
  success: boolean;
  parameters: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  timestamp: Date;
}

// Union of all tool events
export type ToolEvent = ToolRequestedEvent | ToolExecutionFinishedEvent;

// Event callback type
export type ToolEventCallback = (event: ToolEvent) => void;

// Tool formatted for LLM API
export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
