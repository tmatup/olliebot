import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';

/**
 * Google Gemini LLM Provider
 *
 * Supports Gemini models including:
 * - gemini-2.5-flash-lite (fast, cheap)
 * - gemini-2.5-flash (balanced)
 * - gemini-2.5-pro (most capable)
 */
export class GoogleProvider implements LLMProvider {
  readonly name = 'google';
  readonly model: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = 'gemini-2.5-flash-lite'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    // Convert messages to Gemini format
    const contents = this.convertMessages(messages, options?.systemPrompt);

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
        stopSequences: options?.stopSequences,
      },
    };

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${error}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    // Extract response content
    const candidate = data.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text || '';

    // Extract usage if available
    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
        }
      : undefined;

    return {
      content,
      usage,
      model: this.model,
      finishReason: candidate?.finishReason,
    };
  }

  /**
   * Generate embeddings using Gemini embedding model
   */
  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/models/text-embedding-004:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: {
          parts: [{ text }],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini embedding API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { embedding?: { values?: number[] } };
    return data.embedding?.values || [];
  }

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    // Helper to extract text content from LLMMessage
    const getTextContent = (content: LLMMessage['content']): string => {
      if (typeof content === 'string') {
        return content;
      }
      // For array of content blocks, concatenate text parts
      return content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    };

    // Handle system message
    const systemMessage = messages.find((m) => m.role === 'system');
    const effectiveSystemPrompt = systemPrompt || (systemMessage ? getTextContent(systemMessage.content) : undefined);

    // Gemini uses system_instruction or prepends to first user message
    // For simplicity, prepend to first user message
    let systemPrepended = false;

    for (const msg of messages) {
      if (msg.role === 'system') {
        continue; // Skip system messages, handled separately
      }

      const role = msg.role === 'user' ? 'user' : 'model';
      let text = getTextContent(msg.content);

      // Prepend system prompt to first user message
      if (!systemPrepended && role === 'user' && effectiveSystemPrompt) {
        text = `${effectiveSystemPrompt}\n\n${text}`;
        systemPrepended = true;
      }

      contents.push({
        role,
        parts: [{ text }],
      });
    }

    return contents;
  }
}
