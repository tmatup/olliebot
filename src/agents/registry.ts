// Agent Registry - manages all active agents and specialist templates

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  BaseAgent,
  AgentCommunication,
  AgentIdentity,
} from './types.js';

// Directory for sub-agent prompts (part of app code)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = __dirname;

/**
 * Specialist agent template - defines identity and capabilities for a specialist type
 */
export interface SpecialistTemplate {
  type: string;
  identity: Omit<AgentIdentity, 'id'>;
  /** Tool access patterns (supports wildcards and !exclusions) */
  canAccessTools: string[];
}

/** Default tool exclusions for all specialists (supervisor-only tools) */
const SUPERVISOR_ONLY_TOOLS = ['!native__delegate', '!native__remember'];

/**
 * Built-in specialist templates
 */
const SPECIALIST_TEMPLATES: SpecialistTemplate[] = [
  {
    type: 'researcher',
    identity: {
      name: 'Research Agent',
      emoji: '🔍',
      role: 'specialist',
      description: 'Specializes in research, information gathering, and analysis',
    },
    // Researcher: web search, scraping, wikipedia, http
    canAccessTools: [
      'native__web-search',
      'native__web-scrape',
      'native__wikipedia-search',
      'native__analyze-image',
      '*__*', // MCP tools
    ],
  },
  {
    type: 'coder',
    identity: {
      name: 'Code Agent',
      emoji: '💻',
      role: 'specialist',
      description: 'Specializes in writing, reviewing, and explaining code',
    },
    // Coder: web for docs
    canAccessTools: [
      'native__web-search',
      'native__web-scrape',
      'native__analyze-image',
      '*__*', // MCP tools (filesystem, etc.)
    ],
  },
  {
    type: 'writer',
    identity: {
      name: 'Writer Agent',
      emoji: '✍️',
      role: 'specialist',
      description: 'Specializes in writing, editing, and content creation',
    },
    // Writer: web research, image creation for illustrations
    canAccessTools: [
      'native__web-search',
      'native__web-scrape',
      'native__wikipedia-search',
      'native__create-image',
      '*__*', // MCP tools
    ],
  },
  {
    type: 'planner',
    identity: {
      name: 'Planner Agent',
      emoji: '📋',
      role: 'specialist',
      description: 'Specializes in planning, organizing, and task breakdown',
    },
    // Planner: research tools for gathering info to plan
    canAccessTools: [
      'native__web-search',
      'native__web-scrape',
      'native__wikipedia-search',
      '*__*', // MCP tools
    ],
  },
];

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private agentsByName: Map<string, string> = new Map(); // name -> id
  private specialists: Map<string, SpecialistTemplate> = new Map();

  constructor() {
    // Register built-in specialist templates
    for (const template of SPECIALIST_TEMPLATES) {
      this.specialists.set(template.type, template);
    }
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.identity.id, agent);
    this.agentsByName.set(agent.identity.name.toLowerCase(), agent.identity.id);

    // Give the agent a reference to the registry
    if ('setRegistry' in agent && typeof agent.setRegistry === 'function') {
      (agent as { setRegistry: (r: AgentRegistry) => void }).setRegistry(this);
    }
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agentsByName.delete(agent.identity.name.toLowerCase());
      this.agents.delete(agentId);
    }
  }

  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  getAgentByName(name: string): BaseAgent | undefined {
    const agentId = this.agentsByName.get(name.toLowerCase());
    return agentId ? this.agents.get(agentId) : undefined;
  }

  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getAgentIdentities(): AgentIdentity[] {
    return this.getAllAgents().map((a) => a.identity);
  }

  // ============================================================================
  // Specialist Templates
  // ============================================================================

  /**
   * Get all available specialist types
   */
  getSpecialistTypes(): string[] {
    return Array.from(this.specialists.keys());
  }

  /**
   * Get all specialist templates
   */
  getSpecialistTemplates(): SpecialistTemplate[] {
    return Array.from(this.specialists.values());
  }

  /**
   * Get a specialist template by type
   */
  getSpecialistTemplate(type: string): SpecialistTemplate | undefined {
    return this.specialists.get(type);
  }

  /**
   * Find specialist type by identity name
   */
  findSpecialistTypeByName(name: string): string | undefined {
    for (const [type, template] of this.specialists) {
      if (template.identity.name === name) {
        return type;
      }
    }
    return undefined;
  }

  /**
   * Load the system prompt for an agent type from its .md file
   */
  loadAgentPrompt(type: string): string {
    const promptPath = join(PROMPTS_DIR, `${type}.md`);
    return readFileSync(promptPath, 'utf-8').trim();
  }

  /**
   * Get tool access patterns for a specialist type
   * Combines the specialist's allowed tools with supervisor-only exclusions
   */
  getToolAccessForSpecialist(type: string): string[] {
    const template = this.specialists.get(type);
    if (template) {
      // Combine specialist's tools with supervisor-only exclusions
      return [...template.canAccessTools, ...SUPERVISOR_ONLY_TOOLS];
    }
    // Default for custom/unknown types: all tools except supervisor-only
    return ['*', ...SUPERVISOR_ONLY_TOOLS];
  }

  // ============================================================================
  // Communication
  // ============================================================================

  async routeCommunication(comm: AgentCommunication, toAgentId: string): Promise<void> {
    const targetAgent = this.agents.get(toAgentId);
    if (!targetAgent) {
      console.error(`[AgentRegistry] Target agent not found: ${toAgentId}`);
      return;
    }

    await targetAgent.receiveFromAgent(comm);
  }

  async broadcastToAll(
    comm: Omit<AgentCommunication, 'toAgent'>,
    excludeAgentId?: string
  ): Promise<void> {
    for (const [agentId, agent] of this.agents) {
      if (agentId !== excludeAgentId && agentId !== comm.fromAgent) {
        await agent.receiveFromAgent({ ...comm, toAgent: agentId });
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.shutdown();
    }
    this.agents.clear();
    this.agentsByName.clear();
  }
}

// Singleton instance
let registryInstance: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registryInstance) {
    registryInstance = new AgentRegistry();
  }
  return registryInstance;
}
