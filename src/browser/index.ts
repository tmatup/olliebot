/**
 * Browser Automation Module
 *
 * Provides browser automation capabilities for OllieBot with:
 * - Strategy abstraction (Computer Use vs DOM)
 * - Multiple provider support
 * - Debug mode with live preview
 * - Click visualization
 */

// Core types
export * from './types.js';

// Configuration
export { loadBrowserConfig, logBrowserConfig, BROWSER_ENV_VARS } from './config.js';

// Events
export * from './events.js';

// Session management
export { BrowserSessionInstance } from './session.js';
export { BrowserSessionManager, type IBroadcaster, type ILLMService } from './manager.js';

// Strategies
export {
  createStrategy,
  getAvailableStrategies,
  getAvailableProviders,
  type IBrowserStrategy,
  type StrategyConfig,
  type IStrategyLLMService,
} from './strategies/index.js';
export { DOMBrowserStrategy } from './strategies/dom/index.js';
export { ComputerUseBrowserStrategy } from './strategies/computer-use/index.js';
export {
  type IComputerUseProvider,
  type ComputerUseProviderConfig,
  AzureOpenAIComputerUseProvider,
  GoogleComputerUseProvider,
} from './strategies/computer-use/providers/index.js';

// Native tools
export {
  BrowserSessionTool,
  BrowserNavigateTool,
  BrowserActionTool,
  BrowserScreenshotTool,
} from './tools/index.js';
