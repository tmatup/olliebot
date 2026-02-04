import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Hook for voice-to-text using OpenAI's Realtime API via WebSocket proxy.
 *
 * @param {Object} options
 * @param {function} options.onTranscript - Called with transcript text as it streams
 * @param {function} options.onFinalTranscript - Called when transcription is complete
 * @param {function} options.onError - Called when an error occurs
 * @returns {Object} - { isRecording, isConnecting, startRecording, stopRecording, transcript }
 */
export function useVoiceToText({ onTranscript, onFinalTranscript, onError } = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState('');

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);
  const accumulatedTranscriptRef = useRef('');

  // Cleanup function
  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Audio capture helper - defined before startRecording to avoid hoisting issues
  const startAudioCapture = useCallback((audioContext, stream, ws) => {
    const source = audioContext.createMediaStreamSource(stream);

    // Create script processor for raw PCM data
    // Using 4096 buffer size for ~170ms chunks at 24kHz
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;

      const inputData = event.inputBuffer.getChannelData(0);

      // Convert Float32 to Int16 PCM
      const pcm16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Convert to base64 and send
      const base64 = btoa(
        String.fromCharCode.apply(null, new Uint8Array(pcm16.buffer))
      );

      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      }));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || isConnecting) return;

    setIsConnecting(true);
    setTranscript('');
    accumulatedTranscriptRef.current = '';

    // Compute WebSocket URL before try block to avoid React Compiler issues
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname;
    const wsPort = import.meta.env.VITE_WS_PORT || window.location.port || '5173';
    const wsUrl = `${wsProtocol}//${wsHost}:${wsPort}/voice`;

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Create audio context for processing
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      // Connect to voice WebSocket proxy
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Voice] WebSocket connected');
      };

      ws.onmessage = (event) => {
        // Parse message outside of conditional logic to satisfy React Compiler
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          console.error('[Voice] Failed to parse message:', e);
          return;
        }

        // Handle message types
        switch (msg.type) {
          case 'session.created':
          case 'session.updated':
            console.log('[Voice] Session ready');
            setIsConnecting(false);
            setIsRecording(true);
            // Start sending audio after session is ready
            startAudioCapture(audioContext, stream, ws);
            break;

          case 'conversation.item.input_audio_transcription.completed':
            // Final transcription for a speech segment
            if (msg.transcript) {
              const separator = accumulatedTranscriptRef.current ? ' ' : '';
              const newTranscript = accumulatedTranscriptRef.current + separator + msg.transcript;
              accumulatedTranscriptRef.current = newTranscript;
              setTranscript(newTranscript);
              if (onTranscript) onTranscript(newTranscript);
            }
            break;

          case 'response.audio_transcript.delta':
            // Streaming transcript delta
            if (msg.delta) {
              const newTranscript = accumulatedTranscriptRef.current + msg.delta;
              setTranscript(newTranscript);
              if (onTranscript) onTranscript(newTranscript);
            }
            break;

          case 'response.audio_transcript.done':
            // Transcript segment complete
            if (msg.transcript) {
              accumulatedTranscriptRef.current = msg.transcript;
              setTranscript(msg.transcript);
              if (onTranscript) onTranscript(msg.transcript);
            }
            break;

          case 'input_audio_buffer.speech_started':
            console.log('[Voice] Speech started');
            break;

          case 'input_audio_buffer.speech_stopped':
            console.log('[Voice] Speech stopped');
            break;

          case 'error': {
            console.error('[Voice] Error:', msg.error);
            const errorMsg = (msg.error && msg.error.message) ? msg.error.message : 'Voice error';
            if (onError) onError(errorMsg);
            break;
          }
        }
      };

      ws.onerror = (error) => {
        console.error('[Voice] WebSocket error:', error);
        onError?.('Connection error');
        cleanup();
        setIsConnecting(false);
        setIsRecording(false);
      };

      ws.onclose = () => {
        console.log('[Voice] WebSocket closed');
        setIsRecording(false);
        setIsConnecting(false);
      };

    } catch (error) {
      console.error('[Voice] Failed to start recording:', error);
      onError?.(error.message || 'Failed to access microphone');
      cleanup();
      setIsConnecting(false);
      setIsRecording(false);
    }
  }, [isRecording, isConnecting, cleanup, onTranscript, onError, startAudioCapture]);

  const stopRecording = useCallback(() => {
    if (!isRecording && !isConnecting) return;

    // Commit any remaining audio before closing
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    }

    // Get final transcript before cleanup
    const finalTranscript = accumulatedTranscriptRef.current;

    cleanup();
    setIsRecording(false);
    setIsConnecting(false);

    // Call final transcript callback
    if (finalTranscript) {
      onFinalTranscript?.(finalTranscript);
    }

    return finalTranscript;
  }, [isRecording, isConnecting, cleanup, onFinalTranscript]);

  return {
    isRecording,
    isConnecting,
    startRecording,
    stopRecording,
    transcript,
  };
}
