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
    console.log(`[ConfigWatcher] Loading existing configs from: ${this.configDir}`);
    try {
      const files = await readdir(this.configDir);
      console.log(`[ConfigWatcher] Found files in directory:`, files);
      const mdFiles = files.filter((f) => extname(f) === '.md');
      console.log(`[ConfigWatcher] Filtered .md files:`, mdFiles);

      for (const file of mdFiles) {
        const mdPath = join(this.configDir, file);
        console.log(`[ConfigWatcher] Loading config file: ${mdPath}`);
        const config = await this.loadConfigFile(mdPath);
        if (config) {
          console.log(`[ConfigWatcher]   Loaded: ${config.name}, hasJson: ${!!config.jsonContent}`);
          this.configs.set(config.name, config);
        } else {
          console.log(`[ConfigWatcher]   Failed to load: ${file}`);
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
    // Use forward slashes for glob pattern (chokidar requirement)
    const watchPattern = this.configDir.replace(/\\/g, '/') + '/*.md';
    console.log(`[ConfigWatcher] Setting up watcher with pattern: ${watchPattern}`);

    this.watcher = watch(watchPattern, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      // Enable polling on Windows for better reliability
      usePolling: process.platform === 'win32',
      interval: 1000,
    });

    this.watcher.on('ready', () => {
      console.log(`[ConfigWatcher] Watcher is ready. watchPattern: ${watchPattern}`);
    });

    this.watcher.on('add', async (filePath) => {
      console.log(`[ConfigWatcher] File added detected: ${filePath}`);
      const config = await this.loadConfigFile(filePath);
      if (config) {
        this.configs.set(config.name, config);
        console.log(`[ConfigWatcher] Emitting config:added for ${config.name}`);
        this.emit('config:added', config);
      }
    });

    this.watcher.on('change', async (filePath) => {
      console.log(`[ConfigWatcher] File change detected: ${filePath}`);
      const config = await this.loadConfigFile(filePath);
      if (config) {
        this.configs.set(config.name, config);
        console.log(`[ConfigWatcher] Emitting config:changed for ${config.name}`);
        this.emit('config:changed', config);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      console.log(`[ConfigWatcher] File unlink detected: ${filePath}`);
      const name = basename(filePath, '.md');
      this.configs.delete(name);
      console.log(`[ConfigWatcher] Emitting config:removed for ${name}`);
      this.emit('config:removed', filePath);
    });

    this.watcher.on('error', (error) => {
      console.error(`[ConfigWatcher] Watcher error:`, error);
      this.emit('config:error', error);
    });

    this.watcher.on('raw', (event, path, details) => {
      console.log(`[ConfigWatcher] Raw event: ${event} on ${path}`, details);
    });

    console.log(`[ConfigWatcher] Watching ${this.configDir} for changes`);
  }

  /**
   * Update the JSON config for a given task
   */
  async updateJsonConfig(name: string, jsonContent: string): Promise<void> {
    console.log(`[ConfigWatcher] updateJsonConfig called for: ${name}`);
    console.log(`[ConfigWatcher]   Available configs:`, Array.from(this.configs.keys()));

    const config = this.configs.get(name);
    if (!config) {
      console.error(`[ConfigWatcher]   Config not found in map: ${name}`);
      throw new Error(`Config not found: ${name}`);
    }

    console.log(`[ConfigWatcher]   Writing JSON to: ${config.jsonPath}`);
    const { writeFile } = await import('fs/promises');
    await writeFile(config.jsonPath, jsonContent, 'utf-8');
    console.log(`[ConfigWatcher]   JSON file written successfully`);

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
