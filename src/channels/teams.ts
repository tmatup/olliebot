import { v4 as uuid } from 'uuid';
import type { Channel, Message, SendOptions } from './types.js';

/**
 * Microsoft Teams Channel Integration
 *
 * This channel integrates with Microsoft Teams via the Bot Framework.
 * Requires a Teams App registration and Bot Framework configuration.
 *
 * Setup steps:
 * 1. Register a bot in Azure Bot Service
 * 2. Create a Teams App manifest
 * 3. Configure TEAMS_APP_ID and TEAMS_APP_PASSWORD environment variables
 */

export interface TeamsConfig {
  appId: string;
  appPassword: string;
  tenantId?: string;
}

interface TeamsActivity {
  type: string;
  id: string;
  timestamp: string;
  from: { id: string; name: string };
  conversation: { id: string };
  text?: string;
  value?: unknown;
}

export class TeamsChannel implements Channel {
  readonly id: string;
  readonly name = 'teams';

  private config: TeamsConfig;
  private messageHandler: ((message: Message) => Promise<void>) | null = null;
  private actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  private connected = false;
  private conversationReferences: Map<string, unknown> = new Map();

  constructor(id: string = 'teams-default', config: TeamsConfig) {
    this.id = id;
    this.config = config;
  }

  async init(): Promise<void> {
    // Validate configuration
    if (!this.config.appId || !this.config.appPassword) {
      console.warn('[TeamsChannel] Missing Teams configuration. Channel will be inactive.');
      return;
    }

    // In a full implementation, this would:
    // 1. Initialize the Bot Framework adapter
    // 2. Set up the messaging endpoint
    // 3. Register activity handlers

    this.connected = true;
    console.log('[TeamsChannel] Initialized (requires Bot Framework setup)');
  }

  /**
   * Handle incoming activity from Teams
   * This would be called by the Bot Framework adapter
   */
  async handleActivity(activity: TeamsActivity): Promise<void> {
    // Store conversation reference for proactive messaging
    this.conversationReferences.set(activity.conversation.id, {
      activityId: activity.id,
      user: activity.from,
      conversation: activity.conversation,
    });

    if (activity.type === 'message' && activity.text && this.messageHandler) {
      const message: Message = {
        id: uuid(),
        channel: this.id,
        role: 'user',
        content: activity.text,
        metadata: {
          teamsUserId: activity.from.id,
          teamsUserName: activity.from.name,
          conversationId: activity.conversation.id,
        },
        createdAt: new Date(activity.timestamp),
      };
      await this.messageHandler(message);
    } else if (activity.type === 'invoke' && activity.value && this.actionHandler) {
      // Handle adaptive card actions
      const actionData = activity.value as { action?: string; data?: unknown };
      if (actionData.action) {
        await this.actionHandler(actionData.action, actionData.data);
      }
    }
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    if (!this.connected) {
      console.warn('[TeamsChannel] Cannot send - not connected');
      return;
    }

    // Format message for Teams
    const teamsMessage = this.formatForTeams(content, options);

    // In a full implementation, this would use the Bot Framework to send
    // messages to all stored conversation references
    for (const [convId, _ref] of this.conversationReferences) {
      console.log(`[TeamsChannel] Would send to conversation ${convId}:`, teamsMessage);
      // await adapter.continueConversation(ref, async (context) => {
      //   await context.sendActivity(teamsMessage);
      // });
    }
  }

  async sendError(error: string, details?: string): Promise<void> {
    const errorMessage = `❌ **Error:** ${error}${details ? `\n\n\`\`\`\n${details}\n\`\`\`` : ''}`;
    await this.send(errorMessage, { markdown: true });
  }

  private formatForTeams(content: string, options?: SendOptions): unknown {
    // Teams supports Adaptive Cards for rich formatting
    if (options?.buttons && options.buttons.length > 0) {
      // Return an Adaptive Card with actions
      return {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              type: 'AdaptiveCard',
              version: '1.4',
              body: [
                {
                  type: 'TextBlock',
                  text: content,
                  wrap: true,
                },
              ],
              actions: options.buttons.map((btn) => ({
                type: 'Action.Submit',
                title: btn.label,
                data: {
                  action: btn.action,
                  data: btn.data,
                },
              })),
            },
          },
        ],
      };
    }

    // Simple text message with markdown
    return {
      type: 'message',
      text: content,
      textFormat: options?.markdown ? 'markdown' : 'plain',
    };
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onAction(handler: (action: string, data: unknown) => Promise<void>): void {
    this.actionHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async close(): Promise<void> {
    this.conversationReferences.clear();
    this.connected = false;
  }
}
