/**
 * Task Manager - Loads and manages agent tasks from .md files
 *
 * Watches the agent config directory for .md files, parses them,
 * and creates/updates task records in the database.
 */

import { v4 as uuid } from 'uuid';
import { ConfigWatcher, type ConfigFile } from '../config/watcher.js';
import { getDb } from '../db/index.js';
import type { LLMService } from '../llm/service.js';

export interface TaskManagerConfig {
  tasksDir: string;
  llmService: LLMService;
}

export class TaskManager {
  private configWatcher: ConfigWatcher;
  private llmService: LLMService;
  private tasksDir: string;

  constructor(config: TaskManagerConfig) {
    this.tasksDir = config.tasksDir;
    this.llmService = config.llmService;
    this.configWatcher = new ConfigWatcher(config.tasksDir);
  }

  async init(): Promise<void> {
    // Initialize config watcher
    await this.configWatcher.init();

    // Set up event handlers
    this.configWatcher.on('config:added', (config: ConfigFile) => {
      console.log(`[TaskManager] Received config:added event for ${config.name}`);
      this.handleConfigAdded(config);
    });

    this.configWatcher.on('config:changed', (config: ConfigFile) => {
      console.log(`[TaskManager] Received config:changed event for ${config.name}`);
      this.handleConfigChanged(config);
    });

    this.configWatcher.on('config:removed', (filePath: string) => {
      console.log(`[TaskManager] Received config:removed event for ${filePath}`);
      this.handleConfigRemoved(filePath);
    });

    this.configWatcher.on('config:error', (error: Error) => {
      console.error(`[TaskManager] ConfigWatcher error:`, error);
    });

    // Load existing configs into database
    const configs = this.configWatcher.getConfigs();
    for (const [name, config] of configs) {
      await this.syncTaskToDatabase(config);
    }

    console.log(`[TaskManager] Initialized with ${configs.size} tasks from ${this.tasksDir}`);
  }

  private async handleConfigAdded(config: ConfigFile): Promise<void> {
    console.log(`[TaskManager] New task config: ${config.name}`);
    await this.syncTaskToDatabase(config);
  }

  private async handleConfigChanged(config: ConfigFile): Promise<void> {
    console.log(`[TaskManager] Task config updated: ${config.name}`);
    await this.syncTaskToDatabase(config);
  }

  private async handleConfigRemoved(filePath: string): Promise<void> {
    const name = filePath.replace(/^.*[\\/]/, '').replace('.md', '');
    console.log(`[TaskManager] Task config removed: ${name}`);

    try {
      const db = getDb();
      const tasks = db.tasks.findAll({ limit: 100 });
      const task = tasks.find((t) => t.name === name || t.mdFile === filePath);

      if (task) {
        // Update status to paused (soft remove)
        db.tasks.update(task.id, { status: 'paused', updatedAt: new Date().toISOString() });
      }
    } catch (error) {
      console.error(`[TaskManager] Error removing task:`, error);
    }
  }

  private async syncTaskToDatabase(config: ConfigFile): Promise<void> {
    console.log(`[TaskManager] syncTaskToDatabase called for: ${config.name}`);
    console.log(`[TaskManager]   mdPath: ${config.mdPath}`);
    console.log(`[TaskManager]   jsonPath: ${config.jsonPath}`);
    console.log(`[TaskManager]   hasJsonContent: ${!!config.jsonContent}`);

    try {
      const db = getDb();

      // Check if task already exists
      const existingTasks = db.tasks.findAll({ limit: 100 });
      const existingTask = existingTasks.find(
        (t) => t.name === config.name || t.mdFile === config.mdPath
      );
      console.log(`[TaskManager]   existingTask: ${existingTask ? existingTask.id : 'none'}`);

      // Parse the markdown to JSON config
      let jsonConfig: Record<string, unknown> = {};
      try {
        // Try to parse existing JSON config first
        if (config.jsonContent) {
          console.log(`[TaskManager]   Using existing JSON config`);
          jsonConfig = JSON.parse(config.jsonContent);
        } else {
          // Use LLM to parse markdown to JSON
          console.log(`[TaskManager]   No JSON content, calling LLM to parse...`);
          const jsonStr = await this.llmService.parseTaskConfig(config.mdContent);
          console.log(`[TaskManager]   LLM parsing succeeded, saving JSON config...`);
          jsonConfig = JSON.parse(jsonStr);

          // Save the generated JSON config
          await this.configWatcher.updateJsonConfig(config.name, JSON.stringify(jsonConfig, null, 2));
          console.log(`[TaskManager]   JSON config saved successfully`);
        }
      } catch (parseError) {
        console.warn(`[TaskManager] Could not parse config for ${config.name}:`, parseError);
        // Create a basic config from the markdown
        console.log(`[TaskManager]   Creating basic config as fallback...`);
        jsonConfig = this.createBasicConfig(config);

        // Save the basic config so we don't retry LLM parsing on every restart
        try {
          await this.configWatcher.updateJsonConfig(config.name, JSON.stringify(jsonConfig, null, 2));
          console.log(`[TaskManager]   Basic config saved successfully`);
        } catch (saveError) {
          console.warn(`[TaskManager] Could not save basic config for ${config.name}:`, saveError);
        }
      }

      const now = new Date().toISOString();

      if (existingTask) {
        // Update existing task
        db.tasks.update(existingTask.id, {
          name: config.name,
          mdFile: config.mdPath,
          jsonConfig,
          status: 'active',
          updatedAt: now,
        });
        console.log(`[TaskManager] Updated task: ${config.name}`);
      } else {
        // Create new task
        db.tasks.create({
          id: uuid(),
          name: config.name,
          mdFile: config.mdPath,
          jsonConfig,
          status: 'active',
          lastRun: null,
          nextRun: this.calculateNextRun(jsonConfig),
          createdAt: now,
          updatedAt: now,
        });
        console.log(`[TaskManager] Created task: ${config.name}`);
      }
    } catch (error) {
      console.error(`[TaskManager] Error syncing task ${config.name}:`, error);
    }
  }

  /**
   * Create a basic config from markdown content without LLM parsing
   */
  private createBasicConfig(config: ConfigFile): Record<string, unknown> {
    // Extract title from first heading
    const titleMatch = config.mdContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : config.name;

    // Extract description from content after title
    const descMatch = config.mdContent.match(/^#\s+.+\n+(.+?)(?:\n#|$)/s);
    const description = descMatch ? descMatch[1].trim() : '';

    return {
      name: title,
      description,
      trigger: {
        type: 'manual',
      },
      actions: [],
      rawMarkdown: config.mdContent,
    };
  }

  /**
   * Calculate next run time based on config
   */
  private calculateNextRun(config: Record<string, unknown>): string | null {
    const trigger = config.trigger as { type?: string; schedule?: string } | undefined;

    if (!trigger || trigger.type !== 'schedule' || !trigger.schedule) {
      return null;
    }

    // For now, just return null - scheduling implementation would go here
    // A proper implementation would parse the cron expression
    return null;
  }

  /**
   * Get all active tasks
   */
  getTasks(): Array<{
    id: string;
    name: string;
    status: string;
    lastRun: string | null;
    nextRun: string | null;
  }> {
    const db = getDb();
    return db.tasks.findAll({ status: 'active' }).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      lastRun: t.lastRun,
      nextRun: t.nextRun,
    }));
  }

  async close(): Promise<void> {
    await this.configWatcher.close();
  }
}
