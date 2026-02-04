import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { createServer, type Server } from 'http';
import { WebSocketServer } from 'ws';
import type { SupervisorAgent } from '../agents/types.js';
import { WebChannel } from '../channels/index.js';
import { getDb } from '../db/index.js';
import { isWellKnownConversation, getWellKnownConversationMeta } from '../db/well-known-conversations.js';
import type { MCPClient } from '../mcp/index.js';
import type { SkillManager } from '../skills/index.js';
import type { ToolRunner } from '../tools/index.js';
import type { LLMService } from '../llm/service.js';
import { getModelCapabilities } from '../llm/model-capabilities.js';
import { setupEvalRoutes } from './eval-routes.js';
import type { BrowserSessionManager } from '../browser/index.js';
import type { TaskManager } from '../tasks/index.js';
import { type RAGProjectService, createRAGProjectRoutes, type IndexingProgress } from '../rag-projects/index.js';

export interface ServerConfig {
  port: number;
  supervisor: SupervisorAgent;
  mcpClient?: MCPClient;
  skillManager?: SkillManager;
  toolRunner?: ToolRunner;
  llmService?: LLMService;
  browserManager?: BrowserSessionManager;
  taskManager?: TaskManager;
  ragProjectService?: RAGProjectService;
  // LLM configuration for model capabilities endpoint
  mainProvider?: string;
  mainModel?: string;
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
  private llmService?: LLMService;
  private browserManager?: BrowserSessionManager;
  private taskManager?: TaskManager;
  private ragProjectService?: RAGProjectService;
  private mainProvider?: string;
  private mainModel?: string;

  constructor(config: ServerConfig) {
    this.port = config.port;
    this.supervisor = config.supervisor;
    this.mcpClient = config.mcpClient;
    this.skillManager = config.skillManager;
    this.toolRunner = config.toolRunner;
    this.llmService = config.llmService;
    this.browserManager = config.browserManager;
    this.taskManager = config.taskManager;
    this.ragProjectService = config.ragProjectService;
    this.mainProvider = config.mainProvider;
    this.mainModel = config.mainModel;

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

    // Get model capabilities (for reasoning mode support)
    this.app.get('/api/model-capabilities', (_req: Request, res: Response) => {
      const caps = getModelCapabilities(this.mainProvider || '', this.mainModel || '');
      res.json({
        provider: this.mainProvider,
        model: this.mainModel,
        ...caps,
      });
    });

    // Consolidated startup endpoint - returns all data needed for initial page load
    this.app.get('/api/startup', async (_req: Request, res: Response) => {
      try {
        const db = getDb();

        // 1. Model capabilities
        const modelCaps = getModelCapabilities(this.mainProvider || '', this.mainModel || '');
        const modelCapabilities = {
          provider: this.mainProvider,
          model: this.mainModel,
          ...modelCaps,
        };

        // 2. Conversations
        const rawConversations = db.conversations.findAll({ limit: 50 });
        const conversations = rawConversations.map((c) => {
          const wellKnownMeta = getWellKnownConversationMeta(c.id);
          return {
            ...c,
            isWellKnown: !!wellKnownMeta,
            icon: wellKnownMeta?.icon,
            title: wellKnownMeta?.title ?? c.title,
          };
        });
        conversations.sort((a, b) => {
          if (a.isWellKnown && !b.isWellKnown) return -1;
          if (!a.isWellKnown && b.isWellKnown) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

        // 3. Messages for default :feed: conversation
        const rawMessages = db.messages.findByConversationId(':feed:');
        const messages = rawMessages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          agentName: m.metadata?.agentName,
          agentEmoji: m.metadata?.agentEmoji,
          agentType: m.metadata?.agentType,
          attachments: m.metadata?.attachments,
          messageType: m.metadata?.type,
          taskId: m.metadata?.taskId,
          taskName: m.metadata?.taskName,
          taskDescription: m.metadata?.taskDescription,
          toolName: m.metadata?.toolName,
          toolSource: m.metadata?.source,
          toolSuccess: m.metadata?.success,
          toolDurationMs: m.metadata?.durationMs,
          toolError: m.metadata?.error,
          toolParameters: m.metadata?.parameters,
          toolResult: m.metadata?.result,
          delegationAgentId: m.metadata?.agentId,
          delegationAgentType: m.metadata?.agentType,
          delegationMission: m.metadata?.mission,
          delegationRationale: m.metadata?.rationale,
          // Reasoning mode (vendor-neutral)
          reasoningMode: m.metadata?.reasoningMode,
          // Citations
          citations: m.metadata?.citations,
        }));

        // 4. Tasks
        const rawTasks = db.tasks.findAll({ limit: 20 });
        const tasks = rawTasks.map(t => {
          const config = t.jsonConfig as { description?: string; trigger?: { schedule?: string } };
          return {
            id: t.id,
            name: t.name,
            description: config.description || '',
            schedule: config.trigger?.schedule || null,
            status: t.status,
            lastRun: t.lastRun,
            nextRun: t.nextRun,
          };
        });

        // 5. Skills
        const skills = this.skillManager
          ? this.skillManager.getAllMetadata().map(skill => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              location: skill.filePath,
            }))
          : [];

        // 6. MCP servers
        let mcps: Array<{ id: string; name: string; enabled: boolean; transport: string; toolCount: number }> = [];
        if (this.mcpClient) {
          const servers = this.mcpClient.getServers();
          const mcpTools = this.mcpClient.getTools();
          mcps = servers.map(server => ({
            id: server.id,
            name: server.name,
            enabled: server.enabled,
            transport: server.transport || (server.command ? 'stdio' : 'http'),
            toolCount: mcpTools.filter(t => t.serverId === server.id).length,
          }));
        }

        // 7. Tools (organized as tree structure)
        interface ToolInfo {
          name: string;
          description: string;
          inputs: Array<{ name: string; type: string; description: string; required: boolean }>;
        }
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

        const builtin: ToolInfo[] = [];
        const user: ToolInfo[] = [];
        const mcp: Record<string, ToolInfo[]> = {};

        if (this.toolRunner) {
          const allTools = this.toolRunner.getToolsForLLM();
          const mcpServers = this.mcpClient?.getServers() || [];
          const serverNames: Record<string, string> = {};
          for (const server of mcpServers) {
            serverNames[server.id] = server.name;
          }

          for (const tool of allTools) {
            const toolName = tool.name;
            const inputs = extractInputs(tool.input_schema);

            if (toolName.startsWith('user__')) {
              user.push({ name: toolName.replace('user__', ''), description: tool.description, inputs });
            } else if (toolName.startsWith('native__')) {
              builtin.push({ name: toolName.replace('native__', ''), description: tool.description, inputs });
            } else if (toolName.includes('__')) {
              const [serverId, ...rest] = toolName.split('__');
              const mcpToolName = rest.join('__');
              const serverName = serverNames[serverId] || serverId;
              if (!mcp[serverName]) mcp[serverName] = [];
              mcp[serverName].push({ name: mcpToolName, description: tool.description, inputs });
            }
          }
        }

        // 8. RAG Projects
        let ragProjects: Array<{
          id: string;
          name: string;
          documentCount: number;
          indexedCount: number;
          vectorCount: number;
          lastIndexedAt?: string;
          isIndexing: boolean;
        }> = [];
        if (this.ragProjectService) {
          try {
            const projects = await this.ragProjectService.listProjects();
            ragProjects = projects.map(p => ({
              id: p.id,
              name: p.name,
              documentCount: p.documentCount,
              indexedCount: p.indexedCount,
              vectorCount: p.vectorCount,
              lastIndexedAt: p.lastIndexedAt,
              isIndexing: this.ragProjectService!.isIndexing(p.id),
            }));
          } catch (error) {
            console.warn('[API] Failed to load RAG projects:', error);
          }
        }

        res.json({
          modelCapabilities,
          conversations,
          messages,
          tasks,
          skills,
          mcps,
          tools: { builtin, user, mcp },
          ragProjects,
        });
      } catch (error) {
        console.error('[API] Startup data fetch failed:', error);
        res.status(500).json({ error: 'Failed to fetch startup data' });
      }
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

        // Enhance conversations with well-known metadata and sort
        const enhanced = conversations.map((c) => {
          const wellKnownMeta = getWellKnownConversationMeta(c.id);
          return {
            ...c,
            isWellKnown: !!wellKnownMeta,
            icon: wellKnownMeta?.icon,
            // Well-known conversations use their fixed title
            title: wellKnownMeta?.title ?? c.title,
          };
        });

        // Sort: well-known conversations first, then by updatedAt
        enhanced.sort((a, b) => {
          if (a.isWellKnown && !b.isWellKnown) return -1;
          if (!a.isWellKnown && b.isWellKnown) return 1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });

        res.json(enhanced);
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
          agentType: m.metadata?.agentType,
          // Attachments
          attachments: m.metadata?.attachments,
          // Message type (task_run, tool_event, delegation, etc.)
          messageType: m.metadata?.type,
          // Task run metadata
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
          // Delegation metadata (legacy - agentType above is preferred)
          delegationAgentId: m.metadata?.agentId,
          delegationAgentType: m.metadata?.agentType,
          delegationMission: m.metadata?.mission,
          delegationRationale: m.metadata?.rationale,
          // Reasoning mode (vendor-neutral)
          reasoningMode: m.metadata?.reasoningMode,
          // Citations
          citations: m.metadata?.citations,
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

    // Soft delete a conversation (well-known conversations cannot be deleted)
    this.app.delete('/api/conversations/:id', (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;

        // Prevent deletion of well-known conversations
        if (isWellKnownConversation(id)) {
          res.status(403).json({ error: 'Well-known conversations cannot be deleted' });
          return;
        }

        const db = getDb();
        db.conversations.softDelete(id);
        res.json({ success: true });
      } catch (error) {
        console.error('[API] Failed to delete conversation:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
      }
    });

    // Rename a conversation (well-known conversations cannot be renamed)
    this.app.patch('/api/conversations/:id', (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const { title } = req.body;

        if (!title || typeof title !== 'string') {
          res.status(400).json({ error: 'Title is required' });
          return;
        }

        // Prevent renaming of well-known conversations
        if (isWellKnownConversation(id)) {
          res.status(403).json({ error: 'Well-known conversations cannot be renamed' });
          return;
        }

        const db = getDb();
        const conversation = db.conversations.findById(id);
        if (!conversation) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }

        const now = new Date().toISOString();
        db.conversations.update(id, {
          title: title.trim().substring(0, 100),
          manuallyNamed: true,
          updatedAt: now,
        });

        res.json({
          success: true,
          conversation: {
            id,
            title: title.trim().substring(0, 100),
            manuallyNamed: true,
            updatedAt: now,
          },
        });
      } catch (error) {
        console.error('[API] Failed to rename conversation:', error);
        res.status(500).json({ error: 'Failed to rename conversation' });
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
          agentType: m.metadata?.agentType,
          // Attachments
          attachments: m.metadata?.attachments,
          // Message type (task_run, tool_event, delegation, etc.)
          messageType: m.metadata?.type,
          // Task run metadata
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
          // Delegation metadata
          delegationAgentId: m.metadata?.agentId,
          delegationAgentType: m.metadata?.agentType,
          delegationMission: m.metadata?.mission,
          delegationRationale: m.metadata?.rationale,
          // Citations
          citations: m.metadata?.citations,
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
        res.json(tasks.map(t => {
          const config = t.jsonConfig as { description?: string; trigger?: { schedule?: string } };
          return {
            id: t.id,
            name: t.name,
            description: config.description || '',
            schedule: config.trigger?.schedule || null,
            status: t.status,
            lastRun: t.lastRun,
            nextRun: t.nextRun,
          };
        }));
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

        // Mark task as executed (updates lastRun and nextRun)
        if (this.taskManager) {
          this.taskManager.markTaskExecuted(task.id);
        }

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

    // Setup evaluation routes (if llmService and toolRunner are available)
    if (this.llmService && this.toolRunner) {
      setupEvalRoutes(this.app, {
        llmService: this.llmService,
        toolRunner: this.toolRunner,
        webChannel: this.webChannel,
      });
      console.log('[Server] Evaluation routes enabled');
    }

    // Setup RAG project routes
    if (this.ragProjectService) {
      const ragRoutes = createRAGProjectRoutes(this.ragProjectService);
      this.app.use('/api/rag', ragRoutes);
      console.log('[Server] RAG project routes enabled');
    }
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

    // Listen for task updates and broadcast to frontend
    if (this.taskManager) {
      this.taskManager.on('task:updated', ({ task }) => {
        this.webChannel.broadcast({
          type: 'task_updated',
          task,
        });
      });
    }

    // Listen for RAG project indexing progress
    if (this.ragProjectService) {
      this.ragProjectService.on('indexing_progress', (progress: IndexingProgress) => {
        // Map internal event names to WebSocket event types
        const eventTypeMap: Record<string, string> = {
          started: 'rag_indexing_started',
          processing: 'rag_indexing_progress',
          completed: 'rag_indexing_completed',
          error: 'rag_indexing_error',
        };

        this.webChannel.broadcast({
          type: eventTypeMap[progress.status] || 'rag_indexing_progress',
          projectId: progress.projectId,
          totalDocuments: progress.totalDocuments,
          processedDocuments: progress.processedDocuments,
          currentDocument: progress.currentDocument,
          error: progress.error,
          timestamp: progress.timestamp,
        });
      });

      // Listen for project changes
      this.ragProjectService.on('projects_changed', () => {
        this.webChannel.broadcast({
          type: 'rag_projects_changed',
          timestamp: new Date().toISOString(),
        });
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
