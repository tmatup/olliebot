import { useState, useEffect, useRef, memo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/**
 * SyntaxHighlighter wrapper with deferred rendering
 */
function DeferredSyntaxHighlighter({ language, children, customStyle }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const scheduleRender = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    const id = scheduleRender(() => setIsReady(true), { timeout: 100 });
    return () => {
      if (window.cancelIdleCallback) {
        window.cancelIdleCallback(id);
      } else {
        clearTimeout(id);
      }
    };
  }, []);

  if (!isReady) {
    return (
      <pre style={{
        ...customStyle,
        color: '#d4d4d4',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {children}
      </pre>
    );
  }

  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={customStyle}
    >
      {children}
    </SyntaxHighlighter>
  );
}

export const EvalJsonEditor = memo(function EvalJsonEditor({ evaluation, evalDetails, onSave }) {
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [checkStatus, setCheckStatus] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [viewingPrompt, setViewingPrompt] = useState(false);
  const [promptContent, setPromptContent] = useState(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptPath, setPromptPath] = useState(null);

  const textareaRef = useRef(null);
  const previewRef = useRef(null);

  // Initialize JSON text when evaluation details load
  useEffect(() => {
    if (evalDetails) {
      const formatted = JSON.stringify(evalDetails, null, 2);
      setJsonText(formatted);
      setParseError(null);
      setHasChanges(false);
      setSaveStatus(null);
      setCheckStatus(null);
    }
  }, [evalDetails]);

  // Validate JSON on change
  const handleChange = (e) => {
    const newText = e.target.value;
    setJsonText(newText);
    setHasChanges(true);
    setSaveStatus(null);
    setCheckStatus(null);

    try {
      JSON.parse(newText);
      setParseError(null);
    } catch (err) {
      setParseError(err.message);
    }
  };

  // Sync scroll between textarea and preview
  const handleScroll = (e) => {
    if (previewRef.current) {
      previewRef.current.scrollTop = e.target.scrollTop;
      previewRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  // Validate evaluation structure
  const validateEvaluation = (parsed) => {
    const errors = [];

    // Check required top-level fields
    if (!parsed.version) {
      errors.push('Missing required field: version');
    }

    // Check metadata
    if (!parsed.metadata) {
      errors.push('Missing required field: metadata');
    } else {
      if (!parsed.metadata.id) errors.push('Missing required field: metadata.id');
      if (!parsed.metadata.name) errors.push('Missing required field: metadata.name');
      if (!parsed.metadata.target) errors.push('Missing required field: metadata.target');
      if (!Array.isArray(parsed.metadata.tags)) errors.push('metadata.tags must be an array');
    }

    // Check target
    if (!parsed.target) {
      errors.push('Missing required field: target');
    } else {
      if (!parsed.target.source) errors.push('Missing required field: target.source');
    }

    // Check testCase
    if (!parsed.testCase) {
      errors.push('Missing required field: testCase');
    } else {
      if (!parsed.testCase.userPrompt) errors.push('Missing required field: testCase.userPrompt');
    }

    // Check responseExpectations
    if (!parsed.responseExpectations) {
      errors.push('Missing required field: responseExpectations');
    } else {
      if (!Array.isArray(parsed.responseExpectations.requiredElements)) {
        errors.push('responseExpectations.requiredElements must be an array');
      }
    }

    return errors;
  };

  // Check handler - validates JSON structure
  const handleCheck = () => {
    setChecking(true);
    setCheckStatus(null);

    let parseSucceeded = false;
    try {
      const parsed = JSON.parse(jsonText);
      const validationErrors = validateEvaluation(parsed);

      if (validationErrors.length === 0) {
        setCheckStatus({ type: 'success', message: 'Evaluation is valid' });
      } else {
        setCheckStatus({
          type: 'error',
          message: `Validation errors:\n• ${validationErrors.join('\n• ')}`
        });
      }
      parseSucceeded = true;
    } catch (err) {
      setCheckStatus({ type: 'error', message: `JSON parse error: ${err.message}` });
    }
    if (parseSucceeded || !parseSucceeded) setChecking(false);
  };

  // Save handler
  const handleSave = async () => {
    if (parseError) return;

    setSaving(true);
    setSaveStatus(null);

    try {
      const parsed = JSON.parse(jsonText);
      const res = await fetch(`/api/eval/${encodeURIComponent(evaluation.path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      if (res.ok) {
        setSaveStatus({ type: 'success', message: 'Saved successfully' });
        setHasChanges(false);
        if (onSave) {
          onSave(parsed);
        }
      } else {
        const data = await res.json();
        const errorFromServer = data.error;
        if (errorFromServer) {
          setSaveStatus({ type: 'error', message: errorFromServer });
        } else {
          setSaveStatus({ type: 'error', message: 'Failed to save' });
        }
      }
    } catch (err) {
      setSaveStatus({ type: 'error', message: err.message });
    }
    setSaving(false);
  };

  // Extract tags from the current JSON (for header display)
  const tags = evalDetails?.metadata?.tags || [];

  // Extract just the filename from the path (handle both / and \ separators)
  const filename = evaluation?.path?.split(/[/\\]/).pop() || 'evaluation.json';

  // Get the target prompt path from the current JSON
  const getTargetPrompt = () => {
    let parsed = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // Parse failed, use evalDetails fallback
    }
    if (parsed && parsed.target && parsed.target.prompt) {
      return parsed.target.prompt;
    }
    if (evalDetails && evalDetails.target && evalDetails.target.prompt) {
      return evalDetails.target.prompt;
    }
    return undefined;
  };

  // Toggle between JSON and prompt view
  const handleViewPrompt = async () => {
    if (viewingPrompt) {
      // Switch back to JSON view
      setViewingPrompt(false);
      return;
    }

    const path = getTargetPrompt();
    if (!path) return;

    setPromptLoading(true);
    setPromptPath(path);
    setViewingPrompt(true);

    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setPromptContent(data.content);
      } else {
        setPromptContent('Failed to load prompt');
      }
    } catch (err) {
      setPromptContent(`Error: ${err.message}`);
    }
    setPromptLoading(false);
  };

  return (
    <div className="eval-json-editor">
      {/* Header with filename and tags */}
      <div className="eval-json-editor-header">
        <div className="eval-json-editor-title">
          <div className="eval-json-editor-filename">
            {viewingPrompt ? promptPath : filename}
          </div>
          {getTargetPrompt() && (
            <button
              className={`view-prompt-btn ${viewingPrompt ? 'active' : ''}`}
              onClick={handleViewPrompt}
              title={viewingPrompt ? 'Back to evaluation' : `View ${getTargetPrompt()}`}
            >
              {viewingPrompt ? '← Back to Eval' : '📄 View Target Prompt'}
            </button>
          )}
        </div>
        {!viewingPrompt && (
          <div className="eval-json-editor-tags">
            {tags.map(tag => (
              <span key={tag} className="eval-tag">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Editor Content */}
      <div className="eval-json-editor-content">
        {viewingPrompt ? (
          /* Prompt Viewer (read-only) */
          promptLoading ? (
            <div className="eval-prompt-loading">Loading prompt...</div>
          ) : (
            <div className="eval-prompt-viewer">
              <DeferredSyntaxHighlighter
                language="markdown"
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  background: 'transparent',
                  fontFamily: "'Fira Code', 'Consolas', monospace",
                  fontSize: '0.875rem',
                  lineHeight: '1.6',
                  height: '100%',
                  overflow: 'auto',
                }}
              >
                {promptContent || ''}
              </DeferredSyntaxHighlighter>
            </div>
          )
        ) : (
          /* JSON Editor */
          <>
            <textarea
              ref={textareaRef}
              className="eval-json-textarea"
              value={jsonText}
              onChange={handleChange}
              onScroll={handleScroll}
              spellCheck={false}
              placeholder="Loading evaluation..."
            />

            {/* Syntax highlighted preview overlay */}
            <div ref={previewRef} className="eval-json-preview" aria-hidden="true">
              <DeferredSyntaxHighlighter
                language="json"
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  background: 'transparent',
                  fontFamily: "'Fira Code', 'Consolas', monospace",
                  fontSize: '0.875rem',
                  lineHeight: '1.5',
                }}
              >
                {jsonText || ' '}
              </DeferredSyntaxHighlighter>
            </div>
          </>
        )}
      </div>

      {/* Error/Status display */}
      {parseError && (
        <div className="eval-json-error">
          <strong>JSON Error:</strong> {parseError}
        </div>
      )}

      {checkStatus && (
        <div className={`eval-json-status ${checkStatus.type}`}>
          <span className="eval-json-status-message">{checkStatus.message}</span>
          <button
            className="eval-json-status-close"
            onClick={() => setCheckStatus(null)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      {saveStatus && (
        <div className={`eval-json-status ${saveStatus.type}`}>
          {saveStatus.message}
        </div>
      )}

      {/* Footer with buttons - only show when editing JSON */}
      {!viewingPrompt && (
        <div className="eval-json-editor-footer">
          <span className="eval-json-editor-hint">
            {hasChanges ? 'Unsaved changes' : 'No changes'}
          </span>
          <div className="eval-json-editor-actions">
            <button
              className="run-btn secondary"
              onClick={handleCheck}
              disabled={checking || parseError}
            >
              {checking ? 'Checking...' : 'Check'}
            </button>
            <button
              className="run-btn primary"
              onClick={handleSave}
              disabled={saving || parseError || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when value props change
  // Callbacks are not compared since they may have new references but same behavior
  return (
    prevProps.evaluation === nextProps.evaluation &&
    prevProps.evalDetails === nextProps.evalDetails
  );
});
