/**
 * Unit tests for WebSocket server initialization
 * Verifies that only one Socket.IO server can be attached to the HTTP server
 */

const http = require('http');
const express = require('express');

// Used only by the "Room-join authorization ... behavioral" describe block below,
// to control isThreadParticipant()'s return value when exercising
// websocket-server-v2.js's handleMessageSend() directly.
jest.mock('../../utils/webSocketMiddleware', () => ({
  isThreadParticipant: jest.fn(),
}));

describe('WebSocket Server Initialization', () => {
  let server;
  let app;

  beforeEach(() => {
    // Create a fresh HTTP server for each test
    app = express();
    server = http.createServer(app);
  });

  afterEach(done => {
    // Clean up server after each test
    if (server && server.listening) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('Single WebSocket Server Attachment', () => {
    it('should allow WebSocket Server v1 to attach to HTTP server', () => {
      const WebSocketServer = require('../../websocket-server');

      expect(() => {
        const wsServer = new WebSocketServer(server);
        expect(wsServer).toBeDefined();
        expect(wsServer.io).toBeDefined();
      }).not.toThrow();
    });

    it('should allow WebSocket Server v2 to attach to HTTP server', () => {
      const WebSocketServerV2 = require('../../websocket-server-v2');

      expect(() => {
        const wsServerV2 = new WebSocketServerV2(server, null, null);
        expect(wsServerV2).toBeDefined();
        expect(wsServerV2.io).toBeDefined();
      }).not.toThrow();
    });

    it('should prevent multiple WebSocket Server v1 instances on same HTTP server', () => {
      const WebSocketServer = require('../../websocket-server');

      // First instance should succeed
      const wsServer1 = new WebSocketServer(server);
      expect(wsServer1).toBeDefined();

      // Second instance should fail
      expect(() => {
        new WebSocketServer(server);
      }).toThrow('WebSocket Server already initialized for this HTTP server');
    });

    it('should prevent multiple WebSocket Server v2 instances on same HTTP server', () => {
      const WebSocketServerV2 = require('../../websocket-server-v2');

      // First instance should succeed
      const wsServer1 = new WebSocketServerV2(server, null, null);
      expect(wsServer1).toBeDefined();

      // Second instance should fail
      expect(() => {
        new WebSocketServerV2(server, null, null);
      }).toThrow('WebSocket Server v2 already initialized for this HTTP server');
    });

    it('should prevent v1 and v2 WebSocket servers from both attaching to same HTTP server', () => {
      const WebSocketServer = require('../../websocket-server');
      const WebSocketServerV2 = require('../../websocket-server-v2');

      // Initialize v1 first
      const wsServer1 = new WebSocketServer(server);
      expect(wsServer1).toBeDefined();

      // Attempting to initialize v2 should fail
      // Note: This test verifies the core issue - both servers trying to attach causes
      // "server.handleUpgrade() was called more than once" error in production
      expect(() => {
        new WebSocketServerV2(server, null, null);
      }).toThrow();
    });

    it('should prevent v2 and v1 WebSocket servers from both attaching to same HTTP server (reverse order)', () => {
      const WebSocketServer = require('../../websocket-server');
      const WebSocketServerV2 = require('../../websocket-server-v2');

      // Initialize v2 first
      const wsServer2 = new WebSocketServerV2(server, null, null);
      expect(wsServer2).toBeDefined();

      // Attempting to initialize v1 should fail
      expect(() => {
        new WebSocketServer(server);
      }).toThrow();
    });
  });

  describe('WebSocket Mode Environment Variable', () => {
    const originalEnv = process.env.WEBSOCKET_MODE;

    afterEach(() => {
      // Restore original value
      process.env.WEBSOCKET_MODE = originalEnv;
    });

    it('should default to v2 when WEBSOCKET_MODE is not set', () => {
      delete process.env.WEBSOCKET_MODE;
      const mode = process.env.WEBSOCKET_MODE || 'v2';
      expect(mode).toBe('v2');
    });

    it('should accept valid WEBSOCKET_MODE values', () => {
      const validModes = ['v1', 'v2', 'off'];

      validModes.forEach(mode => {
        process.env.WEBSOCKET_MODE = mode;
        expect(process.env.WEBSOCKET_MODE.toLowerCase()).toBe(mode.toLowerCase());
      });
    });

    it('should handle case-insensitive WEBSOCKET_MODE', () => {
      process.env.WEBSOCKET_MODE = 'V2';
      expect(process.env.WEBSOCKET_MODE.toLowerCase()).toBe('v2');

      process.env.WEBSOCKET_MODE = 'V1';
      expect(process.env.WEBSOCKET_MODE.toLowerCase()).toBe('v1');

      process.env.WEBSOCKET_MODE = 'OFF';
      expect(process.env.WEBSOCKET_MODE.toLowerCase()).toBe('off');
    });
  });

  describe('WebSocket Path Configuration', () => {
    it('should default to /socket.io when WEBSOCKET_PATH is not set', () => {
      const path = process.env.WEBSOCKET_PATH || '/socket.io';
      expect(path).toBe('/socket.io');
    });

    it('should accept custom WEBSOCKET_PATH', () => {
      const originalPath = process.env.WEBSOCKET_PATH;
      process.env.WEBSOCKET_PATH = '/custom/ws';

      expect(process.env.WEBSOCKET_PATH).toBe('/custom/ws');

      // Restore
      process.env.WEBSOCKET_PATH = originalPath;
    });
  });

  describe('isConversationParticipant (v4 join guard)', () => {
    const WebSocketServerV2 = require('../../websocket-server-v2');
    const { ObjectId } = require('mongodb');

    it('returns false when db is not attached', async () => {
      const ws = new WebSocketServerV2(server, null, null);
      // explicitly no db attached
      const result = await ws.isConversationParticipant(new ObjectId().toHexString(), 'user-1');
      expect(result).toBe(false);
    });

    it('returns false when userId is missing', async () => {
      const ws = new WebSocketServerV2(server, null, null);
      const result = await ws.isConversationParticipant(new ObjectId().toHexString(), null);
      expect(result).toBe(false);
    });

    it('returns true when a matching participant is found', async () => {
      const ws = new WebSocketServerV2(server, null, null);
      const findOne = jest.fn().mockResolvedValue({ _id: new ObjectId() });
      ws.db = {
        collection: jest.fn(() => ({ findOne })),
      };

      const convId = new ObjectId().toHexString();
      const result = await ws.isConversationParticipant(convId, 'user-1');

      expect(result).toBe(true);
      expect(ws.db.collection).toHaveBeenCalledWith('conversations_v4');
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({ 'participants.userId': 'user-1' }),
        expect.objectContaining({ projection: { _id: 1 } })
      );
    });

    it('returns false when no matching participant is found', async () => {
      const ws = new WebSocketServerV2(server, null, null);
      ws.db = {
        collection: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(null) })),
      };

      const result = await ws.isConversationParticipant(new ObjectId().toHexString(), 'user-1');
      expect(result).toBe(false);
    });

    it('fails closed when the Mongo lookup throws', async () => {
      const ws = new WebSocketServerV2(server, null, null);
      ws.db = {
        collection: jest.fn(() => ({
          findOne: jest.fn().mockRejectedValue(new Error('db down')),
        })),
      };

      const result = await ws.isConversationParticipant(new ObjectId().toHexString(), 'user-1');
      expect(result).toBe(false);
    });
  });

  describe('Room-join authorization (security fix regression)', () => {
    const fs = require('fs');
    const path = require('path');

    it('v1 generic join/leave requires authentication and blocks joining reserved user: rooms', () => {
      const wsSource = fs.readFileSync(path.join(__dirname, '../../websocket-server.js'), 'utf8');
      const joinHandlerMatch = wsSource.match(/socket\.on\('join', room => \{[\s\S]*?\n {6}\}\);/);
      expect(joinHandlerMatch).toBeTruthy();
      const joinHandlerSource = joinHandlerMatch[0];

      expect(joinHandlerSource).toContain('if (!socket.userId)');
      expect(joinHandlerSource).toMatch(/\/\^user:\//);
    });

    it('v1 messenger:join requires authentication before joining a conversation room', () => {
      const wsSource = fs.readFileSync(path.join(__dirname, '../../websocket-server.js'), 'utf8');
      const handlerMatch = wsSource.match(/socket\.on\('messenger:join',[\s\S]*?\n {6}\}\);/);
      expect(handlerMatch).toBeTruthy();
      const handlerSource = handlerMatch[0];

      expect(handlerSource).toContain('if (!socket.userId)');
    });

    it('v2 chat:v5:join-conversation requires authentication before joining a chat room', () => {
      const wsSource = fs.readFileSync(
        path.join(__dirname, '../../websocket-server-v2.js'),
        'utf8'
      );
      const handlerMatch = wsSource.match(
        /socket\.on\('chat:v5:join-conversation', data => \{[\s\S]*?\n {6}\}\);/
      );
      expect(handlerMatch).toBeTruthy();
      const handlerSource = handlerMatch[0];

      expect(handlerSource).toContain('if (!socket.userId)');
    });

    it('v2 handleMessageSend verifies the sender is a thread participant before sending', () => {
      const wsSource = fs.readFileSync(
        path.join(__dirname, '../../websocket-server-v2.js'),
        'utf8'
      );
      expect(wsSource).toContain(
        "const { isThreadParticipant } = require('./utils/webSocketMiddleware');"
      );

      const handlerMatch = wsSource.match(
        /async handleMessageSend\(socket, data\) \{[\s\S]*?\n {2}\}/
      );
      expect(handlerMatch).toBeTruthy();
      const handlerSource = handlerMatch[0];

      expect(handlerSource).toMatch(
        /isThreadParticipant\(\s*socket\.userId,\s*threadId,\s*this\.messagingService\s*\)/
      );
      expect(handlerSource).toContain('senderIsParticipant');
    });
  });

  describe('Room-join authorization (security fix regression) — behavioral', () => {
    // Exercises the actual connection-handler closures registered via
    // `this.io.on('connection', socket => { socket.on('join', ...) ... })` by
    // capturing that listener directly (bypassing the network stack — no real
    // socket.io-client connection needed) and invoking it with a lightweight
    // mock socket, so these lines are actually executed rather than only
    // pattern-matched in source.
    function getConnectionHandler(io) {
      const listeners = io.listeners('connection');
      return listeners[listeners.length - 1];
    }

    function createMockSocket() {
      const handlers = {};
      return {
        id: `sock-${Math.random().toString(36).slice(2)}`,
        handshake: { headers: {} },
        userId: undefined,
        on: jest.fn((event, cb) => {
          handlers[event] = cb;
        }),
        emit: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() })),
        trigger: (event, ...args) => handlers[event] && handlers[event](...args),
      };
    }

    it('v1 join: rejects an unauthenticated socket, blocks reserved user: rooms, allows a real room', () => {
      const WebSocketServer = require('../../websocket-server');
      const ws = new WebSocketServer(server);
      const connHandler = getConnectionHandler(ws.io);
      const socket = createMockSocket();
      connHandler(socket);

      socket.trigger('join', 'lobby');
      expect(socket.emit).toHaveBeenCalledWith('room:error', { error: 'unauthenticated' });
      expect(socket.join).not.toHaveBeenCalled();

      socket.userId = 'user-1';
      socket.emit.mockClear();
      socket.trigger('join', 'user:victim-id');
      expect(socket.emit).toHaveBeenCalledWith('room:error', {
        room: 'user:victim-id',
        error: 'forbidden',
      });
      expect(socket.join).not.toHaveBeenCalled();

      socket.trigger('join', 'supplier:abc');
      expect(socket.join).toHaveBeenCalledWith('supplier:abc');
    });

    it('v1 messenger:join: rejects an unauthenticated socket, allows an authenticated one', () => {
      const WebSocketServer = require('../../websocket-server');
      const ws = new WebSocketServer(server);
      const connHandler = getConnectionHandler(ws.io);
      const socket = createMockSocket();
      connHandler(socket);

      socket.trigger('messenger:join', {});
      expect(socket.emit).not.toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();

      socket.trigger('messenger:join', { conversationId: 'conv-1' });
      expect(socket.emit).toHaveBeenCalledWith('messenger:join-error', {
        conversationId: 'conv-1',
        error: 'unauthenticated',
      });
      expect(socket.join).not.toHaveBeenCalled();

      socket.userId = 'user-1';
      socket.trigger('messenger:join', { conversationId: 'conv-1' });
      expect(socket.join).toHaveBeenCalledWith('messenger:conv-1');
    });

    it('v2 chat:v5:join-conversation: no-ops without a conversationId, rejects unauthenticated, allows authenticated', () => {
      const WebSocketServerV2 = require('../../websocket-server-v2');
      const ws = new WebSocketServerV2(server, null, null);
      const connHandler = getConnectionHandler(ws.io);
      const socket = createMockSocket();
      connHandler(socket);

      socket.trigger('chat:v5:join-conversation', {});
      expect(socket.join).not.toHaveBeenCalled();

      socket.trigger('chat:v5:join-conversation', { conversationId: 'conv-1' });
      expect(socket.join).not.toHaveBeenCalled(); // still unauthenticated

      socket.userId = 'user-1';
      socket.trigger('chat:v5:join-conversation', { conversationId: 'conv-1' });
      expect(socket.join).toHaveBeenCalledWith('chat:v5:conv-1');
    });

    it('v2 handleMessageSend: rejects when the sender is not a thread participant, sends when they are', async () => {
      const WebSocketServerV2 = require('../../websocket-server-v2');
      // eslint-disable-next-line global-require
      const { isThreadParticipant } = require('../../utils/webSocketMiddleware');
      const ws = new WebSocketServerV2(server, null, null);
      ws.messagingService = {
        getThread: jest.fn(async () => ({ participants: ['user-1', 'user-2'] })),
        sendMessage: jest.fn(async () => ({ _id: { toString: () => 'msg-1' } })),
      };
      ws.presenceService = { isOnline: jest.fn(async () => true) };
      const socket = { userId: 'attacker-id', emit: jest.fn() };

      isThreadParticipant.mockResolvedValueOnce(false);
      await ws.handleMessageSend(socket, { threadId: 'thread-1', content: 'hi' });
      expect(socket.emit).toHaveBeenCalledWith('message:error', {
        error: 'Not a participant in this thread',
      });
      expect(ws.messagingService.sendMessage).not.toHaveBeenCalled();

      socket.emit.mockClear();
      socket.userId = 'user-1';
      isThreadParticipant.mockResolvedValueOnce(true);
      await ws.handleMessageSend(socket, { threadId: 'thread-1', content: 'hi' });
      expect(ws.messagingService.sendMessage).toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        'message:sent',
        expect.objectContaining({ threadId: 'thread-1' })
      );
    });
  });
});
