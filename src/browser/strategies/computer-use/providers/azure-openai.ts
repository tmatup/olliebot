/**
 * Azure OpenAI Computer Use Provider
 *
 * Extends OpenAI provider with Azure-specific authentication and endpoints.
 */

import type { IComputerUseProvider, ComputerUseProviderConfig } from './types.js';
import { OpenAIComputerUseProvider } from './openai.js';

/**
 * Azure OpenAI Computer Use Provider.
 *
 * Uses shared Azure OpenAI credentials from environment:
 * - AZURE_OPENAI_API_KEY: API key
 * - AZURE_OPENAI_ENDPOINT: Base endpoint (will append /openai/responses path)
 * - BROWSER_MODEL: Model/deployment name (defaults to computer-use-preview)
 */
export class AzureOpenAIComputerUseProvider extends OpenAIComputerUseProvider implements IComputerUseProvider {
  override readonly name: 'azure_openai' = 'azure_openai';

  constructor(config: ComputerUseProviderConfig = {}) {
    super(config);
    // Override with Azure credentials
    this.apiKey = config.apiKey || process.env.AZURE_OPENAI_API_KEY || '';
    const baseEndpoint = config.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT || '';
    this.endpoint = buildAzureEndpointUrl(baseEndpoint);
  }

  protected override get providerName(): string {
    return 'AzureOpenAI';
  }

  protected override get authHeader(): string {
    return 'api-key';
  }

  protected override get authValue(): string {
    return this.apiKey;
  }

  protected override get includeMaxTokens(): boolean {
    return false;
  }

  protected override get screenshotOutputType(): 'computer_screenshot' | 'input_image' {
    return 'input_image';
  }

  override isAvailable(): boolean {
    return !!(this.apiKey && this.endpoint);
  }
}

/**
 * Builds the full endpoint URL for the Azure OpenAI Responses API.
 */
function buildAzureEndpointUrl(baseEndpoint: string): string {
  if (!baseEndpoint) return '';

  // If endpoint already contains /openai/responses, use as-is
  if (baseEndpoint.includes('/openai/responses')) {
    return baseEndpoint;
  }

  // Otherwise, append the Responses API path
  const base = baseEndpoint.replace(/\/$/, ''); // Remove trailing slash
  return `${base}/openai/responses?api-version=2025-04-01-preview`;
}
