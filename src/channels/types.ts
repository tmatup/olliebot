// Communication channel abstraction types

export interface Message {
  id: string;
  channel: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface SendOptions {
  markdown?: boolean;
  html?: boolean;
  buttons?: ActionButton[];
}

export interface ActionButton {
  id: string;
  label: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface ChannelEvent {
  type: 'message' | 'action' | 'typing' | 'presence';
  channelId: string;
  data: unknown;
}

export interface Channel {
  readonly id: string;
  readonly name: string;

  // Initialize the channel
  init(): Promise<void>;

  // Send a message to the user
  send(content: string, options?: SendOptions): Promise<void>;

  // Send an error message to the user
  sendError(error: string, details?: string): Promise<void>;

  // Streaming support (optional)
  startStream?(streamId: string, agentInfo?: { agentId?: string; agentName?: string; agentEmoji?: string }): void;
  sendStreamChunk?(streamId: string, chunk: string): void;
  endStream?(streamId: string): void;

  // Register message handler
  onMessage(handler: (message: Message) => Promise<void>): void;

  // Register action handler (for buttons, etc.)
  onAction(handler: (action: string, data: unknown) => Promise<void>): void;

  // Check if channel is connected/active
  isConnected(): boolean;

  // Close the channel
  close(): Promise<void>;
}

export interface ChannelFactory {
  create(config: ChannelConfig): Channel;
}

export interface ChannelConfig {
  type: 'web' | 'console' | 'teams';
  id: string;
  options?: Record<string, unknown>;
}
