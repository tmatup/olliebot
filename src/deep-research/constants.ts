/**
 * Deep Research Behavior Constants
 *
 * These constants control the behavior of the deep research system.
 * Modify these values to tune research depth, breadth, and quality.
 */

// ============================================================
// RESEARCH SCOPE PARAMETERS
// ============================================================

/**
 * Number of sub-topics to break the main research topic into.
 * Higher = more comprehensive but slower and more expensive.
 * Recommended: 4-8
 */
export const SUBTOPIC_COUNT = 6;

/**
 * Minimum number of sub-topics (even for simple queries).
 */
export const SUBTOPIC_COUNT_MIN = 3;

/**
 * Maximum number of sub-topics (for complex queries).
 */
export const SUBTOPIC_COUNT_MAX = 10;

// ============================================================
// DATA GATHERING PARAMETERS
// ============================================================

/**
 * Number of data sources to gather for EACH sub-topic.
 * Higher = more thorough research but slower.
 * Recommended: 10-30
 */
export const SOURCES_PER_SUBTOPIC = 20;

/**
 * Minimum sources per sub-topic before moving on.
 */
export const SOURCES_PER_SUBTOPIC_MIN = 5;

/**
 * Maximum sources per sub-topic (diminishing returns beyond this).
 */
export const SOURCES_PER_SUBTOPIC_MAX = 50;

/**
 * Number of search queries to run per sub-topic.
 * More queries = broader coverage of the topic.
 */
export const SEARCHES_PER_SUBTOPIC = 5;

// ============================================================
// QUALITY CONTROL PARAMETERS
// ============================================================

/**
 * Number of review cycles (draft -> review -> revise).
 * Higher = better quality but slower.
 * Recommended: 1-3
 */
export const REVIEW_CYCLES = 2;

/**
 * Maximum review cycles before finalizing (prevents infinite loops).
 */
export const REVIEW_CYCLES_MAX = 5;

/**
 * Minimum relevance score (0-1) for a source to be included.
 */
export const SOURCE_RELEVANCE_THRESHOLD = 0.6;

/**
 * Maximum age of sources in days (0 = no limit).
 * Set to limit research to recent sources only.
 */
export const SOURCE_MAX_AGE_DAYS = 0;

// ============================================================
// OUTPUT PARAMETERS
// ============================================================

/**
 * Maximum word count for the final report.
 */
export const REPORT_MAX_WORDS = 3000;

/**
 * Whether to always ask clarifying questions before starting.
 */
export const REQUIRE_CLARIFICATION = false;

/**
 * Whether to include academic sources (papers, journals).
 */
export const INCLUDE_ACADEMIC_SOURCES = true;

// ============================================================
// PERFORMANCE PARAMETERS
// ============================================================

/**
 * Maximum concurrent sub-agents running in parallel.
 * Higher = faster but more API calls at once.
 */
export const MAX_PARALLEL_WORKERS = 4;

/**
 * Timeout for each research step in milliseconds.
 */
export const STEP_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Timeout for sub-agent delegation in milliseconds.
 * This should be longer than STEP_TIMEOUT_MS as it includes agent spawn time,
 * task execution, and communication overhead.
 */
export const SUB_AGENT_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Total timeout for entire research task in milliseconds.
 */
export const TOTAL_TIMEOUT_MS = 1_800_000; // 30 minutes

// ============================================================
// WORKFLOW IDENTIFIERS
// ============================================================

/**
 * Workflow ID for deep research (used in delegation restrictions).
 */
export const DEEP_RESEARCH_WORKFLOW_ID = 'deep-research';

/**
 * Agent IDs for deep research agents.
 */
export const AGENT_IDS = {
  LEAD: 'deep-research-lead',
  WORKER: 'research-worker',
  REVIEWER: 'research-reviewer',
} as const;
