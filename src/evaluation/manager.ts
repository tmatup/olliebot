/**
 * EvaluationManager - Central orchestrator for evaluation operations
 *
 * Responsibilities:
 * - List, load, and validate evaluation definitions
 * - Manage evaluation suites
 * - Coordinate runner execution
 * - Store and retrieve results
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, relative, basename, dirname } from 'path';
import type { LLMService } from '../llm/service.js';
import type { ToolRunner } from '../tools/runner.js';
import type {
  EvaluationDefinition,
  EvaluationSuite,
  ComparisonResult,
  SuiteResult,
  EvaluationInfo,
  SuiteInfo,
  SuiteWithEvaluations,
  AggregatedResults,
  EvalEvent,
} from './types.js';
import { EvaluationRunner } from './runner.js';
import { StatisticsEngine } from './statistics.js';

export interface EvaluationManagerConfig {
  evaluationsDir: string;
  resultsDir: string;
  llmService: LLMService;
  toolRunner: ToolRunner;
}

export type EvalEventCallback = (event: EvalEvent) => void;

export class EvaluationManager {
  private config: EvaluationManagerConfig;
  private runner: EvaluationRunner;
  private statistics: StatisticsEngine;
  private eventListeners: Set<EvalEventCallback> = new Set();

  constructor(config: EvaluationManagerConfig) {
    this.config = config;
    this.runner = new EvaluationRunner({
      llmService: config.llmService,
      toolRunner: config.toolRunner,
    });
    this.statistics = new StatisticsEngine();

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    const dirs = [
      this.config.evaluationsDir,
      this.config.resultsDir,
      join(this.config.evaluationsDir, 'suites'),
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Subscribe to evaluation events
   */
  onEvent(callback: EvalEventCallback): () => void {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: EvalEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[EvaluationManager] Event listener error:', error);
      }
    }
  }

  /**
   * List all available evaluations
   */
  listEvaluations(filter?: { target?: string; tags?: string[] }): EvaluationInfo[] {
    const evaluations: EvaluationInfo[] = [];

    const scanDir = (dir: string) => {
      if (!existsSync(dir)) return;

      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.eval.json')) {
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const parsed = JSON.parse(content) as EvaluationDefinition;

            // Apply filters
            if (filter?.target && !parsed.metadata.target.includes(filter.target)) {
              continue;
            }
            if (filter?.tags && filter.tags.length > 0) {
              const hasMatchingTag = filter.tags.some(tag =>
                parsed.metadata.tags.includes(tag)
              );
              if (!hasMatchingTag) continue;
            }

            evaluations.push({
              id: parsed.metadata.id,
              name: parsed.metadata.name,
              description: parsed.metadata.description,
              path: relative(this.config.evaluationsDir, fullPath),
              target: parsed.metadata.target,
              tags: parsed.metadata.tags,
            });
          } catch (error) {
            console.warn(`[EvaluationManager] Failed to parse ${fullPath}:`, error);
          }
        }
      }
    };

    scanDir(this.config.evaluationsDir);

    return evaluations;
  }

  /**
   * List all evaluation suites (legacy - returns SuiteInfo[])
   */
  listSuites(): SuiteInfo[] {
    const suitesWithEvals = this.listSuitesWithEvaluations();
    return suitesWithEvals.map(suite => ({
      id: suite.id,
      name: suite.name,
      description: suite.description,
      path: suite.suitePath,
      evaluationCount: suite.evaluations.length,
    }));
  }

  /**
   * List all evaluation suites with their contained evaluations
   * Scans suites/ directory for subdirectories, each subdirectory is a suite
   */
  listSuitesWithEvaluations(): SuiteWithEvaluations[] {
    const suites: SuiteWithEvaluations[] = [];
    const suitesDir = join(this.config.evaluationsDir, 'suites');

    if (!existsSync(suitesDir)) return suites;

    const entries = readdirSync(suitesDir, { withFileTypes: true });

    for (const entry of entries) {
      // Each subdirectory is a suite
      if (entry.isDirectory()) {
        const suiteFolder = join(suitesDir, entry.name);
        const suiteName = entry.name;
        const suiteJsonPath = join(suiteFolder, `${suiteName}.suite.json`);

        try {
          // Load suite metadata from .suite.json file
          if (!existsSync(suiteJsonPath)) {
            console.warn(`[EvaluationManager] Suite folder ${suiteName} missing ${suiteName}.suite.json`);
            continue;
          }

          const suiteContent = readFileSync(suiteJsonPath, 'utf-8');
          const parsed = JSON.parse(suiteContent) as EvaluationSuite;

          // Scan for .eval.json files in the suite folder
          const evaluations: EvaluationInfo[] = [];
          const suiteEntries = readdirSync(suiteFolder, { withFileTypes: true });

          for (const suiteEntry of suiteEntries) {
            if (suiteEntry.isFile() && suiteEntry.name.endsWith('.eval.json')) {
              const evalPath = join(suiteFolder, suiteEntry.name);
              try {
                const evalContent = readFileSync(evalPath, 'utf-8');
                const evalParsed = JSON.parse(evalContent) as EvaluationDefinition;

                evaluations.push({
                  id: evalParsed.metadata.id,
                  name: evalParsed.metadata.name,
                  description: evalParsed.metadata.description,
                  path: relative(this.config.evaluationsDir, evalPath),
                  target: evalParsed.metadata.target,
                  tags: evalParsed.metadata.tags,
                });
              } catch (error) {
                console.warn(`[EvaluationManager] Failed to parse eval ${evalPath}:`, error);
              }
            }
          }

          suites.push({
            id: parsed.metadata.id,
            name: parsed.metadata.name,
            description: parsed.metadata.description,
            path: relative(this.config.evaluationsDir, suiteFolder),
            suitePath: relative(this.config.evaluationsDir, suiteJsonPath),
            evaluations,
          });
        } catch (error) {
          console.warn(`[EvaluationManager] Failed to parse suite ${suiteFolder}:`, error);
        }
      }
    }

    return suites;
  }

  /**
   * Load and validate an evaluation definition
   */
  loadEvaluation(path: string): EvaluationDefinition {
    const fullPath = path.startsWith('/')
      ? path
      : join(this.config.evaluationsDir, path);

    if (!existsSync(fullPath)) {
      throw new Error(`Evaluation file not found: ${fullPath}`);
    }

    const content = readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(content) as EvaluationDefinition;

    // Validate required fields
    this.validateEvaluation(parsed);

    return parsed;
  }

  /**
   * Load an evaluation suite
   */
  loadSuite(path: string): EvaluationSuite {
    const fullPath = path.startsWith('/')
      ? path
      : join(this.config.evaluationsDir, path);

    if (!existsSync(fullPath)) {
      throw new Error(`Suite file not found: ${fullPath}`);
    }

    const content = readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(content) as EvaluationSuite;

    return parsed;
  }

  /**
   * Save an evaluation definition to file
   */
  saveEvaluation(path: string, content: EvaluationDefinition): void {
    const fullPath = path.startsWith('/')
      ? path
      : join(this.config.evaluationsDir, path);

    // Validate the evaluation before saving
    this.validateEvaluation(content);

    // Write to file
    writeFileSync(fullPath, JSON.stringify(content, null, 2));
    console.log(`[EvaluationManager] Evaluation saved to: ${fullPath}`);
  }

  /**
   * Validate evaluation definition
   */
  private validateEvaluation(def: EvaluationDefinition): void {
    if (!def.metadata?.id) {
      throw new Error('Evaluation must have metadata.id');
    }
    if (!def.metadata?.name) {
      throw new Error('Evaluation must have metadata.name');
    }
    if (!def.metadata?.target) {
      throw new Error('Evaluation must have metadata.target');
    }
    if (!def.target) {
      throw new Error('Evaluation must have target prompt reference');
    }
    if (!def.testCase?.userPrompt) {
      throw new Error('Evaluation must have testCase.userPrompt');
    }
    if (!def.responseExpectations) {
      throw new Error('Evaluation must have responseExpectations');
    }
  }

  /**
   * Run a single evaluation N times and compare baseline vs alternative
   */
  async runEvaluation(
    evaluationPath: string,
    options?: {
      runs?: number;
      alternativePrompt?: string;
      jobId?: string;
    }
  ): Promise<ComparisonResult> {
    const jobId = options?.jobId || `eval-${Date.now()}`;
    const runs = options?.runs || 5;

    // Load evaluation definition
    const definition = this.loadEvaluation(evaluationPath);

    // Override alternative if provided
    if (options?.alternativePrompt) {
      definition.alternative = {
        source: 'file',
        prompt: options.alternativePrompt,
      };
    }

    // Run baseline
    console.log(`[EvaluationManager] Running baseline (${runs} runs)...`);
    const baselineRuns = await this.runner.executeMultipleRuns(
      definition,
      'baseline',
      runs,
      (current, total, lastResult) => {
        this.emitEvent({
          type: 'eval_progress',
          jobId,
          current,
          total: definition.alternative ? total * 2 : total,
          promptType: 'baseline',
          lastScore: lastResult?.overallScore,
        });

        if (lastResult) {
          this.emitEvent({
            type: 'eval_run_complete',
            jobId,
            runResult: lastResult,
          });
        }
      }
    );

    const baselineAggregated = this.statistics.aggregateResults(baselineRuns, 'baseline');

    // Run alternative if defined
    let alternativeAggregated: AggregatedResults | undefined;
    let comparison: ComparisonResult['comparison'];

    if (definition.alternative) {
      console.log(`[EvaluationManager] Running alternative (${runs} runs)...`);
      const alternativeRuns = await this.runner.executeMultipleRuns(
        definition,
        'alternative',
        runs,
        (current, total, lastResult) => {
          this.emitEvent({
            type: 'eval_progress',
            jobId,
            current: runs + current,
            total: runs * 2,
            promptType: 'alternative',
            lastScore: lastResult?.overallScore,
          });

          if (lastResult) {
            this.emitEvent({
              type: 'eval_run_complete',
              jobId,
              runResult: lastResult,
            });
          }
        }
      );

      alternativeAggregated = this.statistics.aggregateResults(alternativeRuns, 'alternative');
      comparison = this.statistics.welchTTest(baselineAggregated, alternativeAggregated);
    }

    const result: ComparisonResult = {
      evaluationId: definition.metadata.id,
      evaluationName: definition.metadata.name,
      timestamp: new Date(),
      baseline: baselineAggregated,
      alternative: alternativeAggregated,
      comparison,
    };

    // Save results
    this.saveResults(result);

    // Emit completion event
    this.emitEvent({
      type: 'eval_complete',
      jobId,
      results: result,
    });

    return result;
  }

  /**
   * Run an entire evaluation suite
   */
  async runSuite(
    suitePath: string,
    options?: { jobId?: string }
  ): Promise<SuiteResult> {
    const jobId = options?.jobId || `suite-${Date.now()}`;
    const suite = this.loadSuite(suitePath);

    const evaluationResults: ComparisonResult[] = [];
    let significantImprovements = 0;
    let significantRegressions = 0;
    let inconclusive = 0;

    console.log(`[EvaluationManager] Running suite: ${suite.metadata.name}`);
    console.log(`[EvaluationManager] Evaluations: ${suite.evaluations.length}`);

    for (let i = 0; i < suite.evaluations.length; i++) {
      const evalPath = suite.evaluations[i].path;
      console.log(`[EvaluationManager] Running evaluation ${i + 1}/${suite.evaluations.length}: ${evalPath}`);

      try {
        const result = await this.runEvaluation(evalPath, {
          runs: suite.settings.runsPerEvaluation,
          jobId: `${jobId}-eval-${i}`,
        });

        evaluationResults.push(result);

        // Track comparison outcomes
        if (result.comparison) {
          if (result.comparison.recommendation === 'adopt-alternative') {
            significantImprovements++;
          } else if (result.comparison.recommendation === 'keep-baseline') {
            significantRegressions++;
          } else {
            inconclusive++;
          }
        }
      } catch (error) {
        console.error(`[EvaluationManager] Failed to run evaluation ${evalPath}:`, error);
      }
    }

    // Calculate aggregate summary
    const baselineScores = evaluationResults.map(r => r.baseline.overallScore.mean);
    const alternativeScores = evaluationResults
      .filter(r => r.alternative)
      .map(r => r.alternative!.overallScore.mean);

    const result: SuiteResult = {
      suiteId: suite.metadata.id,
      suiteName: suite.metadata.name,
      timestamp: new Date(),
      evaluationResults,
      aggregateSummary: {
        totalEvaluations: evaluationResults.length,
        baselineAvgScore: baselineScores.reduce((a, b) => a + b, 0) / baselineScores.length,
        alternativeAvgScore: alternativeScores.length > 0
          ? alternativeScores.reduce((a, b) => a + b, 0) / alternativeScores.length
          : undefined,
        significantImprovements,
        significantRegressions,
        inconclusive,
      },
    };

    // Save suite results
    this.saveSuiteResults(result);

    return result;
  }

  /**
   * Save evaluation results
   */
  saveResults(results: ComparisonResult): void {
    const dateStr = new Date().toISOString().split('T')[0];
    const dateDir = join(this.config.resultsDir, dateStr);

    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    const filename = `${results.evaluationId}-${Date.now()}.json`;
    const filepath = join(dateDir, filename);

    writeFileSync(filepath, JSON.stringify(results, null, 2));
    console.log(`[EvaluationManager] Results saved to: ${filepath}`);
  }

  /**
   * Save suite results
   */
  saveSuiteResults(results: SuiteResult): void {
    const dateStr = new Date().toISOString().split('T')[0];
    const dateDir = join(this.config.resultsDir, dateStr);

    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    const filename = `suite-${results.suiteId}-${Date.now()}.json`;
    const filepath = join(dateDir, filename);

    writeFileSync(filepath, JSON.stringify(results, null, 2));
    console.log(`[EvaluationManager] Suite results saved to: ${filepath}`);
  }

  /**
   * Load historical results for an evaluation
   */
  loadResults(evaluationId: string, limit = 10): ComparisonResult[] {
    const results: ComparisonResult[] = [];

    if (!existsSync(this.config.resultsDir)) return results;

    // Scan all date directories
    const dateDirs = readdirSync(this.config.resultsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();

    for (const dateDir of dateDirs) {
      const dirPath = join(this.config.resultsDir, dateDir);
      const files = readdirSync(dirPath)
        .filter(f => f.startsWith(evaluationId) && f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of files) {
        if (results.length >= limit) break;

        try {
          const content = readFileSync(join(dirPath, file), 'utf-8');
          const parsed = JSON.parse(content) as ComparisonResult;
          results.push(parsed);
        } catch {
          // Skip invalid files
        }
      }

      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Load a specific result by its file path (e.g., "2026-02-01/result-file.json")
   */
  loadResultByPath(filePath: string): ComparisonResult {
    const fullPath = join(this.config.resultsDir, filePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Result file not found: ${fullPath}`);
    }

    const content = readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as ComparisonResult;
  }

  /**
   * Load recent results across all evaluations
   */
  loadRecentResults(limit = 10): Array<{ evaluationId: string; evaluationName: string; timestamp: Date; overallScore: number; filePath: string }> {
    const results: Array<{ evaluationId: string; evaluationName: string; timestamp: Date; overallScore: number; filePath: string; mtime: number }> = [];

    if (!existsSync(this.config.resultsDir)) return [];

    // Scan all date directories
    const dateDirs = readdirSync(this.config.resultsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();

    for (const dateDir of dateDirs) {
      const dirPath = join(this.config.resultsDir, dateDir);
      const files = readdirSync(dirPath)
        .filter(f => f.endsWith('.json') && !f.startsWith('suite-'))
        .sort()
        .reverse();

      for (const file of files) {
        if (results.length >= limit * 2) break; // Get extra to sort by time

        try {
          const filePath = join(dirPath, file);
          const content = readFileSync(filePath, 'utf-8');
          const parsed = JSON.parse(content) as ComparisonResult;

          results.push({
            evaluationId: parsed.evaluationId,
            evaluationName: parsed.evaluationName,
            timestamp: new Date(parsed.timestamp),
            overallScore: parsed.baseline.overallScore.mean,
            filePath: `${dateDir}/${file}`,
            mtime: new Date(parsed.timestamp).getTime(),
          });
        } catch {
          // Skip invalid files
        }
      }

      if (results.length >= limit * 2) break;
    }

    // Sort by timestamp descending and limit
    return results
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map(({ mtime, ...rest }) => rest);
  }

  /**
   * Delete a result file by its path (e.g., "2026-02-01/result-123.json")
   */
  deleteResult(filePath: string): void {
    const fullPath = join(this.config.resultsDir, filePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Result file not found: ${filePath}`);
    }

    // Security check: ensure path is within resultsDir
    const normalizedPath = join(this.config.resultsDir, filePath);
    if (!normalizedPath.startsWith(this.config.resultsDir)) {
      throw new Error('Invalid file path');
    }

    unlinkSync(fullPath);
    console.log(`[EvaluationManager] Deleted result: ${filePath}`);
  }

  /**
   * Get the evaluation runner (for advanced use)
   */
  getRunner(): EvaluationRunner {
    return this.runner;
  }

  /**
   * Get the statistics engine (for advanced use)
   */
  getStatistics(): StatisticsEngine {
    return this.statistics;
  }

  /**
   * Generate a summary report as markdown
   */
  generateReport(results: ComparisonResult): string {
    let report = `# Evaluation Report: ${results.evaluationName}\n\n`;
    report += `**ID:** ${results.evaluationId}\n`;
    report += `**Date:** ${results.timestamp}\n\n`;

    report += `## Baseline Results\n\n`;
    report += `| Metric | Mean | Median | Std Dev | 95% CI |\n`;
    report += `|--------|------|--------|---------|--------|\n`;
    report += this.formatScoreRow('Tool Selection', results.baseline.toolSelectionScore);
    report += this.formatScoreRow('Response Quality', results.baseline.responseQualityScore);
    if (results.baseline.delegationScore) {
      report += this.formatScoreRow('Delegation', results.baseline.delegationScore);
    }
    report += this.formatScoreRow('**Overall**', results.baseline.overallScore);

    if (results.alternative && results.comparison) {
      report += `\n## Alternative Results\n\n`;
      report += `| Metric | Mean | Median | Std Dev | 95% CI |\n`;
      report += `|--------|------|--------|---------|--------|\n`;
      report += this.formatScoreRow('Tool Selection', results.alternative.toolSelectionScore);
      report += this.formatScoreRow('Response Quality', results.alternative.responseQualityScore);
      if (results.alternative.delegationScore) {
        report += this.formatScoreRow('Delegation', results.alternative.delegationScore);
      }
      report += this.formatScoreRow('**Overall**', results.alternative.overallScore);

      report += `\n## Comparison\n\n`;
      report += `- **Score Difference:** ${results.comparison.overallScoreDifference.toFixed(4)}\n`;
      report += `- **p-value:** ${results.comparison.pValue.toFixed(4)}\n`;
      report += `- **Significant:** ${results.comparison.isSignificant ? 'Yes' : 'No'}\n`;
      report += `- **Effect Size (Cohen's d):** ${results.comparison.effectSize.toFixed(3)} (${this.statistics.interpretEffectSize(results.comparison.effectSize)})\n`;
      report += `\n### Recommendation\n\n`;

      if (results.comparison.recommendation === 'adopt-alternative') {
        report += `**ADOPT ALTERNATIVE** - The alternative prompt shows statistically significant improvement.\n`;
      } else if (results.comparison.recommendation === 'keep-baseline') {
        report += `**KEEP BASELINE** - The baseline prompt performs better or equal.\n`;
      } else {
        report += `**INCONCLUSIVE** - No statistically significant difference detected. Consider running more iterations.\n`;
      }
    }

    return report;
  }

  private formatScoreRow(name: string, summary: { mean: number; median: number; stdDev: number; confidenceInterval: [number, number] }): string {
    return `| ${name} | ${summary.mean.toFixed(3)} | ${summary.median.toFixed(3)} | ${summary.stdDev.toFixed(3)} | [${summary.confidenceInterval[0].toFixed(3)}, ${summary.confidenceInterval[1].toFixed(3)}] |\n`;
  }
}
