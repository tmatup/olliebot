/**
 * Code Generator for User-Defined Tools
 *
 * Uses LLM to translate .md tool definitions into .js implementations
 * with zod schemas and sandboxed execution functions.
 */

import type { LLMServiceInterface, UserToolDefinition, UserToolParameter } from './types.js';

const CODE_GENERATOR_SYSTEM_PROMPT = `You are a code generator that translates tool specifications into JavaScript implementations.

## Output Format
You must output ONLY valid JavaScript code (no markdown, no explanation). The code must have exactly two exports:

1. exports.inputSchema - A zod schema object defining the input parameters
2. exports.default - A function that implements the tool logic

## Available Globals
- z: The zod library for schema validation
- console: For logging (log, warn, error only)
- JSON, Math, Date, Array, Object, String, Number, Boolean

## Rules
- Use z.object() for the input schema with appropriate zod types
- The default function takes a single 'input' parameter
- Return a plain object with the output fields
- Handle errors gracefully - return { error: "message" } on failure
- NO require(), NO import, NO fetch(), NO fs, NO process
- Keep code simple and focused on the task

## Example Output
exports.inputSchema = z.object({
  name: z.string().min(1),
  count: z.number().int().positive().optional()
});

exports.default = function(input) {
  const greeting = "Hello, " + input.name;
  const times = input.count || 1;
  return {
    message: greeting,
    repeated: times
  };
};`;

/**
 * Code generator that uses LLM to create tool implementations
 */
export class CodeGenerator {
  private llmService: LLMServiceInterface;

  constructor(llmService: LLMServiceInterface) {
    this.llmService = llmService;
  }

  /**
   * Parse a .md file content into structured definition
   */
  parseDefinition(mdContent: string, name: string, mdPath: string, jsPath: string): UserToolDefinition {
    const lines = mdContent.split('\n');
    const inputs: UserToolParameter[] = [];
    const outputs: UserToolParameter[] = [];
    let description = '';
    let logic = '';
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Detect sections
      if (trimmed.toLowerCase().startsWith('input:') || trimmed.toLowerCase().startsWith('inputs:')) {
        currentSection = 'input';
        continue;
      }
      if (trimmed.toLowerCase().startsWith('output:') || trimmed.toLowerCase().startsWith('outputs:')) {
        currentSection = 'output';
        continue;
      }
      if (trimmed.toLowerCase().startsWith('logic:')) {
        currentSection = 'logic';
        continue;
      }
      if (trimmed.toLowerCase().startsWith('description:')) {
        currentSection = 'description';
        continue;
      }

      // Parse content based on section
      if (currentSection === 'input' && trimmed.startsWith('-')) {
        const param = this.parseParameter(trimmed);
        if (param) inputs.push(param);
      } else if (currentSection === 'output' && trimmed.startsWith('-')) {
        const param = this.parseParameter(trimmed);
        if (param) outputs.push({ ...param, required: true });
      } else if (currentSection === 'logic' && trimmed) {
        logic += (logic ? '\n' : '') + trimmed;
      } else if (currentSection === 'description' && trimmed) {
        description += (description ? ' ' : '') + trimmed;
      }
    }

    // Generate description from logic if not explicitly provided
    if (!description && logic) {
      description = `Tool that ${logic.split('.')[0].toLowerCase()}`;
    }

    return {
      name,
      description: description || `User-defined tool: ${name}`,
      inputs,
      outputs,
      logic,
      mdPath,
      jsPath,
    };
  }

  /**
   * Parse a parameter line like "- paramName (type): description"
   */
  private parseParameter(line: string): UserToolParameter | null {
    // Match pattern: - name (type): description
    // or: - name: description
    const match = line.match(/^-\s*(\w+)\s*(?:\(([^)]+)\))?\s*:?\s*(.*)$/);
    if (!match) return null;

    const [, name, type, description] = match;
    const isOptional = description?.toLowerCase().includes('optional') || type?.toLowerCase().includes('optional');

    return {
      name,
      type: (type || 'string').replace(/optional/i, '').trim() || 'string',
      description: description || '',
      required: !isOptional,
    };
  }

  /**
   * Generate JavaScript code from a tool definition using LLM
   */
  async generateCode(definition: UserToolDefinition): Promise<string> {
    const prompt = this.buildPrompt(definition);

    const response = await this.llmService.generate(
      [{ role: 'user', content: prompt }],
      {
        systemPrompt: CODE_GENERATOR_SYSTEM_PROMPT,
        maxTokens: 2000,
      }
    );

    // Extract code from response (handle markdown code blocks if present)
    let code = response.content.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = code.match(/```(?:javascript|js)?\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      code = codeBlockMatch[1].trim();
    }

    // Validate the generated code
    const validation = this.validateCode(code);
    if (!validation.valid) {
      throw new Error(`Generated code validation failed: ${validation.error}`);
    }

    return code;
  }

  /**
   * Build the prompt for code generation
   */
  private buildPrompt(definition: UserToolDefinition): string {
    let prompt = `Generate JavaScript code for a tool with the following specification:\n\n`;
    prompt += `Tool Name: ${definition.name}\n`;
    prompt += `Description: ${definition.description}\n\n`;

    if (definition.inputs.length > 0) {
      prompt += `Input Parameters:\n`;
      for (const input of definition.inputs) {
        const reqStr = input.required ? 'required' : 'optional';
        prompt += `- ${input.name} (${input.type}, ${reqStr}): ${input.description}\n`;
      }
      prompt += '\n';
    }

    if (definition.outputs.length > 0) {
      prompt += `Output Fields:\n`;
      for (const output of definition.outputs) {
        prompt += `- ${output.name} (${output.type}): ${output.description}\n`;
      }
      prompt += '\n';
    }

    if (definition.logic) {
      prompt += `Logic:\n${definition.logic}\n`;
    }

    return prompt;
  }

  /**
   * Validate generated JavaScript code
   */
  validateCode(code: string): { valid: boolean; error?: string } {
    // Check for required exports
    if (!code.includes('exports.inputSchema')) {
      return { valid: false, error: 'Missing exports.inputSchema' };
    }
    if (!code.includes('exports.default')) {
      return { valid: false, error: 'Missing exports.default' };
    }

    // Check for forbidden patterns
    const forbidden = [
      { pattern: /require\s*\(/, message: 'require() is not allowed' },
      { pattern: /import\s+/, message: 'import is not allowed' },
      { pattern: /process\./, message: 'process is not allowed' },
      { pattern: /global\./, message: 'global is not allowed' },
      { pattern: /globalThis\./, message: 'globalThis is not allowed' },
      { pattern: /eval\s*\(/, message: 'eval() is not allowed' },
      { pattern: /Function\s*\(/, message: 'Function() constructor is not allowed' },
    ];

    for (const { pattern, message } of forbidden) {
      if (pattern.test(code)) {
        return { valid: false, error: message };
      }
    }

    // Try to parse as JavaScript (basic syntax check)
    try {
      new Function(code);
    } catch (e) {
      return { valid: false, error: `Syntax error: ${(e as Error).message}` };
    }

    return { valid: true };
  }
}
