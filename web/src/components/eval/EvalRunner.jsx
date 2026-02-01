import { useState, useEffect, useRef } from 'react';
import { EvalResults } from './EvalResults';

export function EvalRunner({ evaluation, suite, onBack }) {
  const [loading, setLoading] = useState(false);
  const [evalDetails, setEvalDetails] = useState(null);
  const [runConfig, setRunConfig] = useState({
    runs: 5,
    alternativePrompt: '',
  });
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const jobIdRef = useRef(null);

  // Keep jobIdRef in sync
  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  // Set up WebSocket listener for eval events
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Only process events for our current job
        if (data.jobId && jobIdRef.current && data.jobId === jobIdRef.current) {
          if (data.type === 'eval_progress') {
            setProgress({ current: data.current, total: data.total });
          } else if (data.type === 'eval_complete') {
            setResults(data.results);
            setProgress(null);
            setLoading(false);
          } else if (data.type === 'eval_error') {
            setError(data.error || 'Evaluation failed');
            setProgress(null);
            setLoading(false);
          }
        }
      } catch (err) {
        // Ignore non-JSON messages
      }
    };

    ws.onerror = (err) => {
      console.error('[EvalRunner] WebSocket error:', err);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  // Load evaluation details when selected
  useEffect(() => {
    if (evaluation) {
      loadEvaluationDetails(evaluation.path);
    } else {
      setEvalDetails(null);
    }
  }, [evaluation]);

  const loadEvaluationDetails = async (path) => {
    try {
      const res = await fetch(`/api/eval/${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setEvalDetails(data.evaluation);
      }
    } catch (err) {
      console.error('Failed to load evaluation details:', err);
    }
  };

  const runEvaluation = async () => {
    if (!evaluation) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ current: 0, total: runConfig.runs });

    try {
      const res = await fetch('/api/eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evaluationPath: evaluation.path,
          runs: runConfig.runs,
          alternativePrompt: runConfig.alternativePrompt || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setJobId(data.jobId);
      } else {
        throw new Error('Failed to start evaluation');
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const runSuite = async () => {
    if (!suite) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch('/api/eval/suite/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suitePath: suite.path,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setJobId(data.jobId);
      } else {
        throw new Error('Failed to start suite');
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Show results if available
  if (results) {
    return (
      <EvalResults
        results={results}
        onClose={() => {
          setResults(null);
          setJobId(null);
        }}
      />
    );
  }

  // Show suite view
  if (suite) {
    return (
      <div className="eval-runner">
        <div className="eval-runner-header">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h2>📦 {suite.name}</h2>
        </div>

        <div className="eval-runner-content">
          <div className="eval-info-card">
            <p className="eval-description">{suite.description}</p>
            <div className="eval-meta">
              <span>Evaluations: {suite.evaluationCount}</span>
            </div>
          </div>

          <div className="eval-actions">
            <button
              className="run-btn primary"
              onClick={runSuite}
              disabled={loading}
            >
              {loading ? 'Running...' : 'Run Suite'}
            </button>
          </div>

          {loading && progress && (
            <div className="eval-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <span className="progress-text">
                {progress.current} / {progress.total} runs
              </span>
            </div>
          )}

          {error && (
            <div className="eval-error">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show evaluation view
  if (evaluation) {
    return (
      <div className="eval-runner">
        <div className="eval-runner-header">
          <button className="back-btn" onClick={onBack}>← Back</button>
          <h2>{evaluation.name}</h2>
        </div>

        <div className="eval-runner-content">
          <div className="eval-info-card">
            <p className="eval-description">{evaluation.description}</p>
            <div className="eval-meta">
              <span className="eval-target">Target: {evaluation.target}</span>
              <span className="eval-tags">
                {evaluation.tags.map(tag => (
                  <span key={tag} className="eval-tag">{tag}</span>
                ))}
              </span>
            </div>
          </div>

          {evalDetails && (
            <>
              <div className="eval-section-card">
                <h3>Test Case</h3>
                <div className="test-case-prompt">
                  <strong>User Prompt:</strong>
                  <p>{evalDetails.testCase.userPrompt}</p>
                </div>
              </div>

              <div className="eval-section-card">
                <h3>Expected Tools</h3>
                <div className="expected-tools">
                  {evalDetails.toolExpectations?.expectedTools?.map((tool, i) => (
                    <div key={i} className="tool-expectation">
                      <span className={`tool-badge ${tool.required ? 'required' : 'optional'}`}>
                        {tool.required ? '✓' : '○'} {tool.name}
                      </span>
                    </div>
                  ))}
                  {evalDetails.toolExpectations?.forbiddenTools?.length > 0 && (
                    <div className="forbidden-tools">
                      <span className="forbidden-label">Forbidden:</span>
                      {evalDetails.toolExpectations.forbiddenTools.map((tool, i) => (
                        <span key={i} className="tool-badge forbidden">✗ {tool}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="eval-section-card">
                <h3>Response Expectations</h3>
                <div className="response-expectations">
                  <h4>Required Elements</h4>
                  {evalDetails.responseExpectations?.requiredElements?.map((el, i) => (
                    <div key={i} className="expectation-item">
                      <span className="expectation-id">{el.id}</span>
                      <span className="expectation-desc">{el.description}</span>
                      <span className="expectation-weight">weight: {el.weight}</span>
                    </div>
                  ))}
                  {evalDetails.responseExpectations?.optionalElements?.length > 0 && (
                    <>
                      <h4>Optional Elements</h4>
                      {evalDetails.responseExpectations.optionalElements.map((el, i) => (
                        <div key={i} className="expectation-item optional">
                          <span className="expectation-id">{el.id}</span>
                          <span className="expectation-desc">{el.description}</span>
                          <span className="expectation-weight">weight: {el.weight}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="eval-error">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {/* Bottom bar - anchored like chat input */}
        <div className="eval-input-bar">
          {loading ? (
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
          ) : (
            <>
              <div className="eval-config-inline">
                <label>
                  Runs:
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={runConfig.runs}
                    onChange={(e) => setRunConfig(prev => ({ ...prev, runs: parseInt(e.target.value) || 5 }))}
                  />
                </label>
                <input
                  type="text"
                  className="alt-prompt-input"
                  placeholder="Alternative prompt path (optional)"
                  value={runConfig.alternativePrompt}
                  onChange={(e) => setRunConfig(prev => ({ ...prev, alternativePrompt: e.target.value }))}
                />
              </div>
              <button
                className="run-btn primary"
                onClick={runEvaluation}
                disabled={loading}
              >
                {loading ? 'Running...' : 'Run Evaluation'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Empty state
  return (
    <div className="eval-runner empty">
      <div className="eval-empty-state">
        <h2>📊 Prompt Evaluation</h2>
        <p>Select an evaluation or suite from the sidebar to get started.</p>
        <p className="hint">
          Evaluations test your prompts against expected behaviors,
          tool usage, and response quality.
        </p>
      </div>
    </div>
  );
}
