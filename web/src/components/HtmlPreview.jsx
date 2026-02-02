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
 *
 * When isStreaming is true, only raw HTML view is shown to prevent flashing.
 * When streaming ends, it auto-switches to preview mode.
 */
function HtmlPreview({ html, className = '', isStreaming = false }) {
  const [viewMode, setViewMode] = useState(isStreaming ? 'raw' : 'preview');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const prevStreamingRef = useRef(isStreaming);
  const codeRef = useRef(null);
  const iframeRef = useRef(null);
  const modalIframeRef = useRef(null);
  const modalCodeRef = useRef(null);

  const increaseHeight = () => setHeight((h) => h + HEIGHT_STEP);
  const decreaseHeight = () => setHeight((h) => Math.max(MIN_HEIGHT, h - HEIGHT_STEP));

  // Auto-switch to preview when streaming ends
  useEffect(() => {
    // If streaming just ended (was true, now false), switch to preview
    if (prevStreamingRef.current && !isStreaming) {
      setViewMode('preview');
    }
    // If streaming just started, switch to raw
    if (!prevStreamingRef.current && isStreaming) {
      setViewMode('raw');
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Highlight code when switching to raw mode
  useEffect(() => {
    if (viewMode === 'raw' && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
    if (viewMode === 'raw' && isFullscreen && modalCodeRef.current) {
      Prism.highlightElement(modalCodeRef.current);
    }
  }, [viewMode, html, isFullscreen]);

  // Helper to write HTML to an iframe and adjust its height to fit content
  const writeToIframe = (iframe) => {
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            html, body {
              margin: 0;
              padding: 0;
              overflow: hidden;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              line-height: 1.5;
              color: #333;
              padding: 12px;
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

      // After content loads, set iframe height to match content
      // This ensures iframe doesn't scroll internally
      setTimeout(() => {
        if (doc.body) {
          const contentHeight = doc.body.scrollHeight;
          iframe.style.height = `${contentHeight}px`;
        }
      }, 0);
    }
  };

  // Update iframe content when in preview mode
  useEffect(() => {
    if (viewMode === 'preview') {
      writeToIframe(iframeRef.current);
    }
  }, [viewMode, html]);

  // Update modal iframe content when fullscreen is open
  useEffect(() => {
    if (isFullscreen && viewMode === 'preview') {
      writeToIframe(modalIframeRef.current);
    }
  }, [isFullscreen, viewMode, html]);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isFullscreen]);

  // Determine effective view mode (forced to raw while streaming)
  const effectiveViewMode = isStreaming ? 'raw' : viewMode;

  return (
    <div className={`html-preview ${className}`}>
      <div className="html-preview-header">
        <div className="html-preview-tabs">
          <button
            className={`html-preview-tab ${effectiveViewMode === 'preview' ? 'active' : ''}`}
            onClick={() => !isStreaming && setViewMode('preview')}
            disabled={isStreaming}
            title={isStreaming ? 'Preview disabled while streaming' : 'Preview'}
          >
            Preview
          </button>
          <button
            className={`html-preview-tab ${effectiveViewMode === 'raw' ? 'active' : ''}`}
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
          <button
            className="html-preview-size-btn html-preview-fullscreen-btn"
            onClick={() => setIsFullscreen(true)}
            title="Open fullscreen"
          >
            ⛶
          </button>
        </div>
      </div>

      <div className="html-preview-content" style={{ height: `${height}px` }}>
        {effectiveViewMode === 'preview' ? (
          <div className="html-preview-iframe-wrapper">
            <iframe
              ref={iframeRef}
              className="html-preview-iframe"
              sandbox="allow-same-origin"
              title="HTML Preview"
              scrolling="no"
            />
          </div>
        ) : (
          <pre className="html-preview-code">
            <code ref={codeRef} className="language-markup">
              {html}
            </code>
          </pre>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="html-preview-modal-overlay">
          <div className="html-preview-modal">
            <div className="html-preview-modal-header">
              <div className="html-preview-tabs">
                <button
                  className={`html-preview-tab ${effectiveViewMode === 'preview' ? 'active' : ''}`}
                  onClick={() => !isStreaming && setViewMode('preview')}
                  disabled={isStreaming}
                  title={isStreaming ? 'Preview disabled while streaming' : 'Preview'}
                >
                  Preview
                </button>
                <button
                  className={`html-preview-tab ${effectiveViewMode === 'raw' ? 'active' : ''}`}
                  onClick={() => setViewMode('raw')}
                >
                  HTML
                </button>
              </div>
              <button
                className="html-preview-modal-close"
                onClick={() => setIsFullscreen(false)}
                title="Close (Esc)"
              >
                ×
              </button>
            </div>
            <div className="html-preview-modal-content">
              {effectiveViewMode === 'preview' ? (
                <div className="html-preview-iframe-wrapper">
                  <iframe
                    ref={modalIframeRef}
                    className="html-preview-iframe"
                    sandbox="allow-same-origin"
                    title="HTML Preview Fullscreen"
                    scrolling="no"
                  />
                </div>
              ) : (
                <pre className="html-preview-code">
                  <code ref={modalCodeRef} className="language-markup">
                    {html}
                  </code>
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HtmlPreview;
