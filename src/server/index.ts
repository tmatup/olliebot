import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { createServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import type { SupervisorAgent } from '../agents/types.js';
import { WebChannel } from '../channels/index.js';
import { getDb } from '../db/index.js';
import type { MCPClient } from '../mcp/index.js';
import type { SkillManager } from '../skills/index.js';
import type { ToolRunner } from '../tools/index.js';
import type { BrowserSessionManager } from '../browser/index.js';

export interface ServerConfig {
  port: number;
  supervisor: SupervisorAgent;
  mcpClient?: MCPClient;
  skillManager?: SkillManager;
  toolRunner?: ToolRunner;
  browserManager?: BrowserSessionManager;
}

export class OllieBotServer {
  private app: Express;
  private server: Server;
  private wss: WebSocketServer;
  private supervisor: SupervisorAgent;
  private webChannel: WebChannel;
  private port: number;
  private mcpClient?: MCPClient;
  private skillManager?: SkillManager;
  private toolRunner?: ToolRunner;
  private browserManager?: BrowserSessionManager;

  constructor(config: ServerConfig) {
    this.port = config.port;
    this.supervisor = config.supervisor;
    this.mcpClient = config.mcpClient;
    this.skillManager = config.skillManager;
    this.toolRunner = config.toolRunner;
    this.browserManager = config.browserManager;

    // Create Express app
    this.app = express();

    // Enable CORS for all origins
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    this.app.use(express.json());

    // Create HTTP server
    this.server = createServer(this.app);

    // Create WebSocket server - attach to HTTP server
    this.wss = new WebSocketServer({
      server: this.server,
      path: '/', // Explicit root path
    });

    // Create and configure web channel
    this.webChannel = new WebChannel('web-main');

    // Setup routes
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get agent state
    this.app.get('/api/state', (_req: Request, res: Response) => {
      res.json(this.supervisor.getState());
    });

    // Get active agents
    this.app.get('/api/agents', (_req: Request, res: Response) => {
      const agents = [
        this.supervisor.identity,
        ...this.supervisor.getSubAgents().map((id) => ({ id, role: 'worker' })),
      ];
      res.json(agents);
    });

    // Get MCP servers
    this.app.get('/api/mcps', (_req: Request, res: Response) => {
      if (!this.mcpClient) {
        res.json([]);
        return;
      }

      const servers = this.mcpClient.getServers();
      const tools = this.mcpClient.getTools();

      res.json(servers.map(server => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport || (server.command ? 'stdio' : 'http'),
        toolCount: tools.filter(t => t.serverId === server.id).length,
      })));
    });

    // Get skills metadata
    this.app.get('/api/skills', (_req: Request, res: Response) => {
      if (!this.skillManager) {
        res.json([]);
        return;
      }

      const skills = this.skillManager.getAllMetadata();
      res.json(skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        location: skill.filePath,
      })));
    });

    // Get all tools (native + MCP) organized as tree structure
    this.app.get('/api/tools', (_req: Request, res: Response) => {
      if (!this.toolRunner) {
        res.json({ builtin: [], user: [], mcp: {} });
        return;
      }

      // Helper to extract input parameters from JSON schema
      const extractInputs = (schema: Record<string, unknown>): Array<{ name: string; type: string; description: string; required: boolean }> => {
        const properties = schema.properties as Record<string, { type?: string; description?: string }> | undefined;
        const required = (schema.required as string[]) || [];
        if (!properties) return [];

        return Object.entries(properties).map(([name, prop]) => ({
          name,
          type: String(prop.type || 'any'),
          description: prop.description || '',
          required: required.includes(name),
        }));
      };

      const tools = this.toolRunner.getToolsForLLM();

      interface ToolInfo {
        name: string;
        description: string;
        inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
      }

      const builtin: ToolInfo[] = [];
      const user: ToolInfo[] = [];
      const mcp: Record<string, ToolInfo[]> = {};

      // Get MCP server names for grouping
      const mcpServers = this.mcpClient?.getServers() || [];
      const serverNames: Record<string, string> = {};
      for (const server of mcpServers) {
        serverNames[server.id] = server.name;
      }

      for (const tool of tools) {
        const toolName = tool.name;
        const inputs = extractInputs(tool.input_schema);

        if (toolName.startsWith('user__')) {
          // User-defined tool
          user.push({
            name: toolName.replace('user__', ''),
            description: tool.description,
            inputs,
          });
        } else if (toolName.startsWith('native__')) {
          // Built-in native tool
          builtin.push({
            name: toolName.replace('native__', ''),
            description: tool.description,
            inputs,
          });
        } else if (toolName.includes('__')) {
          // MCP tool: serverId__toolName
          const [serverId, ...rest] = toolName.split('__');
          const mcpToolName = rest.join('__');
          const serverName = serverNames[serverId] || serverId;

          if (!mcp[serverName]) {
            mcp[serverName] = [];
          }
          mcp[serverName].push({
            name: mcpToolName,
            description: tool.description,
            inputs,
          });
        }
      }

      res.json({ builtin, user, mcp });
    });

    // Get all conversations
    this.app.get('/api/conversations', (_req: Request, res: Response) => {
      try {
        const db = getDb();
        const conversations = db.conversations.findAll({ limit: 50 });
        res.json(conversations);
      } catch (error) {
        console.error('[API] Failed to fetch conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
      }
    });

    // Get messages for a specific conversation
    this.app.get('/api/conversations/:id/messages', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const messages = db.messages.findByConversationId(req.params.id as string);
        res.json(messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          agentName: m.metadata?.agentName,
          agentEmoji: m.metadata?.agentEmoji,
          // Attachments
          attachments: m.metadata?.attachments,
          // Task run metadata
          messageType: m.metadata?.type,
          taskId: m.metadata?.taskId,
          taskName: m.metadata?.taskName,
          taskDescription: m.metadata?.taskDescription,
          // Tool event metadata
          toolName: m.metadata?.toolName,
          toolSource: m.metadata?.source,
          toolSuccess: m.metadata?.success,
          toolDurationMs: m.metadata?.durationMs,
          toolError: m.metadata?.error,
          toolParameters: m.metadata?.parameters,
          toolResult: m.metadata?.result,
        })));
      } catch (error) {
        console.error('[API] Failed to fetch messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    });

    // Create a new conversation
    this.app.post('/api/conversations', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const { title, channel } = req.body;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const conversation = {
          id,
          title: title || 'New Conversation',
          channel: channel || 'web',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };

        db.conversations.create(conversation);
        res.json(conversation);
      } catch (error) {
        console.error('[API] Failed to create conversation:', error);
        res.status(500).json({ error: 'Failed to create conversation' });
      }
    });

    // Soft delete a conversation
    this.app.delete('/api/conversations/:id', (req: Request, res: Response) => {
      try {
        const db = getDb();
        db.conversations.softDelete(req.params.id as string);
        res.json({ success: true });
      } catch (error) {
        console.error('[API] Failed to delete conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
      }
    });

    // Get chat history (for current/active conversation)
    this.app.get('/api/messages', (req: Request, res: Response) => {
      try {
        const db = getDb();
        const limit = parseInt(req.query.limit as string) || 50;

        // Get the most recent conversation
        const conversations = db.conversations.findAll({ limit: 1 });

        if (conversations.length === 0) {
          res.json([]);
          return;
        }

        const messages = db.messages.findByConversationId(conversations[0].id, { limit });
        res.json(messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          agentName: m.metadata?.agentName,
          agentEmoji: m.metadata?.agentEmoji,
          // Attachments
          attachments: m.metadata?.attachments,
          // Task run metadata
          messageType: m.metadata?.type,
          taskId: m.metadata?.taskId,
          taskName: m.metadata?.taskName,
          taskDescription: m.metadata?.taskDescription,
          // Tool event metadata
          toolName: m.metadata?.toolName,
          toolSource: m.metadata?.source,
          toolSuccess: m.metadata?.success,
          toolDurationMs: m.metadata?.durationMs,
          toolError: m.metadata?.error,
          toolParameters: m.metadata?.parameters,
          toolResult: m.metadata?.result,
        })));
      } catch (error) {
        console.error('[API] Failed to fetch messages:', error);
        res.json([]);
      }
    });

    // Send a message (REST alternative to WebSocket)
    this.app.post('/api/messages', async (req: Request, res: Response) => {
      try {
        const { content } = req.body;
        if (!content) {
          res.status(400).json({ error: 'Content is required' });
          return;
        }

        const message = {
          id: crypto.randomUUID(),
          channel: 'web-rest',
          role: 'user' as const,
          content,
          createdAt: new Date(),
        };

        await this.supervisor.handleMessage(message);
        res.json({ success: true, messageId: message.id });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Get connected clients count
    this.app.get('/api/clients', (_req: Request, res: Response) => {
      res.json({ count: this.webChannel.getConnectedClients() });
    });

    // Get active tasks
    this.app.get('/api/tasks', (_req: Request, res: Response) => {
      try {
        const db = getDb();
        const tasks = db.tasks.findAll({ limit: 20 });
        res.json(tasks.map(t => ({
          id: t.id,
          name: t.name,
          status: t.status,
          lastRun: t.lastRun,
          nextRun: t.nextRun,
        })));
      } catch (error) {
        console.error('[API] Failed to fetch tasks:', error);
        res.json([]);
      }
    });

    // Run a task immediately
    this.app.post('/api/tasks/:id/run', async (req: Request, res: Response) => {
      try {
        const db = getDb();
        const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const task = db.tasks.findById(taskId);
        const { conversationId } = req.body || {};

        if (!task) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }

        // Update task lastRun timestamp
        const now = new Date().toISOString();
        db.tasks.update(task.id, { lastRun: now, updatedAt: now });

        // If a conversation ID was provided, set it on the supervisor
        if (conversationId) {
          this.supervisor.setConversationId(conversationId);
        }

        // Get description from jsonConfig
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';

        // Broadcast task_run event for compact UI display
        this.webChannel.broadcast({
          type: 'task_run',
          taskId: task.id,
          taskName: task.name,
          taskDescription,
          timestamp: now,
        });

        // Create a message to trigger the task execution via the supervisor
        // The message content is for the LLM, metadata is for UI display
        const taskMessage = {
          id: crypto.randomUUID(),
          channel: 'web-main',
          role: 'user' as const,
          content: `Run the "${task.name}" task now. Here is the task configuration:\n\n${JSON.stringify(task.jsonConfig, null, 2)}`,
          createdAt: new Date(),
          metadata: {
            type: 'task_run',
            taskId: task.id,
            taskName: task.name,
            taskDescription,
          },
        };

        // Send to supervisor (async - don't wait for completion)
        this.supervisor.handleMessage(taskMessage).catch((error) => {
          console.error('[API] Task execution error:', error);
        });

        res.json({ success: true, taskId: task.id, message: 'Task started' });
      } catch (error) {
        console.error('[API] Failed to run task:', error);
        res.status(500).json({ error: 'Failed to run task' });
      }
    });
  }

  async start(): Promise<void> {
    this.wss.on('error', (error) => {
      console.error('[WebSocket] Server error:', error);
    });

    // Initialize web channel and attach to WebSocket server
    await this.webChannel.init();
    this.webChannel.attachToServer(this.wss);

    // Register web channel with supervisor
    this.supervisor.registerChannel(this.webChannel);

    // Attach web channel to browser manager if present
    if (this.browserManager) {
      this.browserManager.attachWebChannel(this.webChannel);

      // Handle browser actions from web clients
      this.webChannel.onBrowserAction(async (action, sessionId) => {
        console.log(`[Server] Browser action: ${action} for session ${sessionId}`);
        if (action === 'close' && this.browserManager) {
          await this.browserManager.closeSession(sessionId);
        }
      });
    }

    // Start listening
    return new Promise((resolve) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`[Server] HTTP server listening on http://0.0.0.0:${this.port}`);
        console.log(`[Server] WebSocket server ready on ws://0.0.0.0:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close(() => {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
}
