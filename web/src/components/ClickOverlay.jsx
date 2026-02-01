/**
 * Click Overlay Component
 *
 * Renders animated click markers on top of the browser preview.
 * Shows where click actions occurred during automation.
 */

import React from 'react';

/**
 * Action type colors
 */
const ACTION_COLORS = {
  click: '#ef4444',  // red
  type: '#3b82f6',   // blue
  scroll: '#22c55e', // green
};

/**
 * Click overlay component that renders markers over the screenshot.
 */
export function ClickOverlay({ markers = [], viewportSize }) {
  if (!viewportSize || markers.length === 0) {
    return null;
  }

  return (
    <div className="click-overlay">
      {markers.map((marker) => {
        // Calculate position as percentage of viewport
        const leftPercent = (marker.x / viewportSize.width) * 100;
        const topPercent = (marker.y / viewportSize.height) * 100;
        const color = ACTION_COLORS[marker.actionType] || ACTION_COLORS.click;

        return (
          <div
            key={marker.id}
            className={`click-marker click-marker-${marker.actionType}`}
            style={{
              left: `${leftPercent}%`,
              top: `${topPercent}%`,
              '--marker-color': color,
            }}
          >
            <div className="click-marker-ring" />
            <div className="click-marker-dot" />
            <div className="click-marker-label">
              {marker.actionType}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ClickOverlay;
