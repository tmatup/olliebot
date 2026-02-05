/**
 * Speak Tool
 *
 * Converts text to speech using OpenAI's TTS API or Realtime API.
 * Returns base64-encoded audio that can be played by the client.
 */

import { WebSocket } from 'ws';
import type { NativeTool, NativeToolResult } from './types.js';

export interface SpeakToolConfig {
  /** API key */
  apiKey: string;
  /** Provider: 'openai' or 'azure_openai' */
  provider?: 'openai' | 'azure_openai';
  /** TTS model */
  model?: string;
  /** Voice to use (default: alloy) */
  voice?: string;
  /** Azure OpenAI endpoint (required for azure_openai provider) */
  azureEndpoint?: string;
  /** Azure OpenAI API version */
  azureApiVersion?: string;
}

type Voice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'ash' | 'ballad' | 'coral' | 'sage' | 'verse';

export class SpeakTool implements NativeTool {
  readonly name = 'speak';
  readonly description = `Convert text to speech and return audio.

Available voices:
- alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse

The output is base64-encoded audio that can be played by the client.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      phrase: {
        type: 'string',
        description: 'The text to speak',
      },
      voice: {
        type: 'string',
        enum: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'],
        description: 'Voice to use (optional, defaults to configured voice)',
      },
    },
    required: ['phrase'],
  };

  private apiKey: string;
  private provider: 'openai' | 'azure_openai';
  private model: string;
  private defaultVoice: Voice;
  private azureEndpoint?: string;
  private azureApiVersion: string;

  constructor(config: SpeakToolConfig) {
    this.apiKey = config.apiKey;
    this.provider = config.provider || 'openai';
    this.model = config.model || 'tts-1';
    this.defaultVoice = (config.voice || 'alloy') as Voice;
    this.azureEndpoint = config.azureEndpoint;
    this.azureApiVersion = config.azureApiVersion || '2024-10-01-preview';
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const phrase = params.phrase as string;
    const voice = (params.voice as Voice) || this.defaultVoice;

    if (!phrase || phrase.trim().length === 0) {
      return {
        success: false,
        error: 'phrase is required',
      };
    }

    // Check if using realtime model
    const isRealtimeModel = this.model.includes('realtime');

    if (isRealtimeModel) {
      return this.executeRealtime(phrase, voice);
    } else {
      return this.executeStandardTTS(phrase, voice);
    }
  }

  /**
   * Use standard TTS API (for tts-1, tts-1-hd models)
   */
  private async executeStandardTTS(phrase: string, voice: Voice): Promise<NativeToolResult> {
    // Standard TTS has a max of 4096 characters
    if (phrase.length > 4096) {
      return {
        success: false,
        error: 'phrase too long for standard TTS (max 4096 characters)',
      };
    }

    try {
      let url: string;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.provider === 'azure_openai') {
        if (!this.azureEndpoint) {
          return { success: false, error: 'Azure endpoint required for azure_openai provider' };
        }
        url = `${this.azureEndpoint}/openai/deployments/${this.model}/audio/speech?api-version=${this.azureApiVersion}`;
        headers['api-key'] = this.apiKey;
      } else {
        url = 'https://api.openai.com/v1/audio/speech';
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.provider === 'openai' ? this.model : undefined,
          input: phrase,
          voice: voice,
          response_format: 'mp3',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `TTS API error: ${response.status} ${errorText}`,
        };
      }

      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');

      return {
        success: true,
        output: {
          audio: base64Audio,
          mimeType: 'audio/mpeg',
          voice: voice,
          model: this.model,
          characterCount: phrase.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `TTS request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Use Realtime API for gpt-4o-realtime models
   */
  private async executeRealtime(phrase: string, voice: Voice): Promise<NativeToolResult> {
    return new Promise((resolve) => {
      try {
        let wsUrl: string;
        let wsHeaders: Record<string, string>;

        if (this.provider === 'azure_openai') {
          if (!this.azureEndpoint) {
            resolve({ success: false, error: 'Azure endpoint required for azure_openai provider' });
            return;
          }
          // Remove https:// and add wss://
          const endpoint = this.azureEndpoint.replace(/^https?:\/\//, '');
          wsUrl = `wss://${endpoint}/openai/realtime?api-version=${this.azureApiVersion}&deployment=${this.model}`;
          wsHeaders = { 'api-key': this.apiKey };
        } else {
          wsUrl = `wss://api.openai.com/v1/realtime?model=${this.model}`;
          wsHeaders = {
            'Authorization': `Bearer ${this.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
          };
        }

        const ws = new WebSocket(wsUrl, { headers: wsHeaders });
        const audioChunks: string[] = [];
        let sessionCreated = false;
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, error: 'Realtime API timeout (30s)' });
        }, 30000);

        ws.on('open', () => {
          // Session will be created automatically, wait for session.created
        });

        ws.on('message', (data) => {
          try {
            const event = JSON.parse(data.toString());

            switch (event.type) {
              case 'session.created':
                sessionCreated = true;
                // Update session to set voice and modalities
                ws.send(JSON.stringify({
                  type: 'session.update',
                  session: {
                    modalities: ['text', 'audio'],
                    voice: voice,
                  },
                }));
                break;

              case 'session.updated':
                // Session configured, now send the text to speak
                ws.send(JSON.stringify({
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'user',
                    content: [
                      {
                        type: 'input_text',
                        text: `Please say the following exactly: "${phrase}"`,
                      },
                    ],
                  },
                }));
                // Request a response
                ws.send(JSON.stringify({
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                  },
                }));
                break;

              case 'response.audio.delta':
                // Collect audio chunks (base64 encoded PCM16)
                if (event.delta) {
                  audioChunks.push(event.delta);
                }
                break;

              case 'response.audio.done':
                // Audio generation complete
                break;

              case 'response.done':
                // Full response complete, close and return
                clearTimeout(timeout);
                ws.close();

                if (audioChunks.length === 0) {
                  resolve({ success: false, error: 'No audio generated' });
                  return;
                }

                // Combine audio chunks (already base64)
                const combinedAudio = audioChunks.join('');

                resolve({
                  success: true,
                  output: {
                    audio: combinedAudio,
                    mimeType: 'audio/pcm;rate=24000',  // Realtime API returns PCM16 at 24kHz
                    voice: voice,
                    model: this.model,
                    characterCount: phrase.length,
                  },
                });
                break;

              case 'error':
                clearTimeout(timeout);
                ws.close();
                resolve({
                  success: false,
                  error: `Realtime API error: ${event.error?.message || JSON.stringify(event.error)}`,
                });
                break;
            }
          } catch (parseError) {
            // Ignore parse errors for non-JSON messages
          }
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            error: `WebSocket error: ${err.message}`,
          });
        });

        ws.on('close', (code, reason) => {
          clearTimeout(timeout);
          if (!sessionCreated) {
            resolve({
              success: false,
              error: `WebSocket closed before session created: ${code} ${reason}`,
            });
          }
        });
      } catch (error) {
        resolve({
          success: false,
          error: `Realtime TTS failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  }
}
