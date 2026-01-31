/**
 * Memory Service
 *
 * Manages two memory files:
 * - user/memory.md: User-managed notes and preferences
 * - user/memory.json: Agent-managed long-term memory (compact format)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { AgentMemory, MemoryEntry, MemoryContext } from './types.js';

export class MemoryService {
  private userMemoryPath: string;
  private agentMemoryPath: string;
  private agentMemory: AgentMemory | null = null;

  constructor(basePath: string) {
    this.userMemoryPath = join(basePath, 'user', 'memory.md');
    this.agentMemoryPath = join(basePath, 'user', 'memory.json');
  }

  /**
   * Initialize the memory service
   */
  async init(): Promise<void> {
    // Ensure user directory exists
    const userDir = dirname(this.userMemoryPath);
    if (!existsSync(userDir)) {
      mkdirSync(userDir, { recursive: true });
    }

    // Create default user memory file if it doesn't exist
    if (!existsSync(this.userMemoryPath)) {
      writeFileSync(this.userMemoryPath, `# User Memory

This file is for your personal notes and preferences that OllieBot should remember.
Edit this file directly to add information you want the agent to know about you.

## Examples
- Your name and preferred communication style
- Project-specific context
- Frequently used tools or workflows
- Important dates or deadlines

---

<!-- Add your notes below -->

`, 'utf-8');
      console.log(`[Memory] Created user memory file: ${this.userMemoryPath}`);
    }

    // Create default agent memory file if it doesn't exist
    if (!existsSync(this.agentMemoryPath)) {
      const defaultMemory: AgentMemory = { v: 1, e: [] };
      writeFileSync(this.agentMemoryPath, JSON.stringify(defaultMemory), 'utf-8');
      console.log(`[Memory] Created agent memory file: ${this.agentMemoryPath}`);
    }

    // Load agent memory
    this.loadAgentMemory();
    console.log(`[Memory] Initialized with ${this.agentMemory?.e.length || 0} agent memories`);
  }

  /**
   * Load agent memory from file
   */
  private loadAgentMemory(): void {
    try {
      const content = readFileSync(this.agentMemoryPath, 'utf-8');
      this.agentMemory = JSON.parse(content);
    } catch (error) {
      console.error('[Memory] Failed to load agent memory:', error);
      this.agentMemory = { v: 1, e: [] };
    }
  }

  /**
   * Get user memory content (markdown)
   */
  getUserMemory(): string | null {
    try {
      if (!existsSync(this.userMemoryPath)) {
        return null;
      }
      const content = readFileSync(this.userMemoryPath, 'utf-8');
      // Remove template comments and empty sections
      const trimmed = content.trim();
      if (trimmed.length < 50) {
        return null; // Too short, likely just template
      }
      return trimmed;
    } catch (error) {
      console.error('[Memory] Failed to read user memory:', error);
      return null;
    }
  }

  /**
   * Get agent memory
   */
  getAgentMemory(): AgentMemory | null {
    return this.agentMemory;
  }

  /**
   * Get full memory context for system prompt
   */
  getMemoryContext(): MemoryContext {
    return {
      userMemory: this.getUserMemory(),
      agentMemory: this.agentMemory,
    };
  }

  /**
   * Format memory for injection into system prompt
   */
  formatForSystemPrompt(): string {
    const parts: string[] = [];

    // User memory
    const userMemory = this.getUserMemory();
    if (userMemory) {
      parts.push(`## User Notes\n${userMemory}`);
    }

    // Agent memory (compact format)
    if (this.agentMemory && this.agentMemory.e.length > 0) {
      const entries = this.agentMemory.e
        .map(m => m.t ? `[${m.t}] ${m.c}` : m.c)
        .join('\n- ');
      parts.push(`## Remembered\n- ${entries}`);
    }

    if (parts.length === 0) {
      return '';
    }

    return `\n<memory>\n${parts.join('\n\n')}\n</memory>\n`;
  }

  /**
   * Add a new entry to agent memory
   */
  remember(content: string, category?: string): MemoryEntry {
    if (!this.agentMemory) {
      this.agentMemory = { v: 1, e: [] };
    }

    const entry: MemoryEntry = {
      c: content.trim(),
      ...(category && { t: category }),
    };

    this.agentMemory.e.push(entry);
    this.saveAgentMemory();

    console.log(`[Memory] Remembered: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
    return entry;
  }

  /**
   * Remove an entry from agent memory by index
   */
  forget(index: number): boolean {
    if (!this.agentMemory || index < 0 || index >= this.agentMemory.e.length) {
      return false;
    }

    this.agentMemory.e.splice(index, 1);
    this.saveAgentMemory();
    return true;
  }

  /**
   * Save agent memory to file (compact, no pretty print)
   */
  private saveAgentMemory(): void {
    try {
      writeFileSync(this.agentMemoryPath, JSON.stringify(this.agentMemory), 'utf-8');
    } catch (error) {
      console.error('[Memory] Failed to save agent memory:', error);
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): { userMemorySize: number; agentEntryCount: number } {
    const userMemory = this.getUserMemory();
    return {
      userMemorySize: userMemory?.length || 0,
      agentEntryCount: this.agentMemory?.e.length || 0,
    };
  }
}
