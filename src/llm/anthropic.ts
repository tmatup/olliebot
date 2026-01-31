import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMResponseWithTools,
  LLMToolUse,
  StreamCallbacks,
} from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;

  private client: Anthropic;

  constructor(apiKey: string, model: string = 'claude-sonnet-4-20250514') {
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    // Separate system message from conversation
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt ?? systemMessage?.content,
      messages: conversationMessages,
      temperature: options?.temperature,
      stop_sequences: options?.stopSequences,
    });

    const textContent = response.content.find((c) => c.type === 'text');

    return {
      content: textContent?.text ?? '',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
      finishReason: response.stop_reason ?? undefined,
    };
  }

  async stream(
    messages: LLMMessage[],
    callbacks: StreamCallbacks,
    options?: LLMOptions
  ): Promise<void> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    try {
      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system: options?.systemPrompt ?? systemMessage?.content,
        messages: conversationMessages,
        temperature: options?.temperature,
        stop_sequences: options?.stopSequences,
      });

      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const chunk = event.delta.text;
          fullContent += chunk;
          callbacks.onChunk(chunk);
        } else if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens;
        } else if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens;
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
   * Stream with tool use support
   * Streams text chunks while accumulating tool use blocks
   */
  async streamWithTools(
    messages: LLMMessage[],
    callbacks: StreamCallbacks & {
      onToolUse?: (toolUse: LLMToolUse[]) => void;
    },
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = this.formatMessagesForApi(messages);

    const tools = options?.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined;
    if (options?.toolChoice) {
      if (options.toolChoice === 'auto') {
        toolChoice = { type: 'auto' };
      } else if (options.toolChoice === 'none') {
        toolChoice = undefined;
      } else if (typeof options.toolChoice === 'object') {
        toolChoice = { type: 'tool', name: options.toolChoice.name };
      }
    }

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt ?? systemMessage?.content,
      messages: conversationMessages,
      temperature: options?.temperature,
      stop_sequences: options?.stopSequences,
      tools,
      tool_choice: tools?.length ? toolChoice || { type: 'auto' } : undefined,
    });

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const toolUseBlocks: LLMToolUse[] = [];
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
    let stopReason: LLMResponseWithTools['stopReason'] = 'end_turn';

    for await (const event of stream) {
      if (event.type === 'message_start' && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: '',
          };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          const chunk = event.delta.text;
          fullContent += chunk;
          callbacks.onChunk(chunk);
        } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.inputJson += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          toolUseBlocks.push({
            id: currentToolUse.id,
            name: currentToolUse.name,
            input: JSON.parse(currentToolUse.inputJson || '{}'),
          });
          currentToolUse = null;
        }
      } else if (event.type === 'message_delta') {
        if (event.usage) {
          outputTokens = event.usage.output_tokens;
        }
        if (event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason as LLMResponseWithTools['stopReason'];
        }
      }
    }

    // Notify about tool use if any
    if (toolUseBlocks.length > 0 && callbacks.onToolUse) {
      callbacks.onToolUse(toolUseBlocks);
    }

    const result: LLMResponseWithTools = {
      content: fullContent,
      toolUse: toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
      stopReason,
      usage: { inputTokens, outputTokens },
      model: this.model,
      finishReason: stopReason ?? undefined,
    };

    callbacks.onComplete(result);
    return result;
  }

  /**
   * Format messages for Anthropic API (shared helper)
   */
  private formatMessagesForApi(messages: LLMMessage[]) {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.toolUse && m.toolUse.length > 0) {
          return {
            role: m.role as 'user' | 'assistant',
            content: [
              ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
              ...m.toolUse.map((tu) => ({
                type: 'tool_use' as const,
                id: tu.id,
                name: tu.name,
                input: tu.input,
              })),
            ],
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      });
  }

  /**
   * Complete with tool use support
   */
  async completeWithTools(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponseWithTools> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = this.formatMessagesForApi(messages);

    // Format tools for Anthropic API
    const tools = options?.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    // Format tool_choice
    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined;
    if (options?.toolChoice) {
      if (options.toolChoice === 'auto') {
        toolChoice = { type: 'auto' };
      } else if (options.toolChoice === 'none') {
        toolChoice = undefined; // Don't pass tools
      } else if (typeof options.toolChoice === 'object') {
        toolChoice = { type: 'tool', name: options.toolChoice.name };
      }
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt ?? systemMessage?.content,
      messages: conversationMessages,
      temperature: options?.temperature,
      stop_sequences: options?.stopSequences,
      tools,
      tool_choice: tools?.length ? toolChoice || { type: 'auto' } : undefined,
    });

    // Extract text content
    const textBlocks = response.content.filter((c) => c.type === 'text');
    const textContent = textBlocks.map((c) => c.type === 'text' ? c.text : '').join('');

    // Extract tool_use content
    const toolUseBlocks = response.content.filter((c) => c.type === 'tool_use');
    const toolUse: LLMToolUse[] = toolUseBlocks.map((block) => {
      if (block.type === 'tool_use') {
        return {
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      }
      throw new Error('Unexpected content block type');
    });

    return {
      content: textContent,
      toolUse: toolUse.length > 0 ? toolUse : undefined,
      stopReason: response.stop_reason as LLMResponseWithTools['stopReason'],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
      finishReason: response.stop_reason ?? undefined,
    };
  }
}
