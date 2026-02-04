// Agent Registry - manages all active agents and specialist templates

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  BaseAgent,
  AgentCommunication,
  AgentIdentity,
  AgentDelegationConfig,
} from './types.js';
import { DEFAULT_DELEGATION_CONFIG } from './types.js';

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
  /** Delegation configuration for this agent type */
  delegation?: AgentDelegationConfig;
  /** Whether the agent's response should be collapsed by default in the UI */
  collapseResponseByDefault?: boolean;
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
      'native__web_search',
      'native__web_scrape',
      'native__wikipedia_search',
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
      'native__web_search',
      'native__web_scrape',
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
      'native__web_search',
      'native__web_scrape',
      'native__wikipedia_search',
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
      'native__web_search',
      'native__web_scrape',
      'native__wikipedia_search',
      '*__*', // MCP tools
    ],
  },
  // ============================================================================
  // DEEP RESEARCH AGENTS
  // ============================================================================
  {
    type: 'deep-research-lead',
    identity: {
      name: 'Deep Research Lead',
      emoji: '🔬',
      role: 'specialist',
      description: 'Orchestrates comprehensive multi-source research tasks',
    },
    canAccessTools: [
      'native__web_search',
      'native__web_scrape',
      'native__wikipedia_search',
      'native__delegate', // Can delegate to research-worker
      '*__*', // MCP tools
      // Note: delegate is explicitly included above (overrides SUPERVISOR_ONLY_TOOLS exclusion)
    ],
    delegation: {
      canDelegate: true,
      allowedDelegates: ['research-worker'], // research-reviewer removed for now - needs workflow redesign
      restrictedToWorkflow: null,
      supervisorCanInvoke: true,
    },
  },
  {
    type: 'research-worker',
    identity: {
      name: 'Research Worker',
      emoji: '📚',
      role: 'specialist',
      description: 'Deep exploration of specific research subtopics',
    },
    canAccessTools: [
      'native__web_search',
      'native__web_scrape',
      'native__wikipedia_search',
      '*__*', // MCP tools
    ],
    delegation: {
      canDelegate: false,
      allowedDelegates: [],
      restrictedToWorkflow: 'deep-research',
      supervisorCanInvoke: false, // Only invocable by deep-research-lead
    },
    collapseResponseByDefault: true, // Collapse worker responses in UI
  },
  {
    type: 'research-reviewer',
    identity: {
      name: 'Research Reviewer',
      emoji: '📝',
      role: 'specialist',
      description: 'Critical review of research reports for quality assurance',
    },
    canAccessTools: [
      // Reviewer doesn't need search - just reviews drafts
      'native__web_scrape', // Can verify sources
    ],
    delegation: {
      canDelegate: false,
      allowedDelegates: [],
      restrictedToWorkflow: 'deep-research',
      supervisorCanInvoke: false, // Only invocable by deep-research-lead
    },
    collapseResponseByDefault: true, // Collapse reviewer responses in UI
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
   * (but doesn't exclude tools that are explicitly included in the template)
   */
  getToolAccessForSpecialist(type: string): string[] {
    const template = this.specialists.get(type);
    if (template) {
      // Get explicit tool includes from template (without ! prefix)
      const explicitIncludes = new Set(
        template.canAccessTools
          .filter(t => !t.startsWith('!'))
          .map(t => t.replace('native__', ''))
      );

      // Filter out exclusions for tools that are explicitly included
      const filteredExclusions = SUPERVISOR_ONLY_TOOLS.filter(exclusion => {
        if (exclusion.startsWith('!')) {
          const toolName = exclusion.slice(1).replace('native__', '');
          // Don't add exclusion if the tool is explicitly included
          return !explicitIncludes.has(toolName);
        }
        return true;
      });

      // Combine specialist's tools with filtered exclusions
      return [...template.canAccessTools, ...filteredExclusions];
    }
    // Default for custom/unknown types: all tools except supervisor-only
    return ['*', ...SUPERVISOR_ONLY_TOOLS];
  }

  /**
   * Get delegation configuration for a specialist type
   */
  getDelegationConfigForSpecialist(type: string): AgentDelegationConfig {
    const template = this.specialists.get(type);
    return template?.delegation || DEFAULT_DELEGATION_CONFIG;
  }

  /**
   * Check if an agent can delegate to another agent
   * @throws Error if delegation is not allowed
   */
  canDelegate(
    sourceAgentType: string,
    targetAgentType: string,
    currentWorkflowId: string | null
  ): boolean {
    const sourceConfig = this.getDelegationConfigForSpecialist(sourceAgentType);
    const targetConfig = this.getDelegationConfigForSpecialist(targetAgentType);

    // Check if source can delegate at all
    if (!sourceConfig.canDelegate) {
      throw new Error(`Agent type '${sourceAgentType}' cannot delegate to other agents`);
    }

    // Check if source is allowed to delegate to target
    if (
      sourceConfig.allowedDelegates.length > 0 &&
      !sourceConfig.allowedDelegates.includes(targetAgentType)
    ) {
      throw new Error(
        `Agent type '${sourceAgentType}' is not allowed to delegate to '${targetAgentType}'`
      );
    }

    // Check if target has workflow restrictions
    if (targetConfig.restrictedToWorkflow) {
      if (currentWorkflowId !== targetConfig.restrictedToWorkflow) {
        throw new Error(
          `Agent type '${targetAgentType}' can only be invoked within ` +
          `'${targetConfig.restrictedToWorkflow}' workflow, ` +
          `current workflow: '${currentWorkflowId || 'none'}'`
        );
      }
    }

    return true;
  }

  /**
   * Check if supervisor can invoke an agent type directly
   */
  canSupervisorInvoke(agentType: string): boolean {
    const config = this.getDelegationConfigForSpecialist(agentType);
    return config.supervisorCanInvoke;
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
