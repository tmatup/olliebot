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
  OpenAIEmbeddingResponse,
  OpenAIMessage,
  OpenAIToolChoice,
} from './openai-types.js';

/**
 * OpenAI LLM Provider
 *
 * Supports OpenAI models including:
 * - gpt-4o (most capable)
 * - gpt-4o-mini (fast, cheap)
 * - gpt-4-turbo
 * - gpt-3.5-turbo
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = 'gpt-4o',
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data: OpenAIChatCompletionResponse = await response.json();

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
   * Stream a completion from OpenAI
   */
  async stream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: LLMOptions
  ): Promise<void> {
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    };

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');

        for (const line of lines) {
          if (line === 'data: [DONE]') {
            continue;
          }

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
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
    const openaiMessages = this.convertMessagesWithTools(messages, options?.systemPrompt);

    // Convert tools to OpenAI function format
    const tools = options?.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    // Format tool_choice
    let toolChoice: OpenAIToolChoice | undefined;
    if (options?.toolChoice) {
      if (options.toolChoice === 'auto') {
        toolChoice = 'auto';
      } else if (options.toolChoice === 'none') {
        toolChoice = 'none';
      } else if (typeof options.toolChoice === 'object') {
        toolChoice = { type: 'function', function: { name: options.toolChoice.name } };
      }
    }

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = toolChoice || 'auto';
    }

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data: OpenAIChatCompletionResponse = await response.json();

    const choice = data.choices?.[0];
    const message = choice?.message;

    // Extract text content
    const content = message?.content || '';

    // Extract tool calls
    const toolUse: LLMToolUse[] = [];
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === 'function') {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            console.warn(`[OpenAI] Failed to parse tool arguments for ${toolCall.function.name}`);
          }
          toolUse.push({
            id: toolCall.id,
            name: toolCall.function.name,
            input: parsedArgs,
          });
        }
      }
    }

    // Map finish_reason to stopReason
    let stopReason: LLMResponseWithTools['stopReason'];
    if (choice?.finish_reason === 'tool_calls') {
      stopReason = 'tool_use';
    } else if (choice?.finish_reason === 'stop') {
      stopReason = 'end_turn';
    } else if (choice?.finish_reason === 'length') {
      stopReason = 'max_tokens';
    }

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
   * Generate embeddings using OpenAI embedding model
   */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding API error: ${response.status} ${error}`);
    }

    const data: OpenAIEmbeddingResponse = await response.json();
    return data.data?.[0]?.embedding || [];
  }

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): Array<{ role: string; content: string }> {
    const openaiMessages: Array<{ role: string; content: string }> = [];

    const systemMessage = messages.find((m) => m.role === 'system');
    const effectiveSystemPrompt = systemPrompt || systemMessage?.content;

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

      openaiMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return openaiMessages;
  }

  /**
   * Convert messages for tool-enabled calls, handling tool_calls and tool results
   */
  private convertMessagesWithTools(
    messages: LLMMessage[],
    systemPrompt?: string
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    const systemMessage = messages.find((m) => m.role === 'system');
    const effectiveSystemPrompt = systemPrompt || systemMessage?.content;

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
        openaiMessages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolUse.map((tu) => ({
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

      // Handle user messages that contain tool_result (from our tool execution loop)
      if (msg.role === 'user' && msg.content.startsWith('{')) {
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

      // Regular message
      openaiMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return openaiMessages;
  }
}
