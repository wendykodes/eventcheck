import { useState, useEffect, useCallback, useRef } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5175';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const messageQueueRef = useRef([]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        // Send queued messages
        while (messageQueueRef.current.length > 0) {
          const msg = messageQueueRef.current.shift();
          ws.send(JSON.stringify(msg));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, data]);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    } catch (err) {
      console.error('Failed to connect to WebSocket:', err);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const send = useCallback((data) => {
    const message = JSON.stringify(data);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(message);
    } else {
      messageQueueRef.current.push(data);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    connected,
    messages,
    send,
    clearMessages,
    disconnect
  };
}

// Hook for subscribing to specific event types
export function useRealtimeUpdates(eventTypes = []) {
  const { connected, messages, send, clearMessages } = useWebSocket();
  const [filteredMessages, setFilteredMessages] = useState([]);

  useEffect(() => {
    if (eventTypes.length === 0) {
      setFilteredMessages(messages);
    } else {
      setFilteredMessages(messages.filter(msg => eventTypes.includes(msg.type)));
    }
  }, [messages, eventTypes]);

  const subscribe = useCallback((eventTypes) => {
    send({ type: 'subscribe', eventTypes });
  }, [send]);

  const unsubscribe = useCallback((eventTypes) => {
    send({ type: 'unsubscribe', eventTypes });
  }, [send]);

  useEffect(() => {
    if (connected && eventTypes.length > 0) {
      subscribe(eventTypes);
    }
    return () => {
      if (connected && eventTypes.length > 0) {
        unsubscribe(eventTypes);
      }
    };
  }, [connected, eventTypes, subscribe, unsubscribe]);

  return {
    connected,
    messages: filteredMessages,
    clearMessages
  };
}
