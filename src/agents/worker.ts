// Worker Agent - handles delegated tasks from supervisor

import { v4 as uuid } from 'uuid';
import { AbstractAgent, type AgentRegistry } from './base-agent.js';
import type {
  AgentConfig,
  AgentCommunication,
  AgentIdentity,
} from './types.js';
import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';
import type { LLMMessage } from '../llm/types.js';
import { getDb } from '../db/index.js';
import type { WebChannel } from '../channels/web.js';
import { formatToolResultBlocks } from '../utils/index.js';
import type { CitationSource, CitationSourceType, StoredCitationData } from '../citations/types.js';

export class WorkerAgent extends AbstractAgent {
  private currentTaskId?: string;
  private parentId: string;
  public conversationId: string | null = null; // Set by supervisor when spawning
  private subAgents: Map<string, WorkerAgent> = new Map();
  private agentType: string; // The type of this agent (e.g., 'deep-research-lead')
  private currentWorkflowId: string | null = null; // Current workflow context
  // Map of sub-agent IDs to their result promises
  private pendingSubAgentResults: Map<string, {
    resolve: (result: string) => void;
    reject: (error: Error) => void;
  }> = new Map();
  // Collected citations from sub-agents (aggregated when building final response)
  // Stored in simplified format matching StoredCitationData.sources
  private subAgentCitations: Array<{
    id: string;
    type: CitationSourceType;
    toolName: string;
    uri?: string;
    title?: string;
    domain?: string;
    snippet?: string;
    pageNumber?: number;
  }> = [];

  constructor(config: AgentConfig, llmService: LLMService, agentType?: string) {
    super(config, llmService);
    this.parentId = config.parentId || '';
    this.agentType = agentType || 'custom';
  }

  /**
   * Set the workflow context for this agent
   */
  setWorkflowId(workflowId: string | null): void {
    this.currentWorkflowId = workflowId;
  }

  /**
   * Get the agent type
   */
  getAgentType(): string {
    return this.agentType;
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

    // Refresh RAG data cache before generating response
    await this.refreshRagDataCache();

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

    // Citation tracking - sources collected from tool executions
    const collectedSources: CitationSource[] = [];

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
            // Agent tracking - capture which agent made this tool call
            agentId: this.identity.id,
            agentName: this.identity.name,
            agentEmoji: this.identity.emoji,
            agentType: this.agentType,
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
          agentType: this.agentType,
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
          // Execute requested tools with citation extraction
          const toolRequests = response.toolUse.map((tu) =>
            this.toolRunner!.createRequest(tu.id, tu.name, tu.input)
          );

          const { results, citations } = await this.toolRunner!.executeToolsWithCitations(toolRequests);

          // Log tool results concisely
          for (const result of results) {
            const status = result.success ? '✓' : '✗';
            const info = result.success ? `${result.durationMs}ms` : result.error;
            console.log(`[${this.identity.name}] ${status} ${result.toolName} (${info})`);
          }

          // Collect citations from this execution
          if (citations.length > 0) {
            collectedSources.push(...citations);
          }

          // Check if delegate tool was called - handle sub-agent delegation
          // Find ALL delegate results (there may be multiple parallel delegations)
          const delegateResults = results.filter(r => r.toolName === 'native__delegate' && r.success);

          if (delegateResults.length > 0 && this.agentRegistry) {
            // Check if this agent is allowed to delegate
            const delegationConfig = this.agentRegistry.getDelegationConfigForSpecialist(this.agentType);

            if (delegationConfig.canDelegate) {
              console.log(`[${this.identity.name}] Processing ${delegateResults.length} delegation(s) in parallel`);

              // Process all delegations in parallel
              const delegationPromises = delegateResults.map(async (delegateResult, idx) => {
                const delegationParams = delegateResult.output as {
                  type: string;
                  mission: string;
                  rationale?: string;
                  customName?: string;
                  customEmoji?: string;
                };

                try {
                  // Validate delegation is allowed
                  this.agentRegistry!.canDelegate(
                    this.agentType,
                    delegationParams.type,
                    this.currentWorkflowId
                  );

                  // Perform the delegation to sub-agent
                  const subAgentResult = await this.delegateToSubAgent(
                    delegationParams,
                    originalMessage,
                    channel
                  );

                  return {
                    index: results.indexOf(delegateResult),
                    success: true,
                    output: {
                      delegated: true,
                      agentType: delegationParams.type,
                      result: subAgentResult,
                    },
                  };
                } catch (error) {
                  console.error(`[${this.identity.name}] Delegation ${idx + 1} failed:`, error);
                  return {
                    index: results.indexOf(delegateResult),
                    success: false,
                    error: String(error),
                  };
                }
              });

              // Wait for all delegations to complete
              const delegationOutcomes = await Promise.all(delegationPromises);

              // Update results with delegation outcomes
              for (const outcome of delegationOutcomes) {
                if (outcome.index >= 0) {
                  if (outcome.success) {
                    results[outcome.index] = {
                      ...results[outcome.index],
                      output: outcome.output,
                    };
                  } else {
                    results[outcome.index] = {
                      ...results[outcome.index],
                      success: false,
                      error: outcome.error,
                    };
                  }
                }
              }

              console.log(`[${this.identity.name}] All ${delegateResults.length} delegation(s) completed`);
            } else {
              console.warn(`[${this.identity.name}] Agent type '${this.agentType}' cannot delegate`);
            }
          }

          // Add assistant message with tool use to conversation
          llmMessages.push({
            role: 'assistant',
            content: response.content || '',
            toolUse: response.toolUse,
          });

          // Add tool results as user message with content blocks (required by Anthropic)
          // Note: tool_result.content MUST be a string, not an object
          const toolResultBlocks = formatToolResultBlocks(results);
          llmMessages.push({
            role: 'user',
            content: toolResultBlocks,
          });
        } else {
          continueLoop = false;
        }
      }

      if (iterationCount >= maxIterations) {
        console.warn(`[${this.identity.name}] Max iterations reached`);
      }

      // Merge citations from sub-agents into collected sources
      if (this.subAgentCitations.length > 0) {
        console.log(`[${this.identity.name}] Merging ${this.subAgentCitations.length} citation(s) from sub-agents`);
        // Convert stored format to CitationSource format
        const convertedCitations: CitationSource[] = this.subAgentCitations.map(src => ({
          ...src,
          toolRequestId: `subagent-${src.id}`, // Generate placeholder for sub-agent sources
        }));
        collectedSources.push(...convertedCitations);
        this.subAgentCitations = []; // Clear after merging
      }

      // Build citation data (only includes sources actually referenced in response)
      const citationData = this.buildCitationData(streamId, fullResponse, collectedSources);

      // End stream with citations
      this.endStreamWithCitations(channel, streamId, this.conversationId || undefined, citationData);

      // Save and report
      this.saveAssistantMessage(channel.id, fullResponse, citationData);
      console.log(`[${this.identity.name}] Task done (${iterationCount} iter, ${fullResponse.length} chars)`);

      await this.sendToAgent(this.parentId, {
        type: 'task_result',
        toAgent: this.parentId,
        payload: {
          taskId: this.currentTaskId,
          result: fullResponse,
          status: 'completed',
          citations: citationData, // Pass citations to parent for aggregation
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

  /**
   * Delegate a task to a sub-agent and wait for its result
   */
  private async delegateToSubAgent(
    params: {
      type: string;
      mission: string;
      rationale?: string;
      customName?: string;
      customEmoji?: string;
    },
    originalMessage: Message,
    channel: Channel
  ): Promise<string> {
    const { type, mission, rationale, customName, customEmoji } = params;

    console.log(`[${this.identity.name}] Delegating to sub-agent:`);
    console.log(`  Type: ${type}`);
    console.log(`  Rationale: ${rationale || 'Not provided'}`);
    console.log(`  Mission: ${mission.substring(0, 100)}...`);

    if (!this.agentRegistry) {
      throw new Error('Agent registry not available for delegation');
    }

    // Create agent identity from template
    const identity = this.createSubAgentIdentity(type, customName, customEmoji);

    // Load prompt from registry
    const systemPrompt = this.agentRegistry.loadAgentPrompt(type) || '';
    const toolAccess = this.agentRegistry.getToolAccessForSpecialist(type);

    // Create sub-agent config
    const config: AgentConfig = {
      identity,
      capabilities: {
        canSpawnAgents: false, // Sub-agents of workers generally can't spawn more agents
        canAccessTools: toolAccess,
        canUseChannels: ['*'],
        maxConcurrentTasks: 1,
      },
      systemPrompt,
      parentId: this.identity.id,
      mission,
    };

    // Create and initialize sub-agent
    const subAgent = new WorkerAgent(config, this.llmService, type);
    subAgent.setRegistry(this.agentRegistry);
    subAgent.conversationId = this.conversationId;

    // Set workflow context for restricted agents
    if (this.currentWorkflowId) {
      subAgent.setWorkflowId(this.currentWorkflowId);
    }

    // Pass tool runner and RAG manager
    if (this.toolRunner) {
      subAgent.setToolRunner(this.toolRunner);
    }
    if (this.ragDataManager) {
      subAgent.setRagDataManager(this.ragDataManager);
    }

    await subAgent.init();
    this.subAgents.set(subAgent.identity.id, subAgent);
    this.agentRegistry.registerAgent(subAgent);

    console.log(`[${this.identity.name}] Spawned sub-agent ${subAgent.identity.emoji} ${subAgent.identity.name} (${subAgent.identity.id})`);

    // Emit delegation event for UI
    const webChannel = channel as WebChannel;
    if (typeof webChannel.broadcast === 'function') {
      webChannel.broadcast({
        type: 'delegation',
        agentId: subAgent.identity.id,
        agentName: subAgent.identity.name,
        agentEmoji: subAgent.identity.emoji,
        agentType: type,
        parentAgentId: this.identity.id,
        parentAgentName: this.identity.name,
        mission,
        rationale,
        conversationId: this.conversationId || undefined,
        timestamp: new Date().toISOString(),
      });
    }

    // Create a promise to wait for the sub-agent's result
    // The result will come via handleAgentCommunication when sub-agent sends task_result
    let timeoutId: ReturnType<typeof setTimeout>;
    const resultPromise = new Promise<string>((resolve, reject) => {
      this.pendingSubAgentResults.set(subAgent.identity.id, { resolve, reject });

      // Set a timeout to prevent hanging forever
      timeoutId = setTimeout(() => {
        if (this.pendingSubAgentResults.has(subAgent.identity.id)) {
          this.pendingSubAgentResults.delete(subAgent.identity.id);
          reject(new Error(`Sub-agent ${subAgent.identity.id} timed out after 5 minutes`));
        }
      }, 5 * 60 * 1000); // 5 minute timeout
    });

    // Clean up timeout when promise resolves (declared outside promise constructor)
    resultPromise.finally(() => clearTimeout(timeoutId)).catch(() => {});

    // Start the sub-agent's task (don't await - let it run while we wait for result via message)
    subAgent.registerChannel(channel);
    subAgent.handleDelegatedTask(originalMessage, mission, channel).catch((error) => {
      console.error(`[${this.identity.name}] Sub-agent ${subAgent.identity.id} threw error:`, error);
      const pending = this.pendingSubAgentResults.get(subAgent.identity.id);
      if (pending) {
        this.pendingSubAgentResults.delete(subAgent.identity.id);
        pending.reject(error);
      }
    });

    // Wait for the result
    try {
      const result = await resultPromise;

      // Cleanup sub-agent after successful completion
      await subAgent.shutdown();
      this.subAgents.delete(subAgent.identity.id);
      this.agentRegistry?.unregisterAgent(subAgent.identity.id);

      return result;
    } catch (error) {
      // Cleanup sub-agent on error
      await subAgent.shutdown();
      this.subAgents.delete(subAgent.identity.id);
      this.agentRegistry?.unregisterAgent(subAgent.identity.id);
      throw error;
    }
  }

  /**
   * Create an agent identity for a sub-agent
   */
  private createSubAgentIdentity(
    type: string,
    customName?: string,
    customEmoji?: string
  ): AgentIdentity {
    if (!this.agentRegistry) {
      return {
        id: `${type}-${uuid().slice(0, 8)}`,
        name: customName || 'Worker',
        emoji: customEmoji || '⚙️',
        role: 'worker',
        description: 'Worker agent',
      };
    }

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
      case 'task_result': {
        // Handle results from sub-agents
        const payload = comm.payload as { taskId: string; result?: string; error?: string; status: string; citations?: StoredCitationData };
        const pendingResult = this.pendingSubAgentResults.get(comm.fromAgent);

        if (pendingResult) {
          this.pendingSubAgentResults.delete(comm.fromAgent);

          if (payload.status === 'completed' && payload.result) {
            console.log(`[${this.identity.name}] Sub-agent ${comm.fromAgent} completed task`);

            // Collect citations from sub-agent for aggregation
            if (payload.citations?.sources) {
              console.log(`[${this.identity.name}] Collected ${payload.citations.sources.length} citation(s) from sub-agent ${comm.fromAgent}`);
              this.subAgentCitations.push(...payload.citations.sources);
            }

            pendingResult.resolve(payload.result);
          } else {
            console.log(`[${this.identity.name}] Sub-agent ${comm.fromAgent} failed: ${payload.error}`);
            pendingResult.reject(new Error(payload.error || 'Sub-agent task failed'));
          }
        } else {
          console.log(`[${this.identity.name}] Received unexpected task_result from ${comm.fromAgent}`);
        }
        break;
      }
      case 'status_update': {
        // Log status updates from sub-agents
        console.log(`[${this.identity.name}] Sub-agent status: ${JSON.stringify(comm.payload)}`);
        break;
      }
    }
  }

  private saveAssistantMessage(channelId: string, content: string, citations?: StoredCitationData): void {
    const metadata: Record<string, unknown> = {
      agentId: this.identity.id,
      agentName: this.identity.name,
      agentEmoji: this.identity.emoji,
      agentType: this.agentType,
    };

    // Include citations in metadata if present
    if (citations && citations.sources.length > 0) {
      metadata.citations = citations;
    }

    const message: Message = {
      id: uuid(),
      channel: channelId,
      role: 'assistant',
      content,
      metadata,
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
