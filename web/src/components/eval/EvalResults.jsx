import { useState, memo } from 'react';

export const EvalResults = memo(function EvalResults({ results, onClose }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [expandedRuns, setExpandedRuns] = useState(new Set());

  const toggleRun = (runId) => {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const formatScore = (score) => {
    if (typeof score === 'number') {
      return score.toFixed(3);
    }
    return 'N/A';
  };

  const formatCI = (ci) => {
    if (Array.isArray(ci) && ci.length === 2) {
      return `[${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]`;
    }
    return 'N/A';
  };

  const getRecommendationStyle = (recommendation) => {
    switch (recommendation) {
      case 'adopt-alternative':
        return 'recommendation-adopt';
      case 'keep-baseline':
        return 'recommendation-keep';
      default:
        return 'recommendation-inconclusive';
    }
  };

  const getRecommendationText = (recommendation) => {
    switch (recommendation) {
      case 'adopt-alternative':
        return '✓ ADOPT ALTERNATIVE';
      case 'keep-baseline':
        return '○ KEEP BASELINE';
      default:
        return '? INCONCLUSIVE';
    }
  };

  return (
    <div className="eval-results">
      <div className="eval-results-header">
        <div className="header-title">
          <h2>Results: {results.evaluationName}</h2>
          <span className="result-date">
            {new Date(results.timestamp).toLocaleString()}
          </span>
        </div>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="eval-results-tabs">
        <button
          className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
        <button
          className={`tab ${activeTab === 'baseline' ? 'active' : ''}`}
          onClick={() => setActiveTab('baseline')}
        >
          Baseline Runs
        </button>
        {results.alternative && (
          <button
            className={`tab ${activeTab === 'alternative' ? 'active' : ''}`}
            onClick={() => setActiveTab('alternative')}
          >
            Alternative Runs
          </button>
        )}
      </div>

      <div className="eval-results-content">
        {activeTab === 'summary' && (
          <div className="results-summary">
            {/* Comparison Section */}
            {results.comparison && (
              <div className={`comparison-card ${getRecommendationStyle(results.comparison.recommendation)}`}>
                <h3>Comparison Results</h3>
                <div className="recommendation">
                  {getRecommendationText(results.comparison.recommendation)}
                </div>
                <div className="comparison-stats">
                  <div className="stat">
                    <span className="stat-label">Score Difference</span>
                    <span className="stat-value">
                      {results.comparison.overallScoreDifference > 0 ? '+' : ''}
                      {formatScore(results.comparison.overallScoreDifference)}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">p-value</span>
                    <span className="stat-value">{formatScore(results.comparison.pValue)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Significant</span>
                    <span className={`stat-value ${results.comparison.isSignificant ? 'significant' : ''}`}>
                      {results.comparison.isSignificant ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Effect Size</span>
                    <span className="stat-value">{formatScore(results.comparison.effectSize)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Score Tables */}
            <div className="scores-section">
              <h3>Baseline Scores</h3>
              <table className="scores-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Std Dev</th>
                    <th>95% CI</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Tool Selection</td>
                    <td>{formatScore(results.baseline.toolSelectionScore.mean)}</td>
                    <td>{formatScore(results.baseline.toolSelectionScore.median)}</td>
                    <td>{formatScore(results.baseline.toolSelectionScore.stdDev)}</td>
                    <td>{formatCI(results.baseline.toolSelectionScore.confidenceInterval)}</td>
                  </tr>
                  <tr>
                    <td>Response Quality</td>
                    <td>{formatScore(results.baseline.responseQualityScore.mean)}</td>
                    <td>{formatScore(results.baseline.responseQualityScore.median)}</td>
                    <td>{formatScore(results.baseline.responseQualityScore.stdDev)}</td>
                    <td>{formatCI(results.baseline.responseQualityScore.confidenceInterval)}</td>
                  </tr>
                  {results.baseline.delegationScore && (
                    <tr>
                      <td>Delegation</td>
                      <td>{formatScore(results.baseline.delegationScore.mean)}</td>
                      <td>{formatScore(results.baseline.delegationScore.median)}</td>
                      <td>{formatScore(results.baseline.delegationScore.stdDev)}</td>
                      <td>{formatCI(results.baseline.delegationScore.confidenceInterval)}</td>
                    </tr>
                  )}
                  <tr className="total-row">
                    <td><strong>Overall</strong></td>
                    <td><strong>{formatScore(results.baseline.overallScore.mean)}</strong></td>
                    <td>{formatScore(results.baseline.overallScore.median)}</td>
                    <td>{formatScore(results.baseline.overallScore.stdDev)}</td>
                    <td>{formatCI(results.baseline.overallScore.confidenceInterval)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {results.alternative && (
              <div className="scores-section">
                <h3>Alternative Scores</h3>
                <table className="scores-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Mean</th>
                      <th>Median</th>
                      <th>Std Dev</th>
                      <th>95% CI</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Tool Selection</td>
                      <td>{formatScore(results.alternative.toolSelectionScore.mean)}</td>
                      <td>{formatScore(results.alternative.toolSelectionScore.median)}</td>
                      <td>{formatScore(results.alternative.toolSelectionScore.stdDev)}</td>
                      <td>{formatCI(results.alternative.toolSelectionScore.confidenceInterval)}</td>
                    </tr>
                    <tr>
                      <td>Response Quality</td>
                      <td>{formatScore(results.alternative.responseQualityScore.mean)}</td>
                      <td>{formatScore(results.alternative.responseQualityScore.median)}</td>
                      <td>{formatScore(results.alternative.responseQualityScore.stdDev)}</td>
                      <td>{formatCI(results.alternative.responseQualityScore.confidenceInterval)}</td>
                    </tr>
                    {results.alternative.delegationScore && (
                      <tr>
                        <td>Delegation</td>
                        <td>{formatScore(results.alternative.delegationScore.mean)}</td>
                        <td>{formatScore(results.alternative.delegationScore.median)}</td>
                        <td>{formatScore(results.alternative.delegationScore.stdDev)}</td>
                        <td>{formatCI(results.alternative.delegationScore.confidenceInterval)}</td>
                      </tr>
                    )}
                    <tr className="total-row">
                      <td><strong>Overall</strong></td>
                      <td><strong>{formatScore(results.alternative.overallScore.mean)}</strong></td>
                      <td>{formatScore(results.alternative.overallScore.median)}</td>
                      <td>{formatScore(results.alternative.overallScore.stdDev)}</td>
                      <td>{formatCI(results.alternative.overallScore.confidenceInterval)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Element Pass Rates */}
            {Object.keys(results.baseline.elementPassRates || {}).length > 0 && (
              <div className="element-rates-section">
                <h3>Element Pass Rates (Baseline)</h3>
                <div className="element-rates">
                  {Object.entries(results.baseline.elementPassRates).map(([id, rate]) => (
                    <div key={id} className="element-rate">
                      <span className="element-id">{id}</span>
                      <div className="rate-bar">
                        <div
                          className="rate-fill"
                          style={{ width: `${rate * 100}%` }}
                        />
                      </div>
                      <span className="rate-value">{(rate * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'baseline' && (
          <div className="runs-list">
            {results.baseline.runs.map((run, index) => (
              <div key={run.runId} className="run-item">
                <div
                  className="run-header"
                  onClick={() => toggleRun(run.runId)}
                >
                  <span className="run-number">Run {index + 1}</span>
                  <span className="run-score">Score: {formatScore(run.overallScore)}</span>
                  <span className="run-latency">{run.latencyMs}ms</span>
                  <span className="expand-icon">
                    {expandedRuns.has(run.runId) ? '▼' : '▶'}
                  </span>
                </div>
                {expandedRuns.has(run.runId) && (
                  <div className="run-details">
                    <div className="run-scores">
                      <span>Tool: {formatScore(run.toolSelectionScore)}</span>
                      <span>Response: {formatScore(run.responseQualityScore)}</span>
                      {run.delegationScore !== undefined && (
                        <span>Delegation: {formatScore(run.delegationScore)}</span>
                      )}
                    </div>
                    {run.toolCalls.length > 0 && (
                      <div className="run-tools">
                        <strong>Tool Calls:</strong>
                        {run.toolCalls.map((call, i) => (
                          <div key={i} className={`tool-call ${call.wasExpected ? 'expected' : ''} ${call.wasForbidden ? 'forbidden' : ''}`}>
                            {call.toolName}
                          </div>
                        ))}
                      </div>
                    )}
                    {run.constraintViolations.length > 0 && (
                      <div className="run-violations">
                        <strong>Violations:</strong>
                        {run.constraintViolations.map((v, i) => (
                          <div key={i} className="violation">{v}</div>
                        ))}
                      </div>
                    )}
                    <div className="run-response">
                      <strong>Response:</strong>
                      <pre>{run.rawResponse.slice(0, 500)}{run.rawResponse.length > 500 ? '...' : ''}</pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'alternative' && results.alternative && (
          <div className="runs-list">
            {results.alternative.runs.map((run, index) => (
              <div key={run.runId} className="run-item">
                <div
                  className="run-header"
                  onClick={() => toggleRun(run.runId)}
                >
                  <span className="run-number">Run {index + 1}</span>
                  <span className="run-score">Score: {formatScore(run.overallScore)}</span>
                  <span className="run-latency">{run.latencyMs}ms</span>
                  <span className="expand-icon">
                    {expandedRuns.has(run.runId) ? '▼' : '▶'}
                  </span>
                </div>
                {expandedRuns.has(run.runId) && (
                  <div className="run-details">
                    <div className="run-scores">
                      <span>Tool: {formatScore(run.toolSelectionScore)}</span>
                      <span>Response: {formatScore(run.responseQualityScore)}</span>
                      {run.delegationScore !== undefined && (
                        <span>Delegation: {formatScore(run.delegationScore)}</span>
                      )}
                    </div>
                    <div className="run-response">
                      <strong>Response:</strong>
                      <pre>{run.rawResponse.slice(0, 500)}{run.rawResponse.length > 500 ? '...' : ''}</pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render when value props change
  // Callbacks are not compared since they may have new references but same behavior
  return prevProps.results === nextProps.results;
});
