/**
 * Browser Automation Types
 *
 * Core type definitions for the browser automation system.
 */

// =============================================================================
// Strategy Types
// =============================================================================

export type BrowserStrategyType = 'computer-use' | 'dom';

export type ComputerUseProvider = 'anthropic' | 'openai' | 'google' | 'azure_openai';

export type DOMProvider = 'anthropic' | 'openai' | 'google';

// =============================================================================
// Configuration
// =============================================================================

export interface BrowserConfig {
  /** Strategy for browser interaction */
  strategy: BrowserStrategyType;

  /** Provider for Computer Use strategy */
  computerUseProvider: ComputerUseProvider;

  /** Provider for DOM strategy (LLM for selector reasoning) */
  domProvider: DOMProvider;

  /** Run browser in headless mode */
  headless: boolean;

  /** Browser viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };

  /** Default timeout for browser operations (ms) */
  timeout: number;

  /** Custom user agent string */
  userAgent?: string;

  /** Enable debug mode (visible browser, periodic screenshots) */
  debugMode: boolean;

  /** Interval for periodic screenshot updates in debug mode (ms) */
  screenshotInterval?: number;

  /** Show click markers on screenshots */
  showClickMarkers: boolean;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  strategy: 'computer-use',
  computerUseProvider: 'azure_openai',
  domProvider: 'anthropic',
  headless: true,
  viewport: { width: 1024, height: 768 },
  timeout: 30000,
  debugMode: false,
  screenshotInterval: 2000,
  showClickMarkers: true,
};

// =============================================================================
// Session Types
// =============================================================================

export type BrowserSessionStatus =
  | 'starting'
  | 'active'
  | 'idle'
  | 'error'
  | 'closed';

export interface BrowserSession {
  /** Unique session identifier */
  id: string;

  /** Display name for the session */
  name: string;

  /** Current session status */
  status: BrowserSessionStatus;

  /** Strategy being used */
  strategy: BrowserStrategyType;

  /** Provider being used */
  provider: ComputerUseProvider | DOMProvider;

  /** Current page URL */
  currentUrl?: string;

  /** Current page title */
  currentTitle?: string;

  /** Last captured screenshot (base64) */
  lastScreenshot?: string;

  /** Timestamp of last screenshot */
  lastScreenshotAt?: Date;

  /** Session creation time */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;

  /** Error message if status is 'error' */
  error?: string;

  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
}

// =============================================================================
// Action Types
// =============================================================================

export type BrowserActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'navigate'
  | 'wait'
  | 'screenshot'
  | 'extract'
  | 'key'
  | 'select';

export interface BrowserAction {
  /** Type of action to perform */
  type: BrowserActionType;

  /** Coordinates for click/type actions (Computer Use strategy) */
  x?: number;
  y?: number;

  /** CSS selector for DOM strategy */
  selector?: string;

  /** Text to type (for 'type' action) */
  text?: string;

  /** URL to navigate to (for 'navigate' action) */
  url?: string;

  /** Key to press (for 'key' action) */
  key?: string;

  /** Scroll direction */
  direction?: 'up' | 'down' | 'left' | 'right';

  /** Scroll amount in pixels */
  amount?: number;

  /** Wait type (for 'wait' action) */
  waitFor?: 'selector' | 'navigation' | 'timeout';

  /** Wait timeout in ms */
  waitTimeout?: number;

  /** CSS selector to extract from (for 'extract' action) */
  extractSelector?: string;

  /** Attribute to extract (for 'extract' action) */
  extractAttribute?: string;

  /** Value to select from dropdown (for 'select' action) */
  value?: string;

  /** Full page screenshot flag */
  fullPage?: boolean;
}

export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;

  /** The action that was executed */
  action: BrowserAction;

  /** Screenshot after action (base64) - for screenshot action */
  screenshot?: string;

  /** Extracted data - for extract action */
  extractedData?: unknown;

  /** Coordinates where action occurred (for visualization) */
  coordinates?: {
    x: number;
    y: number;
  };

  /** Error message if action failed */
  error?: string;

  /** Duration of action execution in ms */
  durationMs: number;

  /** Page URL after action */
  pageUrl?: string;

  /** Page title after action */
  pageTitle?: string;
}

// =============================================================================
// Click Marker Types (for debug visualization)
// =============================================================================

export interface ClickMarker {
  /** Unique marker identifier */
  id: string;

  /** Session this marker belongs to */
  sessionId: string;

  /** X coordinate */
  x: number;

  /** Y coordinate */
  y: number;

  /** When the click occurred */
  timestamp: Date;

  /** Type of action that created this marker */
  actionType: 'click' | 'type' | 'scroll';
}

// =============================================================================
// Instruction Context Types
// =============================================================================

export interface InstructionContext {
  /** Current screenshot (base64) */
  screenshot: string;

  /** Current page URL */
  url: string;

  /** Current page title */
  title: string;

  /** Accessibility tree or DOM snapshot (for DOM strategy) */
  accessibilityTree?: string;

  /** Previous actions for context */
  previousActions?: Array<{
    action: BrowserAction;
    result: ActionResult;
  }>;
}
