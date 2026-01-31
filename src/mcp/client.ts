import { spawn, type ChildProcess } from 'child_process';
import { createInterface, type Interface as ReadlineInterface } from 'readline';
import type {
  MCPServerConfig,
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  MCPResource,
  MCPPrompt,
} from './types.js';

/**
 * MCP Client - Connects to MCP servers and invokes tools
 *
 * Supports both HTTP and stdio transports.
 * The Model Context Protocol (MCP) is a standard for LLMs to interact
 * with external tools and data sources.
 */
export class MCPClient {
  private servers: Map<string, MCPServerConfig> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private prompts: Map<string, MCPPrompt> = new Map();

  // Stdio transport state
  private processes: Map<string, ChildProcess> = new Map();
  private readlines: Map<string, ReadlineInterface> = new Map();
  private pendingRequests: Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private requestId = 0;

  constructor() {}

  /**
   * Register an MCP server
   */
  async registerServer(config: MCPServerConfig): Promise<void> {
    this.servers.set(config.id, config);

    if (config.enabled) {
      // Determine transport type
      const transport = config.transport || (config.command ? 'stdio' : 'http');

      if (transport === 'stdio' && config.command) {
        await this.startStdioServer(config);
      }

      await this.discoverCapabilities(config);
    }
  }

  /**
   * Start a stdio-based MCP server
   */
  private async startStdioServer(config: MCPServerConfig): Promise<void> {
    if (!config.command) {
      throw new Error(`No command specified for stdio server: ${config.id}`);
    }

    const proc = spawn(config.command, config.args || [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.processes.set(config.id, proc);

    // Handle stdout for JSON-RPC responses
    const rl = createInterface({ input: proc.stdout! });
    this.readlines.set(config.id, rl);

    rl.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        if (response.id !== undefined && this.pendingRequests.has(response.id)) {
          const pending = this.pendingRequests.get(response.id)!;
          this.pendingRequests.delete(response.id);

          if (response.error) {
            pending.reject(new Error(response.error.message || 'MCP error'));
          } else {
            pending.resolve(response.result || {});
          }
        }
      } catch {
        // Not a JSON-RPC response, might be log output
      }
    });

    // Handle stderr (only log non-empty lines)
    proc.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[MCP:${config.id}] ${msg}`);
    });

    // Handle process exit
    proc.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[MCP] Server ${config.name} exited with code ${code}`);
      }
      this.processes.delete(config.id);
      this.readlines.delete(config.id);
    });

    proc.on('error', (error) => {
      console.error(`[MCP] Server ${config.name} error:`, error);
    });

    // Wait for server to be ready (give it a moment to start)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Send initialize request
    try {
      await this.sendStdioRequest(config, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'OllieBot', version: '0.1.0' },
      });
      // Send initialized notification to complete handshake
      this.sendStdioNotification(config, 'notifications/initialized', {});
    } catch (error) {
      console.error(`[MCP] Failed to initialize ${config.name}:`, error);
    }
  }

  /**
   * Send a notification to a stdio-based server (no response expected)
   */
  private sendStdioNotification(
    config: MCPServerConfig,
    method: string,
    params: Record<string, unknown>
  ): void {
    const proc = this.processes.get(config.id);
    if (!proc || !proc.stdin) {
      console.warn(`[MCP] Cannot send notification - server not running: ${config.id}`);
      return;
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    proc.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * Send a request to a stdio-based server
   */
  private sendStdioRequest(
    config: MCPServerConfig,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const proc = this.processes.get(config.id);
    if (!proc || !proc.stdin) {
      return Promise.reject(new Error(`Server not running: ${config.id}`));
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      proc.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Discover tools, resources, and prompts from a server
   */
  private async discoverCapabilities(config: MCPServerConfig): Promise<void> {
    // Discover tools
    try {
      const toolsResponse = await this.sendRequest(config, 'tools/list', {});
      const tools = toolsResponse.tools as Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }> | undefined;

      if (tools) {
        for (const tool of tools) {
          const mcpTool: MCPTool = {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            serverId: config.id,
          };
          this.tools.set(`${config.id}:${tool.name}`, mcpTool);
        }
      }
    } catch {
      // Server may not support tools/list - this is acceptable
    }

    // Discover resources
    try {
      const resourcesResponse = await this.sendRequest(config, 'resources/list', {});
      const resources = resourcesResponse.resources as Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
      }> | undefined;

      if (resources) {
        for (const resource of resources) {
          const mcpResource: MCPResource = {
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            serverId: config.id,
          };
          this.resources.set(`${config.id}:${resource.uri}`, mcpResource);
        }
      }
    } catch {
      // Server may not support resources/list - this is acceptable
    }

    // Discover prompts
    try {
      const promptsResponse = await this.sendRequest(config, 'prompts/list', {});
      const prompts = promptsResponse.prompts as Array<{
        name: string;
        description?: string;
        arguments?: Array<{ name: string; description?: string; required?: boolean }>;
      }> | undefined;

      if (prompts) {
        for (const prompt of prompts) {
          const mcpPrompt: MCPPrompt = {
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
            serverId: config.id,
          };
          this.prompts.set(`${config.id}:${prompt.name}`, mcpPrompt);
        }
      }
    } catch {
      // Server may not support prompts/list - this is acceptable
    }

    // Log summary
    const toolCount = this.getServerToolCount(config.id);
    const resourceCount = this.getServerResourceCount(config.id);
    const promptCount = this.getServerPromptCount(config.id);
    if (toolCount > 0 || resourceCount > 0 || promptCount > 0) {
      console.log(
        `[MCP] Discovered from ${config.name}: ${toolCount} tools, ` +
          `${resourceCount} resources, ${promptCount} prompts`
      );
    }
  }

  /**
   * Send a JSON-RPC request to an MCP server (auto-detects transport)
   */
  private async sendRequest(
    config: MCPServerConfig,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const transport = config.transport || (config.command ? 'stdio' : 'http');

    if (transport === 'stdio') {
      return this.sendStdioRequest(config, method, params);
    }

    return this.sendHttpRequest(config, method, params);
  }

  /**
   * Send a JSON-RPC request to an HTTP-based MCP server
   */
  private async sendHttpRequest(
    config: MCPServerConfig,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!config.url) {
      throw new Error(`No URL specified for HTTP server: ${config.id}`);
    }

    const requestBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { error?: { message: string }; result?: Record<string, unknown> };

    if (result.error) {
      throw new Error(`MCP error: ${result.error.message}`);
    }

    return result.result || {};
  }

  /**
   * Invoke a tool on an MCP server
   */
  async invokeTool(call: MCPToolCall): Promise<MCPToolResult> {
    const toolKey = `${call.serverId}:${call.toolName}`;
    const tool = this.tools.get(toolKey);

    if (!tool) {
      console.error(`[MCP] ✗ Tool not found: ${toolKey}`);
      return {
        success: false,
        error: `Tool not found: ${toolKey}`,
      };
    }

    const server = this.servers.get(call.serverId);
    if (!server || !server.enabled) {
      console.error(`[MCP] ✗ Server not available: ${call.serverId}`);
      return {
        success: false,
        error: `Server not available: ${call.serverId}`,
      };
    }

    const startTime = Date.now();

    try {
      const result = await this.sendRequest(server, 'tools/call', {
        name: call.toolName,
        arguments: call.input,
      });

      const duration = Date.now() - startTime;
      console.log(`[MCP] ✓ ${call.serverId}/${call.toolName} (${duration}ms)`);

      return {
        success: true,
        output: result.content,
        metadata: {
          executionTime: duration,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[MCP] ✗ ${call.serverId}/${call.toolName} (${duration}ms): ${error}`);
      return {
        success: false,
        error: String(error),
        metadata: {
          executionTime: duration,
        },
      };
    }
  }

  /**
   * Read a resource from an MCP server
   */
  async readResource(serverId: string, uri: string): Promise<{ content: string; mimeType?: string } | null> {
    const server = this.servers.get(serverId);
    if (!server || !server.enabled) {
      return null;
    }

    try {
      const result = await this.sendRequest(server, 'resources/read', { uri });
      const contents = result.contents as Array<{ text?: string; mimeType?: string }> | undefined;
      return {
        content: String(contents?.[0]?.text || ''),
        mimeType: String(contents?.[0]?.mimeType || 'text/plain'),
      };
    } catch (error) {
      console.error(`[MCP] Failed to read resource ${uri}:`, error);
      return null;
    }
  }

  /**
   * Get a prompt from an MCP server
   */
  async getPrompt(
    serverId: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<string | null> {
    const server = this.servers.get(serverId);
    if (!server || !server.enabled) {
      return null;
    }

    try {
      const result = await this.sendRequest(server, 'prompts/get', {
        name: promptName,
        arguments: args,
      });
      const messages = result.messages as Array<{ content?: { text?: string } }> | undefined;
      return String(messages?.[0]?.content?.text || '');
    } catch (error) {
      console.error(`[MCP] Failed to get prompt ${promptName}:`, error);
      return null;
    }
  }

  /**
   * Get all available tools, optionally filtered by whitelist/blacklist
   */
  getAvailableTools(options?: {
    whitelist?: string[];
    blacklist?: string[];
  }): MCPTool[] {
    let tools = Array.from(this.tools.values());

    if (options?.whitelist && options.whitelist.length > 0) {
      tools = tools.filter(
        (t) =>
          options.whitelist!.includes(t.serverId) ||
          options.whitelist!.includes(`${t.serverId}:${t.name}`)
      );
    }

    if (options?.blacklist && options.blacklist.length > 0) {
      tools = tools.filter(
        (t) =>
          !options.blacklist!.includes(t.serverId) &&
          !options.blacklist!.includes(`${t.serverId}:${t.name}`)
      );
    }

    return tools;
  }

  /**
   * Get tools formatted for LLM tool use
   */
  getToolsForLLM(options?: { whitelist?: string[]; blacklist?: string[] }): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return this.getAvailableTools(options).map((tool) => ({
      name: `${tool.serverId}__${tool.name}`,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  private getServerToolCount(serverId: string): number {
    return Array.from(this.tools.values()).filter((t) => t.serverId === serverId).length;
  }

  private getServerResourceCount(serverId: string): number {
    return Array.from(this.resources.values()).filter((r) => r.serverId === serverId).length;
  }

  private getServerPromptCount(serverId: string): number {
    return Array.from(this.prompts.values()).filter((p) => p.serverId === serverId).length;
  }

  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  getResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Shutdown all stdio servers
   */
  async shutdown(): Promise<void> {
    for (const [serverId, proc] of this.processes) {
      // Server shutdown is silent unless there's an error
      proc.kill();
    }
    this.processes.clear();
    this.readlines.clear();
    this.pendingRequests.clear();
  }
}
