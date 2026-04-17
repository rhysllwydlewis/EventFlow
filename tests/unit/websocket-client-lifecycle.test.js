'use strict';

const path = require('path');

describe('WebSocketClient lifecycle callbacks', () => {
  let WebSocketClient;
  let handlers;
  let socket;

  beforeEach(() => {
    jest.resetModules();
    handlers = {};
    socket = {
      on: jest.fn((event, cb) => {
        handlers[event] = cb;
      }),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    global.window = {
      location: { hostname: 'example.com', protocol: 'https:', host: 'example.com' },
      __authState: { getUser: () => ({ id: 'user-1' }) },
    };
    global.document = {
      createElement: jest.fn(() => ({
        addEventListener: jest.fn(),
        set src(_val) {},
      })),
      head: { appendChild: jest.fn() },
    };
    global.localStorage = {
      getItem: jest.fn(() => null),
    };
    global.io = jest.fn(() => socket);

    // eslint-disable-next-line global-require
    WebSocketClient = require(
      path.resolve(__dirname, '../../public/assets/js/websocket-client.js')
    );
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.io;
    jest.restoreAllMocks();
  });

  it('fires connect/disconnect/connect lifecycle callbacks with correct reconnect metadata', () => {
    const order = [];
    const client = new WebSocketClient({
      onConnect: ({ isReconnect } = {}) => order.push(`connect:${isReconnect ? 're' : 'first'}`),
      onDisconnect: reason => order.push(`disconnect:${reason}`),
      onReconnect: () => order.push('onReconnect'),
    });

    client.attemptReconnect = jest.fn();

    handlers.connect();
    handlers.disconnect('transport close');
    client.reconnectAttempts = 1;
    handlers.connect();

    expect(client.attemptReconnect).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'connect:first',
      'disconnect:transport close',
      'connect:re',
      'onReconnect',
    ]);
  });
});
