// LLM service abstraction types

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  // For tool use responses
  toolUse?: LLMToolUse[];
}

// Tool use block from LLM response
export interface LLMToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Tool result to send back to LLM
export interface LLMToolResult {
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  // Tool use support
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string };
}

export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  finishReason?: string;
}

// Extended response with tool use
export interface LLMResponseWithTools extends LLMResponse {
  toolUse?: LLMToolUse[];
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: (response: LLMResponse) => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;

  // Generate a completion
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;

  // Generate a streaming completion
  stream?(messages: LLMMessage[], callbacks: StreamCallbacks, options?: LLMOptions): Promise<void>;

  // Generate embeddings (optional)
  embed?(text: string): Promise<number[]>;
}

export interface LLMConfig {
  provider: 'anthropic' | 'google' | 'openai';
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// Data size thresholds for processing strategy
export const DATA_SIZE_THRESHOLDS = {
  SMALL: 3000, // Direct consumption
  MEDIUM: 50000, // Summarize first
  // Above MEDIUM: Use RAG
} as const;
