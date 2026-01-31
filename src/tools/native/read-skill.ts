import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, normalize, resolve } from 'path';
import type { NativeTool, NativeToolResult } from './types.js';

interface ReadSkillParams {
  /** Full absolute path to the SKILL.md file */
  skillPath: string;
  /** Optional: specific file within the skill directory (e.g., "references/forms.md") */
  file?: string;
}

/**
 * Read Skill Tool - Allows the agent to read skill files
 *
 * Per the Agent Skills spec, agents activate skills by reading SKILL.md files
 * and any referenced documents in the skill directory.
 */
export class ReadSkillTool implements NativeTool {
  name = 'read_skill';
  description = `Read a skill file to load its instructions. You must provide the full absolute path to the SKILL.md file as shown in your available skills list.
You can also read additional files within the skill directory like references or documentation.`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      skillPath: {
        type: 'string',
        description: 'The full absolute path to the SKILL.md file (e.g., "user/skills/pdf/SKILL.md")',
      },
      file: {
        type: 'string',
        description: 'Optional: specific file within skill directory (e.g., "references/forms.md")',
      },
    },
    required: ['skillPath'],
  };

  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = resolve(skillsDir);
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const { skillPath, file } = params as unknown as ReadSkillParams;

    if (!skillPath) {
      return {
        success: false,
        error: 'skillPath is required',
      };
    }

    try {
      // Resolve the path
      let targetPath: string;

      if (file) {
        // Reading a specific file within the skill directory
        const skillDir = skillPath.replace(/[/\\]SKILL\.md$/i, '');
        targetPath = join(skillDir, file);
      } else {
        targetPath = skillPath;
      }

      // Normalize and resolve
      targetPath = resolve(normalize(targetPath));

      // Security check: ensure path is within skills directory or is a valid skill path
      const normalizedSkillsDir = resolve(this.skillsDir);
      if (!targetPath.startsWith(normalizedSkillsDir)) {
        // Also allow if it's directly pointing to a valid SKILL.md
        if (!targetPath.includes('skills') || !existsSync(targetPath)) {
          return {
            success: false,
            error: 'Access denied: path must be within skills directory',
          };
        }
      }

      // Check if file exists
      if (!existsSync(targetPath)) {
        return {
          success: false,
          error: `File not found: ${targetPath}`,
        };
      }

      // Read the file
      const content = await readFile(targetPath, 'utf-8');

      console.log(`[ReadSkillTool] Read skill file: ${targetPath} (${content.length} chars)`);

      return {
        success: true,
        output: {
          path: targetPath,
          content,
          size: content.length,
        },
      };
    } catch (error) {
      console.error('[ReadSkillTool] Error:', error);
      return {
        success: false,
        error: `Failed to read skill file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
