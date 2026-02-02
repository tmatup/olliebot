/**
 * Type-safe Database Layer with AlaSQL + JSON Persistence
 *
 * Provides SQL query capabilities with human-readable JSON storage.
 * Data is persisted to a JSON file that can be viewed offline.
 */

import alasql from 'alasql';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  manuallyNamed?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  channel: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Task {
  id: string;
  name: string;
  mdFile: string;
  jsonConfig: Record<string, unknown>;
  status: 'active' | 'paused' | 'error';
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Embedding {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MessageRevision {
  id: string;
  messageId: string;
  revisionNumber: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MessageReply {
  id: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface DatabaseData {
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  embeddings: Embedding[];
  messageRevisions: MessageRevision[];
  messageReplies: MessageReply[];
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface ConversationRepository {
  findById(id: string): Conversation | undefined;
  findAll(options?: { limit?: number; includeDeleted?: boolean }): Conversation[];
  findRecent(channel: string, withinMs: number): Conversation | undefined;
  create(conversation: Conversation): void;
  update(id: string, updates: Partial<Omit<Conversation, 'id'>>): void;
  softDelete(id: string): void;
}

export interface MessageRepository {
  findById(id: string): Message | undefined;
  findByConversationId(conversationId: string, options?: { limit?: number }): Message[];
  create(message: Message): void;
  update(id: string, updates: { content?: string; metadata?: Record<string, unknown> }): void;
}

export interface MessageRevisionRepository {
  findByMessageId(messageId: string): MessageRevision[];
  findByRevisionNumber(messageId: string, revisionNumber: number): MessageRevision | undefined;
  getLatestRevisionNumber(messageId: string): number;
  create(revision: MessageRevision): void;
}

export interface MessageReplyRepository {
  findByMessageId(messageId: string): MessageReply[];
  create(reply: MessageReply): void;
  delete(id: string): void;
}

export interface TaskRepository {
  findById(id: string): Task | undefined;
  findAll(options?: { limit?: number; status?: Task['status'] }): Task[];
  create(task: Task): void;
  update(id: string, updates: Partial<Omit<Task, 'id'>>): void;
}

export interface EmbeddingRepository {
  findBySource(source: string): Embedding[];
  findAll(): Embedding[];
  create(embedding: Embedding): void;
  deleteBySource(source: string): void;
}

// ============================================================================
// Database Implementation
// ============================================================================

class Database {
  private dbPath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isDirty = false;
  private initialized = false;

  conversations: ConversationRepository;
  messages: MessageRepository;
  tasks: TaskRepository;
  embeddings: EmbeddingRepository;
  messageRevisions: MessageRevisionRepository;
  messageReplies: MessageReplyRepository;

  constructor(dbPath: string) {
    this.dbPath = dbPath.endsWith('.json') ? dbPath : dbPath.replace(/\.[^.]+$/, '') + '.json';

    // Initialize repositories
    this.conversations = this.createConversationRepository();
    this.messages = this.createMessageRepository();
    this.tasks = this.createTaskRepository();
    this.embeddings = this.createEmbeddingRepository();
    this.messageRevisions = this.createMessageRevisionRepository();
    this.messageReplies = this.createMessageReplyRepository();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Create tables in AlaSQL
    alasql(`
      CREATE TABLE IF NOT EXISTS conversations (
        id STRING PRIMARY KEY,
        title STRING,
        channel STRING,
        createdAt STRING,
        updatedAt STRING,
        deletedAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS messages (
        id STRING PRIMARY KEY,
        conversationId STRING,
        channel STRING,
        role STRING,
        content STRING,
        metadata STRING,
        createdAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS tasks (
        id STRING PRIMARY KEY,
        name STRING,
        mdFile STRING,
        jsonConfig STRING,
        status STRING,
        lastRun STRING,
        nextRun STRING,
        createdAt STRING,
        updatedAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id STRING PRIMARY KEY,
        source STRING,
        chunkIndex INT,
        content STRING,
        embedding STRING,
        metadata STRING,
        createdAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS message_revisions (
        id STRING PRIMARY KEY,
        messageId STRING,
        revisionNumber INT,
        content STRING,
        metadata STRING,
        createdAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS message_replies (
        id STRING PRIMARY KEY,
        messageId STRING,
        role STRING,
        content STRING,
        metadata STRING,
        createdAt STRING
      )
    `);

    // Load existing data from JSON file
    this.loadFromFile();
    this.initialized = true;
  }

  private loadFromFile(): void {
    try {
      if (existsSync(this.dbPath)) {
        const content = readFileSync(this.dbPath, 'utf-8');
        const data: DatabaseData = JSON.parse(content);

        // Clear existing data
        alasql('DELETE FROM conversations');
        alasql('DELETE FROM messages');
        alasql('DELETE FROM tasks');
        alasql('DELETE FROM embeddings');
        alasql('DELETE FROM message_revisions');
        alasql('DELETE FROM message_replies');

        // Insert loaded data (serialize complex fields for AlaSQL storage)
        if (data.conversations?.length) {
          alasql('INSERT INTO conversations SELECT * FROM ?', [data.conversations]);
        }
        if (data.messages?.length) {
          const messages = data.messages.map(m => ({
            ...m,
            metadata: typeof m.metadata === 'object' ? JSON.stringify(m.metadata) : m.metadata,
          }));
          alasql('INSERT INTO messages SELECT * FROM ?', [messages]);
        }
        if (data.tasks?.length) {
          const tasks = data.tasks.map(t => ({
            ...t,
            jsonConfig: typeof t.jsonConfig === 'object' ? JSON.stringify(t.jsonConfig) : t.jsonConfig,
          }));
          alasql('INSERT INTO tasks SELECT * FROM ?', [tasks]);
        }
        if (data.embeddings?.length) {
          const embeddings = data.embeddings.map(e => ({
            ...e,
            embedding: typeof e.embedding === 'object' ? JSON.stringify(e.embedding) : e.embedding,
            metadata: typeof e.metadata === 'object' ? JSON.stringify(e.metadata) : e.metadata,
          }));
          alasql('INSERT INTO embeddings SELECT * FROM ?', [embeddings]);
        }
        if (data.messageRevisions?.length) {
          const revisions = data.messageRevisions.map(r => ({
            ...r,
            metadata: typeof r.metadata === 'object' ? JSON.stringify(r.metadata) : r.metadata,
          }));
          alasql('INSERT INTO message_revisions SELECT * FROM ?', [revisions]);
        }
        if (data.messageReplies?.length) {
          const replies = data.messageReplies.map(r => ({
            ...r,
            metadata: typeof r.metadata === 'object' ? JSON.stringify(r.metadata) : r.metadata,
          }));
          alasql('INSERT INTO message_replies SELECT * FROM ?', [replies]);
        }

        console.log(`[Database] Loaded from ${this.dbPath}`);
      }
    } catch (error) {
      console.error('[Database] Failed to load from file:', error);
    }
  }

  private saveToFile(): void {
    try {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Get raw data from AlaSQL
      const rawConversations = alasql('SELECT * FROM conversations ORDER BY updatedAt DESC') as Conversation[];
      const rawMessages = alasql('SELECT * FROM messages ORDER BY createdAt ASC') as Array<Record<string, unknown>>;
      const rawTasks = alasql('SELECT * FROM tasks ORDER BY updatedAt DESC') as Array<Record<string, unknown>>;
      const rawEmbeddings = alasql('SELECT * FROM embeddings ORDER BY source, chunkIndex') as Array<Record<string, unknown>>;
      const rawRevisions = alasql('SELECT * FROM message_revisions ORDER BY messageId, revisionNumber ASC') as Array<Record<string, unknown>>;
      const rawReplies = alasql('SELECT * FROM message_replies ORDER BY messageId, createdAt ASC') as Array<Record<string, unknown>>;

      // Deserialize JSON strings for human-readable output
      const data: DatabaseData = {
        conversations: rawConversations,
        messages: rawMessages.map(m => ({
          ...m,
          metadata: typeof m.metadata === 'string' ? JSON.parse(m.metadata as string) : m.metadata,
        })) as Message[],
        tasks: rawTasks.map(t => ({
          ...t,
          jsonConfig: typeof t.jsonConfig === 'string' ? JSON.parse(t.jsonConfig as string) : t.jsonConfig,
        })) as Task[],
        embeddings: rawEmbeddings.map(e => ({
          ...e,
          embedding: typeof e.embedding === 'string' ? JSON.parse(e.embedding as string) : e.embedding,
          metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata as string) : e.metadata,
        })) as Embedding[],
        messageRevisions: rawRevisions.map(r => ({
          ...r,
          metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata as string) : r.metadata,
        })) as MessageRevision[],
        messageReplies: rawReplies.map(r => ({
          ...r,
          metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata as string) : r.metadata,
        })) as MessageReply[],
      };

      writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
      this.isDirty = false;
    } catch (error) {
      console.error('[Database] Failed to save to file:', error);
    }
  }

  private scheduleSave(): void {
    this.isDirty = true;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    // Debounce saves for performance
    this.saveTimeout = setTimeout(() => {
      this.saveToFile();
      this.saveTimeout = null;
    }, 100);
  }

  flush(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.isDirty) {
      this.saveToFile();
    }
  }

  close(): void {
    this.flush();
  }

  // ============================================================================
  // Repository Factories
  // ============================================================================

  private createConversationRepository(): ConversationRepository {
    return {
      findById: (id: string): Conversation | undefined => {
        const results = alasql('SELECT * FROM conversations WHERE id = ?', [id]) as Conversation[];
        return results[0];
      },

      findAll: (options?: { limit?: number; includeDeleted?: boolean }): Conversation[] => {
        const limit = options?.limit ?? 50;
        const includeDeleted = options?.includeDeleted ?? false;
        if (includeDeleted) {
          return alasql(`SELECT * FROM conversations ORDER BY updatedAt DESC LIMIT ${limit}`) as Conversation[];
        }
        return alasql(`SELECT * FROM conversations WHERE deletedAt IS NULL ORDER BY updatedAt DESC LIMIT ${limit}`) as Conversation[];
      },

      findRecent: (channel: string, withinMs: number): Conversation | undefined => {
        const cutoff = new Date(Date.now() - withinMs).toISOString();
        const results = alasql(
          'SELECT * FROM conversations WHERE channel = ? AND updatedAt > ? AND deletedAt IS NULL ORDER BY updatedAt DESC LIMIT 1',
          [channel, cutoff]
        ) as Conversation[];
        return results[0];
      },

      create: (conversation: Conversation): void => {
        alasql('INSERT INTO conversations VALUES ?', [conversation]);
        this.scheduleSave();
      },

      update: (id: string, updates: Partial<Omit<Conversation, 'id'>>): void => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }

        if (setClauses.length > 0) {
          values.push(id);
          alasql(`UPDATE conversations SET ${setClauses.join(', ')} WHERE id = ?`, values);
          this.scheduleSave();
        }
      },

      softDelete: (id: string): void => {
        const now = new Date().toISOString();
        alasql('UPDATE conversations SET deletedAt = ? WHERE id = ?', [now, id]);
        this.scheduleSave();
      },
    };
  }

  private createMessageRepository(): MessageRepository {
    return {
      findById: (id: string): Message | undefined => {
        const rows = alasql('SELECT * FROM messages WHERE id = ?', [id]) as Array<Record<string, unknown>>;
        if (rows.length === 0) return undefined;
        const row = rows[0];
        return {
          ...row,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata,
        } as Message;
      },

      findByConversationId: (conversationId: string, options?: { limit?: number }): Message[] => {
        const limit = options?.limit ?? 100;
        const rows = alasql(
          `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC LIMIT ${limit}`,
          [conversationId]
        ) as Array<Record<string, unknown>>;
        return rows.map(row => ({
          ...row,
          metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata,
        })) as Message[];
      },

      create: (message: Message): void => {
        const row = {
          ...message,
          metadata: JSON.stringify(message.metadata || {}),
        };
        alasql('INSERT INTO messages VALUES ?', [row]);
        this.scheduleSave();
      },

      update: (id: string, updates: { content?: string; metadata?: Record<string, unknown> }): void => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        if (updates.content !== undefined) {
          setClauses.push('content = ?');
          values.push(updates.content);
        }
        if (updates.metadata !== undefined) {
          setClauses.push('metadata = ?');
          values.push(JSON.stringify(updates.metadata));
        }

        if (setClauses.length > 0) {
          values.push(id);
          alasql(`UPDATE messages SET ${setClauses.join(', ')} WHERE id = ?`, values);
          this.scheduleSave();
        }
      },
    };
  }

  private createMessageRevisionRepository(): MessageRevisionRepository {
    const deserializeRevision = (row: Record<string, unknown>): MessageRevision => ({
      id: row.id as string,
      messageId: row.messageId as string,
      revisionNumber: row.revisionNumber as number,
      content: row.content as string,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata as Record<string, unknown>,
      createdAt: row.createdAt as string,
    });

    return {
      findByMessageId: (messageId: string): MessageRevision[] => {
        const rows = alasql(
          'SELECT * FROM message_revisions WHERE messageId = ? ORDER BY revisionNumber ASC',
          [messageId]
        ) as Array<Record<string, unknown>>;
        return rows.map(deserializeRevision);
      },

      findByRevisionNumber: (messageId: string, revisionNumber: number): MessageRevision | undefined => {
        const rows = alasql(
          'SELECT * FROM message_revisions WHERE messageId = ? AND revisionNumber = ?',
          [messageId, revisionNumber]
        ) as Array<Record<string, unknown>>;
        return rows[0] ? deserializeRevision(rows[0]) : undefined;
      },

      getLatestRevisionNumber: (messageId: string): number => {
        const rows = alasql(
          'SELECT MAX(revisionNumber) as maxRev FROM message_revisions WHERE messageId = ?',
          [messageId]
        ) as Array<{ maxRev: number | null }>;
        return rows[0]?.maxRev ?? 0;
      },

      create: (revision: MessageRevision): void => {
        const row = {
          ...revision,
          metadata: JSON.stringify(revision.metadata || {}),
        };
        alasql('INSERT INTO message_revisions VALUES ?', [row]);
        this.scheduleSave();
      },
    };
  }

  private createMessageReplyRepository(): MessageReplyRepository {
    const deserializeReply = (row: Record<string, unknown>): MessageReply => ({
      id: row.id as string,
      messageId: row.messageId as string,
      role: row.role as 'user' | 'assistant',
      content: row.content as string,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata as Record<string, unknown>,
      createdAt: row.createdAt as string,
    });

    return {
      findByMessageId: (messageId: string): MessageReply[] => {
        const rows = alasql(
          'SELECT * FROM message_replies WHERE messageId = ? ORDER BY createdAt ASC',
          [messageId]
        ) as Array<Record<string, unknown>>;
        return rows.map(deserializeReply);
      },

      create: (reply: MessageReply): void => {
        const row = {
          ...reply,
          metadata: JSON.stringify(reply.metadata || {}),
        };
        alasql('INSERT INTO message_replies VALUES ?', [row]);
        this.scheduleSave();
      },

      delete: (id: string): void => {
        alasql('DELETE FROM message_replies WHERE id = ?', [id]);
        this.scheduleSave();
      },
    };
  }

  private createTaskRepository(): TaskRepository {
    const deserializeTask = (row: Record<string, unknown>): Task => ({
      id: row.id as string,
      name: row.name as string,
      mdFile: row.mdFile as string,
      jsonConfig: typeof row.jsonConfig === 'string' ? JSON.parse(row.jsonConfig as string) : row.jsonConfig as Record<string, unknown>,
      status: row.status as Task['status'],
      lastRun: row.lastRun as string | null,
      nextRun: row.nextRun as string | null,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    });

    return {
      findById: (id: string): Task | undefined => {
        const results = alasql('SELECT * FROM tasks WHERE id = ?', [id]) as Array<Record<string, unknown>>;
        return results[0] ? deserializeTask(results[0]) : undefined;
      },

      findAll: (options?: { limit?: number; status?: Task['status'] }): Task[] => {
        const limit = options?.limit ?? 20;
        let rows: Array<Record<string, unknown>>;
        if (options?.status) {
          rows = alasql(
            `SELECT * FROM tasks WHERE status = ? ORDER BY updatedAt DESC LIMIT ${limit}`,
            [options.status]
          ) as Array<Record<string, unknown>>;
        } else {
          rows = alasql(`SELECT * FROM tasks ORDER BY updatedAt DESC LIMIT ${limit}`) as Array<Record<string, unknown>>;
        }
        return rows.map(deserializeTask);
      },

      create: (task: Task): void => {
        const row = {
          ...task,
          jsonConfig: JSON.stringify(task.jsonConfig || {}),
        };
        alasql('INSERT INTO tasks VALUES ?', [row]);
        this.scheduleSave();
      },

      update: (id: string, updates: Partial<Omit<Task, 'id'>>): void => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = ?`);
          // Serialize jsonConfig if present
          if (key === 'jsonConfig' && typeof value === 'object') {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }

        if (setClauses.length > 0) {
          values.push(id);
          alasql(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values);
          this.scheduleSave();
        }
      },
    };
  }

  private createEmbeddingRepository(): EmbeddingRepository {
    const deserializeEmbedding = (row: Record<string, unknown>): Embedding => ({
      id: row.id as string,
      source: row.source as string,
      chunkIndex: row.chunkIndex as number,
      content: row.content as string,
      embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding as string) : row.embedding as number[],
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata as Record<string, unknown>,
      createdAt: row.createdAt as string,
    });

    return {
      findBySource: (source: string): Embedding[] => {
        const rows = alasql(
          'SELECT * FROM embeddings WHERE source = ? ORDER BY chunkIndex ASC',
          [source]
        ) as Array<Record<string, unknown>>;
        return rows.map(deserializeEmbedding);
      },

      findAll: (): Embedding[] => {
        const rows = alasql('SELECT * FROM embeddings') as Array<Record<string, unknown>>;
        return rows.map(deserializeEmbedding);
      },

      create: (embedding: Embedding): void => {
        const row = {
          ...embedding,
          embedding: JSON.stringify(embedding.embedding),
          metadata: JSON.stringify(embedding.metadata || {}),
        };
        alasql('INSERT INTO embeddings VALUES ?', [row]);
        this.scheduleSave();
      },

      deleteBySource: (source: string): void => {
        alasql('DELETE FROM embeddings WHERE source = ?', [source]);
        this.scheduleSave();
      },
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let db: Database | null = null;

export async function initDb(dbPath: string): Promise<Database> {
  if (!db) {
    db = new Database(dbPath);
    await db.init();
    console.log(`[Database] Initialized with JSON persistence at ${dbPath.replace(/\.[^.]+$/, '')}.json`);
  }
  return db;
}

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
