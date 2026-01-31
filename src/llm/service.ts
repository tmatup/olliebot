import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMResponseWithTools,
  StreamCallbacks,
} from './types.js';
import { DATA_SIZE_THRESHOLDS } from './types.js';
import type { AnthropicProvider } from './anthropic.js';

export interface LLMServiceConfig {
  main: LLMProvider;
  fast: LLMProvider;
}

export class LLMService {
  private main: LLMProvider;
  private fast: LLMProvider;

  constructor(config: LLMServiceConfig) {
    this.main = config.main;
    this.fast = config.fast;
  }

  /**
   * Process data according to size-based strategy:
   * - Small (<3000 chars): Return as-is
   * - Medium (3000-50000 chars): Summarize using Fast LLM
   * - Large (>50000 chars): Requires RAG (handled externally)
   */
  async processData(
    data: string,
    context?: string
  ): Promise<{ processed: string; strategy: 'direct' | 'summarized' | 'rag-required' }> {
    const size = data.length;

    if (size <= DATA_SIZE_THRESHOLDS.SMALL) {
      return { processed: data, strategy: 'direct' };
    }

    if (size <= DATA_SIZE_THRESHOLDS.MEDIUM) {
      const summary = await this.summarize(data, context);
      return { processed: summary, strategy: 'summarized' };
    }

    // For large data, signal that RAG is needed
    return {
      processed: `[Data too large: ${size} characters. RAG processing required.]`,
      strategy: 'rag-required',
    };
  }

  /**
   * Summarize text using the Fast LLM
   */
  async summarize(text: string, context?: string): Promise<string> {
    const systemPrompt = `You are a precise summarizer. Summarize the following content into no more than 3000 characters while preserving key information and structure.${context ? ` Context: ${context}` : ''}`;

    const response = await this.fast.complete(
      [{ role: 'user', content: text }],
      { systemPrompt, maxTokens: 1500 }
    );

    return response.content;
  }

  /**
   * Generate response using Main LLM
   */
  async generate(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    return this.main.complete(messages, options);
  }

  /**
   * Generate response with tool use support
   * Requires a provider that supports completeWithTools (e.g., Anthropic)
   */
  async generateWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const toolCount = options?.tools?.length || 0;

    // Check if provider supports tool use
    const provider = this.main as unknown as { completeWithTools?: typeof AnthropicProvider.prototype.completeWithTools };
    if (typeof provider.completeWithTools === 'function') {
      const startTime = Date.now();
      const response = await provider.completeWithTools(messages, options);
      const duration = Date.now() - startTime;

      const toolNames = response.toolUse?.map(t => t.name).join(', ') || 'none';
      console.log(`[LLMService] ${this.main.model} (${duration}ms) tools=${toolCount} → ${response.stopReason || 'end'}, called: ${toolNames}`);

      return response;
    }

    // Fallback: Use regular complete without tools
    console.warn('[LLMService] ⚠ Provider does not support completeWithTools, tools unavailable');
    const response = await this.main.complete(messages, options);
    return {
      ...response,
      toolUse: undefined,
      stopReason: 'end_turn',
    };
  }

  /**
   * Stream response using Main LLM
   */
  async generateStream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: LLMOptions
  ): Promise<void> {
    if (this.main.stream) {
      return this.main.stream(messages, callbacks, options);
    }
    // Fallback to non-streaming if not supported
    try {
      const response = await this.main.complete(messages, options);
      callbacks.onChunk(response.content);
      callbacks.onComplete(response);
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Stream response with tool use support
   * Streams text chunks while accumulating tool use blocks
   */
  async generateWithToolsStream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks & {
      onToolUse?: (toolUse: LLMResponseWithTools['toolUse']) => void;
    },
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const provider = this.main as unknown as {
      streamWithTools?: (
        messages: LLMMessage[],
        callbacks: StreamCallbacks & { onToolUse?: (toolUse: LLMResponseWithTools['toolUse']) => void },
        options?: LLMOptions
      ) => Promise<LLMResponseWithTools>;
    };

    if (typeof provider.streamWithTools === 'function') {
      return provider.streamWithTools(messages, callbacks, options);
    }

    // Fallback to non-streaming if streamWithTools not supported
    console.warn('[LLMService] ⚠ Provider does not support streamWithTools, falling back to non-streaming');
    const response = await this.generateWithTools(messages, options);
    callbacks.onChunk(response.content);
    if (response.toolUse && callbacks.onToolUse) {
      callbacks.onToolUse(response.toolUse);
    }
    callbacks.onComplete(response);
    return response;
  }

  /**
   * Check if streaming is supported
   */
  supportsStreaming(): boolean {
    return typeof this.main.stream === 'function';
  }

  /**
   * Quick generation using Fast LLM (for simple tasks)
   */
  async quickGenerate(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    return this.fast.complete(messages, options);
  }

  /**
   * Parse natural language config (.md) into structured JSON config
   */
  async parseTaskConfig(mdContent: string, existingConfig?: string): Promise<string> {
    const systemPrompt = `You are a task configuration parser. Convert the natural language task description into a structured JSON configuration.

The JSON should follow this schema:
{
  "name": "string - task name",
  "description": "string - what the task does",
  "trigger": {
    "type": "schedule" | "event" | "manual",
    "schedule": "cron expression if type is schedule",
    "event": "event name if type is event"
  },
  "actions": [
    {
      "type": "string - action type",
      "params": {}
    }
  ],
  "mcp": {
    "whitelist": ["allowed MCP servers"],
    "blacklist": ["blocked MCP servers"]
  },
  "skills": {
    "whitelist": ["allowed skills"],
    "blacklist": ["blocked skills"]
  },
  "notifications": {
    "onSuccess": boolean,
    "onError": boolean,
    "channels": ["notification channels"]
  }
}

Only output valid JSON, no explanations.`;

    const userMessage = existingConfig
      ? `Update this existing config:\n${existingConfig}\n\nBased on this description:\n${mdContent}`
      : `Convert this task description to JSON config:\n${mdContent}`;

    const response = await this.main.complete(
      [{ role: 'user', content: userMessage }],
      { systemPrompt, maxTokens: 2000 }
    );

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonStr = response.content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }

    // Validate JSON
    JSON.parse(jsonStr.trim());

    return jsonStr.trim();
  }

  getMainModel(): string {
    return this.main.model;
  }

  getFastModel(): string {
    return this.fast.model;
  }
}
