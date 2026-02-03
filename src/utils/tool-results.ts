import type { ToolResult } from '../tools/types.js';
import type { LLMContentBlock } from '../llm/types.js';
import { stripBinaryDataForLLM } from './strip-binary.js';

export function formatToolResultBlocks(results: ToolResult[]): LLMContentBlock[] {
  return results.map((result) => {
    let content: string;
    if (result.success) {
      const stripped = stripBinaryDataForLLM(result.output);
      content = typeof stripped === 'string' ? stripped : JSON.stringify(stripped);
    } else {
      content = `Error: ${result.error || 'Unknown error'}`;
    }

    return {
      type: 'tool_result',
      tool_use_id: result.requestId,
      content,
      is_error: !result.success,
    };
  });
}
