// Supervisor Agent - orchestrates sub-agents

import { v4 as uuid } from 'uuid';
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
import type { ToolEvent } from '../tools/types.js';
import { stripBinaryDataForLLM } from '../utils/index.js';

export class SupervisorAgentImpl extends AbstractAgent implements ISupervisorAgent {
  private subAgents: Map<string, WorkerAgent> = new Map();
  private tasks: Map<string, TaskAssignment> = new Map();
  private messageChannelMap: Map<string, string> = new Map(); // messageId -> channelId
  private currentConversationId: string | null = null;
  private conversationMessageCount: Map<string, number> = new Map(); // Track message counts for auto-naming

  // Override to make registry non-nullable in supervisor
  protected declare agentRegistry: AgentRegistry;

  constructor(llmService: LLMService, registry: AgentRegistry) {
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
      systemPrompt: registry.loadAgentPrompt('supervisor'),
    };

    super(config, llmService);
    this.agentRegistry = registry;
  }

  async init(): Promise<void> {
    await super.init();
    const specialistCount = this.agentRegistry.getSpecialistTypes().length;
    console.log(`[${this.identity.name}] Supervisor initialized with ${specialistCount} specialist types`);
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
            conversationId: this.currentConversationId || undefined,
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
      // Start stream with agent info and conversation context
      channel.startStream!(streamId, {
        agentId: this.identity.id,
        agentName: this.identity.name,
        agentEmoji: this.identity.emoji,
        conversationId: this.currentConversationId || undefined,
      });

      const systemPrompt = this.buildSystemPrompt();
      const tools = this.getToolsForLLM();

      // Build initial messages, including image attachments
      let llmMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory.slice(-10).map((m) => {
          // Check if message has image attachments
          const imageAttachments = m.attachments?.filter(a => a.type.startsWith('image/')) || [];

          if (imageAttachments.length > 0 && m.role === 'user') {
            // Build multimodal content with text and images
            const content: Array<{ type: 'text' | 'image'; text?: string; source?: { type: 'base64'; media_type: string; data: string } }> = [];

            // Add text content first (content should always be string from Message type)
            if (m.content && typeof m.content === 'string') {
              content.push({ type: 'text', text: m.content });
            }

            // Add image attachments
            for (const att of imageAttachments) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.type,
                  data: att.data,
                },
              });
            }

            return { role: m.role, content };
          }

          // Regular text-only message
          return { role: m.role, content: m.content };
        }),
      ];

      // Tool execution loop - continues until LLM stops requesting tools
      let continueLoop = true;
      let iterationCount = 0;
      const maxIterations = 10; // Prevent infinite loops

      while (continueLoop && iterationCount < maxIterations) {
        iterationCount++;

        if (tools.length > 0 && this.toolRunner) {
          // Use tool-enabled streaming generation
          // Buffer to filter out delegation blocks which shouldn't be shown to users
          let streamBuffer = '';
          const response = await this.llmService.generateWithToolsStream(
            llmMessages,
            {
              onChunk: (chunk: string) => {
                fullResponse += chunk;
                streamBuffer += chunk;

                // Check if we're in the middle of a potential delegation block
                const inDelegateBlock = streamBuffer.includes('```delegate') && !streamBuffer.includes('```delegate\n') ||
                  streamBuffer.includes('```d') && !streamBuffer.includes('```delegate');

                // If not in a delegation block, send filtered content
                if (!inDelegateBlock) {
                  const displayContent = streamBuffer.replace(/```delegate\s*[\s\S]*?```/g, '');
                  if (displayContent) {
                    channel.sendStreamChunk!(streamId, displayContent, this.currentConversationId || undefined);
                  }
                  streamBuffer = '';
                }
              },
              onComplete: () => {
                // Flush any remaining buffered content (filtered)
                if (streamBuffer) {
                  const displayContent = streamBuffer.replace(/```delegate\s*[\s\S]*?```/g, '');
                  if (displayContent) {
                    channel.sendStreamChunk!(streamId, displayContent, this.currentConversationId || undefined);
                  }
                  streamBuffer = '';
                }
              },
              onError: (error: Error) => {
                console.error('[Supervisor] Stream error:', error);
              },
            },
            { tools }
          );

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
                  const displayContent = streamBuffer.replace(/```delegate\s*[\s\S]*?```/g, '');
                  if (displayContent) {
                    channel.sendStreamChunk!(streamId, displayContent, this.currentConversationId || undefined);
                  }
                  streamBuffer = '';
                }
              },
              onComplete: () => {
                // Send any remaining buffered content (filtered)
                if (streamBuffer) {
                  const displayContent = streamBuffer.replace(/```delegate\s*[\s\S]*?```/g, '');
                  if (displayContent) {
                    channel.sendStreamChunk!(streamId, displayContent, this.currentConversationId || undefined);
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

      channel.endStream!(streamId, this.currentConversationId || undefined);

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
      channel.endStream!(streamId, this.currentConversationId || undefined);
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

      // Spawn appropriate agent (pass type explicitly for prompt loading)
      const agentId = await this.spawnAgent(
        {
          identity: this.createAgentIdentity(type, customName, customEmoji),
          mission,
        },
        type
      );

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
          conversationId: this.currentConversationId || undefined,
          timestamp: new Date().toISOString(),
        });
      }

      // Persist delegation event to database for reload
      this.saveDelegationEvent(
        originalMessage.channel,
        agent.identity.id,
        agent.identity.name,
        agent.identity.emoji,
        type,
        mission,
        rationale
      );

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
    const template = this.agentRegistry.getSpecialistTemplate(type);

    if (template) {
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

  async spawnAgent(partialConfig: Partial<AgentConfig>, agentType?: string): Promise<string> {
    // Use explicit type if provided, otherwise try to infer from identity name
    const type = agentType
      || (partialConfig.identity?.role === 'specialist'
        ? this.agentRegistry.findSpecialistTypeByName(partialConfig.identity?.name || '') || 'custom'
        : 'custom');

    // Load prompt from .md file via registry
    const systemPrompt = this.agentRegistry.loadAgentPrompt(type) || '';

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
    agent.setRegistry(this.agentRegistry);

    // Pass the tool runner to worker agents so they can use MCP, skills, and native tools
    if (this.toolRunner) {
      agent.setToolRunner(this.toolRunner);
    }

    await agent.init();
    this.subAgents.set(agent.identity.id, agent);
    this.agentRegistry.registerAgent(agent);

    console.log(`[${this.identity.name}] Spawned ${agent.identity.emoji} ${agent.identity.name} (type: ${type}, prompt: ${systemPrompt.length} chars)`);

    return agent.identity.id;
  }

  async terminateAgent(agentId: string): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      await agent.shutdown();
      this.subAgents.delete(agentId);
      this.agentRegistry.unregisterAgent(agentId);
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

  private ensureConversation(channel: string, firstMessageContent?: string | unknown[]): string {
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
    // Generate temporary title from first message (truncate to 20 chars)
    // Will be auto-named with a better title after 3 messages
    // Handle multimodal content by extracting text
    const textContent = typeof firstMessageContent === 'string'
      ? firstMessageContent
      : Array.isArray(firstMessageContent)
        ? (firstMessageContent as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text).join(' ')
        : '';
    const title = textContent
      ? textContent.substring(0, 20).trim() + (textContent.length > 20 ? '...' : '')
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

  // Get the current conversation ID
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  private saveMessage(message: Message): void {
    try {
      const db = getDb();
      const conversationId = this.ensureConversation(message.channel, message.role === 'user' ? message.content : undefined);

      // Include attachment info in metadata (without base64 data)
      const metadata = {
        ...(message.metadata || {}),
        attachments: message.attachments?.map(a => ({
          name: a.name,
          type: a.type,
          size: a.size,
        })),
      };

      db.messages.create({
        id: message.id,
        conversationId,
        channel: message.channel,
        role: message.role,
        content: message.content,
        metadata,
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
   * Skips conversations that have been manually named by the user
   */
  private async autoNameConversation(conversationId: string, channelId: string): Promise<void> {
    try {
      const db = getDb();

      // Skip if conversation was manually named
      const conversation = db.conversations.findById(conversationId);
      if (conversation?.manuallyNamed) {
        console.log(`[${this.identity.name}] Skipping auto-name for manually named conversation`);
        return;
      }

      const messages = db.messages.findByConversationId(conversationId, { limit: 5 });

      if (messages.length < 3) return;

      // Build context from messages (database messages always have string content)
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
  private saveToolEvent(event: ToolEvent, channelId: string): void {
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

  /**
   * Save delegation events to database for persistence
   */
  private saveDelegationEvent(
    channelId: string,
    agentId: string,
    agentName: string,
    agentEmoji: string,
    agentType: string,
    mission: string,
    rationale?: string
  ): void {
    try {
      const db = getDb();
      const conversationId = this.currentConversationId || this.ensureConversation(channelId);

      const messageId = `delegation-${agentId}`;

      // Check if this delegation was already saved (avoid duplicates)
      const existing = db.messages.findById(messageId);
      if (existing) {
        return;
      }

      db.messages.create({
        id: messageId,
        conversationId,
        channel: channelId,
        role: 'system', // Special role for system events
        content: '', // No text content
        metadata: {
          type: 'delegation',
          agentId,
          agentName,
          agentEmoji,
          agentType,
          mission,
          rationale,
        },
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to save delegation event:`, error);
    }
  }

  /**
   * Handle message reply request from user
   * This takes the original message (e.g., with applet code) and user's reply/revision instructions,
   * then generates updated content and sends it as a message update.
   */
  async handleMessageReply(messageId: string, replyContent: string, conversationId?: string): Promise<void> {
    try {
      const db = getDb();
      const message = db.messages.findById(messageId);

      if (!message) {
        console.error(`[${this.identity.name}] Message not found for reply: ${messageId}`);
        return;
      }

      // Extract applet code from the message content
      const appletMatch = message.content.match(/```(?:applet|interactive)\n([\s\S]*?)```/);
      if (!appletMatch) {
        console.error(`[${this.identity.name}] No applet code found in message: ${messageId}`);
        return;
      }

      const currentAppletCode = appletMatch[1];

      // Save the user's reply to the database
      const userReply = {
        id: `reply-${messageId}-${Date.now()}`,
        messageId,
        role: 'user' as const,
        content: replyContent,
        metadata: {},
        createdAt: new Date().toISOString(),
      };
      db.messageReplies.create(userReply);

      // Use LLM to generate revised applet code
      const response = await this.llmService.quickGenerate(
        [
          {
            role: 'system',
            content: `You are an expert at creating interactive HTML/JavaScript applets.
You will be given the current applet code and user instructions for revisions.
Output ONLY the revised complete applet code (HTML with embedded JavaScript).
Do NOT include the markdown code fence - just the raw HTML/JS code.
Do NOT include explanations or commentary.
The applet will run in an iframe with sandbox="allow-scripts".`,
          },
          {
            role: 'user',
            content: `Current applet code:
\`\`\`
${currentAppletCode}
\`\`\`

User's revision instructions: ${replyContent}

Please provide the complete revised applet code:`,
          },
        ],
        { maxTokens: 4096 }
      );

      if (!response || !response.content) {
        console.error(`[${this.identity.name}] Failed to generate revised applet`);
        return;
      }

      // The response.content is a string from quickGenerate
      let revisedCode = response.content;

      // Clean up the code (remove any markdown fences if LLM included them)
      revisedCode = revisedCode.replace(/^```(?:html|applet|interactive)?\n?/, '').replace(/\n?```$/, '');

      // Build the new message content with the revised applet
      const newContent = message.content.replace(
        /```(?:applet|interactive)\n[\s\S]*?```/,
        `\`\`\`applet\n${revisedCode}\n\`\`\``
      );

      // Save the assistant's revision as a reply
      const assistantReply = {
        id: `reply-${messageId}-${Date.now() + 1}`,
        messageId,
        role: 'assistant' as const,
        content: `Revised applet based on: "${replyContent}"`,
        metadata: { revisedCode },
        createdAt: new Date().toISOString(),
      };
      db.messageReplies.create(assistantReply);

      // Get the web channel and send the update
      const webChannel = this.channels.get('web-default') as WebChannel | undefined;
      if (webChannel) {
        webChannel.updateMessage(messageId, { content: newContent }, conversationId);

        // Broadcast the new reply for UI update
        webChannel.broadcast({
          type: 'message-reply-added',
          messageId,
          reply: userReply,
          conversationId,
          timestamp: new Date().toISOString(),
        });
        webChannel.broadcast({
          type: 'message-reply-added',
          messageId,
          reply: assistantReply,
          conversationId,
          timestamp: new Date().toISOString(),
        });

        console.log(`[${this.identity.name}] Processed message reply for ${messageId}`);
      }
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to handle message reply:`, error);
    }
  }
}
