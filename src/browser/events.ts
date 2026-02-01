/**
 * Browser Automation WebSocket Events
 *
 * Event types broadcast to the frontend for real-time UI updates.
 */

import type { BrowserSession, BrowserAction, ActionResult, ClickMarker } from './types.js';

// =============================================================================
// Session Lifecycle Events
// =============================================================================

/**
 * Emitted when a new browser session is created.
 */
export interface BrowserSessionCreatedEvent {
  type: 'browser_session_created';
  session: BrowserSession;
  timestamp: string;
}

/**
 * Emitted when a browser session is updated (status, URL, etc.).
 */
export interface BrowserSessionUpdatedEvent {
  type: 'browser_session_updated';
  sessionId: string;
  updates: Partial<BrowserSession>;
  timestamp: string;
}

/**
 * Emitted when a browser session is closed.
 */
export interface BrowserSessionClosedEvent {
  type: 'browser_session_closed';
  sessionId: string;
  timestamp: string;
}

// =============================================================================
// Screenshot Events
// =============================================================================

/**
 * Emitted when a screenshot is captured (for live preview).
 */
export interface BrowserScreenshotEvent {
  type: 'browser_screenshot';
  sessionId: string;
  screenshot: string; // base64
  url: string;
  title: string;
  timestamp: string;
}

// =============================================================================
// Action Events
// =============================================================================

/**
 * Emitted when a browser action starts executing.
 */
export interface BrowserActionStartedEvent {
  type: 'browser_action_started';
  sessionId: string;
  actionId: string;
  action: BrowserAction;
  timestamp: string;
}

/**
 * Emitted when a browser action completes.
 */
export interface BrowserActionCompletedEvent {
  type: 'browser_action_completed';
  sessionId: string;
  actionId: string;
  action: BrowserAction;
  result: ActionResult;
  /** Coordinates for click visualization */
  clickCoordinates?: { x: number; y: number };
  timestamp: string;
}

// =============================================================================
// Click Marker Events
// =============================================================================

/**
 * Emitted to show a click marker on the browser preview.
 */
export interface BrowserClickMarkerEvent {
  type: 'browser_click_marker';
  sessionId: string;
  marker: ClickMarker;
}

// =============================================================================
// Union Type
// =============================================================================

/**
 * Union of all browser events for type-safe handling.
 */
export type BrowserEvent =
  | BrowserSessionCreatedEvent
  | BrowserSessionUpdatedEvent
  | BrowserSessionClosedEvent
  | BrowserScreenshotEvent
  | BrowserActionStartedEvent
  | BrowserActionCompletedEvent
  | BrowserClickMarkerEvent;

// =============================================================================
// Event Creators
// =============================================================================

/**
 * Creates a session created event.
 */
export function createSessionCreatedEvent(
  session: BrowserSession
): BrowserSessionCreatedEvent {
  return {
    type: 'browser_session_created',
    session: serializeSession(session),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a session updated event.
 */
export function createSessionUpdatedEvent(
  sessionId: string,
  updates: Partial<BrowserSession>
): BrowserSessionUpdatedEvent {
  return {
    type: 'browser_session_updated',
    sessionId,
    updates: serializeSessionUpdates(updates),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a session closed event.
 */
export function createSessionClosedEvent(
  sessionId: string
): BrowserSessionClosedEvent {
  return {
    type: 'browser_session_closed',
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a screenshot event.
 */
export function createScreenshotEvent(
  sessionId: string,
  screenshot: string,
  url: string,
  title: string
): BrowserScreenshotEvent {
  return {
    type: 'browser_screenshot',
    sessionId,
    screenshot,
    url,
    title,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an action started event.
 */
export function createActionStartedEvent(
  sessionId: string,
  actionId: string,
  action: BrowserAction
): BrowserActionStartedEvent {
  return {
    type: 'browser_action_started',
    sessionId,
    actionId,
    action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates an action completed event.
 */
export function createActionCompletedEvent(
  sessionId: string,
  actionId: string,
  action: BrowserAction,
  result: ActionResult
): BrowserActionCompletedEvent {
  return {
    type: 'browser_action_completed',
    sessionId,
    actionId,
    action,
    result: serializeActionResult(result),
    clickCoordinates: result.coordinates,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a click marker event.
 */
export function createClickMarkerEvent(
  sessionId: string,
  marker: ClickMarker
): BrowserClickMarkerEvent {
  return {
    type: 'browser_click_marker',
    sessionId,
    marker: {
      ...marker,
      timestamp: marker.timestamp,
    },
  };
}

// =============================================================================
// Serialization Helpers
// =============================================================================

/**
 * Serializes a BrowserSession for JSON transmission.
 * Converts Date objects to ISO strings.
 */
function serializeSession(session: BrowserSession): BrowserSession {
  return {
    ...session,
    lastScreenshotAt: session.lastScreenshotAt,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
  };
}

/**
 * Serializes partial session updates for JSON transmission.
 */
function serializeSessionUpdates(
  updates: Partial<BrowserSession>
): Partial<BrowserSession> {
  const serialized: Partial<BrowserSession> = { ...updates };

  // Don't include large screenshot data in updates
  if (serialized.lastScreenshot) {
    delete serialized.lastScreenshot;
  }

  return serialized;
}

/**
 * Serializes an ActionResult for JSON transmission.
 * Truncates large screenshot data if needed.
 */
function serializeActionResult(result: ActionResult): ActionResult {
  const serialized = { ...result };

  // Limit screenshot size for transmission (keep it for action results)
  // The full screenshot is sent separately via browser_screenshot event
  if (serialized.screenshot && serialized.screenshot.length > 100000) {
    // If larger than ~100KB, truncate
    serialized.screenshot = serialized.screenshot.substring(0, 100000) + '...[truncated]';
  }

  return serialized;
}
