/**
 * Embedding Providers
 * Various embedding service implementations for vector generation.
 */

import type { EmbeddingProvider } from './types.js';

/**
 * Google embedding provider using text-embedding-004 model.
 */
export class GoogleEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private dimensions = 768;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.baseUrl}/models/text-embedding-004:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = (await response.json()) as { embedding?: { values?: number[] } };
    return data.embedding?.values || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Google doesn't have a batch endpoint, so we parallelize
    const promises = texts.map((text) => this.embed(text));
    return Promise.all(promises);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * OpenAI embedding provider.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private dimensions = 1536;

  constructor(
    apiKey: string,
    model: string = 'text-embedding-3-small',
    baseUrl: string = 'https://api.openai.com/v1'
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;

    // Update dimensions based on model
    if (model === 'text-embedding-3-large') {
      this.dimensions = 3072;
    } else if (model === 'text-embedding-3-small') {
      this.dimensions = 1536;
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.status}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding API error: ${response.status}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.map((item) => item.embedding) || [];
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * Azure OpenAI embedding provider.
 */
export class AzureOpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private endpoint: string;
  private apiVersion: string;
  private deploymentName: string;
  private dimensions = 1536;

  constructor(
    apiKey: string,
    endpoint: string,
    apiVersion: string = '2024-02-15-preview',
    deploymentName: string = 'text-embedding-ada-002'
  ) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.apiVersion = apiVersion;
    this.deploymentName = deploymentName;
  }

  async embed(text: string): Promise<number[]> {
    const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/embeddings?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI embedding error: ${response.status}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding || [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/embeddings?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey,
      },
      body: JSON.stringify({ input: texts }),
    });

    if (!response.ok) {
      throw new Error(`Azure OpenAI embedding error: ${response.status}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.map((item) => item.embedding) || [];
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

/**
 * Voyage AI embedding provider.
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private baseUrl = 'https://api.voyageai.com/v1';
  private model: string;
  private dimensions = 1024;

  constructor(apiKey: string, model: string = 'voyage-2') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`Voyage API error: ${response.status}`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((item) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}
