import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from './types.js';

/**
 * Azure OpenAI LLM Provider
 *
 * Connects to Azure-hosted OpenAI models.
 * Requires:
 * - Azure OpenAI resource endpoint
 * - API key
 * - Deployment name (model deployment)
 * - API version
 */
export interface AzureOpenAIConfig {
  apiKey: string;
  endpoint: string; // e.g., https://your-resource.openai.azure.com
  deploymentName: string; // The deployment name in Azure
  apiVersion?: string; // e.g., 2024-02-15-preview
}

export class AzureOpenAIProvider implements LLMProvider {
  readonly name = 'azure_openai';
  readonly model: string;

  private config: AzureOpenAIConfig;
  private apiVersion: string;

  constructor(config: AzureOpenAIConfig) {
    this.config = config;
    this.model = config.deploymentName;
    this.apiVersion = config.apiVersion || '2024-02-15-preview';
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    // Convert messages to OpenAI format
    const openaiMessages = this.convertMessages(messages, options?.systemPrompt);

    const requestBody: Record<string, unknown> = {
      messages: openaiMessages,
      max_completion_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };

    if (options?.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    const url = `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json();

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
      model: this.model,
      finishReason: choice?.finish_reason,
    };
  }

  /**
   * Generate embeddings using Azure OpenAI embedding deployment
   */
  async embed(text: string, embeddingDeployment?: string): Promise<number[]> {
    const deployment = embeddingDeployment || 'text-embedding-ada-002';
    const url = `${this.config.endpoint}/openai/deployments/${deployment}/embeddings?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure OpenAI embedding API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || [];
  }

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): Array<{ role: string; content: string }> {
    const openaiMessages: Array<{ role: string; content: string }> = [];

    // Add system prompt if provided
    const systemMessage = messages.find((m) => m.role === 'system');
    const effectiveSystemPrompt = systemPrompt || systemMessage?.content;

    if (effectiveSystemPrompt) {
      openaiMessages.push({
        role: 'system',
        content: effectiveSystemPrompt,
      });
    }

    // Add conversation messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        continue; // Already handled
      }

      openaiMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    return openaiMessages;
  }
}
