/**
 * OpenAI-Compatible Base Provider
 *
 * Shared implementation for OpenAI and Azure OpenAI providers.
 * Both use the same API format, differing only in URL/auth.
 */

import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMResponseWithTools,
  LLMToolUse,
  StreamCallbacks,
} from './types.js';
import type {
  OpenAIChatCompletionResponse,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIToolCall,
  OpenAIToolChoice,
} from './openai-types.js';

/**
 * Configuration for making OpenAI-compatible API requests.
 */
export interface OpenAIRequestConfig {
  url: string;
  headers: Record<string, string>;
  /** Whether to include model in request body (OpenAI yes, Azure no) */
  includeModelInBody: boolean;
  /** Log prefix for error messages */
  logPrefix: string;
}

/**
 * Abstract base class for OpenAI-compatible providers.
 * Subclasses must implement getRequestConfig() to provide URL/auth specifics.
 */
export abstract class OpenAIBaseProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly model: string;

  /**
   * Get configuration for making a chat completions request.
   */
  protected abstract getRequestConfig(): OpenAIRequestConfig;

  /**
   * Fetch with retry for transient errors (5xx, 429).
   * Uses exponential backoff with jitter.
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    logPrefix: string,
    maxRetries: number = 3
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // Don't retry on success or client errors (4xx except 429)
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          return response;
        }

        // Retry on 5xx server errors or 429 rate limit
        if (response.status >= 500 || response.status === 429) {
          const errorText = await response.text();
          lastError = new Error(`${logPrefix} API error: ${response.status} ${errorText}`);

          if (attempt < maxRetries) {
            const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            console.warn(`${logPrefix} Retrying after ${response.status} error (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(backoffMs)}ms`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          console.warn(`${logPrefix} Retrying after network error (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(backoffMs)}ms`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const config = this.getRequestConfig();
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    const requestBody: Record<string, unknown> = {
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (config.includeModelInBody) {
      requestBody.model = this.model;
    }

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    const response = await this.fetchWithRetry(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(requestBody),
    }, config.logPrefix);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${config.logPrefix} API error: ${response.status} ${error}`);
    }

    const data = await response.json() as OpenAIChatCompletionResponse;

    const choice = data.choices?.[0];
    const content = choice?.message?.content || '';

    return {
      content,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens || 0,
            outputTokens: data.usage.completion_tokens || 0,
          }
        : undefined,
      model: data.model || this.model,
      finishReason: choice?.finish_reason,
    };
  }

  /**
   * Stream a completion
   */
  async stream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: LLMOptions
  ): Promise<void> {
    const config = this.getRequestConfig();
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    const requestBody: Record<string, unknown> = {
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    };

    if (config.includeModelInBody) {
      requestBody.model = this.model;
    }

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    try {
      const response = await this.fetchWithRetry(config.url, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify(requestBody),
      }, config.logPrefix);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`${config.logPrefix} API error: ${response.status} ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const text = lineBuffer + chunk;
        const lines = text.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === 'data: [DONE]') {
            continue;
          }

          if (trimmedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmedLine.slice(6));
              const delta = data.choices?.[0]?.delta?.content;

              if (delta) {
                fullContent += delta;
                callbacks.onChunk(delta);
              }

              if (data.usage) {
                inputTokens = data.usage.prompt_tokens || 0;
                outputTokens = data.usage.completion_tokens || 0;
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      callbacks.onComplete({
        content: fullContent,
        usage: { inputTokens, outputTokens },
        model: this.model,
        finishReason: 'stop',
      });
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Complete with tool use support
   */
  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const config = this.getRequestConfig();
    const openaiMessages = this.convertMessagesWithTools(messages, options?.systemPrompt);

    const tools = options?.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const toolChoice = this.formatToolChoice(options?.toolChoice);

    const requestBody: Record<string, unknown> = {
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (config.includeModelInBody) {
      requestBody.model = this.model;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice || 'auto';
    }

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    const response = await this.fetchWithRetry(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(requestBody),
    }, config.logPrefix);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${config.logPrefix} API error: ${response.status} ${error}`);
    }

    const data = await response.json() as OpenAIChatCompletionResponse;

    const choice = data.choices?.[0];
    const message = choice?.message;
    const content = message?.content || '';

    const toolUse = this.extractToolCalls(message?.tool_calls, config.logPrefix);
    const stopReason = this.mapFinishReason(choice?.finish_reason);

    return {
      content,
      toolUse: toolUse.length > 0 ? toolUse : undefined,
      stopReason,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens || 0,
            outputTokens: data.usage.completion_tokens || 0,
          }
        : undefined,
      model: data.model || this.model,
      finishReason: choice?.finish_reason,
    };
  }

  /**
   * Stream with tool use support
   */
  async streamWithTools(
    messages: LLMMessage[],
    callbacks: StreamCallbacks & {
      onToolUse?: (toolUse: LLMToolUse[]) => void;
    },
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const config = this.getRequestConfig();
    const openaiMessages = this.convertMessagesWithTools(messages, options?.systemPrompt);

    const tools = options?.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const toolChoice = this.formatToolChoice(options?.toolChoice);

    const requestBody: Record<string, unknown> = {
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (config.includeModelInBody) {
      requestBody.model = this.model;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice || 'auto';
    }

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    const response = await this.fetchWithRetry(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(requestBody),
    }, config.logPrefix);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${config.logPrefix} API error: ${response.status} ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;
    const toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const text = lineBuffer + chunk;
      const lines = text.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine === 'data: [DONE]') {
          continue;
        }

        if (trimmedLine.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmedLine.slice(6));
            const delta = data.choices?.[0]?.delta;
            const choice = data.choices?.[0];

            if (delta?.content) {
              fullContent += delta.content;
              callbacks.onChunk(delta.content);
            }

            // Handle tool calls - accumulate across chunks
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index;

                if (!toolCallsInProgress.has(index)) {
                  toolCallsInProgress.set(index, {
                    id: toolCall.id || '',
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                  });
                } else {
                  const existing = toolCallsInProgress.get(index)!;
                  if (toolCall.id) existing.id = toolCall.id;
                  if (toolCall.function?.name) existing.name = toolCall.function.name;
                  if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
                }
              }
            }

            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }

            if (data.usage) {
              inputTokens = data.usage.prompt_tokens || 0;
              outputTokens = data.usage.completion_tokens || 0;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    }

    // Convert accumulated tool calls, filtering invalid ones
    const toolUse: LLMToolUse[] = [];
    for (const [, tc] of toolCallsInProgress) {
      if (!tc.id || !tc.name) {
        console.warn(`${config.logPrefix} Skipping invalid tool call: id=${tc.id}, name=${tc.name}`);
        continue;
      }

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.arguments || '{}');
      } catch {
        console.warn(`${config.logPrefix} Failed to parse tool arguments for ${tc.name}: ${tc.arguments}`);
      }
      toolUse.push({
        id: tc.id,
        name: tc.name,
        input: parsedArgs,
      });
    }

    if (toolUse.length > 0 && callbacks.onToolUse) {
      callbacks.onToolUse(toolUse);
    }

    const stopReason = this.mapFinishReason(finishReason);

    const result: LLMResponseWithTools = {
      content: fullContent,
      toolUse: toolUse.length > 0 ? toolUse : undefined,
      stopReason,
      usage: { inputTokens, outputTokens },
      model: this.model,
      finishReason,
    };

    callbacks.onComplete(result);
    return result;
  }

  /**
   * Generate embeddings - must be implemented by subclass due to different URL construction
   */
  abstract embed(text: string, embeddingModel?: string): Promise<number[]>;

  // ===========================================================================
  // Protected helper methods
  // ===========================================================================

  protected formatToolChoice(
    toolChoice?: LLMOptions['toolChoice']
  ): OpenAIToolChoice | undefined {
    if (!toolChoice) return undefined;

    if (toolChoice === 'auto') {
      return 'auto';
    } else if (toolChoice === 'none') {
      return 'none';
    } else if (typeof toolChoice === 'object') {
      return { type: 'function', function: { name: toolChoice.name } };
    }
    return undefined;
  }

  protected mapFinishReason(
    finishReason?: string
  ): LLMResponseWithTools['stopReason'] {
    if (finishReason === 'tool_calls') {
      return 'tool_use';
    } else if (finishReason === 'stop') {
      return 'end_turn';
    } else if (finishReason === 'length') {
      return 'max_tokens';
    }
    return undefined;
  }

  protected extractToolCalls(
    toolCalls: OpenAIToolCall[] | undefined,
    logPrefix: string
  ): LLMToolUse[] {
    const toolUse: LLMToolUse[] = [];

    if (!toolCalls || !Array.isArray(toolCalls)) {
      return toolUse;
    }

    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function') {
        if (!toolCall.id || !toolCall.function?.name) {
          console.warn(`${logPrefix} Skipping invalid tool call: id=${toolCall.id}, name=${toolCall.function?.name}`);
          continue;
        }

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          console.warn(`${logPrefix} Failed to parse tool arguments for ${toolCall.function.name}: ${toolCall.function.arguments}`);
        }
        toolUse.push({
          id: toolCall.id,
          name: toolCall.function.name,
          input: parsedArgs,
        });
      }
    }

    return toolUse;
  }

  protected convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    const systemMessage = messages.find((m) => m.role === 'system');
    const systemContent = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : undefined;
    const effectiveSystemPrompt = systemPrompt || systemContent;

    if (effectiveSystemPrompt) {
      openaiMessages.push({
        role: 'system',
        content: effectiveSystemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        continue;
      }

      if (Array.isArray(msg.content)) {
        const parts: OpenAIContentPart[] = msg.content.map((block): OpenAIContentPart => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text || '' };
          } else if (block.type === 'image' && block.source) {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            };
          }
          return { type: 'text', text: '' };
        });
        openaiMessages.push({
          role: msg.role,
          content: parts,
        });
      } else {
        openaiMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return openaiMessages;
  }

  protected convertMessagesWithTools(
    messages: LLMMessage[],
    systemPrompt?: string
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    const systemMessage = messages.find((m) => m.role === 'system');
    const systemContent = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : undefined;
    const effectiveSystemPrompt = systemPrompt || systemContent;

    if (effectiveSystemPrompt) {
      openaiMessages.push({
        role: 'system',
        content: effectiveSystemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        continue;
      }

      // Handle assistant messages with tool use
      if (msg.role === 'assistant' && msg.toolUse && msg.toolUse.length > 0) {
        const validToolUse = msg.toolUse.filter((tu) => tu.id && tu.name);

        if (validToolUse.length === 0) {
          const textContent = typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
              : '';
          if (textContent) {
            openaiMessages.push({
              role: 'assistant',
              content: textContent,
            });
          }
          continue;
        }

        const assistantText = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
            : null;
        openaiMessages.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: validToolUse.map((tu) => ({
            id: tu.id,
            type: 'function' as const,
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            },
          })),
        });
        continue;
      }

      // Handle user messages that contain tool_result
      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.type === 'tool_result' && parsed.tool_use_id) {
            openaiMessages.push({
              role: 'tool',
              tool_call_id: parsed.tool_use_id,
              content: typeof parsed.content === 'string'
                ? parsed.content
                : JSON.stringify(parsed.content),
            });
            continue;
          }
        } catch {
          // Not a tool result JSON, treat as normal message
        }
      }

      // Regular message - handle multimodal content
      if (Array.isArray(msg.content)) {
        const parts: OpenAIContentPart[] = msg.content.map((block): OpenAIContentPart => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text || '' };
          } else if (block.type === 'image' && block.source) {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${block.source.media_type};base64,${block.source.data}`,
              },
            };
          }
          return { type: 'text', text: '' };
        });
        openaiMessages.push({
          role: msg.role,
          content: parts,
        });
      } else {
        openaiMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return openaiMessages;
  }
}
