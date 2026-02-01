/**
 * Evaluation API Routes
 *
 * REST endpoints for the prompt evaluation system.
 */

import type { Express, Request, Response } from 'express';
import { join } from 'path';
import type { LLMService } from '../llm/service.js';
import type { ToolRunner } from '../tools/runner.js';
import { EvaluationManager } from '../evaluation/index.js';
import type { WebChannel } from '../channels/web.js';

export interface EvalRoutesConfig {
  llmService: LLMService;
  toolRunner: ToolRunner;
  webChannel?: WebChannel;
}

// Store for active evaluation jobs
const activeJobs = new Map<string, {
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  results?: unknown;
  error?: string;
}>();

export function setupEvalRoutes(app: Express, config: EvalRoutesConfig): EvaluationManager {
  const evaluationsDir = join(process.cwd(), 'user', 'evaluations');
  const resultsDir = join(process.cwd(), 'user', 'evaluations', 'results');

  const manager = new EvaluationManager({
    evaluationsDir,
    resultsDir,
    llmService: config.llmService,
    toolRunner: config.toolRunner,
  });

  // Subscribe to evaluation events and broadcast via WebSocket
  if (config.webChannel) {
    manager.onEvent((event) => {
      config.webChannel!.broadcast(event);

      // Update job status
      if (event.type === 'eval_complete') {
        const job = activeJobs.get(event.jobId);
        if (job) {
          job.status = 'completed';
          job.results = event.results;
        }
      }
    });
  }

  // List all evaluations
  app.get('/api/eval/list', (req: Request, res: Response) => {
    try {
      const target = req.query.target as string | undefined;
      const tagsStr = req.query.tags as string | undefined;
      const tags = tagsStr ? tagsStr.split(',') : undefined;

      const evaluations = manager.listEvaluations({ target, tags });
      res.json({ evaluations });
    } catch (error) {
      console.error('[EvalAPI] Failed to list evaluations:', error);
      res.status(500).json({ error: 'Failed to list evaluations' });
    }
  });

  // List all suites
  app.get('/api/eval/suites', (_req: Request, res: Response) => {
    try {
      const suites = manager.listSuites();
      res.json({ suites });
    } catch (error) {
      console.error('[EvalAPI] Failed to list suites:', error);
      res.status(500).json({ error: 'Failed to list suites' });
    }
  });

  // Get evaluation details
  app.get('/api/eval/:path(*)', (req: Request, res: Response) => {
    try {
      const path = String(req.params.path);
      // Don't handle special routes
      if (['list', 'suites', 'run', 'results', 'history'].includes(path.split('/')[0])) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const evaluation = manager.loadEvaluation(path);
      res.json({ evaluation });
    } catch (error) {
      console.error('[EvalAPI] Failed to load evaluation:', error);
      res.status(404).json({ error: 'Evaluation not found' });
    }
  });

  // Run an evaluation
  app.post('/api/eval/run', async (req: Request, res: Response) => {
    try {
      const { evaluationPath, runs, alternativePrompt } = req.body;

      if (!evaluationPath) {
        res.status(400).json({ error: 'evaluationPath is required' });
        return;
      }

      const jobId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Store job status
      activeJobs.set(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      // Return immediately with job ID
      res.json({ jobId, status: 'started' });

      // Run evaluation asynchronously
      manager.runEvaluation(evaluationPath, {
        runs: runs || 5,
        alternativePrompt,
        jobId,
      }).then((results) => {
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.results = results;
        }
      }).catch((error) => {
        console.error('[EvalAPI] Evaluation failed:', error);
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = String(error);
        }
      });
    } catch (error) {
      console.error('[EvalAPI] Failed to start evaluation:', error);
      res.status(500).json({ error: 'Failed to start evaluation' });
    }
  });

  // Run a suite
  app.post('/api/eval/suite/run', async (req: Request, res: Response) => {
    try {
      const { suitePath } = req.body;

      if (!suitePath) {
        res.status(400).json({ error: 'suitePath is required' });
        return;
      }

      const jobId = `suite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Store job status
      activeJobs.set(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      // Return immediately with job ID
      res.json({ jobId, status: 'started' });

      // Run suite asynchronously
      manager.runSuite(suitePath, { jobId }).then((results) => {
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.results = results;
        }
      }).catch((error) => {
        console.error('[EvalAPI] Suite run failed:', error);
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = String(error);
        }
      });
    } catch (error) {
      console.error('[EvalAPI] Failed to start suite:', error);
      res.status(500).json({ error: 'Failed to start suite' });
    }
  });

  // Get job status/results
  app.get('/api/eval/results/:jobId', (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId);
      const job = activeJobs.get(jobId);

      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json({
        jobId,
        status: job.status,
        startedAt: job.startedAt,
        results: job.results,
        error: job.error,
      });
    } catch (error) {
      console.error('[EvalAPI] Failed to get job status:', error);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });

  // Get historical results for an evaluation
  app.get('/api/eval/history/:evaluationId', (req: Request, res: Response) => {
    try {
      const evaluationId = String(req.params.evaluationId);
      const limit = parseInt(req.query.limit as string) || 10;
      const results = manager.loadResults(evaluationId, limit);
      res.json({ results });
    } catch (error) {
      console.error('[EvalAPI] Failed to load history:', error);
      res.status(500).json({ error: 'Failed to load history' });
    }
  });

  // List available prompts
  app.get('/api/prompts/list', (_req: Request, res: Response) => {
    try {
      const promptLoader = manager.getRunner().getPromptLoader();
      const prompts = promptLoader.listAvailablePrompts();
      res.json({ prompts });
    } catch (error) {
      console.error('[EvalAPI] Failed to list prompts:', error);
      res.status(500).json({ error: 'Failed to list prompts' });
    }
  });

  // Get prompt content
  app.get('/api/prompts/:path(*)', (req: Request, res: Response) => {
    try {
      const path = String(req.params.path);
      const promptLoader = manager.getRunner().getPromptLoader();
      const content = promptLoader.loadFromFile(path);
      res.json({ path, content });
    } catch (error) {
      console.error('[EvalAPI] Failed to load prompt:', error);
      res.status(404).json({ error: 'Prompt not found' });
    }
  });

  // Generate report for a result
  app.post('/api/eval/report', (req: Request, res: Response) => {
    try {
      const { results, format } = req.body;

      if (!results) {
        res.status(400).json({ error: 'results is required' });
        return;
      }

      const report = manager.generateReport(results);
      res.json({ report, format: format || 'markdown' });
    } catch (error) {
      console.error('[EvalAPI] Failed to generate report:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // Clean up old jobs (called periodically or on demand)
  app.post('/api/eval/cleanup', (_req: Request, res: Response) => {
    try {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      let cleaned = 0;

      for (const [jobId, job] of activeJobs.entries()) {
        if (job.startedAt.getTime() < oneHourAgo && job.status !== 'running') {
          activeJobs.delete(jobId);
          cleaned++;
        }
      }

      res.json({ cleaned, remaining: activeJobs.size });
    } catch (error) {
      console.error('[EvalAPI] Failed to cleanup jobs:', error);
      res.status(500).json({ error: 'Failed to cleanup jobs' });
    }
  });

  return manager;
}
