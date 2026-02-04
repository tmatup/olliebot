import { WebSocketServer, WebSocket } from 'ws';

export interface VoiceProxyConfig {
  voiceProvider?: 'openai' | 'azure_openai';
  voiceModel?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiApiVersion?: string;
  openaiApiKey?: string;
}

interface UpstreamConnection {
  ws: WebSocket;
  isOpen: boolean;
  sessionReady: boolean;
  pendingMessages: string[];
}

/**
 * Sets up the voice WebSocket proxy for real-time transcription.
 * Keeps connections alive for low-latency voice input.
 */
export function setupVoiceProxy(voiceWss: WebSocketServer, config: VoiceProxyConfig): void {
  const {
    voiceProvider,
    voiceModel,
    azureOpenaiApiKey,
    azureOpenaiEndpoint,
    azureOpenaiApiVersion,
    openaiApiKey,
  } = config;

  // Build upstream URL and headers once
  let upstreamUrl: string;
  let upstreamHeaders: Record<string, string>;

  if (voiceProvider === 'azure_openai') {
    if (!azureOpenaiApiKey || !azureOpenaiEndpoint) {
      console.error('[Voice] Azure OpenAI credentials not configured');
      return;
    }
    const endpoint = azureOpenaiEndpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiVersion = azureOpenaiApiVersion || '2024-10-01-preview';
    upstreamUrl = `wss://${endpoint}/openai/realtime?api-version=${apiVersion}&deployment=${voiceModel}`;
    upstreamHeaders = { 'api-key': azureOpenaiApiKey };
  } else {
    if (!openaiApiKey) {
      console.error('[Voice] OpenAI API key not configured');
      return;
    }
    upstreamUrl = `wss://api.openai.com/v1/realtime?model=${voiceModel}`;
    upstreamHeaders = {
      'Authorization': `Bearer ${openaiApiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    };
  }

  voiceWss.on('error', (error) => {
    console.error('[Voice WebSocket] Server error:', error);
  });

  voiceWss.on('connection', (clientWs) => {
    console.log('[Voice] Client connected');

    let upstream: UpstreamConnection | null = null;

    // Function to connect to upstream
    const connectUpstream = () => {
      if (upstream && (upstream.isOpen || upstream.ws.readyState === WebSocket.CONNECTING)) {
        console.log('[Voice] Upstream already connected or connecting');
        // If session is already ready, notify client immediately
        if (upstream.sessionReady) {
          clientWs.send(JSON.stringify({ type: 'session.ready' }));
        }
        return;
      }

      console.log(`[Voice] Connecting to upstream: ${upstreamUrl}`);

      const upstreamWs = new WebSocket(upstreamUrl, { headers: upstreamHeaders });
      upstream = {
        ws: upstreamWs,
        isOpen: false,
        sessionReady: false,
        pendingMessages: [],
      };

      // Capture HTTP upgrade response for debugging
      upstreamWs.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          console.error(`[Voice] Upstream HTTP ${res.statusCode}: ${res.statusMessage}`);
          console.error(`[Voice] Response headers:`, JSON.stringify(res.headers, null, 2));
          console.error(`[Voice] Response body:`, body);
          clientWs.send(JSON.stringify({
            type: 'error',
            error: { message: `Upstream error: ${res.statusCode} ${res.statusMessage}`, body }
          }));
          // Reset upstream so future connection attempts can proceed
          upstream = null;
        });
      });

      upstreamWs.on('open', () => {
        console.log('[Voice] Connected to upstream');
        if (upstream) {
          upstream.isOpen = true;
        }

        // Send session configuration for transcription-only mode
        const sessionConfig = {
          type: 'session.update',
          session: {
            modalities: ['text'],
            input_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        };
        upstreamWs.send(JSON.stringify(sessionConfig));

        // Flush pending messages
        if (upstream) {
          for (const msg of upstream.pendingMessages) {
            upstreamWs.send(msg);
          }
          upstream.pendingMessages = [];
        }
      });

      upstreamWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Mark session as ready
          if (msg.type === 'session.created' || msg.type === 'session.updated') {
            console.log('[Voice] Session ready');
            if (upstream) {
              upstream.sessionReady = true;
            }
          }

          // Forward relevant events to client
          const relevantEvents = [
            'session.created',
            'session.updated',
            'conversation.item.input_audio_transcription.completed',
            'input_audio_buffer.speech_started',
            'input_audio_buffer.speech_stopped',
            'input_audio_buffer.committed',
            'response.audio_transcript.delta',
            'response.audio_transcript.done',
            'error',
          ];

          if (relevantEvents.includes(msg.type)) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(msg));
            }
          }
        } catch {
          // Forward raw if not JSON
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
          }
        }
      });

      upstreamWs.on('error', (error) => {
        console.error('[Voice] Upstream error:', error.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', error: { message: error.message } }));
        }
      });

      upstreamWs.on('close', (code, reason) => {
        console.log(`[Voice] Upstream closed: ${code} ${reason}`);
        upstream = null;
      });
    };

    // Handle messages from client
    clientWs.on('message', (data) => {
      const msgStr = data.toString();

      try {
        const msg = JSON.parse(msgStr);

        // Handle control messages
        if (msg.type === 'voice.prepare') {
          // Pre-connect to upstream (called on hover)
          console.log('[Voice] Received prepare signal, pre-connecting...');
          connectUpstream();
          return;
        }

        if (msg.type === 'voice.start') {
          // Ensure upstream is connected
          console.log('[Voice] Received start signal');
          connectUpstream();
          return;
        }

        if (msg.type === 'voice.stop') {
          // Clear the audio buffer for next session
          console.log('[Voice] Received stop signal');
          if (upstream?.isOpen && upstream.ws.readyState === WebSocket.OPEN) {
            upstream.ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
          }
          return;
        }
      } catch {
        // Not JSON, continue to forward as audio data
      }

      // Forward to upstream
      if (upstream?.isOpen && upstream.ws.readyState === WebSocket.OPEN) {
        upstream.ws.send(msgStr);
      } else if (upstream) {
        upstream.pendingMessages.push(msgStr);
      }
    });

    clientWs.on('close', () => {
      console.log('[Voice] Client disconnected');
      // Close upstream when client disconnects
      if (upstream?.ws.readyState === WebSocket.OPEN) {
        upstream.ws.close();
      }
      upstream = null;
    });

    clientWs.on('error', (error) => {
      console.error('[Voice] Client error:', error.message);
    });
  });

  console.log('[Voice] WebSocket proxy initialized');
}
