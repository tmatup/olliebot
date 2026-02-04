import { useEffect, useRef, useState, useCallback } from 'react';

// Determine WebSocket URL:
// - If VITE_WS_URL is set, use it (for custom deployments)
// - If VITE_USE_WS_PROXY=true, use Vite's proxy (for remote dev / single-port scenarios)
// - In development, connect to same origin (port 5173)
// - Otherwise use relative URL (production build served from same origin)
const getWebSocketUrl = () => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // Use Vite proxy if explicitly enabled (useful for remote dev with single port forwarding)
  if (import.meta.env.VITE_USE_WS_PROXY === 'true') {
    return `${wsProtocol}://${window.location.host}/ws`;
  }
  // In Vite dev server (port 5173), connect to same origin
  if (window.location.port === '5173') {
    return `${wsProtocol}://${window.location.hostname}:5173`;
  }
  // Production: same origin
  return `${wsProtocol}://${window.location.host}`;
};
const BACKEND_WS_URL = getWebSocketUrl();

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

  const sendMessage = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] Cannot send - not connected');
    }
  }, []);

  return {
    sendMessage,
    connectionState,
  };
}
