import { readFile, readdir, stat } from 'fs/promises';
import { join, basename, dirname } from 'path';
import type { Skill, SkillMetadata } from './types.js';

/**
 * Skill Parser - Loads and parses SKILL.md files
 *
 * Based on the Agent Skills specification:
 * https://agentskills.io/specification
 */
export class SkillParser {
  /**
   * Load all skills from a directory
   * Scans for subdirectories containing SKILL.md files
   */
  async loadSkillsFromDirectory(dirPath: string): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Check for SKILL.md in subdirectory (Anthropic-style)
          const skillMdPath = join(fullPath, 'SKILL.md');
          try {
            await stat(skillMdPath);
            const skill = await this.parseSkill(skillMdPath, fullPath);
            if (skill) {
              skills.push(skill);
            }
          } catch {
            // No SKILL.md in this directory, skip
          }
        }
      }
    } catch (error) {
      console.error('[SkillParser] Error loading skills:', error);
    }

    return skills;
  }

  /**
   * Load only metadata from all skills (for system prompt injection)
   * This is more efficient as it only parses frontmatter
   */
  async loadMetadataFromDirectory(dirPath: string): Promise<SkillMetadata[]> {
    const metadata: SkillMetadata[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const skillMdPath = join(fullPath, 'SKILL.md');
          try {
            await stat(skillMdPath);
            const meta = await this.parseMetadataOnly(skillMdPath, fullPath);
            if (meta) {
              metadata.push(meta);
            }
          } catch {
            // No SKILL.md in this directory, skip
          }
        }
      }
    } catch (error) {
      console.error('[SkillParser] Error loading skill metadata:', error);
    }

    return metadata;
  }

  /**
   * Parse only the metadata from a SKILL.md file (frontmatter only)
   * Used for initial loading to keep context usage low
   */
  async parseMetadataOnly(skillMdPath: string, dirPath: string): Promise<SkillMetadata | null> {
    try {
      const content = await readFile(skillMdPath, 'utf-8');
      const frontmatter = this.extractFrontmatter(content);

      // Extract and type-check frontmatter values
      const fmName = typeof frontmatter.name === 'string' ? frontmatter.name : '';
      const fmDescription = typeof frontmatter.description === 'string' ? frontmatter.description : '';

      // Get skill ID from frontmatter name or directory name
      const id = fmName || basename(dirPath);

      // Validate required fields
      if (!fmName) {
        console.warn(`[SkillParser] Skill missing name in frontmatter: ${skillMdPath}`);
      }
      if (!fmDescription) {
        console.warn(`[SkillParser] Skill missing description in frontmatter: ${skillMdPath}`);
      }

      // Generate display name from ID if not in frontmatter
      const name = fmName || this.idToDisplayName(id);
      const description = fmDescription;

      return {
        id,
        name,
        description,
        filePath: skillMdPath,
        dirPath,
      };
    } catch (error) {
      console.error(`[SkillParser] Error parsing metadata ${skillMdPath}:`, error);
      return null;
    }
  }

  /**
   * Parse a complete skill from SKILL.md file
   * Used when skill is activated and full instructions are needed
   */
  async parseSkill(skillMdPath: string, dirPath: string): Promise<Skill | null> {
    try {
      const content = await readFile(skillMdPath, 'utf-8');
      const frontmatter = this.extractFrontmatter(content);
      const instructions = this.extractBody(content);

      // Extract and type-check frontmatter values
      const fmName = typeof frontmatter.name === 'string' ? frontmatter.name : '';
      const fmDescription = typeof frontmatter.description === 'string' ? frontmatter.description : '';
      const fmLicense = typeof frontmatter.license === 'string' ? frontmatter.license : undefined;
      const fmCompatibility = typeof frontmatter.compatibility === 'string' ? frontmatter.compatibility : undefined;
      const fmAllowedTools = typeof frontmatter['allowed-tools'] === 'string'
        ? frontmatter['allowed-tools'].split(/\s+/)
        : undefined;

      // Get skill ID from frontmatter name or directory name
      const id = fmName || basename(dirPath);
      const name = fmName || this.idToDisplayName(id);
      const description = fmDescription;

      // Scan optional directories
      const references = await this.scanDirectory(join(dirPath, 'references'));
      const scripts = await this.scanDirectory(join(dirPath, 'scripts'));
      const assets = await this.scanDirectory(join(dirPath, 'assets'));

      const skill: Skill = {
        id,
        name,
        description,
        filePath: skillMdPath,
        dirPath,
        license: fmLicense,
        compatibility: fmCompatibility,
        metadata: frontmatter.metadata as Record<string, string> | undefined,
        allowedTools: fmAllowedTools,
        instructions,
        rawContent: content,
        references,
        scripts,
        assets,
      };

      return skill;
    } catch (error) {
      console.error(`[SkillParser] Error parsing skill ${skillMdPath}:`, error);
      return null;
    }
  }

  /**
   * Scan a directory for files
   */
  private async scanDirectory(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(dirPath);
      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Convert skill ID to display name
   * e.g., "pdf-processing" -> "Pdf Processing"
   */
  private idToDisplayName(id: string): string {
    return id
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * Extract YAML frontmatter from content
   */
  private extractFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const result: Record<string, unknown> = {};

    // Simple YAML parser for frontmatter
    let inMetadata = false;
    const metadataObj: Record<string, string> = {};

    for (const line of yaml.split('\n')) {
      // Check for top-level key
      const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
      if (keyMatch) {
        const key = keyMatch[1];
        const value = keyMatch[2].trim();

        if (key === 'metadata') {
          inMetadata = true;
          continue;
        }

        inMetadata = false;

        // Handle quoted strings
        if (value.startsWith('"') && value.endsWith('"')) {
          result[key] = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          result[key] = value.slice(1, -1);
        } else if (value) {
          result[key] = value;
        }
      } else if (inMetadata) {
        // Parse metadata sub-keys
        const subMatch = line.match(/^\s+(\w[\w-]*):\s*(.*)/);
        if (subMatch) {
          let val = subMatch[2].trim();
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1);
          } else if (val.startsWith("'") && val.endsWith("'")) {
            val = val.slice(1, -1);
          }
          metadataObj[subMatch[1]] = val;
        }
      }
    }

    if (Object.keys(metadataObj).length > 0) {
      result.metadata = metadataObj;
    }

    return result;
  }

  /**
   * Extract body content (everything after frontmatter)
   */
  private extractBody(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)/);
    return match ? match[1].trim() : content.trim();
  }
}
