// Multi-agent architecture types

import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';

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
