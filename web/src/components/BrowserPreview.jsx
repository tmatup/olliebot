/**
 * Browser Preview Component
 *
 * Modal that shows a live screenshot preview of the selected browser session.
 * Overlays click markers for visualization.
 */

import React, { memo } from 'react';
import { ClickOverlay } from './ClickOverlay';

/**
 * Browser preview modal component.
 */
export const BrowserPreview = memo(function BrowserPreview({
  session,
  screenshot,
  clickMarkers = [],
  onClose,
  onCloseSession,
}) {
  if (!session) {
    return null;
  }

  return (
    <div className="browser-preview-overlay" onClick={onClose}>
      <div
        className="browser-preview-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="browser-preview-header">
          <div className="browser-preview-title">
            <span className="browser-preview-icon">🌐</span>
            <span className="browser-preview-name">{session.name}</span>
            {screenshot?.url && (
              <span className="browser-preview-url" title={screenshot.url}>
                {screenshot.url}
              </span>
            )}
          </div>
          <button
            className="browser-preview-close"
            onClick={onClose}
            title="Close preview"
          >
            ×
          </button>
        </div>

        {/* Viewport with screenshot */}
        <div className="browser-preview-viewport">
          {screenshot?.screenshot ? (
            <>
              <img
                src={`data:image/png;base64,${screenshot.screenshot}`}
                alt={`Browser session: ${session.name}`}
                className="browser-preview-screenshot"
              />
              <ClickOverlay
                markers={clickMarkers.filter((m) => m.sessionId === session.id)}
                viewportSize={session.viewport || { width: 1024, height: 768 }}
              />
            </>
          ) : (
            <div className="browser-preview-loading">
              <span>Loading screenshot...</span>
            </div>
          )}
        </div>

        {/* Footer with session info */}
        <div className="browser-preview-footer">
          <span className="browser-preview-strategy">
            Strategy: {session.strategy === 'computer-use' ? 'Computer Use' : 'DOM'}
          </span>
          <span className="browser-preview-provider">
            Provider: {session.provider}
          </span>
          <span className="browser-preview-status" data-status={session.status}>
            Status: {session.status}
          </span>
          {screenshot?.timestamp && (
            <span className="browser-preview-timestamp">
              Updated: {formatTime(screenshot.timestamp)}
            </span>
          )}
          {onCloseSession && (
            <button
              className="browser-preview-close-session"
              onClick={() => {
                onCloseSession(session.id);
                onClose();
              }}
              title="Kill browser session"
            >
              Kill Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Formats timestamp for display.
 */
function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return timestamp;
  }
}

export default BrowserPreview;
