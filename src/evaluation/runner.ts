/**
 * EvaluationRunner - Executes individual evaluation runs
 *
 * Responsibilities:
 * - Set up evaluation environment with mocked tools
 * - Execute prompts against the target (supervisor, sub-agent, tool-generator)
 * - Capture tool calls and responses
 * - Return raw results for scoring
 */

import { v4 as uuid } from 'uuid';
import type { LLMService } from '../llm/service.js';
import type { LLMMessage, LLMToolUse } from '../llm/types.js';
import type { ToolRunner } from '../tools/runner.js';
import type {
  EvaluationDefinition,
  SingleRunResult,
  DelegationDecision,
} from './types.js';
import { MockedToolRunner } from './mocked-tool-runner.js';
import { PromptLoader } from './prompt-loader.js';
import { Scorer } from './scorer.js';

export interface EvaluationRunnerConfig {
  llmService: LLMService;
  toolRunner: ToolRunner;
  maxToolIterations?: number;
}

export class EvaluationRunner {
  private llmService: LLMService;
  private toolRunner: ToolRunner;
  private promptLoader: PromptLoader;
  private scorer: Scorer;
  private maxToolIterations: number;

  constructor(config: EvaluationRunnerConfig) {
    this.llmService = config.llmService;
    this.toolRunner = config.toolRunner;
    this.promptLoader = new PromptLoader();
    this.scorer = new Scorer(config.llmService);
    this.maxToolIterations = config.maxToolIterations || 10;
  }

  /**
   * Execute a single evaluation run
   */
  async executeRun(
    definition: EvaluationDefinition,
    promptType: 'baseline' | 'alternative',
    runId?: string
  ): Promise<SingleRunResult> {
    const id = runId || `${definition.metadata.id}-${promptType}-${uuid().slice(0, 8)}`;
    const startTime = Date.now();

    // 1. Load the appropriate prompt
    const promptRef = promptType === 'baseline'
      ? definition.target
      : definition.alternative!;

    let systemPrompt: string;
    try {
      systemPrompt = this.promptLoader.load(promptRef);
    } catch (error) {
      // If loading fails, try loading by target type
      systemPrompt = this.promptLoader.loadForTarget(definition.metadata.target);
    }

    // 2. Set up mocked tool runner
    const mockedToolRunner = new MockedToolRunner(definition.mockedOutputs || {});

    // 3. Build messages
    const messages = this.buildMessages(definition);

    // 4. Execute with tool support
    const { response, tokenUsage } = await this.executeWithTools(
      systemPrompt,
      messages,
      mockedToolRunner
    );

    // 5. Get recorded tool calls
    const recordedCalls = mockedToolRunner.getRecordedCalls();

    // 6. Parse delegation if supervisor target (uses tool calls)
    const delegationDecision = this.parseDelegation(response, definition, recordedCalls);

    // 7. Score the results
    const scores = await this.scorer.score(
      definition,
      response,
      recordedCalls,
      delegationDecision
    );

    return {
      runId: id,
      timestamp: new Date(),
      promptType,
      rawResponse: response,
      toolCalls: scores.toolCallResults,
      delegationDecision,
      toolSelectionScore: scores.toolSelectionScore,
      responseQualityScore: scores.responseQualityScore,
      delegationScore: scores.delegationScore,
      overallScore: scores.overallScore,
      elementResults: scores.elementResults,
      constraintViolations: scores.constraintViolations,
      latencyMs: Date.now() - startTime,
      tokenUsage,
    };
  }

  /**
   * Execute multiple runs of an evaluation
   */
  async executeMultipleRuns(
    definition: EvaluationDefinition,
    promptType: 'baseline' | 'alternative',
    count: number,
    onProgress?: (current: number, total: number, lastResult?: SingleRunResult) => void
  ): Promise<SingleRunResult[]> {
    const results: SingleRunResult[] = [];

    for (let i = 0; i < count; i++) {
      const runId = `${definition.metadata.id}-${promptType}-run${i + 1}`;

      try {
        const result = await this.executeRun(definition, promptType, runId);
        results.push(result);

        if (onProgress) {
          onProgress(i + 1, count, result);
        }
      } catch (error) {
        console.error(`[EvaluationRunner] Run ${i + 1} failed:`, error);

        // Create a failed result
        const failedResult: SingleRunResult = {
          runId,
          timestamp: new Date(),
          promptType,
          rawResponse: `Error: ${error}`,
          toolCalls: [],
          toolSelectionScore: 0,
          responseQualityScore: 0,
          overallScore: 0,
          elementResults: [],
          constraintViolations: [`Execution error: ${error}`],
          latencyMs: 0,
        };
        results.push(failedResult);

        if (onProgress) {
          onProgress(i + 1, count, failedResult);
        }
      }
    }

    return results;
  }

  /**
   * Build messages for LLM
   */
  private buildMessages(definition: EvaluationDefinition): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // Add conversation history if present
    if (definition.testCase.history) {
      for (const msg of definition.testCase.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add the test user prompt
    messages.push({ role: 'user', content: definition.testCase.userPrompt });

    return messages;
  }

  /**
   * Execute with tool support, handling the tool call loop
   */
  private async executeWithTools(
    systemPrompt: string,
    messages: LLMMessage[],
    mockedToolRunner: MockedToolRunner
  ): Promise<{ response: string; tokenUsage?: { input: number; output: number } }> {
    // Get tool definitions from the real tool runner
    const tools = this.toolRunner.getToolsForLLM();

    let currentMessages = [...messages];
    let finalResponse = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;

    while (iterations < this.maxToolIterations) {
      iterations++;

      // Generate response with tools
      const response = await this.llmService.generateWithTools(currentMessages, {
        systemPrompt,
        tools,
        maxTokens: 4096,
      });

      // Accumulate token usage
      if (response.usage) {
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;
      }

      // If no tool use, we're done
      if (!response.toolUse || response.toolUse.length === 0 || response.stopReason === 'end_turn') {
        finalResponse = response.content;
        break;
      }

      // Handle tool calls
      const toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = [];

      for (const toolUse of response.toolUse) {
        const request = mockedToolRunner.createRequest(
          toolUse.id,
          toolUse.name,
          toolUse.input
        );

        const result = await mockedToolRunner.executeTool(request);

        toolResults.push({
          tool_use_id: toolUse.id,
          content: JSON.stringify(result.success ? result.output : { error: result.error }),
          is_error: !result.success,
        });
      }

      // Add assistant message with tool use
      currentMessages.push({
        role: 'assistant',
        content: response.content,
        toolUse: response.toolUse,
      });

      // Add tool results as separate user messages (OpenAI-compatible format)
      // Each tool result is sent as a JSON object that openai-base.ts parses
      for (const toolResult of toolResults) {
        currentMessages.push({
          role: 'user',
          content: JSON.stringify({
            type: 'tool_result',
            tool_use_id: toolResult.tool_use_id,
            content: toolResult.content,
            is_error: toolResult.is_error,
          }),
        });
      }

      // If the response had both content and tool use, capture the content
      if (response.content && response.stopReason !== 'tool_use') {
        finalResponse = response.content;
      }
    }

    // If we hit max iterations, use whatever content we have
    if (iterations >= this.maxToolIterations && !finalResponse) {
      finalResponse = '[Max tool iterations reached without final response]';
    }

    return {
      response: finalResponse,
      tokenUsage: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
    };
  }

  /**
   * Parse delegation decision from tool calls
   */
  private parseDelegation(
    _response: string,
    definition: EvaluationDefinition,
    toolCalls?: Array<{ toolName: string; parameters: Record<string, unknown> }>
  ): DelegationDecision | undefined {
    // Only parse delegation for supervisor targets
    if (definition.metadata.target !== 'supervisor') {
      return undefined;
    }

    // Look for delegate tool call
    const delegateCall = toolCalls?.find(call => call.toolName === 'delegate');

    if (!delegateCall) {
      return { delegated: false };
    }

    return {
      delegated: true,
      agentType: delegateCall.parameters.type as string,
      rationale: delegateCall.parameters.rationale as string | undefined,
    };
  }

  /**
   * Get the prompt loader (for external use)
   */
  getPromptLoader(): PromptLoader {
    return this.promptLoader;
  }

  /**
   * Get the scorer (for external use)
   */
  getScorer(): Scorer {
    return this.scorer;
  }
}
