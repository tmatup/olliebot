/**
 * Agent Skills Types
 *
 * Based on the Agent Skills specification:
 * https://agentskills.io/specification
 *
 * Skills are folders containing a SKILL.md file with YAML frontmatter
 * and markdown instructions that agents load dynamically.
 */

/**
 * Skill metadata - loaded at startup for all skills
 * Kept minimal to reduce context usage (~50-100 tokens per skill)
 */
export interface SkillMetadata {
  /** Skill identifier (from frontmatter name or directory name) */
  id: string;
  /** Display name */
  name: string;
  /** Description of what the skill does and when to use it */
  description: string;
  /** Absolute path to SKILL.md file */
  filePath: string;
  /** Absolute path to skill directory */
  dirPath: string;
}

/**
 * Full skill content - loaded only when skill is activated
 */
export interface Skill extends SkillMetadata {
  /** License information */
  license?: string;
  /** Environment requirements */
  compatibility?: string;
  /** Additional metadata key-value pairs */
  metadata?: Record<string, string>;
  /** Pre-approved tools the skill may use (experimental) */
  allowedTools?: string[];

  /** The full markdown instructions (body after frontmatter) */
  instructions: string;
  /** Raw file content (frontmatter + body) */
  rawContent: string;

  /** Available reference files (references/*.md) */
  references: string[];
  /** Available scripts (scripts/*) */
  scripts: string[];
  /** Available assets (assets/*) */
  assets: string[];
}

/**
 * Result of skill invocation via the agent
 */
export interface SkillInvocationResult {
  success: boolean;
  skillId: string;
  output?: string;
  error?: string;
}
