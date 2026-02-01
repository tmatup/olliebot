/**
 * User-Defined Tools Type Definitions
 *
 * Types for tools defined by users in .md files that are
 * compiled to .js and executed in a VM sandbox.
 */

import type { z } from 'zod';
import type { NativeTool, NativeToolResult } from '../native/types.js';

/**
 * Parsed tool definition from a .md file
 */
export interface UserToolDefinition {
  /** Tool name derived from filename (e.g., "lottery.md" → "lottery") */
  name: string;
  /** Tool description for LLM */
  description: string;
  /** Input parameters parsed from .md */
  inputs: UserToolParameter[];
  /** Output fields parsed from .md */
  outputs: UserToolParameter[];
  /** Natural language logic description */
  logic: string;
  /** Path to source .md file */
  mdPath: string;
  /** Path to generated .js file */
  jsPath: string;
  /** When .js was last generated */
  generatedAt?: Date;
  /** Generation or validation error */
  error?: string;
}

/**
 * Parameter definition for inputs/outputs
 */
export interface UserToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

/**
 * Shape of generated .js file exports
 */
export interface GeneratedToolExports {
  /** Zod schema for input validation */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  /** Tool implementation function */
  default: (input: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * VM execution context - minimal safe globals
 */
export interface ToolVMContext {
  z: typeof z;
  console: Pick<Console, 'log' | 'warn' | 'error'>;
  exports: Partial<GeneratedToolExports>;
  JSON: typeof JSON;
  Math: typeof Math;
  Date: typeof Date;
  Array: typeof Array;
  Object: typeof Object;
  String: typeof String;
  Number: typeof Number;
  Boolean: typeof Boolean;
}

/**
 * User tool wrapped as NativeTool
 */
export interface UserTool extends NativeTool {
  readonly source: 'user';
  readonly definition: UserToolDefinition;
}

/**
 * Configuration for UserToolManager
 */
export interface UserToolManagerConfig {
  /** Directory containing .md tool definitions and generated .js files */
  toolsDir: string;
  /** LLM service for code generation */
  llmService: LLMServiceInterface;
}

/**
 * Minimal LLM service interface needed for code generation
 */
export interface LLMServiceInterface {
  generate(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options?: { systemPrompt?: string; maxTokens?: number }
  ): Promise<{ content: string }>;
}

/**
 * Events emitted by UserToolManager
 */
export type UserToolEventType =
  | 'tool:added'
  | 'tool:updated'
  | 'tool:removed'
  | 'tool:generation_started'
  | 'tool:generation_completed'
  | 'tool:generation_failed';
