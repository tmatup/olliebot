import { useEffect, useRef, useState, useCallback } from 'react';

// Use relative WebSocket URL to go through Vite's proxy (works with port forwarding)
const BACKEND_WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws`;

export function useWebSocket({ onMessage, onOpen, onClose, onError }) {
  const [connectionState, setConnectionState] = useState('disconnected');
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const isMountedRef = useRef(true);
  const maxReconnectAttempts = 10;

  // Store callbacks in refs to avoid reconnection on callback changes
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
    onErrorRef.current = onError;
  }, [onMessage, onOpen, onClose, onError]);

  const connect = useCallback(() => {
    // Connect directly to backend WebSocket server
    const wsUrl = BACKEND_WS_URL;

    // Don't connect if unmounted
    if (!isMountedRef.current) {
      return;
    }

    // Don't connect if already connected or connecting
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    // Don't spam reconnects
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached.');
      setConnectionState('failed');
      return;
    }

    setConnectionState('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setConnectionState('connected');
        reconnectAttempts.current = 0;
        onOpenRef.current?.();
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setConnectionState('disconnected');
        onCloseRef.current?.();

        // Attempt to reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = (error) => {
        if (!isMountedRef.current) return;
        onErrorRef.current?.(error);
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      setConnectionState('failed');
    }
  }, []); // No dependencies - callbacks are accessed via refs

  useEffect(() => {
    isMountedRef.current = true;
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
  }, [connect]);

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
