import React, { useState, useEffect, useRef, useCallback } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-javascript';
import 'prismjs/themes/prism-tomorrow.css';

const DEFAULT_HEIGHT = 450;
const MIN_HEIGHT = 200;
const HEIGHT_STEP = 100;

/**
 * AppletPreview component - renders interactive HTML/JS applets in a sandboxed iframe
 *
 * Unlike HtmlPreview, this allows JavaScript execution while maintaining isolation:
 * - sandbox="allow-scripts" enables JS but prevents access to parent context
 * - Uses srcdoc for better security than document.write()
 * - Supports keyboard input for interactive applets (games, etc.)
 *
 * Supported code block languages: applet, interactive
 *
 * @param {string} code - The HTML/JS code to render
 * @param {boolean} isStreaming - Whether the content is still streaming
 * @param {string} className - Additional CSS classes
 */
function AppletPreview({ code, className = '', isStreaming = false }) {
  const [viewMode, setViewMode] = useState(isStreaming ? 'code' : 'run');
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRunning, setIsRunning] = useState(!isStreaming);
  const [key, setKey] = useState(0); // Used to force iframe remount for restart
  const prevStreamingRef = useRef(isStreaming);
  const codeRef = useRef(null);
  const iframeRef = useRef(null);
  const modalIframeRef = useRef(null);
  const modalCodeRef = useRef(null);

  const increaseHeight = () => setHeight((h) => h + HEIGHT_STEP);
  const decreaseHeight = () => setHeight((h) => Math.max(MIN_HEIGHT, h - HEIGHT_STEP));

  // Auto-switch to run mode when streaming ends
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      setViewMode('run');
      setIsRunning(true);
    }
    if (!prevStreamingRef.current && isStreaming) {
      setViewMode('code');
      setIsRunning(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Highlight code when in code view mode
  useEffect(() => {
    if (viewMode === 'code' && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
    if (viewMode === 'code' && isFullscreen && modalCodeRef.current) {
      Prism.highlightElement(modalCodeRef.current);
    }
  }, [viewMode, code, isFullscreen]);

  // Build the complete HTML document for the applet
  const buildAppletDocument = useCallback(() => {
    // Check if code already has full HTML structure
    const hasDoctype = code.toLowerCase().includes('<!doctype');
    const hasHtmlTag = code.toLowerCase().includes('<html');

    if (hasDoctype || hasHtmlTag) {
      // Use the code as-is if it's a complete document
      return code;
    }

    // Wrap in a basic HTML structure with some default styles
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: #1a1a2e;
      color: #eee;
    }
    canvas {
      display: block;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
  </style>
</head>
<body>
${code}
</body>
</html>`;
  }, [code]);

  // Restart the applet by incrementing key to force iframe remount
  const handleRestart = () => {
    setKey((k) => k + 1);
    setIsRunning(true);
    setViewMode('run');
  };

  // Stop the applet by switching to code view
  const handleStop = () => {
    setIsRunning(false);
    setViewMode('code');
  };

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

  // Focus iframe for keyboard input when in run mode
  const focusIframe = useCallback((iframe) => {
    if (iframe) {
      // Small delay to ensure iframe is ready
      setTimeout(() => {
        iframe.focus();
      }, 100);
    }
  }, []);

  // Effective view mode (forced to code while streaming)
  const effectiveViewMode = isStreaming ? 'code' : viewMode;

  // Render the iframe with srcdoc for better security
  const renderIframe = (ref, inModal = false) => (
    <iframe
      key={`${key}-${inModal ? 'modal' : 'inline'}`}
      ref={(el) => {
        if (ref) ref.current = el;
        if (el && effectiveViewMode === 'run') {
          focusIframe(el);
        }
      }}
      className="applet-iframe"
      srcDoc={isRunning ? buildAppletDocument() : ''}
      sandbox="allow-scripts"
      title={inModal ? "Applet Fullscreen" : "Applet Preview"}
      tabIndex={0}
      style={{ height: inModal ? '100%' : `${height}px` }}
    />
  );

  return (
    <div className={`applet-preview ${className}`}>
      <div className="applet-header">
        <div className="applet-tabs">
          <button
            className={`applet-tab ${effectiveViewMode === 'run' ? 'active' : ''}`}
            onClick={() => !isStreaming && setViewMode('run')}
            disabled={isStreaming}
            title={isStreaming ? 'Run disabled while streaming' : 'Run applet'}
          >
            <span className="tab-icon">▶</span>
            Run
          </button>
          <button
            className={`applet-tab ${effectiveViewMode === 'code' ? 'active' : ''}`}
            onClick={() => setViewMode('code')}
          >
            <span className="tab-icon">{'</>'}</span>
            Code
          </button>
        </div>
        <div className="applet-controls">
          {effectiveViewMode === 'run' && (
            <button
              className="applet-control-btn restart"
              onClick={handleRestart}
              title="Restart applet"
            >
              ↻
            </button>
          )}
          <button
            className="applet-control-btn"
            onClick={decreaseHeight}
            disabled={height <= MIN_HEIGHT}
            title="Decrease height"
          >
            −
          </button>
          <button
            className="applet-control-btn"
            onClick={increaseHeight}
            title="Increase height"
          >
            +
          </button>
          <button
            className="applet-control-btn fullscreen"
            onClick={() => setIsFullscreen(true)}
            title="Open fullscreen"
          >
            ⛶
          </button>
        </div>
      </div>

      <div className="applet-content" style={{ height: `${height}px` }}>
        {effectiveViewMode === 'run' ? (
          <div className="applet-iframe-wrapper">
            {renderIframe(iframeRef, false)}
          </div>
        ) : (
          <pre className="applet-code">
            <code ref={codeRef} className="language-markup">
              {code}
            </code>
          </pre>
        )}
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="applet-modal-overlay">
          <div className="applet-modal">
            <div className="applet-modal-header">
              <div className="applet-tabs">
                <button
                  className={`applet-tab ${effectiveViewMode === 'run' ? 'active' : ''}`}
                  onClick={() => !isStreaming && setViewMode('run')}
                  disabled={isStreaming}
                >
                  <span className="tab-icon">▶</span>
                  Run
                </button>
                <button
                  className={`applet-tab ${effectiveViewMode === 'code' ? 'active' : ''}`}
                  onClick={() => setViewMode('code')}
                >
                  <span className="tab-icon">{'</>'}</span>
                  Code
                </button>
              </div>
              <div className="applet-modal-controls">
                {effectiveViewMode === 'run' && (
                  <button
                    className="applet-control-btn restart"
                    onClick={handleRestart}
                    title="Restart applet"
                  >
                    ↻
                  </button>
                )}
                <button
                  className="applet-modal-close"
                  onClick={() => setIsFullscreen(false)}
                  title="Close (Esc)"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="applet-modal-content">
              {effectiveViewMode === 'run' ? (
                <div className="applet-iframe-wrapper">
                  {renderIframe(modalIframeRef, true)}
                </div>
              ) : (
                <pre className="applet-code">
                  <code ref={modalCodeRef} className="language-markup">
                    {code}
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

export default AppletPreview;
