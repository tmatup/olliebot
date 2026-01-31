/**
 * A2UI - Agent-to-User Interaction Types
 *
 * A2UI provides a standard way for agents to request human input
 * during automated workflows (human-in-the-loop).
 */

export type InteractionType =
  | 'confirmation'
  | 'choice'
  | 'text-input'
  | 'form'
  | 'approval'
  | 'notification';

export interface InteractionRequest {
  id: string;
  type: InteractionType;
  title: string;
  message: string;
  options?: InteractionOption[];
  fields?: FormField[];
  timeout?: number; // ms, 0 = no timeout
  priority: 'low' | 'normal' | 'high' | 'urgent';
  context?: Record<string, unknown>;
  createdAt: Date;
  expiresAt?: Date;
}

export interface InteractionOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface FormField {
  id: string;
  type: 'text' | 'number' | 'email' | 'password' | 'textarea' | 'select' | 'checkbox';
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[]; // For select fields
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
}

export interface InteractionResponse {
  requestId: string;
  respondedAt: Date;
  status: 'completed' | 'cancelled' | 'timeout';
  selectedOption?: string;
  formData?: Record<string, unknown>;
  textInput?: string;
}

export interface PendingInteraction {
  request: InteractionRequest;
  resolve: (response: InteractionResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}
