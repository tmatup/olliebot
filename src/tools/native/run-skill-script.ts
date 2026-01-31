/**
 * Run Skill Script Tool
 *
 * Executes scripts from within skill directories.
 * Sandboxed to only allow running scripts from the skills directory.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, normalize, resolve, extname, dirname } from 'path';
import type { NativeTool, NativeToolResult } from './types.js';

interface RunSkillScriptParams {
  /** Path to the script file within a skill directory */
  scriptPath: string;
  /** Optional arguments to pass to the script */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Working directory (defaults to script's directory) */
  cwd?: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

export class RunSkillScriptTool implements NativeTool {
  name = 'run_skill_script';
  description = `Execute a script from a skill's scripts/ directory. Only scripts within the skills directory can be run.
Use this when a SKILL.md instructs you to run a script.
The script path should be the full path to the script file.`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      scriptPath: {
        type: 'string',
        description: 'Full path to the script file (e.g., "C:/path/to/skills/pdf/scripts/convert.js")',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the script',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Environment variables to set',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (defaults to script directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
      },
    },
    required: ['scriptPath'],
  };

  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = resolve(skillsDir);
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const {
      scriptPath,
      args = [],
      env = {},
      cwd,
      timeout = 60000,
    } = params as unknown as RunSkillScriptParams;

    if (!scriptPath) {
      return {
        success: false,
        error: 'scriptPath is required',
      };
    }

    try {
      // Resolve and normalize the path
      const resolvedPath = resolve(normalize(scriptPath));

      // Security check: ensure script is within skills directory
      if (!resolvedPath.startsWith(this.skillsDir)) {
        return {
          success: false,
          error: `Security error: Script must be within skills directory (${this.skillsDir})`,
        };
      }

      // Check script exists
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `Script not found: ${resolvedPath}`,
        };
      }

      // Determine how to run the script based on extension
      const ext = extname(resolvedPath).toLowerCase();
      let command: string;
      let scriptArgs: string[];

      switch (ext) {
        case '.js':
        case '.mjs':
        case '.cjs':
          command = 'node';
          scriptArgs = [resolvedPath, ...(args || [])];
          break;
        case '.ts':
          command = 'npx';
          scriptArgs = ['tsx', resolvedPath, ...(args || [])];
          break;
        case '.py':
          command = 'python';
          scriptArgs = [resolvedPath, ...(args || [])];
          break;
        case '.sh':
          command = 'bash';
          scriptArgs = [resolvedPath, ...(args || [])];
          break;
        case '.ps1':
          command = 'powershell';
          scriptArgs = ['-ExecutionPolicy', 'Bypass', '-File', resolvedPath, ...(args || [])];
          break;
        case '.bat':
        case '.cmd':
          command = 'cmd';
          scriptArgs = ['/c', resolvedPath, ...(args || [])];
          break;
        default:
          // Try to run directly (for executables)
          command = resolvedPath;
          scriptArgs = args || [];
      }

      // Execute the script
      const workingDir = cwd ? resolve(cwd) : dirname(resolvedPath);

      console.log(`[RunSkillScript] Running: ${command} ${scriptArgs.join(' ')}`);
      console.log(`[RunSkillScript] CWD: ${workingDir}`);

      const result = await this.runProcess(command, scriptArgs, {
        cwd: workingDir,
        env: { ...process.env, ...env },
        timeout,
      });

      if (result.exitCode === 0) {
        console.log(`[RunSkillScript] ✓ ${scriptPath}`);
      } else {
        console.error(`[RunSkillScript] ✗ ${scriptPath} (exit: ${result.exitCode})`);
        if (result.stderr) {
          console.error(`[RunSkillScript] stderr: ${result.stderr}`);
        }
        if (result.stdout) {
          console.error(`[RunSkillScript] stdout: ${result.stdout}`);
        }
      }

      return {
        success: result.exitCode === 0,
        output: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          scriptPath: resolvedPath,
        },
        error: result.exitCode !== 0
          ? `Script exited with code ${result.exitCode}${result.stderr ? `\n${result.stderr}` : ''}${result.stdout && !result.stderr ? `\n${result.stdout}` : ''}`
          : undefined,
      };
    } catch (error) {
      console.error('[RunSkillScript] Error:', error);
      return {
        success: false,
        error: `Script execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private runProcess(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        reject(new Error(`Script timed out after ${options.timeout}ms`));
      }, options.timeout);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({
            exitCode: code ?? 1,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        }
      });
    });
  }
}
