/**
 * Browser Sessions Accordion Component
 *
 * Displays active browser automation sessions in the sidebar.
 * Shows thumbnails of browser screenshots that update in real-time.
 * Clicking a session opens a preview modal.
 */

import React from 'react';

/**
 * Status indicator colors
 */
const STATUS_COLORS = {
  starting: '#3b82f6', // blue
  active: '#22c55e',   // green
  idle: '#eab308',     // yellow
  error: '#ef4444',    // red
  closed: '#6b7280',   // gray
};

/**
 * Browser Sessions accordion component.
 */
export function BrowserSessions({
  sessions = [],
  screenshots = {},
  selectedSessionId,
  onSelectSession,
  onCloseSession,
  expanded,
  onToggle,
}) {
  return (
    <div className="accordion">
      <button
        className={`accordion-header ${expanded ? 'expanded' : ''}`}
        onClick={onToggle}
      >
        <span className="accordion-icon">🌐</span>
        <span className="accordion-title">Browser Sessions</span>
        {sessions.length > 0 && (
          <span className="accordion-count">{sessions.length}</span>
        )}
        <span className="accordion-arrow">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="accordion-content">
          {sessions.length === 0 ? (
            <div className="accordion-empty">No active sessions</div>
          ) : (
            sessions.map((session) => {
              const screenshot = screenshots[session.id];
              return (
                <div
                  key={session.id}
                  className={`browser-session-item ${
                    session.id === selectedSessionId ? 'selected' : ''
                  }`}
                  onClick={() => onSelectSession(session.id)}
                >
                  {/* Thumbnail container */}
                  <div className="browser-session-thumbnail-container">
                    {screenshot?.screenshot ? (
                      <img
                        src={`data:image/png;base64,${screenshot.screenshot}`}
                        alt={session.name}
                        className="browser-session-thumbnail"
                      />
                    ) : (
                      <div className="browser-session-thumbnail-placeholder">
                        <span className="browser-session-thumbnail-icon">🌐</span>
                      </div>
                    )}
                    {/* Status indicator overlay */}
                    <span
                      className="browser-session-status-badge"
                      style={{ backgroundColor: STATUS_COLORS[session.status] || STATUS_COLORS.idle }}
                      title={session.status}
                    />
                  </div>

                  {/* Session info below thumbnail */}
                  <div className="browser-session-meta">
                    <span className="browser-session-name">{session.name}</span>
                    <span className="browser-session-strategy">
                      {session.strategy === 'computer-use' ? 'CU' : 'DOM'}:{' '}
                      {session.provider}
                    </span>
                    {session.currentUrl && (
                      <span
                        className="browser-session-url"
                        title={session.currentUrl}
                      >
                        {getHostname(session.currentUrl)}
                      </span>
                    )}
                  </div>

                  {/* Close button */}
                  {onCloseSession && (
                    <button
                      className="browser-session-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseSession(session.id);
                      }}
                      title="Close session"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Extracts hostname from URL for display.
 */
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default BrowserSessions;
