// Base Agent implementation

import { v4 as uuid } from 'uuid';
import type {
  BaseAgent,
  AgentIdentity,
  AgentState,
  AgentCapabilities,
  AgentConfig,
  AgentCommunication,
  AgentMessage,
} from './types.js';
import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';
import type { ToolRunner, LLMTool } from '../tools/index.js';
import type { MemoryService } from '../memory/service.js';
import type { SkillManager } from '../skills/manager.js';
import type { RagDataManager } from '../rag-projects/data-manager.js';

export abstract class AbstractAgent implements BaseAgent {
  readonly identity: AgentIdentity;
  readonly capabilities: AgentCapabilities;
  readonly config: AgentConfig;

  protected _state: AgentState;
  protected llmService: LLMService;
  protected channels: Map<string, Channel> = new Map();
  protected conversationHistory: Message[] = [];
  protected agentRegistry: AgentRegistry | null = null;
  protected toolRunner: ToolRunner | null = null;
  protected memoryService: MemoryService | null = null;
  protected skillManager: SkillManager | null = null;
  protected ragDataManager: RagDataManager | null = null;
  private ragDataCache: string | null = null;
  private ragDataCacheTime = 0;

  constructor(config: AgentConfig, llmService: LLMService) {
    this.config = config;
    this.identity = config.identity;
    this.capabilities = config.capabilities;
    this.llmService = llmService;

    this._state = {
      status: 'idle',
      lastActivity: new Date(),
      context: {},
    };
  }

  get state(): AgentState {
    return { ...this._state };
  }

  setRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  /**
   * Set the tool runner for this agent
   */
  setToolRunner(runner: ToolRunner): void {
    this.toolRunner = runner;
    console.log(`[${this.identity.name}] Tool runner configured with ${runner.getToolsForLLM().length} tools`);
  }

  /**
   * Set the memory service for this agent
   */
  setMemoryService(service: MemoryService): void {
    this.memoryService = service;
  }

  /**
   * Set the skill manager for this agent
   * Skills are injected into the system prompt per Agent Skills spec
   */
  setSkillManager(manager: SkillManager): void {
    this.skillManager = manager;
    const skillCount = manager.getAllMetadata().length;
    if (skillCount > 0) {
      console.log(`[${this.identity.name}] Skill manager configured with ${skillCount} skills`);
    }
  }

  /**
   * Set the RAG data manager for this agent
   * RAG data is injected into the system prompt if agent has query tool access
   */
  setRagDataManager(manager: RagDataManager): void {
    this.ragDataManager = manager;
  }

  /**
   * Refresh the RAG data cache if the agent has query tool access.
   * Call this before generating responses to ensure fresh data.
   * Cache expires after 60 seconds.
   */
  async refreshRagDataCache(): Promise<void> {
    if (!this.ragDataManager) {
      return;
    }

    // Check if cache is still valid (60 second TTL)
    const now = Date.now();
    if (this.ragDataCache !== null && now - this.ragDataCacheTime < 60000) {
      return;
    }

    // Check if this agent has access to the RAG query tool
    if (!this.ragDataManager.hasQueryToolAccess(this.capabilities.canAccessTools)) {
      this.ragDataCache = null;
      return;
    }

    try {
      this.ragDataCache = await this.ragDataManager.formatForSystemPrompt();
      this.ragDataCacheTime = now;
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to refresh RAG data cache:`, error);
      this.ragDataCache = null;
    }
  }

  /**
   * Get tools available to this agent for LLM calls
   * Applies whitelist/blacklist filtering based on agent capabilities
   *
   * Patterns:
   * - '*' = all tools
   * - 'native__*' = all native tools
   * - 'native__web-search' = specific tool
   * - '!native__delegate' = exclude specific tool (blacklist)
   */
  protected getToolsForLLM(): LLMTool[] {
    if (!this.toolRunner) {
      return [];
    }

    const tools = this.toolRunner.getToolsForLLM();
    const patterns = this.capabilities.canAccessTools;

    // No patterns = no tools
    if (patterns.length === 0) {
      return [];
    }

    // Separate inclusion and exclusion patterns
    const inclusions = patterns.filter(p => !p.startsWith('!'));
    const exclusions = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));

    // Helper to check if a tool matches a pattern
    const matchesPattern = (toolName: string, pattern: string): boolean => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*')) {
        return toolName.startsWith(pattern.slice(0, -1));
      }
      return toolName === pattern || toolName.includes(pattern);
    };

    // Filter tools: must match an inclusion AND not match any exclusion
    return tools.filter((tool) => {
      // Check exclusions first
      if (exclusions.some(pattern => matchesPattern(tool.name, pattern))) {
        return false;
      }
      // Check inclusions
      return inclusions.some(pattern => matchesPattern(tool.name, pattern));
    });
  }

  registerChannel(channel: Channel): void {
    this.channels.set(channel.id, channel);
    console.log(`[${this.identity.name}] Registered channel: ${channel.id}`);
  }

  async init(): Promise<void> {
    console.log(`[${this.identity.name}] Initialized - ${this.identity.description}`);
  }

  async shutdown(): Promise<void> {
    this._state.status = 'completed';
    console.log(`[${this.identity.name}] Shutting down`);
  }

  abstract handleMessage(message: Message): Promise<void>;

  async sendToChannel(
    channel: Channel,
    content: string,
    options?: { markdown?: boolean }
  ): Promise<void> {
    // Create agent-attributed message
    const agentMessage: AgentMessage = {
      id: uuid(),
      channel: channel.id,
      role: 'assistant',
      content,
      agentId: this.identity.id,
      agentName: this.identity.name,
      agentEmoji: this.identity.emoji,
      createdAt: new Date(),
    };

    // Send with agent metadata
    await this.sendAgentMessage(channel, agentMessage, options);

    this._state.lastActivity = new Date();
  }

  protected async sendAgentMessage(
    channel: Channel,
    message: AgentMessage,
    options?: { markdown?: boolean }
  ): Promise<void> {
    // Check if channel supports agent-attributed messages
    const extendedChannel = channel as ExtendedChannel;

    if (typeof extendedChannel.sendAsAgent === 'function') {
      await extendedChannel.sendAsAgent(message.content, {
        ...options,
        agentId: message.agentId,
        agentName: message.agentName,
        agentEmoji: message.agentEmoji,
      });
    } else {
      // Fallback to regular send
      await channel.send(message.content, options);
    }
  }

  async sendError(channel: Channel, error: string, details?: string): Promise<void> {
    await channel.sendError(error, details);
  }

  async receiveFromAgent(comm: AgentCommunication): Promise<void> {
    console.log(
      `[${this.identity.name}] Received ${comm.type} from agent ${comm.fromAgent}`
    );
    await this.handleAgentCommunication(comm);
  }

  protected abstract handleAgentCommunication(comm: AgentCommunication): Promise<void>;

  async sendToAgent(
    toAgentId: string,
    comm: Omit<AgentCommunication, 'fromAgent' | 'timestamp'>
  ): Promise<void> {
    if (!this.agentRegistry) {
      console.error(`[${this.identity.name}] No agent registry available`);
      return;
    }

    const fullComm: AgentCommunication = {
      ...comm,
      fromAgent: this.identity.id,
      timestamp: new Date(),
    };

    await this.agentRegistry.routeCommunication(fullComm, toAgentId);
  }

  getState(): AgentState {
    return { ...this._state };
  }

  updateState(updates: Partial<AgentState>): void {
    this._state = { ...this._state, ...updates, lastActivity: new Date() };
  }

  protected async generateResponse(
    messages: Message[],
    additionalContext?: string
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(additionalContext);

    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const response = await this.llmService.generate(llmMessages);
    return response.content;
  }

  protected buildSystemPrompt(additionalContext?: string): string {
    let prompt = this.config.systemPrompt;

    if (this.config.mission) {
      prompt += `\n\nYour current mission: ${this.config.mission}`;
    }

    if (additionalContext) {
      prompt += `\n\n${additionalContext}`;
    }

    // Inject memory context if available
    if (this.memoryService) {
      const memoryContext = this.memoryService.formatForSystemPrompt();
      if (memoryContext) {
        prompt += memoryContext;
      }
    }

    // Add available tools info if we have a tool runner
    if (this.toolRunner) {
      const tools = this.getToolsForLLM();
      if (tools.length > 0) {
        const toolSummary = this.summarizeTools(tools);
        prompt += `\n\n## Available Tools\n\nYou have access to ${tools.length} tools. USE THEM to complete tasks:\n\n${toolSummary}`;
      }
    }

    // Add skill information per Agent Skills spec (progressive disclosure)
    if (this.skillManager) {
      const skillInstructions = this.skillManager.getSkillUsageInstructions();
      const skillsXml = this.skillManager.getSkillsForSystemPrompt();

      if (skillInstructions && skillsXml) {
        prompt += `\n\n${skillInstructions}\n\n${skillsXml}`;
      }
    }

    // Add RAG knowledge base information (if cached and agent has access)
    if (this.ragDataCache) {
      prompt += `\n\n${this.ragDataCache}`;
    }

    return prompt;
  }

  /**
   * Create a summary of available tools for the system prompt
   */
  private summarizeTools(tools: LLMTool[]): string {
    // Group tools by category
    const categories: Record<string, LLMTool[]> = {
      mcp: [],
      native: [],
    };

    for (const tool of tools) {
      if (tool.name.startsWith('native__')) {
        categories.native.push(tool);
      } else {
        // MCP tools (format: serverId__toolName)
        categories.mcp.push(tool);
      }
    }

    const parts: string[] = [];

    if (categories.mcp.length > 0) {
      const mcpSummary = categories.mcp.slice(0, 10).map(t => `- ${t.name}: ${t.description?.substring(0, 100) || 'No description'}`).join('\n');
      parts.push(`**MCP Tools (${categories.mcp.length} available):**\n${mcpSummary}${categories.mcp.length > 10 ? `\n... and ${categories.mcp.length - 10} more` : ''}`);
    }

    if (categories.native.length > 0) {
      const nativeSummary = categories.native.map(t => `- ${t.name}: ${t.description?.substring(0, 100) || 'No description'}`).join('\n');
      parts.push(`**Native Tools (${categories.native.length} available):**\n${nativeSummary}`);
    }

    return parts.join('\n\n');
  }
}

// Extended channel interface for agent-attributed messages
export interface ExtendedChannel extends Channel {
  sendAsAgent(
    content: string,
    options?: {
      markdown?: boolean;
      agentId?: string;
      agentName?: string;
      agentEmoji?: string;
    }
  ): Promise<void>;
}

// Specialist template type
export interface SpecialistTemplate {
  type: string;
  identity: Omit<AgentIdentity, 'id'>;
  canAccessTools: string[];
}

// Forward declaration - will be implemented in registry.ts
export interface AgentRegistry {
  routeCommunication(comm: AgentCommunication, toAgentId: string): Promise<void>;
  getAgent(agentId: string): BaseAgent | undefined;
  registerAgent(agent: BaseAgent): void;
  unregisterAgent(agentId: string): void;
  // Specialist template methods
  getSpecialistTypes(): string[];
  getSpecialistTemplates(): SpecialistTemplate[];
  getSpecialistTemplate(type: string): SpecialistTemplate | undefined;
  findSpecialistTypeByName(name: string): string | undefined;
  loadAgentPrompt(type: string): string;
  getToolAccessForSpecialist(type: string): string[];
}
