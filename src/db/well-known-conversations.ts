/**
 * Well-Known Conversations
 *
 * Defines conversations with fixed IDs for specific purposes.
 * Unlike regular conversations that use auto-generated GUIDs,
 * well-known conversations have predictable IDs and are
 * automatically created if missing.
 *
 * Well-known conversations:
 * - Have fixed IDs (colon-delimited format like ':feed:')
 * - Have fixed names that cannot be renamed
 * - Have special icons for visual distinction
 * - Are always sorted to the top of the conversation list
 */

import { getDb, type Conversation } from './index.js';

// ============================================================================
// Well-Known Conversation IDs
// ============================================================================

/**
 * Well-known conversation IDs.
 * These use a colon-delimited format to distinguish them from GUIDs.
 */
export const WellKnownConversations = {
  /**
   * Feed conversation - receives messages from background/scheduled tasks.
   * When tasks execute automatically (via scheduler), their output goes here
   * instead of interrupting the user's active conversation.
   */
  FEED: ':feed:',
} as const;

export type WellKnownConversationId = (typeof WellKnownConversations)[keyof typeof WellKnownConversations];

// ============================================================================
// Well-Known Conversation Metadata
// ============================================================================

export interface WellKnownConversationMeta {
  id: WellKnownConversationId;
  title: string;
  icon: string;
  channel: string;
  description: string;
}

const WELL_KNOWN_META: WellKnownConversationMeta[] = [
  {
    id: WellKnownConversations.FEED,
    title: 'Feed',
    icon: '⚡',
    channel: 'web-main',
    description: 'Background task execution feed',
  },
];

/**
 * Get metadata for a well-known conversation.
 */
export function getWellKnownConversationMeta(id: string): WellKnownConversationMeta | undefined {
  return WELL_KNOWN_META.find((m) => m.id === id);
}

/**
 * Get all well-known conversation metadata.
 */
export function getAllWellKnownConversationMeta(): WellKnownConversationMeta[] {
  return [...WELL_KNOWN_META];
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Ensures all well-known conversations exist in the database.
 * Creates any that are missing. Should be called during app initialization.
 */
export function ensureWellKnownConversations(): void {
  const db = getDb();
  const now = new Date().toISOString();

  for (const meta of WELL_KNOWN_META) {
    const existing = db.conversations.findById(meta.id);
    if (!existing) {
      console.log(`[WellKnownConversations] Creating well-known conversation: ${meta.id} (${meta.title})`);
      db.conversations.create({
        id: meta.id,
        title: meta.title,
        channel: meta.channel,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }
  }
}

/**
 * Gets a well-known conversation, creating it if missing.
 */
export function getWellKnownConversation(id: WellKnownConversationId): Conversation {
  const db = getDb();
  let conversation = db.conversations.findById(id);

  if (!conversation) {
    // Find metadata and create
    const meta = WELL_KNOWN_META.find((m) => m.id === id);
    if (!meta) {
      throw new Error(`Unknown well-known conversation ID: ${id}`);
    }

    const now = new Date().toISOString();
    db.conversations.create({
      id: meta.id,
      title: meta.title,
      channel: meta.channel,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    conversation = db.conversations.findById(id)!;
  }

  return conversation;
}

/**
 * Checks if a conversation ID is a well-known conversation.
 */
export function isWellKnownConversation(id: string): id is WellKnownConversationId {
  return Object.values(WellKnownConversations).includes(id as WellKnownConversationId);
}
