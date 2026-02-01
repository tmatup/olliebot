/**
 * Create Image Native Tool
 *
 * Generates an image from a text description using image generation APIs.
 * Supports OpenAI (DALL-E and GPT Image models) and Azure OpenAI.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export interface CreateImageConfig {
  apiKey: string;
  provider?: 'openai' | 'azure_openai';
  model?: string;
  /** Azure OpenAI endpoint (required for azure_openai provider) */
  azureEndpoint?: string;
  /** Azure OpenAI API version */
  azureApiVersion?: string;
}

interface RequestConfig {
  url: string;
  headers: Record<string, string>;
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
        enum: ['256x256', '512x512', '1024x1024', '1536x1024', '1024x1536'],
        description: 'Image size (default: 1024x1024). 1536x1024 (landscape) and 1024x1536 (portrait) only for GPT Image models.',
      },
      quality: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Image quality (only for GPT Image models, default: high)',
      },
    },
    required: ['description'],
  };

  private apiKey: string;
  private provider: 'openai' | 'azure_openai';
  private model: string;
  private azureEndpoint?: string;
  private azureApiVersion: string;

  constructor(config: CreateImageConfig) {
    this.apiKey = config.apiKey;
    this.provider = config.provider || 'openai';
    this.model = config.model || 'dall-e-3';
    this.azureEndpoint = config.azureEndpoint;
    this.azureApiVersion = config.azureApiVersion || '2024-02-15-preview';
  }

  /**
   * Check if the model is a GPT Image model (gpt-image-1, gpt-image-1.5, gpt-image-1-mini, etc.)
   */
  private isGptImageModel(): boolean {
    return this.model.startsWith('gpt-image');
  }

  /**
   * Get request URL and headers based on provider
   */
  private getRequestConfig(): RequestConfig {
    if (this.provider === 'azure_openai') {
      if (!this.azureEndpoint) {
        throw new Error('Azure OpenAI endpoint is required for azure_openai provider');
      }
      return {
        url: `${this.azureEndpoint}/openai/deployments/${this.model}/images/generations?api-version=${this.azureApiVersion}`,
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
      };
    }
    return {
      url: 'https://api.openai.com/v1/images/generations',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    };
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const description = String(params.description || '');
    const size = String(params.size || '1024x1024');
    const quality = String(params.quality || 'high');

    if (!description.trim()) {
      return {
        success: false,
        error: 'description parameter is required',
      };
    }

    try {
      if (this.isGptImageModel()) {
        return await this.generateWithGptImage(description, size, quality);
      } else {
        return await this.generateWithDallE(description, size);
      }
    } catch (error) {
      return {
        success: false,
        error: `Image generation failed: ${String(error)}`,
      };
    }
  }

  /**
   * Generate image with DALL-E models (dall-e-2, dall-e-3)
   */
  private async generateWithDallE(
    description: string,
    size: string
  ): Promise<NativeToolResult> {
    const config = this.getRequestConfig();

    const body: Record<string, unknown> = {
      prompt: description,
      n: 1,
      size,
      response_format: 'b64_json',
    };

    // OpenAI requires model in body, Azure uses deployment in URL
    if (this.provider === 'openai') {
      body.model = this.model;
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(body),
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
        provider: this.provider,
        model: this.model,
      },
    };
  }

  /**
   * Generate image with GPT Image models (gpt-image-1, gpt-image-1.5, gpt-image-1-mini, etc.)
   * These models use different parameters than DALL-E.
   */
  private async generateWithGptImage(
    description: string,
    size: string,
    quality: string
  ): Promise<NativeToolResult> {
    const config = this.getRequestConfig();

    // GPT Image models support different sizes
    const validSizes = ['1024x1024', '1536x1024', '1024x1536', 'auto'];
    const finalSize = validSizes.includes(size) ? size : '1024x1024';

    const body: Record<string, unknown> = {
      prompt: description,
      n: 1,
      size: finalSize,
      quality,
      output_format: 'png',
    };

    // OpenAI requires model in body, Azure uses deployment in URL
    if (this.provider === 'openai') {
      body.model = this.model;
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { error?: { message?: string } }).error?.message ||
        `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
    };

    // GPT Image models return URL by default, need to fetch and convert to base64
    const imageUrl = data.data?.[0]?.url;
    const b64Json = data.data?.[0]?.b64_json;

    let imageData: string;
    if (b64Json) {
      imageData = b64Json;
    } else if (imageUrl) {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error('Failed to fetch generated image');
      }
      const imageBuffer = await imageResponse.arrayBuffer();
      imageData = Buffer.from(imageBuffer).toString('base64');
    } else {
      throw new Error('No image data in response');
    }

    return {
      success: true,
      output: {
        dataUrl: `data:image/png;base64,${imageData}`,
        prompt: description,
        revisedPrompt: data.data?.[0]?.revised_prompt,
        provider: this.provider,
        model: this.model,
      },
    };
  }
}
