import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuid } from 'uuid';
import type { Channel, Message, SendOptions, ActionButton } from './types.js';

interface WebClient {
  ws: WebSocket;
  id: string;
  connectedAt: Date;
}

export class WebChannel implements Channel {
  readonly id: string;
  readonly name = 'web';

  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebClient> = new Map();
  private messageHandler: ((message: Message) => Promise<void>) | null = null;
  private actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  private interactionHandler: ((requestId: string, response: unknown, conversationId?: string) => Promise<void>) | null = null;
  private connected = false;

  constructor(id: string = 'web-default') {
    this.id = id;
  }

  async init(): Promise<void> {
    // WebSocket server will be attached to HTTP server externally
    this.connected = true;
  }

  attachToServer(wss: WebSocketServer): void {
    this.wss = wss;

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = uuid();
      const client: WebClient = {
        ws,
        id: clientId,
        connectedAt: new Date(),
      };
      this.clients.set(clientId, client);

      ws.on('message', async (data: Buffer) => {
        try {
          const parsed = JSON.parse(data.toString());
          await this.handleClientMessage(clientId, parsed);
        } catch (error) {
          console.error('[WebChannel] Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error(`[WebChannel] Client error (${clientId}):`, error);
        this.clients.delete(clientId);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        timestamp: new Date().toISOString(),
      });
    });
  }

  private newConversationHandler: (() => void) | null = null;
  private browserActionHandler: ((action: string, sessionId: string) => Promise<void>) | null = null;

  private async handleClientMessage(clientId: string, data: unknown): Promise<void> {
    const msg = data as {
      type: string;
      content?: string;
      action?: string;
      data?: unknown;
      conversationId?: string;
      requestId?: string;
      sessionId?: string;
      attachments?: Array<{ name: string; type: string; size: number; data: string }>;
      reasoningEffort?: 'medium' | 'high' | 'xhigh';
      messageType?: string; // e.g., 'deep_research'
      messageId?: string; // Client-provided ID for deduplication
    };

    if (msg.type === 'message' && (msg.content || msg.attachments?.length) && this.messageHandler) {
      const message: Message = {
        // Use client-provided messageId if available (for deduplication), otherwise generate one
        id: msg.messageId || uuid(),
        channel: this.id,
        role: 'user',
        content: msg.content || '',
        attachments: msg.attachments,
        metadata: {
          clientId,
          conversationId: msg.conversationId,
          // Store as vendor-neutral 'reasoningMode' in DB (mapped from client's reasoningEffort)
          reasoningMode: msg.reasoningEffort,
          // Message type for special handling (e.g., 'deep_research')
          messageType: msg.messageType,
        },
        createdAt: new Date(),
      };
      await this.messageHandler(message);
    } else if (msg.type === 'action' && msg.action && this.actionHandler) {
      // Include conversationId in the data passed to the action handler
      await this.actionHandler(msg.action, { ...msg.data as object, conversationId: msg.conversationId });
    } else if (msg.type === 'interaction-response' && this.interactionHandler) {
      await this.interactionHandler(msg.requestId!, msg.data, msg.conversationId);
    } else if (msg.type === 'new-conversation' && this.newConversationHandler) {
      this.newConversationHandler();
    } else if (msg.type === 'browser-action' && msg.action && msg.sessionId && this.browserActionHandler) {
      await this.browserActionHandler(msg.action, msg.sessionId);
    }
  }

  onNewConversation(handler: () => void): void {
    this.newConversationHandler = handler;
  }

  private sendToClient(clientId: string, data: unknown): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(data));
      } catch (error) {
        // Socket may have been closed between readyState check and send
        console.warn(`[WebChannel] Failed to send to client ${clientId}:`, (error as Error).message);
        this.clients.delete(clientId);
      }
    }
  }

  async send(content: string, options?: SendOptions): Promise<void> {
    const payload: {
      type: string;
      id: string;
      content: string;
      markdown: boolean;
      html: boolean;
      buttons?: ActionButton[];
      timestamp: string;
    } = {
      type: 'message',
      id: uuid(),
      content,
      markdown: options?.markdown ?? true,
      html: options?.html ?? false,
      timestamp: new Date().toISOString(),
    };

    if (options?.buttons) {
      payload.buttons = options.buttons;
    }

    // Broadcast to all connected clients
    this.broadcast(payload);
  }

  async sendError(error: string, details?: string): Promise<void> {
    const payload = {
      type: 'error',
      id: uuid(),
      error,
      details,
      timestamp: new Date().toISOString(),
    };

    // Broadcast error to all connected clients
    this.broadcast(payload);
  }

  async sendAsAgent(
    content: string,
    options?: {
      markdown?: boolean;
      agentId?: string;
      agentName?: string;
      agentEmoji?: string;
    }
  ): Promise<void> {
    const payload = {
      type: 'message',
      id: uuid(),
      content,
      markdown: options?.markdown ?? true,
      html: false,
      agentId: options?.agentId,
      agentName: options?.agentName,
      agentEmoji: options?.agentEmoji,
      timestamp: new Date().toISOString(),
    };

    this.broadcast(payload);
  }

  // Streaming support
  startStream(streamId: string, agentInfo?: {
    agentId?: string;
    agentName?: string;
    agentEmoji?: string;
    agentType?: string;
    conversationId?: string;
  }): void {
    const payload = {
      type: 'stream_start',
      id: streamId,
      ...agentInfo,
      timestamp: new Date().toISOString(),
    };
    this.broadcast(payload);
  }

  sendStreamChunk(streamId: string, chunk: string, conversationId?: string): void {
    const payload = {
      type: 'stream_chunk',
      streamId,
      chunk,
      conversationId,
    };
    this.broadcast(payload);
  }

  endStream(streamId: string, conversationId?: string, citations?: { sources: unknown[]; references: unknown[] }): void {
    const payload: {
      type: string;
      streamId: string;
      conversationId?: string;
      citations?: { sources: unknown[]; references: unknown[] };
      timestamp: string;
    } = {
      type: 'stream_end',
      streamId,
      conversationId,
      timestamp: new Date().toISOString(),
    };

    // Include citations if provided
    if (citations && citations.sources.length > 0) {
      payload.citations = citations;
    }

    this.broadcast(payload);
  }

  /**
   * Broadcast data to all connected clients
   */
  broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    const closedClients: string[] = [];
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch (error) {
          // Socket may have been closed between readyState check and send
          console.warn(`[WebChannel] Failed to broadcast to client ${client.id}:`, (error as Error).message);
          closedClients.push(client.id);
        }
      }
    }
    // Clean up closed clients
    for (const clientId of closedClients) {
      this.clients.delete(clientId);
    }
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onAction(handler: (action: string, data: unknown) => Promise<void>): void {
    this.actionHandler = handler;
  }

  onInteraction(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>): void {
    this.interactionHandler = handler;
  }

  onBrowserAction(handler: (action: string, sessionId: string) => Promise<void>): void {
    this.browserActionHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectedClients(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.connected = false;
  }
}
