import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import type {
  InteractionRequest,
  InteractionResponse,
  InteractionType,
  InteractionOption,
  FormField,
  PendingInteraction,
} from './types.js';

/**
 * A2UI Manager - Handles human-in-the-loop interactions
 *
 * Provides a standardized way for the agent to:
 * - Request user confirmation
 * - Present choices
 * - Collect text input
 * - Display forms
 * - Request approvals
 * - Send notifications
 */
export class A2UIManager extends EventEmitter {
  private pending: Map<string, PendingInteraction> = new Map();
  private defaultTimeout = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
  }

  /**
   * Request user confirmation (yes/no)
   */
  async confirm(
    title: string,
    message: string,
    options?: { timeout?: number; priority?: InteractionRequest['priority'] }
  ): Promise<boolean> {
    const response = await this.request({
      type: 'confirmation',
      title,
      message,
      options: [
        { id: 'yes', label: 'Yes', isDefault: true, style: 'primary' },
        { id: 'no', label: 'No', style: 'secondary' },
      ],
      timeout: options?.timeout,
      priority: options?.priority || 'normal',
    });

    return response.status === 'completed' && response.selectedOption === 'yes';
  }

  /**
   * Present choices to the user
   */
  async choose<T extends string>(
    title: string,
    message: string,
    choices: Array<{ id: T; label: string; description?: string }>,
    options?: { timeout?: number; priority?: InteractionRequest['priority'] }
  ): Promise<T | null> {
    const response = await this.request({
      type: 'choice',
      title,
      message,
      options: choices.map((c, i) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        isDefault: i === 0,
      })),
      timeout: options?.timeout,
      priority: options?.priority || 'normal',
    });

    if (response.status === 'completed' && response.selectedOption) {
      return response.selectedOption as T;
    }
    return null;
  }

  /**
   * Request text input from the user
   */
  async prompt(
    title: string,
    message: string,
    options?: {
      placeholder?: string;
      timeout?: number;
      priority?: InteractionRequest['priority'];
    }
  ): Promise<string | null> {
    const response = await this.request({
      type: 'text-input',
      title,
      message,
      fields: [
        {
          id: 'input',
          type: 'text',
          label: 'Your response',
          placeholder: options?.placeholder,
          required: true,
        },
      ],
      timeout: options?.timeout,
      priority: options?.priority || 'normal',
    });

    if (response.status === 'completed' && response.formData) {
      return String(response.formData.input || '');
    }
    return null;
  }

  /**
   * Display a form and collect data
   */
  async form<T extends Record<string, unknown>>(
    title: string,
    message: string,
    fields: FormField[],
    options?: { timeout?: number; priority?: InteractionRequest['priority'] }
  ): Promise<T | null> {
    const response = await this.request({
      type: 'form',
      title,
      message,
      fields,
      timeout: options?.timeout,
      priority: options?.priority || 'normal',
    });

    if (response.status === 'completed' && response.formData) {
      return response.formData as T;
    }
    return null;
  }

  /**
   * Request approval (with approve/reject options)
   */
  async approve(
    title: string,
    message: string,
    options?: {
      timeout?: number;
      priority?: InteractionRequest['priority'];
      context?: Record<string, unknown>;
    }
  ): Promise<{ approved: boolean; comment?: string }> {
    const response = await this.request({
      type: 'approval',
      title,
      message,
      options: [
        { id: 'approve', label: 'Approve', style: 'primary' },
        { id: 'reject', label: 'Reject', style: 'danger' },
      ],
      fields: [
        {
          id: 'comment',
          type: 'textarea',
          label: 'Comment (optional)',
          required: false,
        },
      ],
      timeout: options?.timeout,
      priority: options?.priority || 'high',
      context: options?.context,
    });

    return {
      approved: response.status === 'completed' && response.selectedOption === 'approve',
      comment: response.formData?.comment as string | undefined,
    };
  }

  /**
   * Send a notification (no response expected)
   */
  async notify(
    title: string,
    message: string,
    options?: { priority?: InteractionRequest['priority'] }
  ): Promise<void> {
    const request = this.createRequest({
      type: 'notification',
      title,
      message,
      timeout: 0, // No timeout for notifications
      priority: options?.priority || 'normal',
    });

    this.emit('interaction', request);
  }

  /**
   * Create and send a custom interaction request
   */
  async request(params: {
    type: InteractionType;
    title: string;
    message: string;
    options?: InteractionOption[];
    fields?: FormField[];
    timeout?: number;
    priority: InteractionRequest['priority'];
    context?: Record<string, unknown>;
  }): Promise<InteractionResponse> {
    const request = this.createRequest(params);

    return new Promise((resolve, reject) => {
      const pending: PendingInteraction = {
        request,
        resolve,
        reject,
      };

      // Set up timeout if specified
      const timeout = params.timeout ?? this.defaultTimeout;
      if (timeout > 0) {
        pending.timeoutHandle = setTimeout(() => {
          this.handleTimeout(request.id);
        }, timeout);
      }

      this.pending.set(request.id, pending);

      // Emit the interaction request
      this.emit('interaction', request);
    });
  }

  /**
   * Handle a response from the user
   */
  handleResponse(response: InteractionResponse): boolean {
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      console.warn(`[A2UI] No pending interaction for ID: ${response.requestId}`);
      return false;
    }

    // Clear timeout
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    // Remove from pending
    this.pending.delete(response.requestId);

    // Resolve the promise
    pending.resolve(response);

    return true;
  }

  /**
   * Cancel a pending interaction
   */
  cancel(requestId: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return false;
    }

    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    this.pending.delete(requestId);

    pending.resolve({
      requestId,
      respondedAt: new Date(),
      status: 'cancelled',
    });

    return true;
  }

  private createRequest(params: {
    type: InteractionType;
    title: string;
    message: string;
    options?: InteractionOption[];
    fields?: FormField[];
    timeout?: number;
    priority: InteractionRequest['priority'];
    context?: Record<string, unknown>;
  }): InteractionRequest {
    const timeout = params.timeout ?? this.defaultTimeout;

    return {
      id: uuid(),
      type: params.type,
      title: params.title,
      message: params.message,
      options: params.options,
      fields: params.fields,
      timeout,
      priority: params.priority,
      context: params.context,
      createdAt: new Date(),
      expiresAt: timeout > 0 ? new Date(Date.now() + timeout) : undefined,
    };
  }

  private handleTimeout(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }

    this.pending.delete(requestId);

    pending.resolve({
      requestId,
      respondedAt: new Date(),
      status: 'timeout',
    });

    this.emit('timeout', pending.request);
  }

  /**
   * Get all pending interactions
   */
  getPending(): InteractionRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }

  /**
   * Set default timeout for interactions
   */
  setDefaultTimeout(ms: number): void {
    this.defaultTimeout = ms;
  }
}
