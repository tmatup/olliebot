/**
 * Deep Research Types
 *
 * Type definitions for the deep research system including
 * events, metadata, configuration, and agent delegation.
 */

// ============================================================
// DEEP RESEARCH EVENTS
// ============================================================

/**
 * Event types emitted during deep research.
 */
export type DeepResearchEventType =
  | 'initiated'       // Research started
  | 'plan_created'    // Research plan generated
  | 'step_started'    // Research step beginning
  | 'step_completed'  // Research step finished
  | 'source_found'    // New source discovered
  | 'draft_started'   // Report drafting began
  | 'review_cycle'    // Internal review iteration
  | 'completed'       // Final report ready
  | 'error';          // Research failed

/**
 * Deep research event payload.
 */
export interface DeepResearchEvent {
  type: 'deep_research';
  subtype: DeepResearchEventType;
  researchId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ============================================================
// RESEARCH STATUS
// ============================================================

/**
 * Status of a deep research task.
 */
export type DeepResearchStatus =
  | 'planning'
  | 'researching'
  | 'drafting'
  | 'reviewing'
  | 'completed'
  | 'error';

// ============================================================
// RESEARCH PLAN
// ============================================================

/**
 * A subtopic within the research plan.
 */
export interface ResearchSubtopic {
  id: string;
  topic: string;
  questions: string[];
  assignedAgent?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  findings?: string;
  sourceCount?: number;
}

/**
 * Research plan created by the lead agent.
 */
export interface ResearchPlan {
  objectives: string[];
  subtopics: ResearchSubtopic[];
  estimatedDuration?: number;
}

// ============================================================
// SOURCES
// ============================================================

/**
 * A source discovered during research.
 */
export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  snippet: string;
  relevance: number;
  publishedDate?: string;
  citedIn?: string[];
}

// ============================================================
// RESEARCH STEPS
// ============================================================

/**
 * A step in the research process.
 */
export interface ResearchStep {
  id: string;
  stage: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  startedAt?: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

// ============================================================
// REVIEW CYCLES
// ============================================================

/**
 * A review cycle performed by the reviewer agent.
 */
export interface ReviewCycle {
  iteration: number;
  approved: boolean;
  feedback: string;
  issues: ReviewIssue[];
  strengths: string[];
  timestamp: string;
}

/**
 * An issue identified during review.
 */
export interface ReviewIssue {
  severity: 'high' | 'medium' | 'low';
  section: string;
  issue: string;
  suggestion: string;
}

// ============================================================
// DEEP RESEARCH METADATA
// ============================================================

/**
 * Complete metadata for a deep research task.
 * Attached to messages with messageType: 'deep_research'.
 */
export interface DeepResearchMetadata {
  type: 'deep_research';
  researchId: string;
  query: string;
  status: DeepResearchStatus;

  // Research plan
  plan?: ResearchPlan;

  // Sources collected
  sources?: ResearchSource[];

  // Research steps/progress
  steps?: ResearchStep[];

  // Review cycles
  reviewCycles?: ReviewCycle[];

  // Timing
  startedAt: string;
  completedAt?: string;
  estimatedDuration?: number;

  // Final output
  report?: string;
  error?: string;
}

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration for a deep research task.
 */
export interface DeepResearchConfig {
  // Behavior
  requireClarification: boolean;
  maxSubtopics: number;
  maxSourcesPerTopic: number;
  maxReviewCycles: number;

  // Models - can override env vars per-request
  provider?: string;
  model?: string;
  workerModel?: string;
  reviewerModel?: string;

  // Search
  searchProvider: 'tavily' | 'brave' | 'duckduckgo' | 'mcp';
  includeAcademic: boolean;

  // Output
  reportFormat: 'markdown' | 'html';
  includeSources: boolean;
  maxReportLength: number;
}

// ============================================================
// AGENT DELEGATION
// ============================================================

/**
 * Agent delegation configuration.
 * Controls which agents can invoke which other agents.
 */
export interface AgentDelegationConfig {
  /**
   * Whether this agent can delegate to other agents.
   * Default: false (agents cannot delegate by default)
   */
  canDelegate: boolean;

  /**
   * List of agent IDs this agent is allowed to invoke.
   * Only checked if canDelegate is true.
   * Empty array = can delegate to any agent (not recommended).
   */
  allowedDelegates: string[];

  /**
   * Workflow scope restriction.
   * If set, this agent can ONLY be invoked within the specified workflow.
   * null = can be invoked from anywhere (supervisor, other agents).
   */
  restrictedToWorkflow: string | null;

  /**
   * Whether supervisor can directly invoke this agent.
   * Default: true
   * Set to false for agents that should only be used as sub-agents.
   */
  supervisorCanInvoke: boolean;
}

/**
 * Workflow context passed through agent delegation chain.
 */
export interface WorkflowContext {
  workflowId: string;
  workflowInstanceId: string;
  parentAgentId: string;
  depth: number;
}

// ============================================================
// WEBSOCKET EVENTS
// ============================================================

/**
 * WebSocket events broadcast to UI during deep research.
 */
export type DeepResearchUIEvent =
  | { type: 'deep_research_started'; researchId: string; query: string }
  | { type: 'deep_research_plan'; researchId: string; plan: ResearchPlan }
  | { type: 'deep_research_step'; researchId: string; step: ResearchStep }
  | { type: 'deep_research_source'; researchId: string; source: ResearchSource }
  | { type: 'deep_research_progress'; researchId: string; percent: number; status: DeepResearchStatus }
  | { type: 'deep_research_draft'; researchId: string; section: string }
  | { type: 'deep_research_review'; researchId: string; review: ReviewCycle }
  | { type: 'deep_research_completed'; researchId: string; report: string }
  | { type: 'deep_research_error'; researchId: string; error: string };

// ============================================================
// WORKER TASK
// ============================================================

/**
 * Task assigned to a research worker agent.
 */
export interface ResearchWorkerTask {
  subtopicId: string;
  subtopic: string;
  questions: string[];
  targetSources: number;
  searchProvider?: string;
}

/**
 * Result returned by a research worker agent.
 */
export interface ResearchWorkerResult {
  subtopicId: string;
  findings: string;
  sources: ResearchSource[];
  gaps: string[];
  confidence: number;
}

// ============================================================
// REVIEWER TASK
// ============================================================

/**
 * Task assigned to a research reviewer agent.
 */
export interface ResearchReviewerTask {
  draft: string;
  sources: ResearchSource[];
  iteration: number;
}

/**
 * Result returned by a research reviewer agent.
 */
export interface ResearchReviewerResult {
  approved: boolean;
  issues: ReviewIssue[];
  strengths: string[];
  feedback: string;
}
