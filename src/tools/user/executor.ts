/**
 * VM-based Tool Executor
 *
 * Executes user-defined tools in a sandboxed VM context
 * with limited globals and timeout protection.
 */

import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { NativeToolResult } from '../native/types.js';
import type { ToolVMContext, GeneratedToolExports } from './types.js';

/** Default execution timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Executes user-defined tools in a sandboxed VM environment
 */
export class ToolExecutor {
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Execute a user tool from its generated .js file
   */
  async execute(
    jsPath: string,
    input: Record<string, unknown>
  ): Promise<NativeToolResult> {
    const startTime = Date.now();

    try {
      // Read the generated code
      const code = await readFile(jsPath, 'utf-8');

      // Create sandboxed context
      const context = this.createContext();

      // Run code in VM to get exports
      this.runInVM(code, context);

      const exports = context.exports as GeneratedToolExports;

      // Validate that required exports exist
      if (!exports.inputSchema || !exports.default) {
        return {
          success: false,
          error: 'Tool missing required exports (inputSchema or default)',
        };
      }

      // Validate input against schema
      let validatedInput: Record<string, unknown>;
      try {
        validatedInput = exports.inputSchema.parse(input);
      } catch (e) {
        if (e instanceof z.ZodError) {
          const issues = e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          return {
            success: false,
            error: `Input validation failed: ${issues}`,
          };
        }
        throw e;
      }

      // Execute the tool function
      const result = await Promise.resolve(exports.default(validatedInput));

      return {
        success: true,
        output: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Tool execution failed: ${message}`,
      };
    }
  }

  /**
   * Create a sandboxed VM context with minimal safe globals
   */
  private createContext(): vm.Context {
    // Create a sandboxed console that only allows safe methods
    const sandboxedConsole = {
      log: (...args: unknown[]) => console.log('[UserTool]', ...args),
      warn: (...args: unknown[]) => console.warn('[UserTool]', ...args),
      error: (...args: unknown[]) => console.error('[UserTool]', ...args),
    };

    const contextObj: ToolVMContext = {
      z,
      console: sandboxedConsole,
      exports: {},
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
    };

    return vm.createContext(contextObj);
  }

  /**
   * Run code in the VM context
   */
  private runInVM(code: string, context: vm.Context): void {
    const script = new vm.Script(code, {
      filename: 'user-tool.js',
    });

    script.runInContext(context, {
      timeout: this.timeoutMs,
      displayErrors: true,
    });
  }

  /**
   * Execute code directly (for testing without file)
   */
  async executeCode(
    code: string,
    input: Record<string, unknown>
  ): Promise<NativeToolResult> {
    try {
      const context = this.createContext();
      this.runInVM(code, context);

      const exports = context.exports as GeneratedToolExports;

      if (!exports.inputSchema || !exports.default) {
        return {
          success: false,
          error: 'Tool missing required exports (inputSchema or default)',
        };
      }

      let validatedInput: Record<string, unknown>;
      try {
        validatedInput = exports.inputSchema.parse(input);
      } catch (e) {
        if (e instanceof z.ZodError) {
          const issues = e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          return {
            success: false,
            error: `Input validation failed: ${issues}`,
          };
        }
        throw e;
      }

      const result = await Promise.resolve(exports.default(validatedInput));

      return {
        success: true,
        output: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Tool execution failed: ${message}`,
      };
    }
  }
}
