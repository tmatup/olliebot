import 'dotenv/config';
import { join } from 'path';
import { initDb, closeDb } from './db/index.js';
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
  TakeScreenshotTool,
  AnalyzeImageTool,
  CreateImageTool,
  RememberTool,
  ReadSkillTool,
  RunSkillScriptTool,
} from './tools/index.js';
import { TaskManager } from './tasks/index.js';
import { MemoryService } from './memory/index.js';

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
  configDir: process.env.CONFIG_DIR || join(process.cwd(), 'user', 'agent'),
  skillsDir: process.env.SKILLS_DIR || join(process.cwd(), 'user', 'skills'),

  // LLM Configuration
  // Supported providers: 'anthropic', 'google', 'openai', 'azure_openai'
  mainProvider: process.env.MAIN_PROVIDER || 'anthropic',
  mainModel: process.env.MAIN_MODEL || 'claude-sonnet-4-20250514',
  fastProvider: process.env.FAST_PROVIDER || 'google',
  fastModel: process.env.FAST_MODEL || 'gemini-2.5-flash-lite',

  // API Keys
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Azure OpenAI Configuration
  azureOpenaiApiKey: process.env.AZURE_OPENAI_API_KEY || '',
  azureOpenaiEndpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
  azureOpenaiApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',

  // Embedding provider: 'google', 'openai', 'azure_openai'
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'google',

  // MCP Configuration (JSON string of server configs)
  mcpServers: process.env.MCP_SERVERS || '[]',

  // Native tool API keys
  imageGenProvider: (process.env.IMAGE_GEN_PROVIDER || 'openai') as 'openai' | 'stability',
  stabilityApiKey: process.env.STABILITY_API_KEY || '',
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
  toolRunner.registerNativeTool(new WebSearchTool());

  toolRunner.registerNativeTool(new TakeScreenshotTool());
  toolRunner.registerNativeTool(new AnalyzeImageTool(llmService));

  // Image generation (requires API key)
  const imageApiKey = CONFIG.imageGenProvider === 'openai'
    ? CONFIG.openaiApiKey
    : CONFIG.stabilityApiKey;
  if (imageApiKey) {
    toolRunner.registerNativeTool(
      new CreateImageTool({
        apiKey: imageApiKey,
        provider: CONFIG.imageGenProvider,
      })
    );
  }

  // Memory tool (always available)
  toolRunner.registerNativeTool(new RememberTool(memoryService));

  // Skill tools (for Agent Skills spec)
  toolRunner.registerNativeTool(new ReadSkillTool(CONFIG.skillsDir));
  toolRunner.registerNativeTool(new RunSkillScriptTool(CONFIG.skillsDir));

  console.log(`[Init] Tool runner initialized with ${toolRunner.getToolsForLLM().length} tools`);

  // Initialize Task Manager (watches user/agent for .md task configs)
  console.log('[Init] Initializing task manager...');
  const taskManager = new TaskManager({
    configDir: CONFIG.configDir,
    llmService,
  });
  await taskManager.init();

  // Create supervisor agent (multi-agent architecture)
  console.log('[Init] Creating supervisor agent...');
  const supervisor = new SupervisorAgentImpl(llmService);

  // Set tool runner, memory service, and skill manager on supervisor
  supervisor.setToolRunner(toolRunner);
  supervisor.setMemoryService(memoryService);
  supervisor.setSkillManager(skillManager);

  // Register with global agent registry
  const registry = getAgentRegistry();
  registry.registerAgent(supervisor);

  // Initialize supervisor
  await supervisor.init();

  // Determine mode based on command line args
  const mode = process.argv[2] || 'server';

  if (mode === 'console') {
    // Console mode - CLI interface
    console.log('[Init] Starting in console mode...');
    const consoleChannel = new ConsoleChannel();
    await consoleChannel.init();
    supervisor.registerChannel(consoleChannel);
  } else {
    // Server mode - HTTP + WebSocket
    console.log('[Init] Starting in server mode...');
    const server = new OllieBotServer({
      port: CONFIG.port,
      supervisor,
      mcpClient,
      skillManager,
    });
    await server.start();

    console.log(`
✅ OllieBot ready! (Multi-Agent Architecture)

  🌐 Web UI:     http://localhost:${CONFIG.port}
  📡 WebSocket:  ws://localhost:${CONFIG.port}
  📚 API:        http://localhost:${CONFIG.port}/api

  📁 Config:     ${CONFIG.configDir}
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
    await taskManager.close();
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
