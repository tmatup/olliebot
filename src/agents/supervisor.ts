// Supervisor Agent - orchestrates sub-agents

import { v4 as uuid } from 'uuid';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { AbstractAgent, type AgentRegistry } from './base-agent.js';
import type {
  SupervisorAgent as ISupervisorAgent,
  AgentConfig,
  AgentCommunication,
  TaskAssignment,
  AgentIdentity,
} from './types.js';
import { WorkerAgent } from './worker.js';
import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';
import type { LLMMessage, LLMToolUse } from '../llm/types.js';
import { getDb } from '../db/index.js';
import type { WebChannel } from '../channels/web.js';

/**
 * Strip large binary data (like base64 images) from tool results before sending to LLM.
 * The LLM can't meaningfully process binary data, and it wastes context tokens.
 */
function stripBinaryDataForLLM(output: unknown): unknown {
  if (output === null || output === undefined) {
    return output;
  }

  if (typeof output === 'string') {
    // Check if the entire string is a data URL
    if (output.startsWith('data:image/')) {
      const sizeKB = Math.round(output.length / 1024);
      return `[Image data: ${sizeKB}KB - displayed to user]`;
    }
    return output;
  }

  if (Array.isArray(output)) {
    return output.map(item => stripBinaryDataForLLM(item));
  }

  if (typeof output === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
      if (key === 'dataUrl' && typeof value === 'string' && value.startsWith('data:')) {
        // Replace dataUrl with a placeholder indicating it was shown to the user
        const sizeKB = Math.round(value.length / 1024);
        cleaned[key] = `[Image data: ${sizeKB}KB - displayed to user]`;
      } else {
        cleaned[key] = stripBinaryDataForLLM(value);
      }
    }
    return cleaned;
  }

  return output;
}

// Directory for external agent prompts (user can override defaults)
const PROMPTS_DIR = join(process.cwd(), 'user', 'agent', 'prompts');

// Default prompts (used if no external file exists)
const DEFAULT_PROMPTS: Record<string, string> = {
  researcher: `You are a Research Agent. Your role is to:
- Gather and analyze information
- Provide well-researched answers
- Cite sources when possible
- Break down complex topics into understandable parts

Be thorough but concise. Focus on accuracy and relevance.`,
  coder: `You are a Code Agent. Your role is to:
- Write clean, efficient code
- Explain code concepts clearly
- Debug and troubleshoot issues
- Suggest best practices and improvements

Always consider security, performance, and maintainability.`,
  writer: `You are a Writer Agent. Your role is to:
- Create clear, engaging content
- Edit and improve text
- Adapt tone and style as needed
- Structure information effectively

Focus on clarity, readability, and audience appropriateness.`,
  planner: `You are a Planner Agent. Your role is to:
- Break down complex tasks into steps
- Create actionable plans
- Identify dependencies and priorities
- Estimate effort and track progress

Be systematic and thorough in planning.`,
  custom: `You are a helpful assistant agent. Adapt your approach based on the mission assigned to you.`,
};

/**
 * Load agent prompt from external file, or fall back to default
 */
function loadAgentPrompt(agentType: string): string {
  const promptPath = join(PROMPTS_DIR, `${agentType}.md`);

  try {
    if (existsSync(promptPath)) {
      const content = readFileSync(promptPath, 'utf-8').trim();
      if (content.length > 0) {
        return content;
      }
    }
  } catch (error) {
    // Fall through to default
  }

  return DEFAULT_PROMPTS[agentType] || DEFAULT_PROMPTS.custom;
}

// Specialist agent identity templates (prompts loaded from external files)
const SPECIALIST_IDENTITIES: Record<string, { identity: AgentIdentity }> = {
  researcher: {
    identity: {
      id: '',
      name: 'Research Agent',
      emoji: '🔍',
      role: 'specialist',
      description: 'Specializes in research, information gathering, and analysis',
    },
  },
  coder: {
    identity: {
      id: '',
      name: 'Code Agent',
      emoji: '💻',
      role: 'specialist',
      description: 'Specializes in writing, reviewing, and explaining code',
    },
  },
  writer: {
    identity: {
      id: '',
      name: 'Writer Agent',
      emoji: '✍️',
      role: 'specialist',
      description: 'Specializes in writing, editing, and content creation',
    },
  },
  planner: {
    identity: {
      id: '',
      name: 'Planner Agent',
      emoji: '📋',
      role: 'specialist',
      description: 'Specializes in planning, organizing, and task breakdown',
    },
  },
};

export class SupervisorAgentImpl extends AbstractAgent implements ISupervisorAgent {
  private subAgents: Map<string, WorkerAgent> = new Map();
  private tasks: Map<string, TaskAssignment> = new Map();
  private messageChannelMap: Map<string, string> = new Map(); // messageId -> channelId
  private currentConversationId: string | null = null;
  private conversationMessageCount: Map<string, number> = new Map(); // Track message counts for auto-naming

  constructor(llmService: LLMService) {
    const config: AgentConfig = {
      identity: {
        id: 'supervisor-main',
        name: 'OllieBot',
        emoji: '🤖',
        role: 'supervisor',
        description: 'Main supervisor agent that orchestrates tasks and delegates to specialists',
      },
      capabilities: {
        canSpawnAgents: true,
        canAccessTools: ['*'],
        canUseChannels: ['*'],
        maxConcurrentTasks: 10,
      },
      systemPrompt: `You are OllieBot, a supervisor agent that orchestrates a team of specialized agents.

Your capabilities:
- Directly answer simple questions yourself
- Delegate complex or specialized tasks to sub-agents
- Coordinate multiple agents working on related tasks
- Synthesize results from multiple agents

Available specialist types you can spawn:
- researcher: For research, information gathering, fact-finding, learning about topics, exploring subjects. Use when the task requires gathering knowledge or understanding a topic (e.g., "tell me about X", "what are the best Y", "fun things to do in Z").
- coder: For programming, writing code, debugging, technical implementation. Use when the task explicitly requires writing software code.
- writer: For writing documents, editing text, creative writing, content creation. Use when the task requires producing written content like articles, emails, or stories.
- planner: For planning, organizing, breaking down complex projects. Use when the task requires creating a structured plan or timeline.

When you decide to delegate, respond with a JSON block:
\`\`\`delegate
{
  "type": "researcher|coder|writer|planner|custom",
  "rationale": "Brief explanation of why this agent type was chosen",
  "mission": "specific task description",
  "customName": "optional custom agent name",
  "customEmoji": "optional emoji"
}
\`\`\`

IMPORTANT: Choose the agent based on the PRIMARY nature of the task:
- If the task is about LEARNING or FINDING INFORMATION about a topic → researcher
- If the task is about WRITING CODE → coder
- If the task is about CREATING WRITTEN CONTENT → writer
- Creating a presentation about a topic is primarily a RESEARCH + WRITING task, NOT a coding task

For simple questions, just respond directly. Only delegate when specialized expertise or parallel work would be beneficial.

## Memory
You have access to a 'remember' tool for saving important information to long-term memory.
BE VERY SELECTIVE - only use it for critical information that will be valuable in future conversations:
- User preferences (name, communication style, timezone)
- Important project decisions or context
- Key facts the user explicitly wants remembered
DO NOT remember: temporary info, things easily re-asked, conversation details, or trivial facts.
Every memory adds to context window consumption for ALL future calls.`,
    };

    super(config, llmService);
  }

  async init(): Promise<void> {
    await super.init();
    console.log(`[${this.identity.name}] Supervisor initialized with ${Object.keys(SPECIALIST_IDENTITIES).length} specialist types`);
  }

  registerChannel(channel: Channel): void {
    super.registerChannel(channel);

    // Set up message handler for this channel
    channel.onMessage(async (message) => {
      await this.handleMessage(message);
    });

    channel.onAction(async (action, data) => {
      console.log(`[${this.identity.name}] Action: ${action}`, data);
    });

    // Handle new conversation request if channel supports it
    if ('onNewConversation' in channel && typeof channel.onNewConversation === 'function') {
      (channel as { onNewConversation: (handler: () => void) => void }).onNewConversation(() => {
        this.startNewConversation();
        console.log(`[${this.identity.name}] Started new conversation`);
      });
    }
  }

  async handleMessage(message: Message): Promise<void> {
    this._state.lastActivity = new Date();
    this._state.status = 'working';

    // If message includes a conversationId, set it on the supervisor
    const msgConversationId = message.metadata?.conversationId as string | undefined;
    if (msgConversationId) {
      this.setConversationId(msgConversationId);
    }

    // Store channel mapping for response routing
    this.messageChannelMap.set(message.id, message.channel);

    // Save message to history
    this.conversationHistory.push(message);
    this.saveMessage(message);

    const channel = this.channels.get(message.channel);
    if (!channel) {
      console.error(`[${this.identity.name}] Channel not found: ${message.channel}`);
      return;
    }

    try {
      // Check if channel supports streaming
      const supportsStreaming = typeof channel.startStream === 'function' && this.llmService.supportsStreaming();

      if (supportsStreaming) {
        await this.generateStreamingResponse(message, channel);
      } else {
        // Fallback to non-streaming
        const response = await this.generateResponse(this.conversationHistory.slice(-10));
        const delegationMatch = response.match(/```delegate\s*([\s\S]*?)```/);

        if (delegationMatch) {
          await this.handleDelegation(delegationMatch[1], message, channel);
        } else {
          await this.sendToChannel(channel, response, { markdown: true });
          this.saveAssistantMessage(message.channel, response);
        }
      }
    } catch (error) {
      console.error(`[${this.identity.name}] Error:`, error);
      await this.sendError(channel, 'Failed to process message', String(error));
    }

    this._state.status = 'idle';
  }

  private async generateStreamingResponse(message: Message, channel: Channel): Promise<void> {
    const streamId = uuid();
    let fullResponse = '';

    // Setup tool event broadcasting if tool runner is available
    let unsubscribeTool: (() => void) | undefined;
    if (this.toolRunner) {
      unsubscribeTool = this.toolRunner.onToolEvent((event) => {
        // Broadcast tool events to connected clients
        const webChannel = channel as WebChannel;
        if (typeof webChannel.broadcast === 'function') {
          // Safely stringify result for broadcast (may be large)
          let resultForBroadcast: string | undefined;
          if ('result' in event && event.result !== undefined) {
            try {
              const fullResult = JSON.stringify(event.result);
              // Don't truncate image data URLs (they need full base64 content)
              const hasImageData = fullResult.includes('data:image/');
              const limit = hasImageData ? 5000000 : 10000; // 5MB for images, 10KB for others
              resultForBroadcast = fullResult.length > limit ? fullResult.substring(0, limit) + '...(truncated)' : fullResult;
            } catch {
              resultForBroadcast = String(event.result);
            }
          }

          webChannel.broadcast({
            ...event,
            result: resultForBroadcast,
            timestamp: event.timestamp.toISOString(),
            startTime: 'startTime' in event ? event.startTime.toISOString() : undefined,
            endTime: 'endTime' in event ? event.endTime.toISOString() : undefined,
          });
        }

        // Persist tool events to database
        this.saveToolEvent(event, message.channel);
      });
    }

    try {
      // Start stream with agent info
      channel.startStream!(streamId, {
        agentId: this.identity.id,
        agentName: this.identity.name,
        agentEmoji: this.identity.emoji,
      });

      const systemPrompt = this.buildSystemPrompt();
      const tools = this.getToolsForLLM();

      // Build initial messages
      let llmMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      // Tool execution loop - continues until LLM stops requesting tools
      let continueLoop = true;
      let iterationCount = 0;
      const maxIterations = 10; // Prevent infinite loops

      while (continueLoop && iterationCount < maxIterations) {
        iterationCount++;

        if (tools.length > 0 && this.toolRunner) {
          // Use tool-enabled generation
          const response = await this.llmService.generateWithTools(llmMessages, { tools });

          // Add any text content to the stream
          if (response.content) {
            fullResponse += response.content;
            // Filter out delegation blocks from streamed output (user shouldn't see internal JSON)
            const displayContent = response.content.replace(/```delegate\s*[\s\S]*?```/g, '').trim();
            if (displayContent) {
              channel.sendStreamChunk!(streamId, displayContent);
            }
          }

          // Check if LLM requested tool use
          if (response.toolUse && response.toolUse.length > 0) {
            // Execute requested tools
            const toolRequests = response.toolUse.map((tu) =>
              this.toolRunner!.createRequest(tu.id, tu.name, tu.input)
            );

            const results = await this.toolRunner.executeTools(toolRequests);

            // Add assistant message with tool use to conversation
            llmMessages.push({
              role: 'assistant',
              content: response.content || '',
              toolUse: response.toolUse,
            });

            // Add tool results as user messages
            for (const result of results) {
              llmMessages.push({
                role: 'user',
                content: JSON.stringify({
                  type: 'tool_result',
                  tool_use_id: result.requestId,
                  content: result.success ? stripBinaryDataForLLM(result.output) : `Error: ${result.error}`,
                  is_error: !result.success,
                }),
              });
            }

            // Continue loop to let LLM process tool results
          } else {
            // No more tool use - we're done
            continueLoop = false;
          }
        } else {
          // No tools available, use regular streaming
          // Buffer to filter out delegation blocks which shouldn't be shown to users
          let streamBuffer = '';
          await this.llmService.generateStream(
            llmMessages,
            {
              onChunk: (chunk) => {
                fullResponse += chunk;
                streamBuffer += chunk;

                // Check if we're in the middle of a potential delegation block
                const hasPartialDelegate = streamBuffer.includes('```delegate') && !streamBuffer.includes('```delegate') ||
                  (streamBuffer.includes('```d') && !streamBuffer.includes('```delegate'));

                // If not potentially in a delegation block, send buffered content (minus any trailing partial markers)
                if (!hasPartialDelegate && !streamBuffer.includes('```delegate')) {
                  // Remove any delegation blocks that are complete
                  const displayContent = streamBuffer.replace(/```delegate\s*[\s\S]*?```/g, '').trim();
                  if (displayContent) {
                    channel.sendStreamChunk!(streamId, displayContent);
                  }
                  streamBuffer = '';
                }
              },
              onComplete: () => {
                // Send any remaining buffered content (filtered)
                if (streamBuffer) {
                  const displayContent = streamBuffer.replace(/```delegate\s*[\s\S]*?```/g, '').trim();
                  if (displayContent) {
                    channel.sendStreamChunk!(streamId, displayContent);
                  }
                }
              },
              onError: (error) => {
                throw error;
              },
            }
          );
          continueLoop = false;
        }
      }

      channel.endStream!(streamId);

      // Check for delegation in complete response
      const delegationMatch = fullResponse.match(/```delegate\s*([\s\S]*?)```/);
      if (delegationMatch) {
        // Remove the delegation block from saved response (it's not useful for conversation history)
        const cleanedResponse = fullResponse.replace(/```delegate\s*[\s\S]*?```/, '').trim();
        if (cleanedResponse) {
          this.saveAssistantMessage(message.channel, cleanedResponse);
        }
        await this.handleDelegation(delegationMatch[1], message, channel);
      } else {
        this.saveAssistantMessage(message.channel, fullResponse);
      }
    } catch (error) {
      channel.endStream!(streamId);
      await this.sendError(channel, 'Streaming error', error instanceof Error ? error.message : String(error));
    } finally {
      // Cleanup tool event subscription
      if (unsubscribeTool) {
        unsubscribeTool();
      }
    }
  }

  private async handleDelegation(
    delegationJson: string,
    originalMessage: Message,
    channel: Channel
  ): Promise<void> {
    try {
      const delegation = JSON.parse(delegationJson.trim());
      const { type, mission, customName, customEmoji, rationale } = delegation;

      // Log agent selection rationale
      console.log(`[${this.identity.name}] Agent Selection:`);
      console.log(`  Type: ${type}`);
      console.log(`  Rationale: ${rationale || 'Not provided'}`);
      console.log(`  Mission: ${mission}`);

      // Spawn appropriate agent
      const agentId = await this.spawnAgent({
        identity: this.createAgentIdentity(type, customName, customEmoji),
        mission,
      });

      const agent = this.subAgents.get(agentId);
      if (!agent) {
        throw new Error('Failed to spawn agent');
      }

      // Pass the current conversationId to the worker agent
      if (this.currentConversationId) {
        agent.conversationId = this.currentConversationId;
      } else {
        // Ensure we have a conversation before delegating
        const convId = this.ensureConversation(originalMessage.channel, originalMessage.content);
        agent.conversationId = convId;
      }

      // Emit delegation event for compact UI display
      const webChannel = channel as WebChannel;
      if (typeof webChannel.broadcast === 'function') {
        webChannel.broadcast({
          type: 'delegation',
          agentId: agent.identity.id,
          agentName: agent.identity.name,
          agentEmoji: agent.identity.emoji,
          agentType: type,
          mission,
          rationale,
          timestamp: new Date().toISOString(),
        });
      }

      // Create task assignment
      const task = await this.delegateTask(mission);

      // Have the sub-agent handle the message
      agent.registerChannel(channel);
      await agent.handleDelegatedTask(originalMessage, mission, channel);

    } catch (error) {
      console.error(`[${this.identity.name}] Delegation failed:`, error);
      // Fall back to handling directly
      const fallbackResponse = await this.generateResponse([
        ...this.conversationHistory.slice(-10),
        {
          id: uuid(),
          channel: originalMessage.channel,
          role: 'system',
          content: 'Delegation failed. Please respond directly to the user.',
          createdAt: new Date(),
        },
      ]);
      await this.sendToChannel(channel, fallbackResponse, { markdown: true });
    }
  }

  private createAgentIdentity(
    type: string,
    customName?: string,
    customEmoji?: string
  ): AgentIdentity {
    const template = SPECIALIST_IDENTITIES[type];

    if (template?.identity) {
      return {
        ...template.identity,
        id: `${type}-${uuid().slice(0, 8)}`,
        name: customName || template.identity.name,
        emoji: customEmoji || template.identity.emoji,
      };
    }

    // Custom agent
    return {
      id: `custom-${uuid().slice(0, 8)}`,
      name: customName || 'Assistant',
      emoji: customEmoji || '🔧',
      role: 'worker',
      description: 'Custom worker agent',
    };
  }

  async spawnAgent(partialConfig: Partial<AgentConfig>): Promise<string> {
    const type = partialConfig.identity?.role === 'specialist'
      ? Object.keys(SPECIALIST_IDENTITIES).find(
          (k) => SPECIALIST_IDENTITIES[k].identity?.name === partialConfig.identity?.name
        ) || 'custom'
      : 'custom';

    // Load prompt from external file (with fallback to default)
    const systemPrompt = loadAgentPrompt(type);

    const config: AgentConfig = {
      identity: partialConfig.identity || {
        id: `worker-${uuid().slice(0, 8)}`,
        name: 'Worker',
        emoji: '⚙️',
        role: 'worker',
        description: 'General worker agent',
      },
      capabilities: {
        canSpawnAgents: false,
        canAccessTools: [],
        canUseChannels: ['*'],
        maxConcurrentTasks: 1,
      },
      systemPrompt,
      parentId: this.identity.id,
      mission: partialConfig.mission,
      ...partialConfig,
    };

    const agent = new WorkerAgent(config, this.llmService);
    agent.setRegistry(this.agentRegistry!);

    // Pass the tool runner to worker agents so they can use MCP, skills, and native tools
    if (this.toolRunner) {
      agent.setToolRunner(this.toolRunner);
    }

    await agent.init();
    this.subAgents.set(agent.identity.id, agent);
    this.agentRegistry?.registerAgent(agent);

    console.log(`[${this.identity.name}] Spawned ${agent.identity.emoji} ${agent.identity.name}`);

    return agent.identity.id;
  }

  async terminateAgent(agentId: string): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      await agent.shutdown();
      this.subAgents.delete(agentId);
      this.agentRegistry?.unregisterAgent(agentId);
      console.log(`[${this.identity.name}] Terminated agent: ${agentId}`);
    }
  }

  getSubAgents(): string[] {
    return Array.from(this.subAgents.keys());
  }

  async delegateTask(task: string, requirements?: string): Promise<TaskAssignment> {
    const assignment: TaskAssignment = {
      id: uuid(),
      description: task,
      assignedTo: '', // Will be set when agent picks it up
      assignedBy: this.identity.id,
      status: 'pending',
      createdAt: new Date(),
    };

    this.tasks.set(assignment.id, assignment);
    return assignment;
  }

  getTaskStatus(taskId: string): TaskAssignment | undefined {
    return this.tasks.get(taskId);
  }

  protected async handleAgentCommunication(comm: AgentCommunication): Promise<void> {
    switch (comm.type) {
      case 'task_result': {
        const payload = comm.payload as { taskId: string; result: string };
        const task = this.tasks.get(payload.taskId);
        if (task) {
          task.status = 'completed';
          task.result = payload.result;
          task.completedAt = new Date();
        }
        break;
      }
      case 'request_help': {
        // Sub-agent requesting help
        const payload = comm.payload as { question: string; channelId: string };
        const channel = this.channels.get(payload.channelId);
        if (channel) {
          await this.sendToChannel(
            channel,
            `📢 Agent ${comm.fromAgent} needs assistance: ${payload.question}`,
            { markdown: true }
          );
        }
        break;
      }
      case 'status_update': {
        // Just log for now
        console.log(`[${this.identity.name}] Status from ${comm.fromAgent}:`, comm.payload);
        break;
      }
    }
  }

  private ensureConversation(channel: string, firstMessageContent?: string): string {
    const db = getDb();

    // If we have a current conversation, update its timestamp and return it
    if (this.currentConversationId) {
      db.conversations.update(this.currentConversationId, { updatedAt: new Date().toISOString() });
      return this.currentConversationId;
    }

    // Check for recent conversation (within last hour)
    const recentConversation = db.conversations.findRecent(channel, 60 * 60 * 1000);

    if (recentConversation) {
      this.currentConversationId = recentConversation.id;
      db.conversations.update(this.currentConversationId, { updatedAt: new Date().toISOString() });
      return this.currentConversationId;
    }

    // Create a new conversation
    const id = uuid();
    const now = new Date().toISOString();
    // Generate title from first message (truncate to 50 chars)
    const title = firstMessageContent
      ? firstMessageContent.substring(0, 50) + (firstMessageContent.length > 50 ? '...' : '')
      : 'New Conversation';

    db.conversations.create({
      id,
      title,
      channel,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    this.currentConversationId = id;

    // Notify frontend about the new conversation
    const webChannel = this.channels.get(channel) as WebChannel | undefined;
    if (webChannel && typeof webChannel.broadcast === 'function') {
      webChannel.broadcast({
        type: 'conversation_created',
        conversation: {
          id,
          title,
          channel,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return id;
  }

  // Start a new conversation (called when user clicks "New Chat")
  startNewConversation(): void {
    this.currentConversationId = null;
    this.conversationHistory = [];
  }

  // Set the current conversation ID (used when running tasks in a specific conversation)
  setConversationId(conversationId: string | null): void {
    this.currentConversationId = conversationId;
    if (conversationId) {
      // Reset message count for this conversation if we haven't tracked it
      if (!this.conversationMessageCount.has(conversationId)) {
        // Get current message count from database
        const db = getDb();
        const messages = db.messages.findByConversationId(conversationId);
        this.conversationMessageCount.set(conversationId, messages.length);
      }
    }
  }

  private saveMessage(message: Message): void {
    try {
      const db = getDb();
      const conversationId = this.ensureConversation(message.channel, message.role === 'user' ? message.content : undefined);

      db.messages.create({
        id: message.id,
        conversationId,
        channel: message.channel,
        role: message.role,
        content: message.content,
        metadata: message.metadata || {},
        createdAt: message.createdAt.toISOString(),
      });

      // Track message count for auto-naming
      this.incrementMessageCount(conversationId, message.channel);
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to save message:`, error);
    }
  }

  private saveAssistantMessage(channelId: string, content: string): void {
    const message: Message = {
      id: uuid(),
      channel: channelId,
      role: 'assistant',
      content,
      metadata: { agentId: this.identity.id, agentName: this.identity.name },
      createdAt: new Date(),
    };
    this.conversationHistory.push(message);
    this.saveMessage(message);
  }

  /**
   * Auto-generate a conversation title based on the first few messages
   */
  private async autoNameConversation(conversationId: string, channelId: string): Promise<void> {
    try {
      const db = getDb();
      const messages = db.messages.findByConversationId(conversationId, { limit: 5 });

      if (messages.length < 3) return;

      // Build context from messages
      const context = messages
        .map((m) => `${m.role}: ${m.content.substring(0, 200)}`)
        .join('\n');

      // Use fast LLM to generate a title
      const response = await this.llmService.quickGenerate(
        [
          {
            role: 'user',
            content: `Generate a short, descriptive title (3-6 words max) for a conversation that starts like this:\n\n${context}\n\nRespond with ONLY the title, no quotes or punctuation.`,
          },
        ],
        { maxTokens: 20 }
      );

      const title = response.content.trim().substring(0, 60);

      if (title) {
        const now = new Date().toISOString();
        db.conversations.update(conversationId, { title, updatedAt: now });

        // Notify frontend about the updated title
        const webChannel = this.channels.get(channelId) as WebChannel | undefined;
        if (webChannel && typeof webChannel.broadcast === 'function') {
          webChannel.broadcast({
            type: 'conversation_updated',
            conversation: {
              id: conversationId,
              title,
              updatedAt: now,
            },
          });
        }

        console.log(`[${this.identity.name}] Auto-named conversation: "${title}"`);
      }
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to auto-name conversation:`, error);
    }
  }

  private incrementMessageCount(conversationId: string, channelId: string): void {
    const count = (this.conversationMessageCount.get(conversationId) || 0) + 1;
    this.conversationMessageCount.set(conversationId, count);

    // Auto-name after exactly 3 messages
    if (count === 3) {
      // Run async without blocking
      this.autoNameConversation(conversationId, channelId).catch((err) => {
        console.error(`[${this.identity.name}] Auto-naming error:`, err);
      });
    }
  }

  /**
   * Save tool events to database for persistence
   */
  private saveToolEvent(event: { type: string; requestId: string; toolName: string; source: string; [key: string]: unknown }, channelId: string): void {
    // Only save completed events (to avoid duplicates - requested + finished)
    if (event.type !== 'tool_execution_finished') {
      return;
    }

    try {
      const db = getDb();
      const conversationId = this.currentConversationId || this.ensureConversation(channelId);

      const messageId = `tool-${event.requestId}`;

      // Check if this tool event was already saved (avoid duplicates on re-runs)
      const existing = db.messages.findById(messageId);
      if (existing) {
        return;
      }

      // Safely stringify result (may be large, so truncate if needed)
      let resultStr: string | undefined;
      if (event.result !== undefined) {
        try {
          const fullResult = JSON.stringify(event.result);
          // Don't truncate image data URLs (they need full base64 content)
          const hasImageData = fullResult.includes('data:image/');
          const limit = hasImageData ? 5000000 : 10000; // 5MB for images, 10KB for others
          resultStr = fullResult.length > limit ? fullResult.substring(0, limit) + '...(truncated)' : fullResult;
        } catch {
          resultStr = String(event.result);
        }
      }

      db.messages.create({
        id: messageId,
        conversationId,
        channel: channelId,
        role: 'tool', // Special role for tool events
        content: '', // No text content
        metadata: {
          type: 'tool_event',
          toolName: event.toolName,
          source: event.source,
          success: event.success as boolean,
          durationMs: event.durationMs as number,
          error: event.error as string | undefined,
          parameters: event.parameters as Record<string, unknown> | undefined,
          result: resultStr,
        },
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to save tool event:`, error);
    }
  }
}
