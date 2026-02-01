/**
 * Computer Use Providers
 *
 * Exports all Computer Use provider implementations.
 */

export * from './types.js';
export { GoogleComputerUseProvider } from './google.js';
export { AzureOpenAIComputerUseProvider } from './azure-openai.js';

import type { ComputerUseProvider } from '../../../types.js';
import type { IComputerUseProvider, ComputerUseProviderConfig } from './types.js';
import { GoogleComputerUseProvider } from './google.js';
import { AzureOpenAIComputerUseProvider } from './azure-openai.js';

/**
 * Creates a Computer Use provider based on the provider type.
 */
export function createComputerUseProvider(
  provider: ComputerUseProvider,
  config?: ComputerUseProviderConfig
): IComputerUseProvider {
  switch (provider) {
    case 'azure_openai':
      return new AzureOpenAIComputerUseProvider(config);

    case 'google':
      return new GoogleComputerUseProvider(config);

    case 'anthropic':
      // TODO: Implement Anthropic provider
      console.warn('[Browser] Anthropic Computer Use provider not yet implemented, falling back to Azure OpenAI');
      return new AzureOpenAIComputerUseProvider(config);

    case 'openai':
      // TODO: Implement OpenAI provider
      console.warn('[Browser] OpenAI CUA provider not yet implemented, falling back to Azure OpenAI');
      return new AzureOpenAIComputerUseProvider(config);

    default:
      return new AzureOpenAIComputerUseProvider(config);
  }
}
