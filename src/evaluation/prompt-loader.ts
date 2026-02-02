/**
 * PromptLoader - Loads prompts for evaluation
 *
 * Handles loading prompts from various sources:
 * - External .md files in user/sub-agents/
 * - Inline content in evaluation definitions
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { PromptReference, TargetType } from './types.js';

// Directory paths
const USER_PROMPTS_DIR = join(process.cwd(), 'user', 'sub-agents');
const AGENT_PROMPTS_DIR = join(process.cwd(), 'src', 'agents');

// Default prompts (fallback if file doesn't exist)
const DEFAULT_PROMPTS: Record<string, string> = {
  researcher: `You are a Research Agent specialized in finding and analyzing information.
Your strengths:
- Web research and fact-finding
- Analyzing and summarizing information
- Providing detailed explanations with sources

Always cite your sources when possible and be thorough in your research.`,

  coder: `You are a Code Agent specialized in programming and technical tasks.
Your strengths:
- Writing clean, efficient code
- Debugging and fixing issues
- Explaining technical concepts

Always follow best practices and write well-documented code.`,

  writer: `You are a Writer Agent specialized in creating and editing content.
Your strengths:
- Writing clear, engaging content
- Editing and improving text
- Adapting tone and style for different audiences

Focus on clarity, accuracy, and engaging prose.`,

  planner: `You are a Planner Agent specialized in organizing and planning tasks.
Your strengths:
- Breaking down complex projects into steps
- Creating actionable plans
- Identifying dependencies and priorities

Always provide clear, achievable action items.`,

  custom: `You are a helpful assistant agent. Complete the assigned task to the best of your ability.`,
};

// Supervisor system prompt (the main orchestrator prompt)
const SUPERVISOR_PROMPT = `You are OllieBot, a supervisor agent that orchestrates a team of specialized agents.

Your capabilities:
- Directly answer simple questions yourself
- Delegate complex or specialized tasks to sub-agents
- Coordinate multiple agents working on related tasks
- Synthesize results from multiple agents

Available specialist types you can spawn:
- researcher: For research, information gathering, fact-finding
- coder: For programming, writing code, debugging, technical tasks
- writer: For writing documents, editing text, creative content
- planner: For planning, organizing, breaking down complex tasks

When you decide to delegate a task, respond with a JSON block like this:
\`\`\`delegate
{
  "type": "researcher|coder|writer|planner|custom",
  "rationale": "Brief explanation of why this agent type is best",
  "mission": "Specific task description for the agent",
  "customName": "optional custom agent name",
  "customEmoji": "optional custom emoji"
}
\`\`\`

IMPORTANT: Choose the agent based on the PRIMARY nature of the task:
- If the task is mainly about finding information → researcher
- If the task requires writing code → coder
- If the task is about creating written content → writer
- If the task involves planning or organizing → planner

For simple questions you can answer directly, just respond normally without delegating.`;

export class PromptLoader {
  private promptsDir: string;
  private cache: Map<string, string> = new Map();

  constructor(promptsDir?: string) {
    this.promptsDir = promptsDir || USER_PROMPTS_DIR;
  }

  /**
   * Load prompt from reference
   */
  load(reference: PromptReference): string {
    if (reference.source === 'inline' && reference.content) {
      return reference.content;
    }

    if (reference.source === 'file' && reference.prompt) {
      return this.loadFromFile(reference.prompt);
    }

    throw new Error('Invalid prompt reference: must have content for inline or prompt path for file');
  }

  /**
   * Load prompt from file path
   * Path can be:
   * - Relative to user/sub-agents/ (e.g., "researcher.md")
   * - Absolute path
   */
  loadFromFile(promptPath: string): string {
    // Check cache first
    if (this.cache.has(promptPath)) {
      return this.cache.get(promptPath)!;
    }

    // Try different path resolutions
    const pathsToTry = [
      // Direct path if absolute
      promptPath,
      // Relative to user/sub-agents/
      join(this.promptsDir, promptPath),
      // With .md extension in user dir
      join(this.promptsDir, `${promptPath}.md`),
      // Relative to src/agents/
      join(AGENT_PROMPTS_DIR, promptPath),
      // With .md extension in src/agents/
      join(AGENT_PROMPTS_DIR, `${promptPath}.md`),
    ];

    for (const fullPath of pathsToTry) {
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, 'utf-8').trim();
          if (content.length > 0) {
            this.cache.set(promptPath, content);
            return content;
          }
        } catch {
          // Try next path
        }
      }
    }

    // Fall back to default prompts
    const agentType = promptPath.replace('.md', '').split('/').pop() || '';
    if (DEFAULT_PROMPTS[agentType]) {
      console.log(`[PromptLoader] Using default prompt for: ${agentType}`);
      return DEFAULT_PROMPTS[agentType];
    }

    throw new Error(`Prompt not found: ${promptPath}`);
  }

  /**
   * Load prompt for a specific target type
   */
  loadForTarget(target: TargetType): string {
    if (target === 'supervisor') {
      return this.loadSupervisorPrompt();
    }

    if (target.startsWith('sub-agent:')) {
      const agentType = target.replace('sub-agent:', '');
      return this.loadSubAgentPrompt(agentType);
    }

    if (target === 'tool-generator') {
      return this.loadToolGeneratorPrompt();
    }

    throw new Error(`Unknown target type: ${target}`);
  }

  /**
   * Load supervisor system prompt
   */
  loadSupervisorPrompt(): string {
    // Try loading from file first - check both user dir and src/agents
    const pathsToTry = [
      join(this.promptsDir, 'supervisor.md'),
      join(AGENT_PROMPTS_DIR, 'supervisor.md'),
    ];

    for (const supervisorPath of pathsToTry) {
      if (existsSync(supervisorPath)) {
        try {
          const content = readFileSync(supervisorPath, 'utf-8').trim();
          if (content.length > 0) {
            return content;
          }
        } catch {
          // Try next path
        }
      }
    }

    return SUPERVISOR_PROMPT;
  }

  /**
   * Load sub-agent prompt by type
   */
  loadSubAgentPrompt(agentType: string): string {
    return this.loadFromFile(`${agentType}.md`);
  }

  /**
   * Load tool generator prompt
   */
  loadToolGeneratorPrompt(): string {
    // Try loading from file first - check both user dir and src/agents
    const pathsToTry = [
      join(this.promptsDir, 'code-generator.md'),
      join(AGENT_PROMPTS_DIR, 'code-generator.md'),
    ];

    for (const generatorPath of pathsToTry) {
      if (existsSync(generatorPath)) {
        try {
          const content = readFileSync(generatorPath, 'utf-8').trim();
          if (content.length > 0) {
            return content;
          }
        } catch {
          // Try next path
        }
      }
    }

    // Default tool generator prompt
    return `You are a code generator that translates tool specifications into JavaScript implementations.

## Output Format
You must output ONLY valid JavaScript code (no markdown, no explanation).
The code must have exactly two exports:

1. exports.inputSchema - A zod schema object defining the input parameters
2. exports.default - A function that implements the tool logic

## Available Globals
- z: The zod library for schema validation
- console: For logging (log, warn, error only)
- JSON, Math, Date, Array, Object, String, Number, Boolean

## Rules
- Use z.object() for the input schema with appropriate zod types
- The default function takes a single 'input' parameter
- Return a plain object with the output fields
- Handle errors gracefully - return { error: "message" } on failure
- NO require(), NO import, NO fetch(), NO fs, NO process
- Keep code simple and focused on the task`;
  }

  /**
   * List all available prompts
   */
  listAvailablePrompts(): Array<{ name: string; path: string; type: string }> {
    const prompts: Array<{ name: string; path: string; type: string }> = [];

    // Add supervisor
    prompts.push({
      name: 'Supervisor',
      path: 'supervisor.md',
      type: 'supervisor',
    });

    // Add sub-agents
    const subAgentTypes = ['researcher', 'coder', 'writer', 'planner', 'custom'];
    for (const agentType of subAgentTypes) {
      prompts.push({
        name: agentType.charAt(0).toUpperCase() + agentType.slice(1),
        path: `${agentType}.md`,
        type: `sub-agent:${agentType}`,
      });
    }

    // Add tool generator
    prompts.push({
      name: 'Code Generator',
      path: 'code-generator.md',
      type: 'tool-generator',
    });

    return prompts;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
