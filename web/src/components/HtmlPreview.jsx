import React, { useState, useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/themes/prism-tomorrow.css';

const DEFAULT_HEIGHT = 450;
const MIN_HEIGHT = 300;
const HEIGHT_STEP = 100;

/**
 * HtmlPreview component - renders HTML with toggle between raw code and preview
 * Preview uses sandboxed iframe for security (no JavaScript execution)
 */
function HtmlPreview({ html, className = '' }) {
  const [viewMode, setViewMode] = useState('preview'); // 'preview' or 'raw'
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const codeRef = useRef(null);
  const iframeRef = useRef(null);

  const increaseHeight = () => setHeight((h) => h + HEIGHT_STEP);
  const decreaseHeight = () => setHeight((h) => Math.max(MIN_HEIGHT, h - HEIGHT_STEP));

  // Highlight code when switching to raw mode
  useEffect(() => {
    if (viewMode === 'raw' && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [viewMode, html]);

  // Update iframe content when in preview mode
  useEffect(() => {
    if (viewMode === 'preview' && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                line-height: 1.5;
                color: #333;
                padding: 12px;
                margin: 0;
                background: #fff;
              }
              img { max-width: 100%; height: auto; }
              table { border-collapse: collapse; width: 100%; }
              th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
              th { background: #f5f5f5; }
              a { color: #0066cc; }
              pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
              code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
            </style>
          </head>
          <body>${html}</body>
          </html>
        `);
        doc.close();
      }
    }
  }, [viewMode, html]);

  return (
    <div className={`html-preview ${className}`}>
      <div className="html-preview-header">
        <div className="html-preview-tabs">
          <button
            className={`html-preview-tab ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
          >
            Preview
          </button>
          <button
            className={`html-preview-tab ${viewMode === 'raw' ? 'active' : ''}`}
            onClick={() => setViewMode('raw')}
          >
            HTML
          </button>
        </div>
        <div className="html-preview-controls">
          <button
            className="html-preview-size-btn"
            onClick={decreaseHeight}
            disabled={height <= MIN_HEIGHT}
            title="Decrease height"
          >
            −
          </button>
          <button
            className="html-preview-size-btn"
            onClick={increaseHeight}
            title="Increase height"
          >
            +
          </button>
        </div>
      </div>

      <div className="html-preview-content" style={{ height: `${height}px` }}>
        {viewMode === 'preview' ? (
          <iframe
            ref={iframeRef}
            className="html-preview-iframe"
            sandbox="allow-same-origin"
            title="HTML Preview"
          />
        ) : (
          <pre className="html-preview-code">
            <code ref={codeRef} className="language-markup">
              {html}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

export default HtmlPreview;
