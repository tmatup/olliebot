/**
 * User Tool Manager
 *
 * Watches user/tools/*.md for tool definitions, generates .js implementations
 * using LLM, and provides tools for registration with ToolRunner.
 */

import { EventEmitter } from 'node:events';
import { join, basename } from 'node:path';
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { watch, type FSWatcher } from 'chokidar';
import type { NativeTool, NativeToolResult } from '../native/types.js';
import type {
  UserToolDefinition,
  UserToolManagerConfig,
  LLMServiceInterface,
  UserTool,
  UserToolEventType,
} from './types.js';
import { CodeGenerator } from './generator.js';
import { ToolExecutor } from './executor.js';

/** Debounce delay for file changes (ms) */
const DEBOUNCE_DELAY_MS = 500;

/**
 * Manages user-defined tools from .md files
 */
export class UserToolManager extends EventEmitter {
  private toolsDir: string;
  private llmService: LLMServiceInterface;
  private watcher: FSWatcher | null = null;
  private tools: Map<string, UserToolDefinition> = new Map();
  private generator: CodeGenerator;
  private executor: ToolExecutor;
  private pendingGenerations: Map<string, NodeJS.Timeout> = new Map();
  private generationInProgress: Set<string> = new Set();

  constructor(config: UserToolManagerConfig) {
    super();
    this.toolsDir = config.toolsDir;
    this.llmService = config.llmService;
    this.generator = new CodeGenerator(config.llmService);
    this.executor = new ToolExecutor();
  }

  /**
   * Initialize the manager: ensure directory exists, load existing tools, start watching
   */
  async init(): Promise<void> {
    // Ensure directory exists
    if (!existsSync(this.toolsDir)) {
      await mkdir(this.toolsDir, { recursive: true });
    }

    // Load existing .md files
    await this.loadExistingTools();

    // Start watching for changes
    this.startWatching();

    console.log(`[UserToolManager] Initialized with ${this.tools.size} tools from ${this.toolsDir}`);
  }

  /**
   * Load all existing .md files in the tools directory
   */
  private async loadExistingTools(): Promise<void> {
    const { glob } = await import('node:fs/promises').then((m) => m).catch(() => ({ glob: null }));

    // Fallback: read directory and filter .md files
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(this.toolsDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    for (const file of mdFiles) {
      const mdPath = join(this.toolsDir, file);
      try {
        await this.loadTool(mdPath);
      } catch (error) {
        console.error(`[UserToolManager] Failed to load ${file}:`, error);
      }
    }
  }

  /**
   * Start watching the tools directory for changes
   */
  private startWatching(): void {
    // Watch both .md and .js files
    const watchPatterns = [
      join(this.toolsDir, '*.md'),
      join(this.toolsDir, '*.js'),
    ];

    this.watcher = watch(watchPatterns, {
      persistent: true,
      ignoreInitial: true, // Don't fire for existing files (we loaded them already)
      awaitWriteFinish: {
        stabilityThreshold: DEBOUNCE_DELAY_MS,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (path) => {
      if (path.endsWith('.md')) {
        this.handleFileEvent('add', path);
      }
      // Ignore .js additions (we create them)
    });

    this.watcher.on('change', (path) => {
      if (path.endsWith('.md')) {
        this.handleFileEvent('change', path);
      }
      // Ignore .js changes (we create them)
    });

    this.watcher.on('unlink', (path) => {
      if (path.endsWith('.md')) {
        this.handleFileRemoved(path);
      } else if (path.endsWith('.js')) {
        this.handleJsFileDeleted(path);
      }
    });

    this.watcher.on('error', (error) => {
      console.error('[UserToolManager] Watcher error:', error);
    });
  }

  /**
   * Handle .js file deletion - regenerate from .md if it exists
   */
  private async handleJsFileDeleted(jsPath: string): Promise<void> {
    const name = basename(jsPath, '.js');
    const mdPath = join(this.toolsDir, `${name}.md`);

    console.log(`[UserToolManager] Generated .js file deleted: ${name}`);

    // Check if the .md file still exists
    if (!existsSync(mdPath)) {
      console.log(`[UserToolManager] No .md file found for ${name}, skipping regeneration`);
      return;
    }

    console.log(`[UserToolManager] Regenerating ${name}.js from ${name}.md...`);

    try {
      // Force regeneration since .js was deleted
      const definition = await this.loadTool(mdPath, true);
      console.log(`[UserToolManager] Successfully regenerated tool: ${name}`);
      this.emitEvent('tool:updated', definition);
    } catch (error) {
      console.error(`[UserToolManager] Failed to regenerate tool ${name}:`, error);
      this.emitEvent('tool:generation_failed', { name, error: String(error) });
    }
  }

  /**
   * Handle file add/change events with debouncing
   */
  private handleFileEvent(event: 'add' | 'change', mdPath: string): void {
    const name = this.getToolName(mdPath);
    console.log(`[UserToolManager] File ${event} detected: ${name} (${mdPath})`);

    // Cancel any pending generation for this tool
    const pending = this.pendingGenerations.get(name);
    if (pending) {
      clearTimeout(pending);
      console.log(`[UserToolManager] Cancelled pending generation for: ${name}`);
    }

    // Debounce: wait for file to stabilize before generating
    const timeout = setTimeout(() => {
      this.pendingGenerations.delete(name);

      // Handle async in a way that catches errors
      (async () => {
        if (event === 'add') {
          await this.handleFileAdded(mdPath);
        } else {
          await this.handleFileChanged(mdPath);
        }
      })().catch((error) => {
        console.error(`[UserToolManager] Error handling ${event} for ${name}:`, error);
      });
    }, DEBOUNCE_DELAY_MS);

    this.pendingGenerations.set(name, timeout);
  }

  /**
   * Handle new .md file added
   */
  private async handleFileAdded(mdPath: string): Promise<void> {
    const name = this.getToolName(mdPath);
    console.log(`[UserToolManager] New tool detected: ${name}`);

    try {
      const definition = await this.loadTool(mdPath);
      this.emitEvent('tool:added', definition);
    } catch (error) {
      console.error(`[UserToolManager] Failed to add tool ${name}:`, error);
      this.emitEvent('tool:generation_failed', { name, error: String(error) });
    }
  }

  /**
   * Handle .md file changed
   */
  private async handleFileChanged(mdPath: string): Promise<void> {
    const name = this.getToolName(mdPath);
    const jsPath = this.getJsPath(name);
    console.log(`[UserToolManager] Tool changed: ${name}`);
    console.log(`[UserToolManager] Re-generating ${jsPath} from ${mdPath}...`);

    try {
      // Force regeneration since the .md file changed
      const definition = await this.loadTool(mdPath, true);
      console.log(`[UserToolManager] Successfully re-generated tool: ${name}`);
      this.emitEvent('tool:updated', definition);
    } catch (error) {
      console.error(`[UserToolManager] Failed to re-generate tool ${name}:`, error);
      this.emitEvent('tool:generation_failed', { name, error: String(error) });
    }
  }

  /**
   * Handle .md file removed
   */
  private async handleFileRemoved(mdPath: string): Promise<void> {
    const name = this.getToolName(mdPath);
    console.log(`[UserToolManager] Tool removed: ${name}`);

    // Remove from cache
    this.tools.delete(name);

    // Try to remove generated .js file
    const jsPath = this.getJsPath(name);
    if (existsSync(jsPath)) {
      try {
        await unlink(jsPath);
      } catch {
        // Ignore errors removing generated file
      }
    }

    this.emitEvent('tool:removed', name);
  }

  /**
   * Check if tool needs regeneration
   * Returns true if:
   * - .js file doesn't exist
   * - .md file is newer than .js file
   */
  private async needsRegeneration(mdPath: string, jsPath: string): Promise<boolean> {
    // If .js doesn't exist, need to generate
    if (!existsSync(jsPath)) {
      return true;
    }

    try {
      const [mdStat, jsStat] = await Promise.all([
        stat(mdPath),
        stat(jsPath),
      ]);

      // If .md is newer than .js, need to regenerate
      return mdStat.mtime > jsStat.mtime;
    } catch {
      // If we can't stat files, regenerate to be safe
      return true;
    }
  }

  /**
   * Load a tool from its .md file
   * @param mdPath Path to the .md file
   * @param forceRegenerate If true, regenerate even if .js is up to date
   */
  private async loadTool(mdPath: string, forceRegenerate: boolean = false): Promise<UserToolDefinition> {
    const name = this.getToolName(mdPath);
    const jsPath = this.getJsPath(name);

    // Check if we need to regenerate
    const needsRegen = forceRegenerate || await this.needsRegeneration(mdPath, jsPath);

    if (!needsRegen) {
      // .js is up to date, just load the existing definition
      console.log(`[UserToolManager] Tool ${name} is up to date, skipping generation`);

      // Parse the .md to get definition (but don't regenerate code)
      const mdContent = await readFile(mdPath, 'utf-8');
      const definition = this.generator.parseDefinition(mdContent, name, mdPath, jsPath);

      const jsStat = await stat(jsPath);
      definition.generatedAt = jsStat.mtime;
      this.tools.set(name, definition);

      return definition;
    }

    // Prevent concurrent generation for the same tool
    if (this.generationInProgress.has(name)) {
      console.log(`[UserToolManager] Generation already in progress for: ${name}, skipping`);
      const existing = this.tools.get(name);
      if (existing) return existing;
      throw new Error(`Generation already in progress for ${name}`);
    }

    this.generationInProgress.add(name);
    this.emitEvent('tool:generation_started', name);
    console.log(`[UserToolManager] Starting code generation for: ${name}`);

    try {
      // Read and parse the .md file
      console.log(`[UserToolManager] Reading ${mdPath}...`);
      const mdContent = await readFile(mdPath, 'utf-8');
      const definition = this.generator.parseDefinition(mdContent, name, mdPath, jsPath);
      console.log(`[UserToolManager] Parsed definition for: ${name} (${definition.inputs.length} inputs)`);

      // Generate the .js file using LLM
      console.log(`[UserToolManager] Generating JavaScript code for: ${name}...`);
      const code = await this.generator.generateCode(definition);
      console.log(`[UserToolManager] Writing generated code to: ${jsPath}`);
      await writeFile(jsPath, code, 'utf-8');

      definition.generatedAt = new Date();
      this.tools.set(name, definition);

      console.log(`[UserToolManager] ✓ Successfully generated ${jsPath}`);
      this.emitEvent('tool:generation_completed', definition);

      return definition;
    } finally {
      this.generationInProgress.delete(name);
    }
  }

  /**
   * Get tool name from .md file path
   */
  private getToolName(mdPath: string): string {
    return basename(mdPath, '.md');
  }

  /**
   * Get .js file path for a tool name (same directory as .md file)
   */
  private getJsPath(name: string): string {
    return join(this.toolsDir, `${name}.js`);
  }

  /**
   * Emit a typed event
   */
  private emitEvent(event: UserToolEventType, data: unknown): void {
    this.emit(event, data);
  }

  /**
   * Get all tools formatted for ToolRunner registration
   */
  getToolsForRegistration(): NativeTool[] {
    const tools: NativeTool[] = [];

    for (const definition of this.tools.values()) {
      if (definition.error) continue; // Skip tools with errors

      const tool = this.createNativeTool(definition);
      if (tool) tools.push(tool);
    }

    return tools;
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): UserTool | undefined {
    const definition = this.tools.get(name);
    if (!definition || definition.error) return undefined;

    return this.createNativeTool(definition) as UserTool;
  }

  /**
   * Get all tool definitions
   */
  getAllDefinitions(): UserToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Create a NativeTool wrapper for a user tool definition
   */
  private createNativeTool(definition: UserToolDefinition): NativeTool | null {
    const executor = this.executor;
    const jsPath = definition.jsPath;

    // Build JSON schema from definition
    const inputSchema = this.buildInputSchema(definition);

    return {
      name: definition.name,
      description: definition.description,
      inputSchema,

      async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
        return executor.execute(jsPath, params);
      },
    };
  }

  /**
   * Build JSON Schema for tool inputs
   */
  private buildInputSchema(definition: UserToolDefinition): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const input of definition.inputs) {
      properties[input.name] = {
        type: this.mapTypeToJsonSchema(input.type),
        description: input.description,
      };

      if (input.required) {
        required.push(input.name);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * Map user-specified type to JSON Schema type
   */
  private mapTypeToJsonSchema(type: string): string {
    const typeMap: Record<string, string> = {
      string: 'string',
      number: 'number',
      int: 'integer',
      integer: 'integer',
      boolean: 'boolean',
      bool: 'boolean',
      array: 'array',
      object: 'object',
    };

    return typeMap[type.toLowerCase()] || 'string';
  }

  /**
   * Reload a specific tool
   */
  async reloadTool(name: string): Promise<void> {
    const definition = this.tools.get(name);
    if (!definition) {
      throw new Error(`Tool not found: ${name}`);
    }

    await this.loadTool(definition.mdPath);
  }

  /**
   * Close the manager and stop watching
   */
  async close(): Promise<void> {
    // Clear pending generations
    for (const timeout of this.pendingGenerations.values()) {
      clearTimeout(timeout);
    }
    this.pendingGenerations.clear();

    // Stop watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    console.log('[UserToolManager] Closed');
  }
}
