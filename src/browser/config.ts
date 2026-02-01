/**
 * Browser Automation Configuration
 *
 * Loads browser automation configuration from environment variables.
 */

import type {
  BrowserConfig,
  BrowserStrategyType,
  ComputerUseProvider,
  DOMProvider,
} from './types.js';
import { DEFAULT_BROWSER_CONFIG } from './types.js';

/**
 * Environment variable names for browser configuration.
 */
export const BROWSER_ENV_VARS = {
  /** Strategy: 'computer-use' | 'dom' */
  STRATEGY: 'BROWSER_STRATEGY',

  /** Browser provider: 'anthropic' | 'openai' | 'google' | 'azure_openai' */
  PROVIDER: 'BROWSER_PROVIDER',

  /** Model for browser automation */
  MODEL: 'BROWSER_MODEL',

  /** DOM provider: 'anthropic' | 'openai' | 'google' */
  DOM_PROVIDER: 'BROWSER_DOM_PROVIDER',

  /** Headless mode: 'true' | 'false' */
  HEADLESS: 'BROWSER_HEADLESS',

  /** Debug mode: 'true' | 'false' */
  DEBUG_MODE: 'BROWSER_DEBUG_MODE',

  /** Screenshot interval in ms */
  SCREENSHOT_INTERVAL: 'BROWSER_SCREENSHOT_INTERVAL',

  /** Show click markers: 'true' | 'false' */
  SHOW_CLICK_MARKERS: 'BROWSER_SHOW_CLICK_MARKERS',

  /** Viewport width */
  VIEWPORT_WIDTH: 'BROWSER_VIEWPORT_WIDTH',

  /** Viewport height */
  VIEWPORT_HEIGHT: 'BROWSER_VIEWPORT_HEIGHT',

  /** Timeout in ms */
  TIMEOUT: 'BROWSER_TIMEOUT',

  /** Custom user agent */
  USER_AGENT: 'BROWSER_USER_AGENT',
} as const;

/**
 * Validates that a string is a valid BrowserStrategyType.
 */
function isValidStrategy(value: string): value is BrowserStrategyType {
  return value === 'computer-use' || value === 'dom';
}

/**
 * Validates that a string is a valid ComputerUseProvider.
 */
function isValidCUProvider(value: string): value is ComputerUseProvider {
  return value === 'anthropic' || value === 'openai' || value === 'google' || value === 'azure_openai';
}

/**
 * Validates that a string is a valid DOMProvider.
 */
function isValidDOMProvider(value: string): value is DOMProvider {
  return value === 'anthropic' || value === 'openai' || value === 'google';
}

/**
 * Parses a boolean environment variable.
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Parses an integer environment variable.
 */
function parseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Loads browser configuration from environment variables.
 *
 * Environment variables:
 * - BROWSER_STRATEGY: 'computer-use' | 'dom' (default: 'computer-use')
 * - BROWSER_CU_PROVIDER: 'anthropic' | 'openai' | 'google' (default: 'google')
 * - BROWSER_DOM_PROVIDER: 'anthropic' | 'openai' | 'google' (default: 'anthropic')
 * - BROWSER_HEADLESS: 'true' | 'false' (default: 'true')
 * - BROWSER_DEBUG_MODE: 'true' | 'false' (default: 'false')
 * - BROWSER_SCREENSHOT_INTERVAL: number in ms (default: 2000)
 * - BROWSER_SHOW_CLICK_MARKERS: 'true' | 'false' (default: 'true')
 * - BROWSER_VIEWPORT_WIDTH: number (default: 1024)
 * - BROWSER_VIEWPORT_HEIGHT: number (default: 768)
 * - BROWSER_TIMEOUT: number in ms (default: 30000)
 * - BROWSER_USER_AGENT: string (optional)
 */
export function loadBrowserConfig(
  env: Record<string, string | undefined> = process.env
): BrowserConfig {
  const strategyRaw = env[BROWSER_ENV_VARS.STRATEGY];
  const providerRaw = env[BROWSER_ENV_VARS.PROVIDER];
  const domProviderRaw = env[BROWSER_ENV_VARS.DOM_PROVIDER];

  const strategy: BrowserStrategyType =
    strategyRaw && isValidStrategy(strategyRaw)
      ? strategyRaw
      : DEFAULT_BROWSER_CONFIG.strategy;

  const computerUseProvider: ComputerUseProvider =
    providerRaw && isValidCUProvider(providerRaw)
      ? providerRaw
      : DEFAULT_BROWSER_CONFIG.computerUseProvider;

  const domProvider: DOMProvider =
    domProviderRaw && isValidDOMProvider(domProviderRaw)
      ? domProviderRaw
      : DEFAULT_BROWSER_CONFIG.domProvider;

  const config: BrowserConfig = {
    strategy,
    computerUseProvider,
    domProvider,
    headless: parseBoolean(
      env[BROWSER_ENV_VARS.HEADLESS],
      DEFAULT_BROWSER_CONFIG.headless
    ),
    debugMode: parseBoolean(
      env[BROWSER_ENV_VARS.DEBUG_MODE],
      DEFAULT_BROWSER_CONFIG.debugMode
    ),
    screenshotInterval: parseInt(
      env[BROWSER_ENV_VARS.SCREENSHOT_INTERVAL],
      DEFAULT_BROWSER_CONFIG.screenshotInterval!
    ),
    showClickMarkers: parseBoolean(
      env[BROWSER_ENV_VARS.SHOW_CLICK_MARKERS],
      DEFAULT_BROWSER_CONFIG.showClickMarkers
    ),
    viewport: {
      width: parseInt(
        env[BROWSER_ENV_VARS.VIEWPORT_WIDTH],
        DEFAULT_BROWSER_CONFIG.viewport.width
      ),
      height: parseInt(
        env[BROWSER_ENV_VARS.VIEWPORT_HEIGHT],
        DEFAULT_BROWSER_CONFIG.viewport.height
      ),
    },
    timeout: parseInt(
      env[BROWSER_ENV_VARS.TIMEOUT],
      DEFAULT_BROWSER_CONFIG.timeout
    ),
    userAgent: env[BROWSER_ENV_VARS.USER_AGENT],
  };

  return config;
}

/**
 * Logs the current browser configuration.
 */
export function logBrowserConfig(config: BrowserConfig): void {
  console.log('[Browser] Configuration:');
  console.log(`  Strategy: ${config.strategy}`);
  console.log(
    `  Provider: ${config.strategy === 'computer-use' ? config.computerUseProvider : config.domProvider}`
  );
  console.log(`  Headless: ${config.headless}`);
  console.log(`  Debug Mode: ${config.debugMode}`);
  console.log(`  Viewport: ${config.viewport.width}x${config.viewport.height}`);
  console.log(`  Timeout: ${config.timeout}ms`);
  if (config.debugMode) {
    console.log(`  Screenshot Interval: ${config.screenshotInterval}ms`);
    console.log(`  Show Click Markers: ${config.showClickMarkers}`);
  }
}
