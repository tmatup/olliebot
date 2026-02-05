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

// Type alias for Anthropic content block parameters
type ContentBlockParam = Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam;
const DEBUG_LLM = ['1', 'true', 'yes', 'on'].includes((process.env.DEBUG_LLM || '').toLowerCase());

/**
 * Sanitize tool name to match Anthropic's pattern: ^[a-zA-Z0-9_-]{1,128}$
 * Replaces dots and other invalid characters with underscores.
 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

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
    const systemContent = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : undefined;

    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as string | ContentBlockParam[],
      }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt ?? systemContent,
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
    const systemContent = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : undefined;

    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as string | ContentBlockParam[],
      }));

    try {
      const stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system: options?.systemPrompt ?? systemContent,
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
    const systemContent = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : undefined;
    const conversationMessages = this.formatMessagesForApi(messages);

    // Build reverse map: sanitized name -> original name
    const toolNameMap = new Map<string, string>();
    const tools = options?.tools?.map((t) => {
      const sanitized = sanitizeToolName(t.name);
      toolNameMap.set(sanitized, t.name);
      return {
        name: sanitized,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      };
    });

    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined;
    if (options?.toolChoice) {
      if (options.toolChoice === 'auto') {
        toolChoice = { type: 'auto' };
      } else if (options.toolChoice === 'none') {
        toolChoice = undefined;
      } else if (typeof options.toolChoice === 'object') {
        toolChoice = { type: 'tool', name: sanitizeToolName(options.toolChoice.name) };
      }
    }

    if (DEBUG_LLM) {
      const lastMessageContent = conversationMessages[conversationMessages.length - 1]?.content;
      console.log('[Anthropic] streamWithTools request:', {
        model: this.model,
        messageCount: conversationMessages.length,
        toolCount: tools?.length || 0,
        lastMessageRole: conversationMessages[conversationMessages.length - 1]?.role,
        lastMessageContentType: Array.isArray(lastMessageContent)
          ? lastMessageContent.map((c: { type: string }) => c.type)
          : 'string',
      });
    }

    let stream;
    try {
      stream = await this.client.messages.stream({
        model: this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system: options?.systemPrompt ?? systemContent,
        messages: conversationMessages,
        temperature: options?.temperature,
        stop_sequences: options?.stopSequences,
        tools,
        tool_choice: tools?.length ? toolChoice || { type: 'auto' } : undefined,
      });
    } catch (error) {
      console.error('[Anthropic] Stream creation failed:', error);
      throw error;
    }

    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const toolUseBlocks: LLMToolUse[] = [];
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
    let stopReason: LLMResponseWithTools['stopReason'] = 'end_turn';

    try {
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
          if (DEBUG_LLM) {
            console.log(`[Anthropic] Streaming chunk (${chunk.length} chars)`);
          }
          callbacks.onChunk(chunk);
        } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.inputJson += event.delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          // Map sanitized name back to original
          const originalName = toolNameMap.get(currentToolUse.name) || currentToolUse.name;
          toolUseBlocks.push({
            id: currentToolUse.id,
            name: originalName,
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
    } catch (error) {
      console.error('[Anthropic] Stream processing failed:', error);
      throw error;
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
          // Content blocks need to be combined with tool_use blocks
          let contentBlocks: ContentBlockParam[] = [];

          if (m.content) {
            if (typeof m.content === 'string') {
              contentBlocks.push({ type: 'text', text: m.content });
            } else {
              // Already an array of content blocks (multimodal or tool_result)
              contentBlocks = m.content.map((block): ContentBlockParam => {
                if (block.type === 'text') {
                  return { type: 'text', text: block.text || '' };
                } else if (block.type === 'image' && block.source) {
                  return {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: block.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                      data: block.source.data,
                    },
                  };
                } else if (block.type === 'tool_result' && block.tool_use_id) {
                  return {
                    type: 'tool_result',
                    tool_use_id: block.tool_use_id,
                    content: String(block.content || ''),
                    is_error: block.is_error,
                  };
                }
                return { type: 'text', text: '' };
              });
            }
          }

          return {
            role: m.role as 'user' | 'assistant',
            content: [
              ...contentBlocks,
              ...m.toolUse.map((tu) => ({
                type: 'tool_use' as const,
                id: tu.id,
                name: sanitizeToolName(tu.name),
                input: tu.input,
              })),
            ],
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content as string | ContentBlockParam[],
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
    const systemContent = typeof systemMessage?.content === 'string'
      ? systemMessage.content
      : undefined;
    const conversationMessages = this.formatMessagesForApi(messages);

    // Build reverse map: sanitized name -> original name
    const toolNameMap = new Map<string, string>();
    const tools = options?.tools?.map((t) => {
      const sanitized = sanitizeToolName(t.name);
      toolNameMap.set(sanitized, t.name);
      return {
        name: sanitized,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      };
    });

    // Format tool_choice
    let toolChoice: Anthropic.MessageCreateParams['tool_choice'] | undefined;
    if (options?.toolChoice) {
      if (options.toolChoice === 'auto') {
        toolChoice = { type: 'auto' };
      } else if (options.toolChoice === 'none') {
        toolChoice = undefined; // Don't pass tools
      } else if (typeof options.toolChoice === 'object') {
        toolChoice = { type: 'tool', name: sanitizeToolName(options.toolChoice.name) };
      }
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: options?.systemPrompt ?? systemContent,
      messages: conversationMessages,
      temperature: options?.temperature,
      stop_sequences: options?.stopSequences,
      tools,
      tool_choice: tools?.length ? toolChoice || { type: 'auto' } : undefined,
    });

    // Extract text content
    const textBlocks = response.content.filter((c) => c.type === 'text');
    const textContent = textBlocks.map((c) => c.type === 'text' ? c.text : '').join('');

    // Extract tool_use content and map sanitized names back to original
    const toolUseBlocks = response.content.filter((c) => c.type === 'tool_use');
    const toolUse: LLMToolUse[] = toolUseBlocks.map((block) => {
      if (block.type === 'tool_use') {
        const originalName = toolNameMap.get(block.name) || block.name;
        return {
          id: block.id,
          name: originalName,
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
