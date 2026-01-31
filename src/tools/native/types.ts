/**
 * Native Tool Interface
 *
 * Defines the contract for native (built-in) tools.
 */

export interface NativeToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface NativeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  execute(params: Record<string, unknown>): Promise<NativeToolResult>;
}
