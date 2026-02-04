import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for voice-to-text using OpenAI's Realtime API via WebSocket proxy.
 * Keeps WebSocket connection alive for low-latency voice input.
 */
export function useVoiceToText({ onTranscript, onFinalTranscript, onError } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isWsConnected, setIsWsConnected] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const streamRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');
  const sessionReadyRef = useRef(false);
  const audioBufferRef = useRef([]);
  const pendingStopRef = useRef(false);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectDelayRef = useRef(2000); // Start with 2s delay
  const workletLoadedRef = useRef(false);

  // Callback refs to avoid stale closures
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
    onTranscriptRef.current = onTranscript;
    onErrorRef.current = onError;
  }, [onFinalTranscript, onTranscript, onError]);

  // Cleanup audio processing resources (keep mic stream alive for fast re-recording)
  const cleanupAudio = useCallback(() => {
    sessionReadyRef.current = false;
    audioBufferRef.current = [];
    pendingStopRef.current = false;

    if (processorRef.current) {
      processorRef.current.port.onmessage = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    // Keep streamRef.current alive for fast subsequent recordings
  }, []);

  // Compute WebSocket URL (use same origin - Vite proxies /voice to backend)
  const getWsUrl = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//localhost:3000/voice`;
  }, []);

  // Handle incoming WebSocket messages
  const handleWsMessage = useCallback((event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error('[Voice] Failed to parse message:', e);
      return;
    }

    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
      case 'session.ready': {
        console.log('[Voice] Session ready, flushing', audioBufferRef.current.length, 'buffered audio chunks');
        sessionReadyRef.current = true;

        // Flush buffered audio
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (const audioMsg of audioBufferRef.current) {
            ws.send(audioMsg);
          }
        }
        audioBufferRef.current = [];

        // If user already released button, complete the stop now
        if (pendingStopRef.current) {
          console.log('[Voice] Completing pending stop after flush');
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            ws.send(JSON.stringify({ type: 'voice.stop' }));
          }
          const finalTranscript = accumulatedTranscriptRef.current;
          cleanupAudio();
          setIsRecording(false);
          setIsConnecting(false);
          setIsFlushing(false);
          pendingStopRef.current = false;
          onFinalTranscriptRef.current?.(finalTranscript);
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        if (msg.transcript) {
          const separator = accumulatedTranscriptRef.current ? ' ' : '';
          const newTranscript = accumulatedTranscriptRef.current + separator + msg.transcript;
          accumulatedTranscriptRef.current = newTranscript;
          setTranscript(newTranscript);
          onTranscriptRef.current?.(newTranscript);
        }
        break;
      }

      case 'response.audio_transcript.delta': {
        if (msg.delta) {
          const newTranscript = accumulatedTranscriptRef.current + msg.delta;
          setTranscript(newTranscript);
          onTranscriptRef.current?.(newTranscript);
        }
        break;
      }

      case 'response.audio_transcript.done': {
        if (msg.transcript) {
          accumulatedTranscriptRef.current = msg.transcript;
          setTranscript(msg.transcript);
          onTranscriptRef.current?.(msg.transcript);
        }
        break;
      }

      case 'input_audio_buffer.speech_started':
        console.log('[Voice] Speech started');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Voice] Speech stopped');
        break;

      case 'error': {
        console.error('[Voice] Error:', msg.error);
        const errorMsg = (msg.error && msg.error.message) ? msg.error.message : 'Voice error';
        onErrorRef.current?.(errorMsg);
        break;
      }
    }
  }, [cleanupAudio]);

  // Connect WebSocket on mount, reconnect on close
  useEffect(() => {
    let mounted = true;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const INITIAL_RECONNECT_DELAY = 2000; // 2s
    const MAX_RECONNECT_DELAY = 30000; // 30s

    const connect = () => {
      if (!mounted) return;
      // Don't create new connection if one already exists and is usable
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        return;
      }

      const wsUrl = getWsUrl();
      console.log('[Voice] Connecting to backend:', wsUrl,
        `(attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Voice] Backend WebSocket connected');
        // Reset reconnect state on successful connection
        reconnectAttemptsRef.current = 0;
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        if (mounted) setIsWsConnected(true);
      };

      ws.onmessage = handleWsMessage;

      ws.onerror = (error) => {
        console.error('[Voice] WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('[Voice] Backend WebSocket closed');
        if (mounted) {
          setIsWsConnected(false);
          wsRef.current = null;

          // Check if we've exceeded max reconnect attempts
          if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
            console.warn('[Voice] Max reconnection attempts reached. Voice feature unavailable.');
            onErrorRef.current?.('Voice service unavailable. Please check server configuration.');
            return;
          }

          // Exponential backoff with jitter
          const delay = Math.min(
            reconnectDelayRef.current * (1 + Math.random() * 0.3), // Add 0-30% jitter
            MAX_RECONNECT_DELAY
          );

          console.log(`[Voice] Reconnecting in ${Math.round(delay / 1000)}s...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current += 1;
            reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, MAX_RECONNECT_DELAY);
            connect();
          }, delay);
        }
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        // Remove handlers before closing to prevent errors
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      // Release microphone on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [getWsUrl, handleWsMessage]);

  // Audio capture helper using AudioWorklet
  const startAudioCapture = useCallback(async (audioContext, stream) => {
    // Load AudioWorklet processor if not already loaded
    if (!workletLoadedRef.current) {
      try {
        await audioContext.audioWorklet.addModule('/src/worklets/pcm-processor.js');
        workletLoadedRef.current = true;
        console.log('[Voice] AudioWorklet processor loaded');
      } catch (error) {
        console.error('[Voice] Failed to load AudioWorklet processor:', error);
        onErrorRef.current?.('Failed to initialize audio processor');
        return;
      }
    }

    const source = audioContext.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(audioContext, 'pcm-processor');

    sourceRef.current = source;
    processorRef.current = processor;

    // Handle messages from the AudioWorklet processor
    processor.port.onmessage = (event) => {
      // Guard: ignore messages if processor was cleaned up
      if (!processorRef.current) return;

      const pcm16Buffer = event.data; // ArrayBuffer from worklet

      // Convert to base64
      const bytes = new Uint8Array(pcm16Buffer);
      const base64 = btoa(
        Array.from(bytes, byte => String.fromCharCode(byte)).join('')
      );

      const audioMessage = JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      });

      // Buffer audio until session is ready, then send directly
      const ws = wsRef.current;
      if (sessionReadyRef.current && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(audioMessage);
      } else {
        audioBufferRef.current.push(audioMessage);
      }
    };

    // Connect the audio graph (no output to destination to avoid feedback)
    source.connect(processor);
  }, []);

  // Pre-acquire microphone and prepare upstream connection (call on hover)
  const prepareRecording = useCallback(async () => {
    // Pre-connect upstream
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[Voice] Sending prepare signal');
      ws.send(JSON.stringify({ type: 'voice.prepare' }));
    }

    // Pre-acquire microphone (if not already acquired)
    if (!streamRef.current) {
      try {
        console.log('[Voice] Pre-acquiring microphone...');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;
        console.log('[Voice] Microphone pre-acquired');
      } catch (error) {
        console.error('[Voice] Failed to pre-acquire microphone:', error);
      }
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (isRecording || isConnecting) return;

    setTranscript('');
    accumulatedTranscriptRef.current = '';
    sessionReadyRef.current = false;
    audioBufferRef.current = [];
    pendingStopRef.current = false;

    // Ensure WebSocket is connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[Voice] WebSocket not connected');
      onErrorRef.current?.('Voice connection not ready');
      return;
    }

    try {
      // Use pre-acquired stream or request new one
      let stream = streamRef.current;
      if (!stream) {
        setIsConnecting(true);
        console.log('[Voice] Acquiring microphone (not pre-acquired)...');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;
        setIsConnecting(false);
      }

      // Show "Listening..." immediately (stream is ready)
      setIsRecording(true);

      // Send start signal to trigger upstream connection
      wsRef.current.send(JSON.stringify({ type: 'voice.start' }));

      // Create audio context and start capturing
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;
      await startAudioCapture(audioContext, stream);

    } catch (error) {
      console.error('[Voice] Failed to start recording:', error);
      onErrorRef.current?.(error.message || 'Failed to access microphone');
      cleanupAudio();
      setIsConnecting(false);
      setIsRecording(false);
    }
  }, [isRecording, isConnecting, cleanupAudio, startAudioCapture]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording && !isConnecting) return;

    // If session not ready yet, mark pending stop and wait for flush
    if (!sessionReadyRef.current) {
      console.log('[Voice] Session not ready, marking pending stop');
      pendingStopRef.current = true;
      setIsFlushing(true);
      setIsRecording(false);
      return;
    }

    // Session is ready, do immediate stop
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      ws.send(JSON.stringify({ type: 'voice.stop' }));
    }

    const finalTranscript = accumulatedTranscriptRef.current;

    cleanupAudio();
    setIsRecording(false);
    setIsConnecting(false);
    setIsFlushing(false);

    onFinalTranscriptRef.current?.(finalTranscript);

    return finalTranscript;
  }, [isRecording, isConnecting, cleanupAudio]);

  // Release microphone and cleanup (call when turning voice mode OFF)
  const releaseRecording = useCallback(() => {
    console.log('[Voice] Releasing microphone');
    cleanupAudio();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setIsConnecting(false);
    setIsFlushing(false);
  }, [cleanupAudio]);

  return {
    isRecording,
    isConnecting,
    isFlushing,
    isWsConnected,
    startRecording,
    stopRecording,
    prepareRecording,
    releaseRecording,
    transcript,
  };
}
