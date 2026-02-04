import React, { useState, memo } from 'react';

/**
 * Source type icons
 */
const SOURCE_ICONS = {
  web: '🌐',
  file: '📄',
  api: '🔌',
  database: '🗄️',
  memory: '🧠',
  skill: '⚡',
  mcp: '🔗',
};

/**
 * Individual source card component
 * Memoized to prevent re-renders when parent re-renders with same props.
 */
const SourceCard = memo(function SourceCard({ index, source }) {
  const icon = SOURCE_ICONS[source.type] || '📎';

  return (
    <div className="source-card">
      <div className="source-header">
        <span className="source-index">[{index}]</span>
        <span className="source-icon">{icon}</span>
        <span className="source-domain">{source.domain || 'local'}</span>
        {source.uri && source.type === 'web' && (
          <a
            href={source.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="source-link"
            onClick={(e) => e.stopPropagation()}
          >
            Visit
          </a>
        )}
        {source.pageNumber && (
          <span className="source-page">Page {source.pageNumber}</span>
        )}
      </div>
      {source.title && (
        <div className="source-title">{source.title}</div>
      )}
      {source.snippet && (
        <div className="source-snippet">"{source.snippet}"</div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.index === nextProps.index &&
    prevProps.source === nextProps.source
  );
});

/**
 * Source panel component - displays citation sources for a message
 * Memoized with custom comparison to prevent re-renders.
 */
export const SourcePanel = memo(function SourcePanel({ citations }) {
  const [expanded, setExpanded] = useState(false);

  // Don't render if no citations or no sources
  if (!citations?.sources || citations.sources.length === 0) {
    return null;
  }

  const { sources } = citations;
  const sourceCount = sources.length;

  return (
    <div className="source-panel">
      <button
        className="source-panel-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="source-panel-icon">📚</span>
        <span className="source-panel-text">
          {sourceCount} source{sourceCount !== 1 ? 's' : ''} used
        </span>
        <span className="source-panel-arrow">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="source-list">
          {sources.map((source, i) => (
            <SourceCard
              key={source.id || i}
              index={i + 1}
              source={source}
            />
          ))}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.citations === nextProps.citations;
});

export default SourcePanel;
