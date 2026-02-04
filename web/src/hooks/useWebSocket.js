import { useEffect, useRef, useState } from 'react';

// Use relative WebSocket URL to go through Vite's proxy (works with port forwarding)
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const BACKEND_WS_URL = import.meta.env.VITE_WS_URL || `${wsProtocol}://${window.location.host}/ws`;

const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket({ onMessage, onOpen, onClose, onError }) {
  const [connectionState, setConnectionState] = useState('disconnected');
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const isMountedRef = useRef(true);

  // Store callbacks in refs to avoid reconnection on callback changes
  const callbacksRef = useRef({ onMessage, onOpen, onClose, onError });

  // Update callback refs via effect (not during render)
  useEffect(() => {
    callbacksRef.current = { onMessage, onOpen, onClose, onError };
  }, [onMessage, onOpen, onClose, onError]);

  // Single effect for WebSocket lifecycle
  useEffect(() => {
    isMountedRef.current = true;

    const connect = () => {
      // Don't connect if unmounted
      if (!isMountedRef.current) {
        return;
      }

      // Don't connect if already connected or connecting
      if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
        return;
      }

      // Don't spam reconnects
      if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[WebSocket] Max reconnection attempts reached.');
        setConnectionState('failed');
        return;
      }

      setConnectionState('connecting');

      try {
        const ws = new WebSocket(BACKEND_WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMountedRef.current) return;
          setConnectionState('connected');
          reconnectAttempts.current = 0;
          callbacksRef.current.onOpen?.();
        };

        ws.onmessage = (event) => {
          if (!isMountedRef.current) return;
          // Extract callback before try block (React Compiler compatibility)
          const onMessageCallback = callbacksRef.current.onMessage;
          try {
            const data = JSON.parse(event.data);
            if (onMessageCallback) onMessageCallback(data);
          } catch (error) {
            console.error('[WebSocket] Failed to parse message:', error);
          }
        };

        ws.onclose = () => {
          if (!isMountedRef.current) return;
          setConnectionState('disconnected');
          callbacksRef.current.onClose?.();

          // Attempt to reconnect with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;

          reconnectTimeoutRef.current = setTimeout(connect, delay);
        };

        ws.onerror = (error) => {
          if (!isMountedRef.current) return;
          callbacksRef.current.onError?.(error);
        };
      } catch (error) {
        console.error('[WebSocket] Failed to create connection:', error);
        setConnectionState('failed');
      }
    };

    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const sendMessage = (data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send - not connected');
    }
  };

  return {
    sendMessage,
    connectionState,
  };
}
