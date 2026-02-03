import 'dotenv/config';
import { join } from 'path';
import { initDb, closeDb, getDb } from './db/index.js';
import { ensureWellKnownConversations, WellKnownConversations } from './db/well-known-conversations.js';
import { SupervisorAgentImpl, getAgentRegistry } from './agents/index.js';
import {
  LLMService,
  AnthropicProvider,
  GoogleProvider,
  OpenAIProvider,
  AzureOpenAIProvider,
  type LLMProvider,
} from './llm/index.js';
import { ConsoleChannel } from './channels/index.js';
import { OllieBotServer } from './server/index.js';
import { MCPClient } from './mcp/index.js';
import type { MCPServerConfig } from './mcp/types.js';
import { SkillManager } from './skills/index.js';
import { A2UIManager } from './a2ui/index.js';
import { RAGService, GoogleEmbeddingProvider } from './rag/index.js';
import { OpenAIEmbeddingProvider } from './rag/service.js';
import {
  ToolRunner,
  WebSearchTool,
  type WebSearchProvider,
  WebScrapeTool,
  WikipediaSearchTool,
  TakeScreenshotTool,
  AnalyzeImageTool,
  CreateImageTool,
  RememberTool,
  ReadSkillTool,
  RunSkillScriptTool,
  HttpClientTool,
  DelegateTool,
} from './tools/index.js';
import { TaskManager } from './tasks/index.js';
import { MemoryService } from './memory/index.js';
import { UserToolManager } from './tools/user/index.js';
import {
  BrowserSessionManager,
  loadBrowserConfig,
  BrowserSessionTool,
  BrowserNavigateTool,
  BrowserActionTool,
  BrowserScreenshotTool,
} from './browser/index.js';

/**
 * Parse MCP server configurations from various formats.
 * Supports:
 * 1. Flat array: [{ id, name, command, args, env, enabled }]
 * 2. Claude Desktop format: [{ mcpServers: { serverId: { command, args, env } } }]
 * 3. Direct Claude Desktop format: { mcpServers: { serverId: { command, args, env } } }
 */
function parseMCPServers(configStr: string): MCPServerConfig[] {
  try {
    const parsed = JSON.parse(configStr);
    const servers: MCPServerConfig[] = [];

    // Handle direct mcpServers object (Claude Desktop format without array wrapper)
    if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
      for (const [serverId, config] of Object.entries(parsed.mcpServers)) {
        const serverConfig = config as Record<string, unknown>;
        servers.push({
          id: serverId,
          name: serverId.charAt(0).toUpperCase() + serverId.slice(1),
          enabled: true,
          transport: 'stdio',
          command: serverConfig.command as string,
          args: serverConfig.args as string[] | undefined,
          env: serverConfig.env as Record<string, string> | undefined,
        });
      }
      return servers;
    }

    // Handle array format
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        // Check if item is Claude Desktop format (has mcpServers key)
        if (item && typeof item === 'object' && item.mcpServers) {
          for (const [serverId, config] of Object.entries(item.mcpServers)) {
            const serverConfig = config as Record<string, unknown>;
            servers.push({
              id: serverId,
              name: serverId.charAt(0).toUpperCase() + serverId.slice(1),
              enabled: true,
              transport: 'stdio',
              command: serverConfig.command as string,
              args: serverConfig.args as string[] | undefined,
              env: serverConfig.env as Record<string, string> | undefined,
            });
          }
        } else if (item && typeof item === 'object' && item.id) {
          // Flat format - already has id
          servers.push(item as MCPServerConfig);
        }
      }
      return servers;
    }

    return [];
  } catch (error) {
    console.warn('[MCP] Failed to parse MCP_SERVERS config:', error);
    return [];
  }
}

// Configuration
const CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || join(process.cwd(), 'user', 'data', 'olliebot.db'),
  tasksDir: join(process.cwd(), 'user', 'tasks'),
  skillsDir: join(process.cwd(), 'user', 'skills'),
  userToolsDir: join(process.cwd(), 'user', 'tools'),

  // LLM Configuration
  // Supported providers: 'anthropic', 'google', 'openai', 'azure_openai'
  mainProvider: process.env.MAIN_PROVIDER || 'openai',
  mainModel: process.env.MAIN_MODEL || 'gpt-5.2',
  fastProvider: process.env.FAST_PROVIDER || 'openai',
  fastModel: process.env.FAST_MODEL || 'gpt-4.1-mini',

  // API Keys
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Azure OpenAI Configuration
  azureOpenaiApiKey: process.env.AZURE_OPENAI_API_KEY || '',
  azureOpenaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
  azureOpenaiApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',

  // Embedding provider: 'google', 'openai', 'azure_openai'
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'openai',

  // MCP Configuration (JSON string of server configs)
  mcpServers: process.env.MCP_SERVERS || '[]',

  // Native tool API keys
  imageGenProvider: (process.env.IMAGE_GEN_PROVIDER || 'openai') as 'openai' | 'azure_openai',
  imageGenModel: process.env.IMAGE_GEN_MODEL || 'dall-e-3',

  // Web search configuration
  webSearchProvider: (process.env.WEB_SEARCH_PROVIDER || 'tavily') as WebSearchProvider,
  webSearchApiKey: process.env.WEB_SEARCH_API_KEY || '',
  googleCustomSearchEngineId: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || '',
};

function createLLMProvider(provider: string, model: string): LLMProvider {
  switch (provider) {
    case 'google':
      if (!CONFIG.googleApiKey) {
        throw new Error('GOOGLE_API_KEY required for Google provider');
      }
      return new GoogleProvider(CONFIG.googleApiKey, model);

    case 'openai':
      if (!CONFIG.openaiApiKey) {
        throw new Error('OPENAI_API_KEY required for OpenAI provider');
      }
      return new OpenAIProvider(CONFIG.openaiApiKey, model);

    case 'azure_openai':
      if (!CONFIG.azureOpenaiApiKey || !CONFIG.azureOpenaiEndpoint) {
        throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required for Azure OpenAI provider');
      }
      return new AzureOpenAIProvider({
        apiKey: CONFIG.azureOpenaiApiKey,
        endpoint: CONFIG.azureOpenaiEndpoint,
        deploymentName: model,
        apiVersion: CONFIG.azureOpenaiApiVersion,
      });

    case 'anthropic':
    default:
      if (!CONFIG.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY required for Anthropic provider');
      }
      return new AnthropicProvider(CONFIG.anthropicApiKey, model);
  }
}

function createEmbeddingProvider() {
  switch (CONFIG.embeddingProvider) {
    case 'openai':
      if (!CONFIG.openaiApiKey) {
        throw new Error('OPENAI_API_KEY required for OpenAI embeddings');
      }
      return new OpenAIEmbeddingProvider(CONFIG.openaiApiKey);

    case 'azure_openai':
      if (!CONFIG.azureOpenaiApiKey || !CONFIG.azureOpenaiEndpoint) {
        throw new Error('AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required for Azure OpenAI embeddings');
      }
      return new AzureOpenAIEmbeddingProvider(
        CONFIG.azureOpenaiApiKey,
        CONFIG.azureOpenaiEndpoint,
        CONFIG.azureOpenaiApiVersion
      );

    case 'google':
    default:
      if (!CONFIG.googleApiKey) {
        return null; // RAG will be disabled
      }
      return new GoogleEmbeddingProvider(CONFIG.googleApiKey);
  }
}

// Azure OpenAI Embedding Provider
class AzureOpenAIEmbeddingProvider {
  private apiKey: string;
  private endpoint: string;
  private apiVersion: string;
  private deploymentName: string;

  constructor(
    apiKey: string,
    endpoint: string,
    apiVersion: string = '2024-02-15-preview',
    deploymentName: string = 'text-embedding-ada-002'
  ) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.apiVersion = apiVersion;
    this.deploymentName = deploymentName;
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/embeddings?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI embedding error: ${response.status}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/embeddings?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({ input: texts }),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI embedding error: ${response.status}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.map((item) => item.embedding) || [];
  }

  getDimensions(): number {
    return 1536; // Ada-002 dimensions
  }
}

async function main(): Promise<void> {
  console.log('🤖 OllieBot Starting...\n');

  // Validate at least one API key is available
  const hasApiKey =
    CONFIG.anthropicApiKey ||
    CONFIG.googleApiKey ||
    CONFIG.openaiApiKey ||
    (CONFIG.azureOpenaiApiKey && CONFIG.azureOpenaiEndpoint);

  if (!hasApiKey) {
    console.error('Error: At least one LLM API key is required');
    console.error('Set one of: ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY, or AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT');
    process.exit(1);
  }

  // Initialize database
  console.log('[Init] Initializing database...');
  await initDb(CONFIG.dbPath);
  ensureWellKnownConversations();

  // Initialize LLM service with Main and Fast providers
  console.log('[Init] Initializing LLM service...');
  const mainProvider = createLLMProvider(CONFIG.mainProvider, CONFIG.mainModel);
  const fastProvider = createLLMProvider(CONFIG.fastProvider, CONFIG.fastModel);

  const llmService = new LLMService({
    main: mainProvider,
    fast: fastProvider,
  });

  console.log(`[Init] Main LLM: ${CONFIG.mainProvider}/${CONFIG.mainModel}`);
  console.log(`[Init] Fast LLM: ${CONFIG.fastProvider}/${CONFIG.fastModel}`);

  // Initialize Memory Service
  console.log('[Init] Initializing memory service...');
  const memoryService = new MemoryService(process.cwd());
  await memoryService.init();

  // Initialize MCP Client
  console.log('[Init] Initializing MCP client...');
  const mcpClient = new MCPClient();

  const mcpServers = parseMCPServers(CONFIG.mcpServers);
  for (const serverConfig of mcpServers) {
    try {
      await mcpClient.registerServer(serverConfig);
    } catch (error) {
      console.warn(`[Init] Failed to register MCP server ${serverConfig.id}:`, error);
    }
  }
  console.log(`[Init] Registered ${mcpClient.getServers().length} MCP servers`);

  // Initialize Skill Manager
  console.log('[Init] Initializing skill manager...');
  const skillManager = new SkillManager(CONFIG.skillsDir);
  await skillManager.init();

  // Initialize A2UI Manager
  console.log('[Init] Initializing A2UI manager...');
  const a2uiManager = new A2UIManager();

  // Initialize RAG Service
  let ragService: RAGService | null = null;
  const embeddingProvider = createEmbeddingProvider();
  if (embeddingProvider) {
    console.log(`[Init] Initializing RAG service with ${CONFIG.embeddingProvider} embeddings...`);
    ragService = new RAGService(embeddingProvider);
  } else {
    console.log('[Init] RAG service disabled (no embedding provider configured)');
  }

  // Initialize Tool Runner
  console.log('[Init] Initializing tool runner...');
  const toolRunner = new ToolRunner({
    mcpClient,
  });

  // Register native tools
  toolRunner.registerNativeTool(new WikipediaSearchTool());
  toolRunner.registerNativeTool(new HttpClientTool());
  toolRunner.registerNativeTool(new DelegateTool());

  // Web search (requires API key)
  if (CONFIG.webSearchApiKey) {
    toolRunner.registerNativeTool(
      new WebSearchTool({
        provider: CONFIG.webSearchProvider,
        apiKey: CONFIG.webSearchApiKey,
        searchEngineId: CONFIG.googleCustomSearchEngineId || undefined,
      })
    );
    console.log(`[Init] Web search enabled (${CONFIG.webSearchProvider})`);
  }

  // Web scraping (uses LLM for summarization)
  toolRunner.registerNativeTool(new WebScrapeTool({ llmService }));

  toolRunner.registerNativeTool(new TakeScreenshotTool());
  toolRunner.registerNativeTool(new AnalyzeImageTool(llmService));

  // Image generation (requires API key based on provider)
  const imageApiKey = CONFIG.imageGenProvider === 'azure_openai'
    ? CONFIG.azureOpenaiApiKey
    : CONFIG.openaiApiKey;
  console.log(`[Init] Image generation: provider=${CONFIG.imageGenProvider}, hasApiKey=${!!imageApiKey}`);
  if (imageApiKey) {
    toolRunner.registerNativeTool(
      new CreateImageTool({
        apiKey: imageApiKey,
        provider: CONFIG.imageGenProvider,
        model: CONFIG.imageGenModel,
        azureEndpoint: CONFIG.azureOpenaiEndpoint,
        azureApiVersion: CONFIG.azureOpenaiApiVersion,
      })
    );
  } else {
    console.log('[Init] CreateImageTool not registered: no API key configured');
  }

  // Memory tool (always available)
  toolRunner.registerNativeTool(new RememberTool(memoryService));

  // Skill tools (for Agent Skills spec)
  toolRunner.registerNativeTool(new ReadSkillTool(CONFIG.skillsDir));
  toolRunner.registerNativeTool(new RunSkillScriptTool(CONFIG.skillsDir));

  // Initialize Browser Session Manager
  console.log('[Init] Initializing browser session manager...');
  const browserConfig = loadBrowserConfig();
  const browserManager = new BrowserSessionManager({
    defaultConfig: browserConfig,
    llmService: llmService as unknown as import('./browser/manager.js').ILLMService,
  });

  // Register browser tools
  toolRunner.registerNativeTool(new BrowserSessionTool(browserManager));
  toolRunner.registerNativeTool(new BrowserNavigateTool(browserManager));
  toolRunner.registerNativeTool(new BrowserActionTool(browserManager));
  toolRunner.registerNativeTool(new BrowserScreenshotTool(browserManager));
  console.log('[Init] Browser tools registered');

  // Initialize User Tool Manager (watches user/tools for .md tool definitions)
  console.log('[Init] Initializing user tool manager...');
  const userToolManager = new UserToolManager({
    toolsDir: CONFIG.userToolsDir,
    llmService,
  });
  await userToolManager.init();

  // Register user-defined tools
  for (const tool of userToolManager.getToolsForRegistration()) {
    toolRunner.registerUserTool(tool);
  }

  // Hot-reload: re-register tools when they change
  userToolManager.on('tool:updated', (definition) => {
    const tool = userToolManager.getTool(definition.name);
    if (tool) {
      toolRunner.registerUserTool(tool);
      console.log(`[UserTool] Hot-reloaded: ${definition.name}`);
    }
  });

  userToolManager.on('tool:added', (definition) => {
    const tool = userToolManager.getTool(definition.name);
    if (tool) {
      toolRunner.registerUserTool(tool);
      console.log(`[UserTool] Registered new tool: ${definition.name}`);
    }
  });

  console.log(`[Init] Tool runner initialized with ${toolRunner.getToolsForLLM().length} tools`);

  // Initialize Task Manager (watches user/tasks for .md task configs)
  console.log('[Init] Initializing task manager...');
  const taskManager = new TaskManager({
    tasksDir: CONFIG.tasksDir,
    llmService,
  });
  await taskManager.init();

  // Create supervisor agent (multi-agent architecture)
  console.log('[Init] Creating supervisor agent...');
  const registry = getAgentRegistry();
  const supervisor = new SupervisorAgentImpl(llmService, registry);

  // Set tool runner, memory service, and skill manager on supervisor
  supervisor.setToolRunner(toolRunner);
  supervisor.setMemoryService(memoryService);
  supervisor.setSkillManager(skillManager);

  // Register with global agent registry
  registry.registerAgent(supervisor);

  // Initialize supervisor
  await supervisor.init();

  // Determine mode based on command line args
  const mode = process.argv[2] || 'server';

  if (mode === 'console') {
    // Console mode - CLI interface
    console.log('[Init] Starting in console mode...');
    const consoleChannel = new ConsoleChannel();

    // Wire up conversation provider for console commands
    consoleChannel.setConversationProvider({
      listConversations: (limit = 20) => {
        const db = getDb();
        return db.conversations.findAll({ limit });
      },
      getMessages: (conversationId: string, limit = 10) => {
        const db = getDb();
        const messages = db.messages.findByConversationId(conversationId, { limit: 100 });
        // Return last N messages (findByConversationId returns oldest first)
        return messages.slice(-limit).map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        }));
      },
      getCurrentConversationId: () => supervisor.getCurrentConversationId(),
      setConversationId: (id) => supervisor.setConversationId(id),
      startNewConversation: () => supervisor.startNewConversation(),
    });

    // Wire up system provider for tasks, tools, MCP
    consoleChannel.setSystemProvider({
      getTasks: () => {
        const db = getDb();
        const tasks = db.tasks.findAll({ limit: 20 });
        return tasks.map(t => {
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
      },
      getTools: () => {
        const tools = toolRunner.getToolsForLLM();
        const mcpServers = mcpClient?.getServers() || [];
        const serverNames: Record<string, string> = {};
        for (const server of mcpServers) {
          serverNames[server.id] = server.name;
        }

        const builtin: Array<{ name: string; description: string }> = [];
        const user: Array<{ name: string; description: string }> = [];
        const mcp: Record<string, Array<{ name: string; description: string }>> = {};

        for (const tool of tools) {
          const toolName = tool.name;
          if (toolName.startsWith('user__')) {
            user.push({
              name: toolName.replace('user__', ''),
              description: tool.description,
            });
          } else if (toolName.startsWith('native__')) {
            builtin.push({
              name: toolName.replace('native__', ''),
              description: tool.description,
            });
          } else if (toolName.includes('__')) {
            const [serverId, ...rest] = toolName.split('__');
            const mcpToolName = rest.join('__');
            const serverName = serverNames[serverId] || serverId;
            if (!mcp[serverName]) {
              mcp[serverName] = [];
            }
            mcp[serverName].push({
              name: mcpToolName,
              description: tool.description,
            });
          }
        }
        return { builtin, user, mcp };
      },
      getMcpServers: () => {
        if (!mcpClient) return [];
        const servers = mcpClient.getServers();
        const tools = mcpClient.getTools();
        return servers.map(server => ({
          id: server.id,
          name: server.name,
          enabled: server.enabled,
          transport: server.transport || (server.command ? 'stdio' : 'http'),
          toolCount: tools.filter(t => t.serverId === server.id).length,
        }));
      },
    });

    await consoleChannel.init();
    supervisor.registerChannel(consoleChannel);

    // Listen for scheduled tasks in console mode too
    taskManager.on('task:due', async ({ task }) => {
      console.log(`\n[Scheduler] Running scheduled task: ${task.name}`);
      try {
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';

        // Create a task message for the supervisor
        const taskMessage = {
          id: crypto.randomUUID(),
          channel: consoleChannel.id,
          role: 'user' as const,
          content: `[Scheduled Task] Run the "${task.name}" task now. Here is the task configuration:\n\n${JSON.stringify(task.jsonConfig, null, 2)}`,
          createdAt: new Date(),
          metadata: {
            type: 'task_run',
            taskId: task.id,
            taskName: task.name,
            taskDescription,
            scheduled: true,
            conversationId: WellKnownConversations.FEED,
          },
        };

        taskManager.markTaskExecuted(task.id);
        await supervisor.handleMessage(taskMessage);
      } catch (error) {
        console.error(`[Scheduler] Error running scheduled task "${task.name}":`, error);
      }
    });

    // Start the task scheduler
    taskManager.startScheduler();
  } else {
    // Server mode - HTTP + WebSocket
    console.log('[Init] Starting in server mode...');
    const server = new OllieBotServer({
      port: CONFIG.port,
      supervisor,
      mcpClient,
      skillManager,
      toolRunner,
      llmService,
      browserManager,
      taskManager,
      mainProvider: CONFIG.mainProvider,
      mainModel: CONFIG.mainModel,
    });
    await server.start();

    // Listen for scheduled tasks that are due
    taskManager.on('task:due', async ({ task }) => {
      console.log(`[Scheduler] Running scheduled task: ${task.name}`);
      try {
        const taskDescription = (task.jsonConfig as { description?: string }).description || '';

        // Create a task message for the supervisor
        // Route to the well-known :feed: conversation for background tasks
        const taskMessage = {
          id: crypto.randomUUID(),
          channel: 'web-main',  // Use web channel so responses are visible in UI
          role: 'user' as const,
          content: `[Scheduled Task] Run the "${task.name}" task now. Here is the task configuration:\n\n${JSON.stringify(task.jsonConfig, null, 2)}`,
          createdAt: new Date(),
          metadata: {
            type: 'task_run',
            taskId: task.id,
            taskName: task.name,
            taskDescription,
            scheduled: true,
            conversationId: WellKnownConversations.FEED,  // Route to feed conversation
          },
        };

        // Mark the task as executed (updates lastRun and nextRun)
        taskManager.markTaskExecuted(task.id);

        // Send to supervisor
        await supervisor.handleMessage(taskMessage);
      } catch (error) {
        console.error(`[Scheduler] Error running scheduled task "${task.name}":`, error);
      }
    });

    // Start the task scheduler (after event listeners are set up)
    taskManager.startScheduler();

    console.log(`
✅ OllieBot ready! (Multi-Agent Architecture)

  🌐 Web UI:     http://localhost:${CONFIG.port}
  📡 WebSocket:  ws://localhost:${CONFIG.port}
  📚 API:        http://localhost:${CONFIG.port}/api

  📁 Config:     ${CONFIG.tasksDir}
  🗄️  Database:   ${CONFIG.dbPath}
  🧠 Main LLM:   ${CONFIG.mainProvider}/${CONFIG.mainModel}
  ⚡ Fast LLM:   ${CONFIG.fastProvider}/${CONFIG.fastModel}

  🤖 Supervisor: ${supervisor.identity.emoji} ${supervisor.identity.name}
`);
  }

  // Handle shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\n[Shutdown] Gracefully shutting down...');
    await registry.shutdown();
    await browserManager.shutdown();
    await taskManager.close();
    await userToolManager.close();
    await skillManager.close();
    await closeDb();
    console.log('[Shutdown] Complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
