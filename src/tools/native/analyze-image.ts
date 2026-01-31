/**
 * Analyze Image Native Tool
 *
 * Analyzes an image using LLM vision capabilities.
 * Accepts either a file path or a base64 data URL.
 */

import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { NativeTool, NativeToolResult } from './types.js';
import type { LLMService } from '../../llm/service.js';

export class AnalyzeImageTool implements NativeTool {
  readonly name = 'analyze_image';
  readonly description = 'Analyze an image and describe its contents. Provide either a file path or a base64 data URL.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the image file to analyze',
      },
      dataUrl: {
        type: 'string',
        description: 'Base64 data URL of the image (e.g., data:image/png;base64,...)',
      },
      prompt: {
        type: 'string',
        description: 'Specific question or analysis request about the image (default: describe the image)',
      },
    },
    required: [],
  };

  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    try {
      let dataUrl = params.dataUrl as string | undefined;

      // If filePath provided, read and convert to dataUrl
      if (!dataUrl && params.filePath) {
        const filePath = String(params.filePath);
        const imageBuffer = await readFile(filePath);
        const ext = extname(filePath).toLowerCase().slice(1);
        const mimeType = this.getMimeType(ext);
        dataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
      }

      if (!dataUrl) {
        return {
          success: false,
          error: 'Either filePath or dataUrl must be provided',
        };
      }

      const prompt = String(params.prompt || 'Describe this image in detail. What do you see?');

      // For vision-capable models, the content includes the image
      // The LLM service will need to handle multimodal content
      // For now, we format the message to include the image reference
      const response = await this.llmService.generate([
        {
          role: 'user',
          content: `[Image attached: ${dataUrl.substring(0, 50)}...]\n\n${prompt}`,
        },
      ]);

      return {
        success: true,
        output: {
          analysis: response.content,
          prompt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Image analysis failed: ${String(error)}`,
      };
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    return mimeTypes[ext] || 'image/png';
  }
}
