// Worker Agent - handles delegated tasks from supervisor

import { v4 as uuid } from 'uuid';
import { AbstractAgent } from './base-agent.js';
import type {
  AgentConfig,
  AgentCommunication,
} from './types.js';
import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';
import type { LLMMessage } from '../llm/types.js';
import { getDb } from '../db/index.js';
import type { WebChannel } from '../channels/web.js';
import { stripBinaryDataForLLM } from '../utils/index.js';

export class WorkerAgent extends AbstractAgent {
  private currentTaskId?: string;
  private parentId: string;
  public conversationId: string | null = null; // Set by supervisor when spawning

  constructor(config: AgentConfig, llmService: LLMService) {
    super(config, llmService);
    this.parentId = config.parentId || '';
  }

  async init(): Promise<void> {
    await super.init();
    console.log(`[${this.identity.name}] Worker initialized - ${this.config.mission || 'awaiting task'}`);
  }

  async handleMessage(message: Message): Promise<void> {
    // Workers typically receive messages through delegation, not directly
    // But they can respond to follow-up questions in their channel
    this._state.lastActivity = new Date();
    this._state.status = 'working';

    const channel = this.channels.get(message.channel);
    if (!channel) return;

    try {
      const response = await this.generateResponse([
        ...this.conversationHistory.slice(-5),
        message,
      ]);

      await this.sendToChannel(channel, response, { markdown: true });
      this.saveAssistantMessage(message.channel, response);
    } catch (error) {
      await this.sendError(channel, 'Failed to process message', String(error));
    }

    this._state.status = 'idle';
  }

  async handleDelegatedTask(
    originalMessage: Message,
    mission: string,
    channel: Channel
  ): Promise<void> {
    this._state.status = 'working';
    this._state.currentTask = mission;
    this.currentTaskId = uuid();

    // Notify supervisor we're starting
    await this.sendToAgent(this.parentId, {
      type: 'status_update',
      toAgent: this.parentId,
      payload: { status: 'started', taskId: this.currentTaskId, mission },
    });

    try {
      // Check if we have tools available
      const tools = this.getToolsForLLM();
      const hasTools = tools.length > 0 && this.toolRunner;

      if (hasTools) {
        // Use tool-enabled execution
        await this.executeWithTools(originalMessage, mission, channel, tools);
      } else {
        // Fallback to simple generation without tools
        const contextMessages: Message[] = [
          {
            id: uuid(),
            channel: channel.id,
            role: 'system',
            content: `Your mission: ${mission}\n\nRespond as ${this.identity.name} (${this.identity.emoji}).`,
            createdAt: new Date(),
          },
          originalMessage,
        ];

        const response = await this.generateResponse(contextMessages);
        await this.sendToChannel(channel, response, { markdown: true });
        this.saveAssistantMessage(channel.id, response);

        // Report completion
        await this.sendToAgent(this.parentId, {
          type: 'task_result',
          toAgent: this.parentId,
          payload: {
            taskId: this.currentTaskId,
            result: response,
            status: 'completed',
          },
        });
      }
    } catch (error) {
      console.error(`[${this.identity.name}] Task failed:`, error);

      await this.sendError(channel, `${this.identity.name} encountered an error`, String(error));

      // Report failure to supervisor
      await this.sendToAgent(this.parentId, {
        type: 'task_result',
        toAgent: this.parentId,
        payload: {
          taskId: this.currentTaskId,
          error: String(error),
          status: 'failed',
        },
      });
    }

    this._state.status = 'idle';
    this._state.currentTask = undefined;
  }

  /**
   * Execute task with tool support
   */
  private async executeWithTools(
    originalMessage: Message,
    mission: string,
    channel: Channel,
    tools: ReturnType<typeof this.getToolsForLLM>
  ): Promise<void> {
    const streamId = uuid();
    let fullResponse = '';

    console.log(`[${this.identity.name}] Starting task (${tools.length} tools)`);

    // Setup tool event broadcasting
    let unsubscribeTool: (() => void) | undefined;
    if (this.toolRunner) {
      unsubscribeTool = this.toolRunner.onToolEvent((event) => {
        const webChannel = channel as WebChannel;
        if (typeof webChannel.broadcast === 'function') {
          webChannel.broadcast({
            ...event,
            timestamp: event.timestamp.toISOString(),
            startTime: 'startTime' in event ? event.startTime.toISOString() : undefined,
            endTime: 'endTime' in event ? event.endTime.toISOString() : undefined,
          });
        }
      });
    }

    try {
      // Start stream with agent info and conversation context
      if (typeof channel.startStream === 'function') {
        channel.startStream(streamId, {
          agentId: this.identity.id,
          agentName: this.identity.name,
          agentEmoji: this.identity.emoji,
          conversationId: this.conversationId || undefined,
        });
      }

      const systemPrompt = this.buildSystemPrompt(
        `Your mission: ${mission}\n\nYou have access to tools including MCP servers, skills, and native tools. Use them to complete your mission.`
      );

      // Build initial messages
      let llmMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: originalMessage.content },
      ];

      // Tool execution loop
      let continueLoop = true;
      let iterationCount = 0;
      const maxIterations = 10;

      while (continueLoop && iterationCount < maxIterations) {
        iterationCount++;

        const llmStartTime = Date.now();

        // Use streaming with tools for real-time response
        const response = await this.llmService.generateWithToolsStream(
          llmMessages,
          {
            onChunk: (chunk) => {
              fullResponse += chunk;
              if (typeof channel.sendStreamChunk === 'function') {
                channel.sendStreamChunk(streamId, chunk, this.conversationId || undefined);
              }
            },
            onComplete: () => {
              // Response complete for this iteration
            },
            onError: (error) => {
              console.error(`[${this.identity.name}] Stream error:`, error);
            },
          },
          { tools }
        );

        const llmDuration = Date.now() - llmStartTime;
        const toolCount = response.toolUse?.length || 0;
        console.log(`[${this.identity.name}] LLM (${llmDuration}ms) → ${toolCount > 0 ? `${toolCount} tool(s)` : 'done'}`);

        // Check if LLM requested tool use
        if (response.toolUse && response.toolUse.length > 0) {
          // Execute requested tools
          const toolRequests = response.toolUse.map((tu) =>
            this.toolRunner!.createRequest(tu.id, tu.name, tu.input)
          );

          const results = await this.toolRunner!.executeTools(toolRequests);

          // Log tool results concisely
          for (const result of results) {
            const status = result.success ? '✓' : '✗';
            const info = result.success ? `${result.durationMs}ms` : result.error;
            console.log(`[${this.identity.name}] ${status} ${result.toolName} (${info})`);
          }

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
        } else {
          continueLoop = false;
        }
      }

      if (iterationCount >= maxIterations) {
        console.warn(`[${this.identity.name}] Max iterations reached`);
      }

      if (typeof channel.endStream === 'function') {
        channel.endStream(streamId, this.conversationId || undefined);
      }

      // Save and report
      this.saveAssistantMessage(channel.id, fullResponse);
      console.log(`[${this.identity.name}] Task done (${iterationCount} iter, ${fullResponse.length} chars)`);

      await this.sendToAgent(this.parentId, {
        type: 'task_result',
        toAgent: this.parentId,
        payload: {
          taskId: this.currentTaskId,
          result: fullResponse,
          status: 'completed',
        },
      });
    } finally {
      if (unsubscribeTool) {
        unsubscribeTool();
      }
    }
  }

  async requestHelp(question: string, channelId: string): Promise<void> {
    await this.sendToAgent(this.parentId, {
      type: 'request_help',
      toAgent: this.parentId,
      payload: { question, channelId },
    });
  }

  protected async handleAgentCommunication(comm: AgentCommunication): Promise<void> {
    switch (comm.type) {
      case 'terminate':
        await this.shutdown();
        break;
      case 'task_assignment': {
        const payload = comm.payload as { mission: string; channelId: string; message: Message };
        const channel = this.channels.get(payload.channelId);
        if (channel) {
          await this.handleDelegatedTask(payload.message, payload.mission, channel);
        }
        break;
      }
    }
  }

  private saveAssistantMessage(channelId: string, content: string): void {
    const message: Message = {
      id: uuid(),
      channel: channelId,
      role: 'assistant',
      content,
      metadata: {
        agentId: this.identity.id,
        agentName: this.identity.name,
        agentEmoji: this.identity.emoji,
      },
      createdAt: new Date(),
    };
    this.conversationHistory.push(message);

    if (!this.conversationId) {
      console.warn(`[${this.identity.name}] No conversationId set, skipping message save`);
      return;
    }

    try {
      const db = getDb();
      db.messages.create({
        id: message.id,
        conversationId: this.conversationId,
        channel: message.channel,
        role: message.role,
        content: message.content,
        metadata: message.metadata || {},
        createdAt: message.createdAt.toISOString(),
      });
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to save message:`, error);
    }
  }
}
