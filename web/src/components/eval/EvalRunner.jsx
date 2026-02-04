import { useState, useEffect, useRef } from 'react';
import { EvalResults } from './EvalResults';
import { EvalJsonEditor } from './EvalJsonEditor';

export function EvalRunner({ evaluation, suite, viewingResults, onBack }) {
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

  // Clear results when selection changes (allows navigation after viewing results)
  useEffect(() => {
    setResults(null);
    setError(null);
    setProgress(null);
    setLoading(false);
    setJobId(null);
    jobIdRef.current = null;
  }, [evaluation, suite, viewingResults]);

  // Set up WebSocket listener for eval events
  useEffect(() => {
    // Use the same backend URL as the main WebSocket connection
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

    console.log('[EvalRunner] Connecting WebSocket to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[EvalRunner] WebSocket connected');
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Ignore non-JSON messages
        return;
      }

      // Check if this is an eval event (avoiding optional chaining in try)
      const dataType = data.type;
      const isEvalEvent = dataType && dataType.startsWith('eval_');

      // Debug: log all eval-related events
      if (isEvalEvent) {
        console.log('[EvalRunner] WebSocket event:', dataType, 'jobId:', data.jobId, 'current jobId:', jobIdRef.current);
      }

      // Process events for our current job OR if we're waiting for any job to start
      if (isEvalEvent && data.jobId) {
        // If we don't have a jobId yet but we're loading, accept the first matching event
        const isOurJob = jobIdRef.current && data.jobId === jobIdRef.current;

        if (isOurJob) {
          if (dataType === 'eval_progress') {
            console.log('[EvalRunner] Updating progress:', data.current, '/', data.total);
            setProgress({ current: data.current, total: data.total });
          } else if (dataType === 'eval_complete') {
            console.log('[EvalRunner] Evaluation complete');
            setResults(data.results);
            setProgress(null);
            setLoading(false);
          } else if (dataType === 'eval_error') {
            console.log('[EvalRunner] Evaluation error:', data.error);
            const errorMsg = data.error;
            setError(errorMsg ? errorMsg : 'Evaluation failed');
            setProgress(null);
            setLoading(false);
          }
        }
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

  // Check for active jobs on mount (UI recovery)
  useEffect(() => {
    const checkActiveJobs = async () => {
      try {
        const res = await fetch('/api/eval/jobs');
        if (res.ok) {
          const data = await res.json();
          const jobs = data.jobs;
          if (jobs) {
            const runningJob = jobs.find(job => job.status === 'running');
            if (runningJob) {
              setJobId(runningJob.jobId);
              setLoading(true);
              setProgress({ current: 0, total: 1 }); // Will be updated by WebSocket
            }
          }
        }
      } catch (err) {
        console.error('Failed to check active jobs:', err);
      }
    };
    checkActiveJobs();
  }, []);

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

  // Load evaluation details when selected
  useEffect(() => {
    if (evaluation) {
      loadEvaluationDetails(evaluation.path);
    } else {
      setEvalDetails(null);
    }
  }, [evaluation, loadEvaluationDetails]);

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
          alternativePrompt: runConfig.alternativePrompt,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[EvalRunner] Started evaluation with jobId:', data.jobId);
        // Set ref immediately so WebSocket handler can use it right away
        jobIdRef.current = data.jobId;
        setJobId(data.jobId);
      } else {
        setError('Failed to start evaluation');
        setLoading(false);
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
          suitePath: suite.suitePath,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[EvalRunner] Started suite with jobId:', data.jobId);
        // Set ref immediately so WebSocket handler can use it right away
        jobIdRef.current = data.jobId;
        setJobId(data.jobId);
      } else {
        setError('Failed to start suite');
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  // Handle save from JSON editor
  const handleSave = (updatedEval) => {
    setEvalDetails(updatedEval);
  };

  // Show results if available (from a fresh run)
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

  // Show past results if viewing from sidebar
  if (viewingResults) {
    return (
      <EvalResults
        results={viewingResults}
        onClose={onBack}
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
              <span>Evaluations: {suite.evaluations?.length || 0}</span>
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

  // Show evaluation view with JSON editor
  if (evaluation) {
    return (
      <div className="eval-runner">
        <div className="eval-runner-content eval-runner-content-full">
          {/* JSON Editor */}
          <EvalJsonEditor
            evaluation={evaluation}
            evalDetails={evalDetails}
            onSave={handleSave}
          />

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
