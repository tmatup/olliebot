// Multi-agent architecture types

import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';

// ============================================================
// AGENT DELEGATION CONFIGURATION
// ============================================================

/**
 * Agent delegation configuration.
 * Controls which agents can invoke which other agents.
 */
export interface AgentDelegationConfig {
  /**
   * Whether this agent can delegate to other agents.
   * Default: false (agents cannot delegate by default)
   */
  canDelegate: boolean;

  /**
   * List of agent IDs this agent is allowed to invoke.
   * Only checked if canDelegate is true.
   * Empty array = can delegate to any agent (not recommended).
   */
  allowedDelegates: string[];

  /**
   * Workflow scope restriction.
   * If set, this agent can ONLY be invoked within the specified workflow.
   * null = can be invoked from anywhere (supervisor, other agents).
   */
  restrictedToWorkflow: string | null;

  /**
   * Whether supervisor can directly invoke this agent.
   * Default: true
   * Set to false for agents that should only be used as sub-agents.
   */
  supervisorCanInvoke: boolean;
}

/**
 * Workflow context passed through agent delegation chain.
 */
export interface WorkflowContext {
  workflowId: string;
  workflowInstanceId: string;
  parentAgentId: string;
  depth: number;
}

/**
 * Default delegation config for agents that haven't specified one.
 */
export const DEFAULT_DELEGATION_CONFIG: AgentDelegationConfig = {
  canDelegate: false,
  allowedDelegates: [],
  restrictedToWorkflow: null,
  supervisorCanInvoke: true,
};

export type AgentRole = 'supervisor' | 'worker' | 'specialist';

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'error';

export interface AgentIdentity {
  id: string;
  name: string;
  emoji: string; // Visual identifier in chat
  role: AgentRole;
  description: string;
}

export interface AgentState {
  status: AgentStatus;
  currentTask?: string;
  lastActivity: Date;
  context: Record<string, unknown>;
}

export interface AgentCapabilities {
  canSpawnAgents: boolean;
  canAccessTools: string[];
  canUseChannels: string[];
  maxConcurrentTasks: number;
}

export interface AgentConfig {
  identity: AgentIdentity;
  capabilities: AgentCapabilities;
  systemPrompt: string;
  parentId?: string; // ID of supervisor agent
  mission?: string; // Specific mission for sub-agents
  timeout?: number; // Auto-terminate after ms
}

export interface AgentMessage extends Message {
  agentId: string;
  agentName: string;
  agentEmoji: string;
}

export interface TaskAssignment {
  id: string;
  description: string;
  assignedTo: string; // Agent ID
  assignedBy: string; // Supervisor ID
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface AgentCommunication {
  type: 'task_assignment' | 'task_result' | 'status_update' | 'request_help' | 'terminate';
  fromAgent: string;
  toAgent: string;
  payload: unknown;
  timestamp: Date;
}

export interface BaseAgent {
  readonly identity: AgentIdentity;
  readonly state: AgentState;
  readonly capabilities: AgentCapabilities;
  readonly config: AgentConfig;

  // Lifecycle
  init(): Promise<void>;
  shutdown(): Promise<void>;

  // Communication
  handleMessage(message: Message): Promise<void>;
  sendToChannel(channel: Channel, content: string, options?: { markdown?: boolean }): Promise<void>;
  sendError(channel: Channel, error: string, details?: string): Promise<void>;

  // Inter-agent communication
  receiveFromAgent(comm: AgentCommunication): Promise<void>;
  sendToAgent(toAgentId: string, comm: Omit<AgentCommunication, 'fromAgent' | 'timestamp'>): Promise<void>;

  // State
  getState(): AgentState;
  updateState(updates: Partial<AgentState>): void;
}

export interface SupervisorAgent extends BaseAgent {
  // Sub-agent management
  spawnAgent(config: Partial<AgentConfig>, agentType?: string): Promise<string>;
  terminateAgent(agentId: string): Promise<void>;
  getSubAgents(): string[];

  // Task delegation
  delegateTask(task: string, requirements?: string): Promise<TaskAssignment>;
  getTaskStatus(taskId: string): TaskAssignment | undefined;

  // Channel management
  registerChannel(channel: Channel): void;

  // Conversation management
  setConversationId(conversationId: string | null): void;
  getCurrentConversationId(): string | null;
  startNewConversation(): void;
}
