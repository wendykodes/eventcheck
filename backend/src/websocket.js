import { WebSocketServer } from 'ws';

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map();
  }

  initialize(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const userId = this.extractUserId(req);
      this.clients.set(userId, ws);

      console.log(`[WS] Client connected: ${userId}`);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(userId, message);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${userId}`);
        this.clients.delete(userId);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Error for client ${userId}:`, err);
      });

      // Send welcome message
      ws.send(JSON.stringify({ type: 'connected', userId }));
    });

    console.log('[WS] WebSocket server initialized');
  }

  extractUserId(req) {
    // Extract user ID from session or token
    // For now, use a simple approach
    return req.headers['user-id'] || 'anonymous';
  }

  handleMessage(userId, message) {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(userId, message.eventTypes);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(userId, message.eventTypes);
        break;
      case 'ping':
        this.sendToClient(userId, { type: 'pong' });
        break;
      default:
        console.log(`[WS] Unknown message type: ${message.type}`);
    }
  }

  handleSubscribe(userId, eventTypes) {
    const client = this.clients.get(userId);
    if (client) {
      client.subscriptions = client.subscriptions || [];
      eventTypes.forEach(type => {
        if (!client.subscriptions.includes(type)) {
          client.subscriptions.push(type);
        }
      });
      console.log(`[WS] Client ${userId} subscribed to:`, eventTypes);
    }
  }

  handleUnsubscribe(userId, eventTypes) {
    const client = this.clients.get(userId);
    if (client && client.subscriptions) {
      client.subscriptions = client.subscriptions.filter(
        type => !eventTypes.includes(type)
      );
      console.log(`[WS] Client ${userId} unsubscribed from:`, eventTypes);
    }
  }

  sendToClient(userId, data) {
    const client = this.clients.get(userId);
    if (client && client.readyState === 1) {
      client.send(JSON.stringify(data));
    }
  }

  broadcast(data, eventTypes = []) {
    this.clients.forEach((client, userId) => {
      if (client.readyState === 1) {
        if (eventTypes.length === 0 || 
            (client.subscriptions && 
             eventTypes.some(type => client.subscriptions.includes(type)))) {
          client.send(JSON.stringify(data));
        }
      }
    });
  }

  broadcastToEvent(eventId, data) {
    this.clients.forEach((client, userId) => {
      if (client.readyState === 1 && client.eventId === eventId) {
        client.send(JSON.stringify(data));
      }
    });
  }

  sendToRole(role, data) {
    this.clients.forEach((client, userId) => {
      if (client.readyState === 1 && client.role === role) {
        client.send(JSON.stringify(data));
      }
    });
  }
}

export default new WebSocketService();
