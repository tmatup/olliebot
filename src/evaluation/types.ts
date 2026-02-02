/**
 * Evaluation System Types
 *
 * Core type definitions for the prompt evaluation system including
 * evaluation definitions, results, scoring, and statistical analysis.
 */

// ============================================================================
// Core Evaluation Types
// ============================================================================

export type TargetType = 'supervisor' | `sub-agent:${string}` | 'tool-generator';
export type MatchType = 'exact' | 'contains' | 'regex' | 'semantic';
export type PromptSource = 'file' | 'inline';

export interface EvaluationMetadata {
  id: string;
  name: string;
  description: string;
  target: TargetType;
  tags: string[];
  author?: string;
  created?: string;
  updated?: string;
}

export interface PromptReference {
  source: PromptSource;
  prompt?: string;       // Path relative to user/sub-agents/ or prompts/
  content?: string;      // Inline content
}

export interface TestCase {
  userPrompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: Record<string, unknown>;
}

// ============================================================================
// Tool Expectations
// ============================================================================

export interface ParameterExpectation {
  matchType: MatchType;
  expected?: string | number | boolean;
  min?: number;
  max?: number;
  pattern?: string;  // For regex
}

export interface ToolExpectation {
  name: string;
  required: boolean;
  parameters?: Record<string, ParameterExpectation>;
}

export interface ToolExpectations {
  expectedTools: ToolExpectation[];
  forbiddenTools?: string[];
  strictOrder?: boolean;
}

export interface MockedToolOutput {
  success: boolean;
  output?: unknown;
  error?: string;
}

// ============================================================================
// Response Expectations
// ============================================================================

export interface ResponseElement {
  id: string;
  description: string;
  matchType: MatchType;
  value: string;
  weight: number;
}

export interface ResponseConstraints {
  maxLength?: number;
  minLength?: number;
  noHallucinations?: boolean;
  mustBeMarkdown?: boolean;
  forbiddenPatterns?: string[];
}

export interface ResponseExpectations {
  requiredElements: ResponseElement[];
  optionalElements?: ResponseElement[];
  constraints?: ResponseConstraints;
}

// ============================================================================
// Delegation Expectations (Supervisor-specific)
// ============================================================================

export interface DelegationExpectations {
  shouldDelegate: boolean;
  expectedAgentType?: string;
  delegationRationaleShouldMention?: string[];
}

// ============================================================================
// Scoring Configuration
// ============================================================================

export interface ScoringCriteria {
  weight: number;
  criteria?: Record<string, number>;
}

export interface ScoringConfig {
  toolSelection: ScoringCriteria;
  responseQuality: ScoringCriteria;
  delegationAccuracy?: ScoringCriteria;
}

// Default scoring weights
export const DEFAULT_SCORING: ScoringConfig = {
  toolSelection: {
    weight: 0.3,
    criteria: {
      correct_tools_called: 0.5,
      correct_parameters: 0.3,
      no_forbidden_tools: 0.2,
    },
  },
  responseQuality: {
    weight: 0.5,
    criteria: {
      required_elements: 0.6,
      optional_elements: 0.2,
      constraints_met: 0.2,
    },
  },
  delegationAccuracy: {
    weight: 0.2,
    criteria: {
      correct_delegation_decision: 0.5,
      correct_agent_type: 0.3,
      quality_rationale: 0.2,
    },
  },
};

// ============================================================================
// Complete Evaluation Definition
// ============================================================================

export interface EvaluationDefinition {
  version: string;
  metadata: EvaluationMetadata;
  target: PromptReference;
  alternative?: PromptReference;
  testCase: TestCase;
  toolExpectations?: ToolExpectations;
  mockedOutputs?: Record<string, MockedToolOutput>;
  responseExpectations: ResponseExpectations;
  delegationExpectations?: DelegationExpectations;
  scoring?: ScoringConfig;
}

// ============================================================================
// Evaluation Results
// ============================================================================

export interface ToolCallResult {
  toolName: string;
  parameters: Record<string, unknown>;
  wasExpected: boolean;
  wasForbidden: boolean;
  parameterMatchScore: number;
  executionOrder: number;
}

export interface ElementMatchResult {
  elementId: string;
  matched: boolean;
  confidence: number;  // 0-1 for semantic matching
  matchedText?: string;
}

export interface DelegationDecision {
  delegated: boolean;
  agentType?: string;
  rationale?: string;
}

export interface SingleRunResult {
  runId: string;
  timestamp: Date;
  promptType: 'baseline' | 'alternative';

  // Raw outputs
  rawResponse: string;
  toolCalls: ToolCallResult[];
  delegationDecision?: DelegationDecision;

  // Scores
  toolSelectionScore: number;
  responseQualityScore: number;
  delegationScore?: number;
  overallScore: number;

  // Detailed results
  elementResults: ElementMatchResult[];
  constraintViolations: string[];

  // Metadata
  latencyMs: number;
  tokenUsage?: { input: number; output: number };
}

export interface StatisticalSummary {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  confidenceInterval: [number, number];
  samples: number[];
}

export interface AggregatedResults {
  promptType: 'baseline' | 'alternative';
  runs: SingleRunResult[];

  // Statistical summaries
  toolSelectionScore: StatisticalSummary;
  responseQualityScore: StatisticalSummary;
  delegationScore?: StatisticalSummary;
  overallScore: StatisticalSummary;

  // Per-element aggregation
  elementPassRates: Record<string, number>;
}

export interface ComparisonResult {
  evaluationId: string;
  evaluationName: string;
  timestamp: Date;

  baseline: AggregatedResults;
  alternative?: AggregatedResults;

  // Statistical comparison (if alternative exists)
  comparison?: {
    overallScoreDifference: number;
    pValue: number;
    isSignificant: boolean;
    confidenceLevel: number;
    effectSize: number;  // Cohen's d
    recommendation: 'keep-baseline' | 'adopt-alternative' | 'inconclusive';
  };
}

// ============================================================================
// Suite Types
// ============================================================================

export interface SuiteSettings {
  runsPerEvaluation: number;
  parallelRuns: boolean;
  timeoutMs: number;
  llmConfig?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export interface SuiteComparisonConfig {
  statisticalTest: 'welch_t_test' | 'mann_whitney' | 'bootstrap';
  confidenceLevel: number;
  minimumRunsForSignificance: number;
}

export interface EvaluationSuite {
  version: string;
  metadata: {
    id: string;
    name: string;
    description: string;
  };
  settings: SuiteSettings;
  evaluations: Array<{ path: string }>;
  comparison: SuiteComparisonConfig;
}

export interface SuiteResult {
  suiteId: string;
  suiteName: string;
  timestamp: Date;
  evaluationResults: ComparisonResult[];
  aggregateSummary: {
    totalEvaluations: number;
    baselineAvgScore: number;
    alternativeAvgScore?: number;
    significantImprovements: number;
    significantRegressions: number;
    inconclusive: number;
  };
}

// ============================================================================
// Evaluation Info (for listing)
// ============================================================================

export interface EvaluationInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  target: TargetType;
  tags: string[];
}

export interface SuiteInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  evaluationCount: number;
}

export interface SuiteWithEvaluations {
  id: string;
  name: string;
  description: string;
  path: string;           // folder path relative to evaluationsDir
  suitePath: string;      // .suite.json path relative to evaluationsDir
  evaluations: EvaluationInfo[];
}

// ============================================================================
// Progress Events (for WebSocket)
// ============================================================================

export interface EvalProgressEvent {
  type: 'eval_progress';
  jobId: string;
  current: number;
  total: number;
  promptType: 'baseline' | 'alternative';
  lastScore?: number;
}

export interface EvalRunCompleteEvent {
  type: 'eval_run_complete';
  jobId: string;
  runResult: SingleRunResult;
}

export interface EvalCompleteEvent {
  type: 'eval_complete';
  jobId: string;
  results: ComparisonResult;
}

export interface EvalErrorEvent {
  type: 'eval_error';
  jobId: string;
  error: string;
}

export type EvalEvent = EvalProgressEvent | EvalRunCompleteEvent | EvalCompleteEvent | EvalErrorEvent;
