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

import { OpenAIBaseProvider, type OpenAIRequestConfig } from './openai-base.js';

export interface AzureOpenAIConfig {
  apiKey: string;
  endpoint: string; // e.g., https://your-resource.openai.azure.com
  deploymentName: string; // The deployment name in Azure
  apiVersion?: string; // e.g., 2024-02-15-preview
}

export class AzureOpenAIProvider extends OpenAIBaseProvider {
  readonly name = 'azure_openai';
  readonly model: string;

  private config: AzureOpenAIConfig;
  private apiVersion: string;

  constructor(config: AzureOpenAIConfig) {
    super();
    this.config = config;
    this.model = config.deploymentName;
    this.apiVersion = config.apiVersion || '2024-02-15-preview';
  }

  protected getRequestConfig(): OpenAIRequestConfig {
    return {
      url: `${this.config.endpoint}/openai/deployments/${this.config.deploymentName}/chat/completions?api-version=${this.apiVersion}`,
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
      },
      includeModelInBody: false, // Azure uses deployment name in URL, not body
      logPrefix: '[AzureOpenAI]',
    };
  }

  /**
   * Generate embeddings using Azure OpenAI embedding deployment
   */
  async embed(text: string, embeddingDeployment?: string): Promise<number[]> {
    const deployment = embeddingDeployment || 'text-embedding-ada-002';
    const url = `${this.config.endpoint}/openai/deployments/${deployment}/embeddings?api-version=${this.apiVersion}`;

    const response = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          input: text,
        }),
      },
      '[AzureOpenAI]'
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure OpenAI embedding API error: ${response.status} ${error}`);
    }

    const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
    return data.data?.[0]?.embedding || [];
  }
}
