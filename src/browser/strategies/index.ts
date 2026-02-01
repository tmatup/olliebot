/**
 * Browser Strategies
 *
 * Strategy pattern implementation for browser automation.
 * Provides factory function to create strategies based on configuration.
 */

import type { BrowserConfig } from '../types.js';
import type { IBrowserStrategy, IStrategyLLMService } from './types.js';
import { DOMBrowserStrategy } from './dom/index.js';
import { ComputerUseBrowserStrategy } from './computer-use/index.js';

export * from './types.js';
export * from './base.js';
export { DOMBrowserStrategy } from './dom/index.js';
export { ComputerUseBrowserStrategy } from './computer-use/index.js';

/**
 * Creates a browser strategy based on configuration.
 *
 * @param config - Browser configuration
 * @param llmService - Optional LLM service for strategies that need it
 * @returns The appropriate browser strategy
 */
export function createStrategy(
  config: BrowserConfig,
  llmService?: IStrategyLLMService
): IBrowserStrategy {
  if (config.strategy === 'computer-use') {
    return new ComputerUseBrowserStrategy({
      provider: config.computerUseProvider,
      llmService,
    });
  }

  return new DOMBrowserStrategy({
    provider: config.domProvider,
    llmService,
  });
}

/**
 * Gets the list of available strategies.
 */
export function getAvailableStrategies(): Array<{
  type: string;
  name: string;
  description: string;
}> {
  return [
    {
      type: 'computer-use',
      name: 'Computer Use',
      description: 'Screenshot-based with coordinate actions. Works on any visual UI.',
    },
    {
      type: 'dom',
      name: 'DOM',
      description: 'Playwright selectors with LLM reasoning. Faster for known sites.',
    },
  ];
}

/**
 * Gets the list of available providers for a strategy.
 */
export function getAvailableProviders(strategyType: 'computer-use' | 'dom'): Array<{
  id: string;
  name: string;
  description: string;
}> {
  if (strategyType === 'computer-use') {
    return [
      {
        id: 'google',
        name: 'Google Gemini',
        description: 'Cheapest and fastest. Best for cost-sensitive use cases.',
      },
      {
        id: 'anthropic',
        name: 'Anthropic Claude',
        description: 'Most mature. Best for desktop automation.',
      },
      {
        id: 'openai',
        name: 'OpenAI CUA',
        description: 'Best web accuracy. Preview API.',
      },
    ];
  }

  return [
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      description: 'Best reasoning for selector generation.',
    },
    {
      id: 'google',
      name: 'Google Gemini',
      description: 'Fast and cost-effective.',
    },
    {
      id: 'openai',
      name: 'OpenAI GPT',
      description: 'Strong general-purpose reasoning.',
    },
  ];
}
