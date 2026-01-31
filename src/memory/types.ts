/**
 * Memory System Types
 * Kept minimal to reduce context window usage
 */

export interface MemoryEntry {
  c: string;  // content
  t?: string; // tag/category (optional)
}

export interface AgentMemory {
  v: number;           // version
  e: MemoryEntry[];    // entries
}

export interface MemoryContext {
  userMemory: string | null;
  agentMemory: AgentMemory | null;
}
