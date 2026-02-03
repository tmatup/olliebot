import React, { memo } from 'react';

/**
 * RAG Projects Accordion
 * Displays a list of RAG projects from user/rag/ with indexing controls.
 */
const RAGProjects = memo(function RAGProjects({
  projects = [],
  indexingProgress = {}, // { projectId: { status, totalDocuments, processedDocuments, ... } }
  expanded = false,
  onToggle,
  onIndex,
}) {
  return (
    <div className="accordion">
      <button
        className={`accordion-header ${expanded ? 'expanded' : ''}`}
        onClick={onToggle}
      >
        <span className="accordion-icon">📚</span>
        <span className="accordion-title">RAG Projects</span>
        <span className="accordion-arrow">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="accordion-content">
          {projects.length === 0 ? (
            <div className="accordion-empty">
              No projects found
              <div className="accordion-empty-hint">
                Create folders in user/rag/
              </div>
            </div>
          ) : (
            projects.map((project) => {
              const projectProgress = indexingProgress[project.id];
              const isProjectIndexing =
                project.isIndexing ||
                (projectProgress &&
                  projectProgress.status !== 'completed' &&
                  projectProgress.status !== 'error');

              const progressPercent =
                projectProgress && projectProgress.totalDocuments > 0
                  ? Math.round(
                      (projectProgress.processedDocuments /
                        projectProgress.totalDocuments) *
                        100
                    )
                  : null;

              return (
                <div
                  key={project.id}
                  className={`accordion-item rag-project-item ${isProjectIndexing ? 'indexing' : ''}`}
                  title={`${project.documentCount} documents, ${project.vectorCount} vectors`}
                >
                  <span className="rag-project-icon">📁</span>
                  <div className="rag-project-info">
                    <span className="rag-project-name">{project.name}</span>
                    <span className="rag-project-stats">
                      {project.indexedCount}/{project.documentCount} indexed
                      {project.vectorCount > 0 && (
                        <span className="rag-project-vectors">
                          {' '}
                          • {project.vectorCount} vectors
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Index button / progress */}
                  {isProjectIndexing ? (
                    <div className="rag-project-progress">
                      {progressPercent !== null && (
                        <span className="rag-project-percent">{progressPercent}%</span>
                      )}
                      <span className="rag-project-spinner" title="Indexing...">
                        ◐
                      </span>
                    </div>
                  ) : (
                    <button
                      className="rag-project-index-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        const force = e.ctrlKey || e.metaKey;
                        onIndex(project.id, force);
                      }}
                      title="Index documents (Ctrl+click to force full re-index)"
                    >
                      ⟳
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
});

export default RAGProjects;
