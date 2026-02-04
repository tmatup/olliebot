import { WebSocketServer, WebSocket } from 'ws';

export interface VoiceProxyConfig {
  voiceProvider?: 'openai' | 'azure_openai';
  voiceModel?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiApiVersion?: string;
  openaiApiKey?: string;
}

/**
 * Sets up the voice WebSocket proxy for real-time transcription.
 * Proxies connections from clients to OpenAI/Azure OpenAI Realtime API.
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

  voiceWss.on('error', (error) => {
    console.error('[Voice WebSocket] Server error:', error);
  });

  voiceWss.on('connection', (clientWs) => {
    console.log('[Voice] Client connected');

    // Determine the upstream URL based on provider
    let upstreamUrl: string;
    let headers: Record<string, string>;

    if (voiceProvider === 'azure_openai') {
      if (!azureOpenaiApiKey || !azureOpenaiEndpoint) {
        console.error('[Voice] Azure OpenAI credentials not configured');
        clientWs.close(1008, 'Azure OpenAI not configured');
        return;
      }
      // Azure OpenAI Realtime API URL
      // Format: wss://{endpoint}/openai/realtime?api-version={version}&deployment={model}
      const endpoint = azureOpenaiEndpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const apiVersion = azureOpenaiApiVersion || '2024-10-01-preview';
      upstreamUrl = `wss://${endpoint}/openai/realtime?api-version=${apiVersion}&deployment=${voiceModel}`;
      headers = {
        'api-key': azureOpenaiApiKey,
      };
    } else {
      // OpenAI Realtime API
      if (!openaiApiKey) {
        console.error('[Voice] OpenAI API key not configured');
        clientWs.close(1008, 'OpenAI not configured');
        return;
      }
      upstreamUrl = `wss://api.openai.com/v1/realtime?model=${voiceModel}`;
      headers = {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      };
    }

    console.log(`[Voice] Connecting to upstream: ${upstreamUrl.split('?')[0]}`);

    // Connect to upstream OpenAI/Azure Realtime API
    const upstreamWs = new WebSocket(upstreamUrl, { headers });

    let isUpstreamOpen = false;
    const pendingMessages: string[] = [];

    upstreamWs.on('open', () => {
      console.log('[Voice] Connected to upstream');
      isUpstreamOpen = true;

      // Send session configuration for transcription-only mode
      const sessionConfig = {
        type: 'session.update',
        session: {
          modalities: ['text'], // Text output only (transcription)
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
      for (const msg of pendingMessages) {
        upstreamWs.send(msg);
      }
      pendingMessages.length = 0;
    });

    upstreamWs.on('message', (data) => {
      // Forward messages from upstream to client
      try {
        const msg = JSON.parse(data.toString());

        // Forward relevant events to client
        // - session.created, session.updated: Session state
        // - conversation.item.input_audio_transcription.completed: Final transcription
        // - input_audio_buffer.speech_started/stopped: VAD events
        // - response.audio_transcript.delta/done: Streaming transcription
        // - error: Error messages
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
          clientWs.send(JSON.stringify(msg));
        }
      } catch {
        // Forward raw if not JSON
        clientWs.send(data);
      }
    });

    upstreamWs.on('error', (error) => {
      console.error('[Voice] Upstream error:', error.message);
      clientWs.send(JSON.stringify({ type: 'error', error: { message: error.message } }));
    });

    upstreamWs.on('close', (code, reason) => {
      console.log(`[Voice] Upstream closed: ${code} ${reason}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reason.toString());
      }
    });

    // Handle messages from client
    clientWs.on('message', (data) => {
      const msg = data.toString();
      if (isUpstreamOpen) {
        upstreamWs.send(msg);
      } else {
        pendingMessages.push(msg);
      }
    });

    clientWs.on('close', () => {
      console.log('[Voice] Client disconnected');
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.close();
      }
    });

    clientWs.on('error', (error) => {
      console.error('[Voice] Client error:', error.message);
    });
  });

  console.log('[Voice] WebSocket proxy initialized');
}
