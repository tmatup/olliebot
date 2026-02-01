/**
 * OpenAI LLM Provider
 *
 * Supports OpenAI models including:
 * - gpt-4o (most capable)
 * - gpt-4o-mini (fast, cheap)
 * - gpt-4-turbo
 * - gpt-3.5-turbo
 */

import { OpenAIBaseProvider, type OpenAIRequestConfig } from './openai-base.js';
import type { OpenAIEmbeddingResponse } from './openai-types.js';

export class OpenAIProvider extends OpenAIBaseProvider {
  readonly name = 'openai';
  readonly model: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model: string = 'gpt-4o',
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  protected getRequestConfig(): OpenAIRequestConfig {
    return {
      url: `${this.baseUrl}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      includeModelInBody: true,
      logPrefix: '[OpenAI]',
    };
  }

  /**
   * Generate embeddings using OpenAI embedding model
   */
  async embed(text: string): Promise<number[]> {
    const config = this.getRequestConfig();

    const response = await this.fetchWithRetry(
      `${this.baseUrl}/embeddings`,
      {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: text,
        }),
      },
      config.logPrefix
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding API error: ${response.status} ${error}`);
    }

    const data = await response.json() as OpenAIEmbeddingResponse;
    return data.data?.[0]?.embedding || [];
  }
}
