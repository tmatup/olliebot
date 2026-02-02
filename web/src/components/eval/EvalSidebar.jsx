import { useState, useEffect } from 'react';

export function EvalSidebar({
  onSelectEvaluation,
  onSelectSuite,
  onSelectResult,
  selectedEvaluation,
  selectedSuite,
  selectedResult,
}) {
  const [suites, setSuites] = useState([]);
  const [recentResults, setRecentResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSuites, setExpandedSuites] = useState({});
  const [expandedSections, setExpandedSections] = useState({
    evaluations: true,
    results: false,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [suitesRes, resultsRes] = await Promise.all([
        fetch('/api/eval/suites'),
        fetch('/api/eval/results?limit=10'),
      ]);

      if (suitesRes.ok) {
        const data = await suitesRes.json();
        setSuites(data.suites || []);
        // Auto-expand first suite if none expanded
        if (data.suites?.length > 0 && Object.keys(expandedSuites).length === 0) {
          setExpandedSuites({ [data.suites[0].id]: true });
        }
      }

      if (resultsRes.ok) {
        const data = await resultsRes.json();
        setRecentResults(data.results || []);
      }
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const toggleSuite = (suiteId) => {
    setExpandedSuites(prev => ({
      ...prev,
      [suiteId]: !prev[suiteId],
    }));
  };

  const handleSuiteClick = (suite, e) => {
    // If clicking the expand icon, just toggle
    if (e.target.classList.contains('suite-expand-icon')) {
      toggleSuite(suite.id);
      return;
    }
    // Otherwise select the suite and expand it
    onSelectSuite(suite);
    setExpandedSuites(prev => ({
      ...prev,
      [suite.id]: true,
    }));
  };

  const handleDeleteResult = async (result, e) => {
    e.stopPropagation();

    if (!confirm(`Delete result for "${result.evaluationName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/eval/result/${encodeURIComponent(result.filePath)}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        // Remove from local state
        setRecentResults(prev => prev.filter(r => r.filePath !== result.filePath));
        // Clear selection if this was the selected result
        if (selectedResult?.filePath === result.filePath) {
          onSelectResult?.(null);
        }
      } else {
        console.error('Failed to delete result');
      }
    } catch (error) {
      console.error('Failed to delete result:', error);
    }
  };

  // Count total evaluations across all suites
  const totalEvaluations = suites.reduce((sum, suite) => sum + (suite.evaluations?.length || 0), 0);

  if (loading) {
    return (
      <div className="eval-sidebar">
        <div className="eval-sidebar-header">
          <h3>Evaluations</h3>
        </div>
        <div className="eval-sidebar-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="eval-sidebar">
      <div className="eval-sidebar-header">
        <h3>Evaluations</h3>
        <button className="refresh-btn" onClick={loadData} title="Refresh">
          ↻
        </button>
      </div>

      {/* Evaluations Tree Section */}
      <div className="eval-section">
        <div
          className="eval-section-header"
          onClick={() => toggleSection('evaluations')}
        >
          <span className="expand-icon">{expandedSections.evaluations ? '▼' : '▶'}</span>
          <span>Evaluations ({totalEvaluations})</span>
        </div>

        {expandedSections.evaluations && (
          <div className="eval-section-content eval-tree">
            {suites.map(suite => (
              <div key={suite.id} className="eval-tree-suite">
                {/* Suite header (expandable root node) */}
                <div
                  className={`eval-tree-suite-header ${selectedSuite?.id === suite.id ? 'selected' : ''}`}
                  onClick={(e) => handleSuiteClick(suite, e)}
                >
                  <span
                    className="suite-expand-icon"
                    onClick={(e) => { e.stopPropagation(); toggleSuite(suite.id); }}
                  >
                    {expandedSuites[suite.id] ? '▼' : '▶'}
                  </span>
                  <span className="suite-icon">📦</span>
                  <span className="suite-name">{suite.name}</span>
                  <span className="suite-count">{suite.evaluations?.length || 0}</span>
                </div>

                {/* Evaluations (leaf nodes) */}
                {expandedSuites[suite.id] && suite.evaluations?.length > 0 && (
                  <div className="eval-tree-evaluations">
                    {suite.evaluations.map(evaluation => (
                      <div
                        key={evaluation.id}
                        className={`eval-tree-item ${selectedEvaluation?.id === evaluation.id ? 'selected' : ''}`}
                        onClick={() => onSelectEvaluation(evaluation)}
                      >
                        <span className="eval-tree-item-icon">📄</span>
                        <span className="eval-tree-item-name">
                          {evaluation.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty state for suite with no evaluations */}
                {expandedSuites[suite.id] && (!suite.evaluations || suite.evaluations.length === 0) && (
                  <div className="eval-tree-empty">No evaluations in this suite</div>
                )}
              </div>
            ))}

            {suites.length === 0 && (
              <div className="eval-empty">No suites found</div>
            )}
          </div>
        )}
      </div>

      {/* Recent Results Section */}
      <div className="eval-section">
        <div
          className="eval-section-header"
          onClick={() => toggleSection('results')}
        >
          <span className="expand-icon">{expandedSections.results ? '▼' : '▶'}</span>
          <span>Recent Results ({recentResults.length})</span>
        </div>

        {expandedSections.results && (
          <div className="eval-section-content">
            {recentResults.map((result, idx) => (
              <div
                key={idx}
                className={`eval-result-item ${selectedResult?.filePath === result.filePath ? 'selected' : ''}`}
                onClick={() => onSelectResult?.(result)}
              >
                <span className="result-name">{result.evaluationName}</span>
                <span className="result-score" style={{
                  color: result.overallScore >= 0.8 ? 'var(--success)' :
                         result.overallScore >= 0.5 ? 'var(--warning)' : 'var(--error)'
                }}>
                  {(result.overallScore * 100).toFixed(0)}%
                </span>
                <span className="result-date">
                  {new Date(result.timestamp).toLocaleDateString()}
                </span>
                <button
                  className="result-delete-btn"
                  onClick={(e) => handleDeleteResult(result, e)}
                  title="Delete result"
                >
                  ×
                </button>
              </div>
            ))}
            {recentResults.length === 0 && (
              <div className="eval-empty">No recent results</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
