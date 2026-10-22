/**
 * How live updates behave when the connection is not perfect (Socket.IO against the real
 * WebSocketServerV2, no Redis):
 *
 *  - the server restarts while a page is open: the client reconnects, signs in again on its own
 *    ('connect' fires on every reconnect) and gets events again;
 *  - an expired or forged token never joins the user's room;
 *  - a client that can only use long polling (a proxy that blocks WebSockets) still gets events;
 *  - an event is delivered once even though the page registers its handler once per connection.
 *
 * @jest-environment node
 */
'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: connect } = require('socket.io-client');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'reconnect-test-secret-32-characters-long!!';
delete process.env.REDIS_URL;

const WebSocketServerV2 = require('../../websocket-server-v2');

const tokenFor = (userId, options) => jwt.sign({ id: userId }, process.env.JWT_SECRET, options);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startServer(port = 0) {
  const httpServer = http.createServer();
  await new Promise(resolve => httpServer.listen(port, '127.0.0.1', resolve));
  const ws = new WebSocketServerV2(httpServer);
  return { httpServer, ws, port: httpServer.address().port };
}

async function stopServer({ httpServer, ws }) {
  await new Promise(resolve => ws.io.close(() => resolve()));
  if (httpServer.listening) {
    await new Promise(resolve => httpServer.close(() => resolve()));
  }
}

/** A client that signs in on every connect, the way the messenger widget does. */
function widgetLikeClient(port, token, options = {}) {
  const socket = connect(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnectionDelay: 50,
    reconnectionDelayMax: 100,
    ...options,
  });
  socket.authenticated = 0;
  socket.on('connect', () => socket.emit('auth', { token }));
  socket.on('auth:success', () => {
    socket.authenticated += 1;
  });
  return socket;
}

const until = async (check, label, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await wait(25);
  }
  throw new Error(`timed out waiting for ${label}`);
};

describe('live updates over an imperfect connection', () => {
  const open = [];
  afterEach(async () => {
    open.splice(0).forEach(socket => socket.close());
  });

  it('reconnects after a server restart, signs in again and receives events', async () => {
    let server = await startServer();
    const { port } = server;
    const client = widgetLikeClient(port, tokenFor('user-r1'));
    open.push(client);
    await until(() => client.authenticated === 1, 'first sign-in');

    await stopServer(server);
    await until(() => !client.connected, 'the disconnect');

    server = await startServer(port);
    try {
      await until(() => client.authenticated === 2, 'sign-in after the restart');
      const heard = [];
      client.on('notification:new', data => heard.push(data));
      server.ws.emitToUser('user-r1', 'notification:new', { id: 'after-restart' });
      await until(() => heard.length === 1, 'an event after the restart');
      expect(heard).toEqual([{ id: 'after-restart' }]);
    } finally {
      client.close();
      await stopServer(server);
    }
  });

  it('does not put an expired or forged token in the user room', async () => {
    const server = await startServer();
    try {
      const expired = widgetLikeClient(server.port, tokenFor('user-r2', { expiresIn: -10 }));
      const forged = widgetLikeClient(
        server.port,
        jwt.sign({ id: 'user-r2' }, 'some-other-secret-that-is-long-enough')
      );
      open.push(expired, forged);
      const errors = [];
      expired.on('auth:error', e => errors.push(e.error));
      forged.on('auth:error', e => errors.push(e.error));
      const heard = [];
      expired.on('notification:new', d => heard.push(d));
      forged.on('notification:new', d => heard.push(d));

      await until(() => errors.length === 2, 'both refusals');
      server.ws.emitToUser('user-r2', 'notification:new', { id: 'secret' });
      await wait(200);
      expect(heard).toEqual([]);
      expect(expired.authenticated + forged.authenticated).toBe(0);
    } finally {
      await stopServer(server);
    }
  });

  it('still delivers to a client that can only use long polling', async () => {
    const server = await startServer();
    try {
      const client = widgetLikeClient(server.port, tokenFor('user-r3'), {
        transports: ['polling'],
      });
      open.push(client);
      await until(() => client.authenticated === 1, 'sign-in over polling');
      expect(client.io.engine.transport.name).toBe('polling');
      const heard = [];
      client.on('notification:new', d => heard.push(d));
      server.ws.emitToUser('user-r3', 'notification:new', { id: 'polled' });
      await until(() => heard.length === 1, 'a polled event');
    } finally {
      await stopServer(server);
    }
  });

  it('delivers one event once, however many times the client reconnected', async () => {
    let server = await startServer();
    const { port } = server;
    const client = widgetLikeClient(port, tokenFor('user-r4'));
    open.push(client);
    const heard = [];
    // Registered once, as the widget does, outside the connect handler.
    client.on('notification:new', d => heard.push(d));
    await until(() => client.authenticated === 1, 'sign-in');
    try {
      for (let restart = 2; restart <= 3; restart += 1) {
        await stopServer(server);
        await until(() => !client.connected, 'disconnect');
        server = await startServer(port);
        await until(() => client.authenticated === restart, `reconnect ${restart}`);
      }
      server.ws.emitToUser('user-r4', 'notification:new', { id: 'once' });
      await until(() => heard.length >= 1, 'the event');
      await wait(200);
      expect(heard).toEqual([{ id: 'once' }]);
    } finally {
      client.close();
      await stopServer(server);
    }
  });
});
