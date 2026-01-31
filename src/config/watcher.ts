import { watch, type FSWatcher } from 'chokidar';
import { readFile, readdir, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { EventEmitter } from 'events';

export interface ConfigFile {
  name: string;
  mdPath: string;
  jsonPath: string;
  mdContent: string;
  jsonContent?: string;
  lastModified: Date;
}

export interface ConfigWatcherEvents {
  'config:changed': (file: ConfigFile) => void;
  'config:added': (file: ConfigFile) => void;
  'config:removed': (filePath: string) => void;
  'config:error': (error: Error, filePath?: string) => void;
}

export class ConfigWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private git: SimpleGit;
  private configDir: string;
  private configs: Map<string, ConfigFile> = new Map();

  constructor(configDir: string) {
    super();
    this.configDir = configDir;

    // Ensure config directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    this.git = simpleGit(configDir);
  }

  async init(): Promise<void> {
    // Initialize git repo if not exists
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init();
      console.log('[ConfigWatcher] Initialized git repository');
    }

    // Load existing configs
    await this.loadExistingConfigs();

    // Start watching
    this.startWatching();
  }

  private async loadExistingConfigs(): Promise<void> {
    try {
      const files = await readdir(this.configDir);
      const mdFiles = files.filter((f) => extname(f) === '.md');

      for (const file of mdFiles) {
        const mdPath = join(this.configDir, file);
        const config = await this.loadConfigFile(mdPath);
        if (config) {
          this.configs.set(config.name, config);
        }
      }

      console.log(`[ConfigWatcher] Loaded ${this.configs.size} config files`);
    } catch (error) {
      console.error('[ConfigWatcher] Error loading configs:', error);
    }
  }

  private async loadConfigFile(mdPath: string): Promise<ConfigFile | null> {
    try {
      const mdContent = await readFile(mdPath, 'utf-8');
      const name = basename(mdPath, '.md');
      const jsonPath = mdPath.replace('.md', '.json');
      const stats = await stat(mdPath);

      let jsonContent: string | undefined;
      try {
        jsonContent = await readFile(jsonPath, 'utf-8');
      } catch {
        // JSON file doesn't exist yet
      }

      return {
        name,
        mdPath,
        jsonPath,
        mdContent,
        jsonContent,
        lastModified: stats.mtime,
      };
    } catch (error) {
      console.error(`[ConfigWatcher] Error loading ${mdPath}:`, error);
      return null;
    }
  }

  private startWatching(): void {
    this.watcher = watch(join(this.configDir, '*.md'), {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', async (filePath) => {
      const config = await this.loadConfigFile(filePath);
      if (config) {
        this.configs.set(config.name, config);
        this.emit('config:added', config);
      }
    });

    this.watcher.on('change', async (filePath) => {
      const config = await this.loadConfigFile(filePath);
      if (config) {
        this.configs.set(config.name, config);
        this.emit('config:changed', config);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      const name = basename(filePath, '.md');
      this.configs.delete(name);
      this.emit('config:removed', filePath);
    });

    this.watcher.on('error', (error) => {
      this.emit('config:error', error);
    });

    console.log(`[ConfigWatcher] Watching ${this.configDir} for changes`);
  }

  /**
   * Update the JSON config for a given task
   */
  async updateJsonConfig(name: string, jsonContent: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Config not found: ${name}`);
    }

    const { writeFile } = await import('fs/promises');
    await writeFile(config.jsonPath, jsonContent, 'utf-8');

    config.jsonContent = jsonContent;
    this.configs.set(name, config);

    // Commit both files
    await this.commitChanges(config);
  }

  /**
   * Commit config changes to git
   */
  private async commitChanges(config: ConfigFile): Promise<void> {
    try {
      const mdHash = this.hashContent(config.mdContent);
      const jsonHash = config.jsonContent
        ? this.hashContent(config.jsonContent)
        : 'none';

      // Stage files
      await this.git.add([config.mdPath]);
      if (config.jsonContent) {
        await this.git.add([config.jsonPath]);
      }

      // Check if there are changes to commit
      const status = await this.git.status();
      if (status.staged.length > 0) {
        const message = `Update config: ${config.name}\n\nMD hash: ${mdHash}\nJSON hash: ${jsonHash}`;
        await this.git.commit(message);
        console.log(`[ConfigWatcher] Committed changes for ${config.name}`);
      }
    } catch (error) {
      console.error(`[ConfigWatcher] Git commit error:`, error);
    }
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 8);
  }

  /**
   * Get config change history from git
   */
  async getConfigHistory(name: string, limit: number = 10): Promise<Array<{
    hash: string;
    date: string;
    message: string;
  }>> {
    const config = this.configs.get(name);
    if (!config) {
      return [];
    }

    try {
      const log = await this.git.log({
        file: config.mdPath,
        maxCount: limit,
      });

      return log.all.map((entry) => ({
        hash: entry.hash,
        date: entry.date,
        message: entry.message,
      }));
    } catch (error) {
      console.error(`[ConfigWatcher] Error getting history:`, error);
      return [];
    }
  }

  /**
   * Get all loaded configs
   */
  getConfigs(): Map<string, ConfigFile> {
    return new Map(this.configs);
  }

  /**
   * Get a specific config by name
   */
  getConfig(name: string): ConfigFile | undefined {
    return this.configs.get(name);
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
