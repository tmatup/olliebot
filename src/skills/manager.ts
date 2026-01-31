import { watch, type FSWatcher } from 'chokidar';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import type { Skill, SkillMetadata } from './types.js';
import { SkillParser } from './parser.js';

/**
 * Skill Manager - Discovers, loads, and provides skills to agents
 *
 * Based on the Agent Skills specification:
 * https://agentskills.io/specification
 *
 * Key principles:
 * - Progressive disclosure: metadata loaded at startup, full content on activation
 * - Agent-driven execution: agents read SKILL.md and execute scripts via bash tools
 * - Filesystem-based: skills are directories with SKILL.md files
 */
export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private metadata: Map<string, SkillMetadata> = new Map();
  private parser: SkillParser;
  private watcher: FSWatcher | null = null;
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
    this.parser = new SkillParser();

    // Ensure skills directory exists
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true });
    }
  }

  /**
   * Initialize the skill manager
   * Loads metadata for all skills (not full content - progressive disclosure)
   */
  async init(): Promise<void> {
    // Load metadata for all skills
    await this.loadMetadata();

    // Watch for changes
    this.startWatching();

    console.log(`[SkillManager] Initialized with ${this.metadata.size} skills`);
  }

  /**
   * Load metadata for all skills (frontmatter only)
   * This keeps initial context usage low
   */
  private async loadMetadata(): Promise<void> {
    const metadataList = await this.parser.loadMetadataFromDirectory(this.skillsDir);
    for (const meta of metadataList) {
      this.metadata.set(meta.id, meta);
      console.log(`[SkillManager] Discovered skill: ${meta.name} (${meta.id})`);

      // Auto-install dependencies if skill has scripts with package.json
      await this.installSkillDependencies(meta.dirPath);
    }
  }

  /**
   * Install npm dependencies for a skill if needed
   */
  private async installSkillDependencies(skillDir: string): Promise<void> {
    const scriptsDir = join(skillDir, 'scripts');
    const packageJsonPath = join(scriptsDir, 'package.json');
    const nodeModulesPath = join(scriptsDir, 'node_modules');

    // Check if scripts/package.json exists
    if (!existsSync(packageJsonPath)) {
      return;
    }

    // Check if node_modules already exists
    if (existsSync(nodeModulesPath)) {
      return;
    }

    try {
      // Read package.json to check for dependencies
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
      const hasDeps = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;
      const hasDevDeps = packageJson.devDependencies && Object.keys(packageJson.devDependencies).length > 0;

      if (!hasDeps && !hasDevDeps) {
        return;
      }

      console.log(`[SkillManager] Installing dependencies for skill in ${scriptsDir}...`);

      execSync('npm install', {
        cwd: scriptsDir,
        stdio: 'pipe',
        timeout: 120000, // 2 minute timeout
      });

      console.log(`[SkillManager] Dependencies installed for ${scriptsDir}`);
    } catch (error) {
      console.error(`[SkillManager] Failed to install dependencies in ${scriptsDir}:`, error);
    }
  }

  /**
   * Watch for skill file changes
   */
  private startWatching(): void {
    this.watcher = watch(join(this.skillsDir, '*', 'SKILL.md'), {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', async (filePath) => {
      const skill = await this.parser.parseSkill(
        filePath,
        join(filePath, '..')
      );
      if (skill) {
        this.metadata.set(skill.id, skill);
        this.skills.set(skill.id, skill);
        console.log(`[SkillManager] Added skill: ${skill.name}`);
      }
    });

    this.watcher.on('change', async (filePath) => {
      const skill = await this.parser.parseSkill(
        filePath,
        join(filePath, '..')
      );
      if (skill) {
        this.metadata.set(skill.id, skill);
        this.skills.set(skill.id, skill);
        console.log(`[SkillManager] Updated skill: ${skill.name}`);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      // Find and remove the skill
      for (const [id, meta] of this.metadata) {
        if (meta.filePath === filePath) {
          this.metadata.delete(id);
          this.skills.delete(id);
          console.log(`[SkillManager] Removed skill: ${meta.name}`);
          break;
        }
      }
    });
  }

  /**
   * Get skill metadata for system prompt injection
   * Returns XML format as recommended by the Agent Skills specification
   */
  getSkillsForSystemPrompt(): string {
    if (this.metadata.size === 0) {
      return '';
    }

    const skillsXml = Array.from(this.metadata.values())
      .map(
        (meta) => `  <skill>
    <name>${this.escapeXml(meta.name)}</name>
    <description>${this.escapeXml(meta.description)}</description>
    <location>${this.escapeXml(meta.filePath)}</location>
  </skill>`
      )
      .join('\n');

    return `<available_skills>
${skillsXml}
</available_skills>`;
  }

  /**
   * Get instructions for how the agent should use skills
   * Include this in the system prompt along with available_skills
   */
  getSkillUsageInstructions(): string {
    if (this.metadata.size === 0) {
      return '';
    }

    return `## Agent Skills

You have access to specialized skills that provide domain knowledge and workflows.
Skills are activated by reading their SKILL.md file when relevant to the task.

When a user request matches a skill's description:
1. Use the read_skill tool with the full path from the <location> tag
2. Follow the instructions in the skill file
3. If the skill references scripts, use the run_skill_script tool to execute them
4. If the skill has references/ directory, use read_skill with the file parameter to read additional docs

Tools available:
- read_skill: Read SKILL.md or reference files (skillPath required, optional file parameter)
- run_skill_script: Execute scripts from skill directories (scriptPath required, optional args/env/timeout)

IMPORTANT: Use the exact full paths from the skill's <location> tag.`;
  }

  /**
   * Get a skill by ID - loads full content if not already cached
   */
  async getSkill(skillId: string): Promise<Skill | null> {
    // Check cache first
    if (this.skills.has(skillId)) {
      return this.skills.get(skillId)!;
    }

    // Get metadata
    const meta = this.metadata.get(skillId);
    if (!meta) {
      return null;
    }

    // Load full skill
    const skill = await this.parser.parseSkill(meta.filePath, meta.dirPath);
    if (skill) {
      this.skills.set(skillId, skill);
    }

    return skill;
  }

  /**
   * Get all skill metadata
   */
  getAllMetadata(): SkillMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get skill metadata by ID
   */
  getMetadata(skillId: string): SkillMetadata | undefined {
    return this.metadata.get(skillId);
  }

  /**
   * Check if a skill exists
   */
  hasSkill(skillId: string): boolean {
    return this.metadata.has(skillId);
  }

  /**
   * Get the skills directory path
   */
  getSkillsDir(): string {
    return this.skillsDir;
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
