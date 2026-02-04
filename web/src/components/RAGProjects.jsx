import React, { useState } from 'react';

/**
 * RAG Projects Accordion
 * Displays a list of RAG projects from user/rag/ with indexing controls.
 * Supports drag-and-drop file upload to projects.
 */
function RAGProjects({
  projects = [],
  indexingProgress = {}, // { projectId: { status, totalDocuments, processedDocuments, ... } }
  expanded = false,
  onToggle,
  onIndex,
  onUpload, // (projectId, files) => Promise<void>
}) {
  // Track which project is being dragged over
  const [dragOverProjectId, setDragOverProjectId] = useState(null);
  const [uploadingProjectId, setUploadingProjectId] = useState(null);

  // Handle drag over on a project item
  const handleDragOver = (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverProjectId(projectId);
  };

  // Handle drag leave
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverProjectId(null);
  };

  // Handle file drop
  const handleDrop = async (e, projectId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverProjectId(null);

    if (!onUpload) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setUploadingProjectId(projectId);
    try {
      await onUpload(projectId, files);
    } catch {
      // Error handling done in parent
    }
    setUploadingProjectId(null);
  };
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

              const isDragOver = dragOverProjectId === project.id;
              const isUploading = uploadingProjectId === project.id;

              return (
                <div
                  key={project.id}
                  className={`accordion-item rag-project-item ${isProjectIndexing ? 'indexing' : ''} ${isDragOver ? 'drag-over' : ''} ${isUploading ? 'uploading' : ''}`}
                  title={`${project.documentCount} documents, ${project.vectorCount} vectors\nDrop files here to upload`}
                  onDragOver={(e) => handleDragOver(e, project.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, project.id)}
                >
                  <span className="rag-project-icon">
                    {isUploading ? '⬆️' : isDragOver ? '📥' : '📁'}
                  </span>
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
}

export default RAGProjects;
