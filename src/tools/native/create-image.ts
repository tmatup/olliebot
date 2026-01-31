/**
 * Create Image Native Tool
 *
 * Generates an image from a text description using image generation APIs.
 * Supports OpenAI DALL-E and Stability AI.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export interface CreateImageConfig {
  apiKey: string;
  provider?: 'openai' | 'stability';
}

export class CreateImageTool implements NativeTool {
  readonly name = 'create_image';
  readonly description = 'Generate an image from a text description. Returns the generated image as a base64 data URL.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Detailed description of the image to create',
      },
      size: {
        type: 'string',
        enum: ['256x256', '512x512', '1024x1024'],
        description: 'Image size (default: 1024x1024)',
      },
    },
    required: ['description'],
  };

  private apiKey: string;
  private provider: 'openai' | 'stability';

  constructor(config: CreateImageConfig) {
    this.apiKey = config.apiKey;
    this.provider = config.provider || 'openai';
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const description = String(params.description || '');
    const size = String(params.size || '1024x1024');

    if (!description.trim()) {
      return {
        success: false,
        error: 'description parameter is required',
      };
    }

    try {
      if (this.provider === 'openai') {
        return await this.generateWithOpenAI(description, size);
      } else {
        return await this.generateWithStability(description);
      }
    } catch (error) {
      return {
        success: false,
        error: `Image generation failed: ${String(error)}`,
      };
    }
  }

  private async generateWithOpenAI(
    description: string,
    size: string
  ): Promise<NativeToolResult> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: description,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { error?: { message?: string } }).error?.message ||
        `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    };
    const imageData = data.data?.[0]?.b64_json;

    if (!imageData) {
      throw new Error('No image data in response');
    }

    return {
      success: true,
      output: {
        dataUrl: `data:image/png;base64,${imageData}`,
        prompt: description,
        revisedPrompt: data.data?.[0]?.revised_prompt,
        provider: 'openai',
      },
    };
  }

  private async generateWithStability(description: string): Promise<NativeToolResult> {
    const response = await fetch(
      'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          text_prompts: [{ text: description }],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          samples: 1,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stability AI error: ${errorText}`);
    }

    const data = (await response.json()) as {
      artifacts?: Array<{ base64?: string }>;
    };
    const imageData = data.artifacts?.[0]?.base64;

    if (!imageData) {
      throw new Error('No image data in response');
    }

    return {
      success: true,
      output: {
        dataUrl: `data:image/png;base64,${imageData}`,
        prompt: description,
        provider: 'stability',
      },
    };
  }
}
