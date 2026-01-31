// Agent Registry - manages all active agents

import type {
  BaseAgent,
  AgentCommunication,
  AgentIdentity,
} from './types.js';

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private agentsByName: Map<string, string> = new Map(); // name -> id

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
