/**
 * RAG Projects API Routes
 * Express routes for RAG project management.
 */

import { Router, type Request, type Response } from 'express';
import type { RAGProjectService } from './service.js';

/**
 * Create Express router for RAG project endpoints.
 */
export function createRAGProjectRoutes(ragService: RAGProjectService): Router {
  const router = Router();

  /**
   * GET /api/rag/projects
   * List all RAG projects.
   */
  router.get('/projects', async (_req: Request, res: Response) => {
    try {
      const projects = await ragService.listProjects();

      // Add indexing status to each project
      const projectsWithStatus = projects.map((project) => ({
        ...project,
        isIndexing: ragService.isIndexing(project.id),
      }));

      res.json(projectsWithStatus);
    } catch (error) {
      console.error('[RAGProjects] Failed to list projects:', error);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  /**
   * GET /api/rag/projects/:id
   * Get detailed project info including document list.
   */
  router.get('/projects/:id', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const project = await ragService.getProjectDetails(projectId);

      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      res.json({
        ...project,
        isIndexing: ragService.isIndexing(projectId),
      });
    } catch (error) {
      console.error(`[RAGProjects] Failed to get project:`, error);
      res.status(500).json({ error: 'Failed to get project details' });
    }
  });

  /**
   * POST /api/rag/projects/:id/index
   * Trigger indexing for a project.
   * Returns immediately; progress is sent via WebSocket.
   * Query param: ?force=true to force full re-index
   */
  router.post('/projects/:id/index', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const force = req.query.force === 'true' || req.body.force === true;

      // Check if already indexing
      if (ragService.isIndexing(projectId)) {
        res.status(409).json({ error: 'Indexing already in progress' });
        return;
      }

      // Start indexing (async - don't wait for completion)
      ragService.indexProject(projectId, force).catch((error) => {
        console.error(`[RAGProjects] Indexing error for ${projectId}:`, error);
      });

      res.json({
        success: true,
        message: force ? 'Force re-indexing started' : 'Indexing started',
        projectId,
        force,
      });
    } catch (error) {
      console.error(`[RAGProjects] Failed to start indexing:`, error);
      res.status(500).json({ error: 'Failed to start indexing' });
    }
  });

  /**
   * POST /api/rag/projects/:id/query
   * Query a project's vectors.
   */
  router.post('/projects/:id/query', async (req: Request, res: Response) => {
    try {
      const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { query, topK, minScore, contentType } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      const response = await ragService.queryProject(projectId, {
        query,
        topK: typeof topK === 'number' ? topK : 10,
        minScore: typeof minScore === 'number' ? minScore : 0,
        contentType: contentType || 'all',
      });

      res.json(response);
    } catch (error) {
      console.error(`[RAGProjects] Query error:`, error);
      res.status(500).json({ error: 'Query failed' });
    }
  });

  /**
   * GET /api/rag/supported-extensions
   * Get list of supported file extensions.
   */
  router.get('/supported-extensions', (_req: Request, res: Response) => {
    res.json({
      extensions: ragService.getSupportedExtensions(),
    });
  });

  return router;
}
