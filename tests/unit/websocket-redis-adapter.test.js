/**
 * Covers the Socket.IO Redis adapter wiring in websocket-server-v2.js: when
 * REDIS_URL is set and @socket.io/redis-adapter is installed, both the pub
 * client and its duplicated sub client must have an 'error' listener attached
 * (ioredis logs "[ioredis] Unhandled error event" straight to stderr for any
 * connection with none), so a connection blip routes through the app logger
 * instead of raw stderr.
 */

'use strict';

const http = require('http');

describe('WebSocket Server v2 Redis adapter error handling', () => {
  const originalEnv = process.env;
  let mockPubClient;
  let mockSubClient;
  let loggerMock;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, REDIS_URL: 'redis://redis.internal:6379' };

    mockSubClient = { on: jest.fn() };
    mockPubClient = {
      on: jest.fn(),
      duplicate: jest.fn(() => mockSubClient),
    };

    jest.doMock('ioredis', () => jest.fn().mockImplementation(() => mockPubClient));
    jest.doMock('@socket.io/redis-adapter', () => ({
      createAdapter: jest.fn(() => jest.fn()),
    }));

    loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    jest.doMock('../../utils/logger', () => loggerMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.dontMock('ioredis');
    jest.dontMock('@socket.io/redis-adapter');
    jest.dontMock('../../utils/logger');
  });

  it('attaches an error listener to the pub client at module load', () => {
    require('../../websocket-server-v2');

    expect(mockPubClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    const handler = mockPubClient.on.mock.calls.find(call => call[0] === 'error')[1];
    handler(new Error('connect ECONNREFUSED 10.0.0.1:6379'));

    expect(loggerMock.warn).toHaveBeenCalledWith('WebSocket Redis client error', {
      error: 'connect ECONNREFUSED 10.0.0.1:6379',
    });
  });

  it('attaches an error listener to the duplicated sub client on server init', () => {
    const WebSocketServerV2 = require('../../websocket-server-v2');
    const server = http.createServer();

    // eslint-disable-next-line no-new
    new WebSocketServerV2(server, null, null);

    expect(mockPubClient.duplicate).toHaveBeenCalled();
    expect(mockSubClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    const handler = mockSubClient.on.mock.calls.find(call => call[0] === 'error')[1];
    handler(new Error('connect ECONNREFUSED 10.0.0.1:6379'));

    expect(loggerMock.warn).toHaveBeenCalledWith('WebSocket Redis subscriber client error', {
      error: 'connect ECONNREFUSED 10.0.0.1:6379',
    });
  });
});
