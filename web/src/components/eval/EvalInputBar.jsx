import { useState, memo } from 'react';

/**
 * EvalInputBar - manages local input state to prevent parent re-renders.
 * Same pattern as ChatInput - state lives here, parent only notified on submit.
 */
export const EvalInputBar = memo(function EvalInputBar({
  onRun,
  loading,
  progress,
}) {
  const [runs, setRuns] = useState(5);
  const [alternativePrompt, setAlternativePrompt] = useState('');

  const handleRun = () => {
    onRun({ runs, alternativePrompt });
  };

  if (loading) {
    return (
      <div className="eval-input-bar">
        <div className="eval-progress-inline">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: progress ? `${(progress.current / progress.total) * 100}%` : '0%' }}
            />
          </div>
          <span className="progress-text">
            {progress ? `${progress.current} / ${progress.total} runs` : 'Starting evaluation...'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="eval-input-bar">
      <div className="eval-config-inline">
        <label>
          Runs:
          <input
            type="number"
            min="1"
            max="20"
            value={runs}
            onChange={(e) => setRuns(parseInt(e.target.value) || 5)}
          />
        </label>
        <input
          type="text"
          className="alt-prompt-input"
          placeholder="Alternative prompt path (optional)"
          value={alternativePrompt}
          onChange={(e) => setAlternativePrompt(e.target.value)}
        />
      </div>
      <button
        className="run-btn primary"
        onClick={handleRun}
        disabled={loading}
      >
        Run Evaluation
      </button>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when these props change
  return (
    prevProps.loading === nextProps.loading &&
    prevProps.progress === nextProps.progress
  );
});
