/**
 * MCP (Model Context Protocol) Server Integration Types
 *
 * MCP allows OllieBot to connect to external tool providers
 * that expose capabilities through a standardized protocol.
 */

// Transport type for MCP servers
export type MCPTransport = 'http' | 'stdio';

export interface MCPServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  capabilities?: string[];
  // HTTP transport
  url?: string;
  apiKey?: string;
  // Stdio transport (command-based like Claude Desktop)
  transport?: MCPTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

export interface MCPToolCall {
  toolName: string;
  serverId: string;
  input: Record<string, unknown>;
}

export interface MCPToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: {
    executionTime: number;
    tokenUsage?: number;
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  serverId: string;
}
