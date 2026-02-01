/**
 * OpenAI API Types
 * Type definitions for OpenAI Chat Completions and Embeddings API responses
 */

// ============================================================================
// Tool Call Types
// ============================================================================

/** A function call requested by the model */
export interface OpenAIFunctionCall {
  name: string;
  arguments: string;
}

/** A tool call in an assistant message */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: OpenAIFunctionCall;
}

// ============================================================================
// Message Types
// ============================================================================

/** Message content in a chat completion response */
export interface OpenAIResponseMessage {
  content?: string;
  tool_calls?: OpenAIToolCall[];
}

/** A choice in a chat completion response */
export interface OpenAIChatChoice {
  message?: OpenAIResponseMessage;
  finish_reason?: string;
}

/** Token usage statistics */
export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

// ============================================================================
// API Response Types
// ============================================================================

/** Response from the chat completions endpoint */
export interface OpenAIChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAIChatChoice[];
  usage?: OpenAIUsage;
}

/** A single embedding result */
export interface OpenAIEmbeddingData {
  embedding?: number[];
  index?: number;
}

/** Response from the embeddings endpoint */
export interface OpenAIEmbeddingResponse {
  data?: OpenAIEmbeddingData[];
  model?: string;
  usage?: OpenAIUsage;
}

// ============================================================================
// Request Message Types
// ============================================================================

/** Content part for multimodal messages */
export interface OpenAITextContentPart {
  type: 'text';
  text: string;
}

export interface OpenAIImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type OpenAIContentPart = OpenAITextContentPart | OpenAIImageContentPart;

/** Basic message for chat completions */
export interface OpenAIRequestMessage {
  role: string;
  content: string | OpenAIContentPart[];
}

/** Tool call structure for request messages */
export interface OpenAIRequestToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Assistant message with tool calls for request */
export interface OpenAIAssistantMessageWithTools {
  role: 'assistant';
  content: string | null;
  tool_calls: OpenAIRequestToolCall[];
}

/** Tool result message for request */
export interface OpenAIToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** Union of all possible message types in a request */
export type OpenAIMessage =
  | OpenAIRequestMessage
  | OpenAIAssistantMessageWithTools
  | OpenAIToolResultMessage;

// ============================================================================
// Tool Definition Types
// ============================================================================

/** Tool choice for forcing a specific function */
export interface OpenAIToolChoiceFunction {
  type: 'function';
  function: { name: string };
}

/** Tool choice options */
export type OpenAIToolChoice = 'auto' | 'none' | OpenAIToolChoiceFunction;
