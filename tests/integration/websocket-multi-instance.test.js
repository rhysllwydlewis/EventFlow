/**
 * Two app instances behind one load balancer: an event emitted for a user on instance A must reach
 * that user's socket when it is connected to instance B. That is what the Redis adapter is for
 * (user:<id> rooms, the conversation rooms and the supplier dashboard's live updates all rely on it).
 *
 * Needs a real Redis. It runs only when MULTI_INSTANCE_REDIS_URL is set (CI sets it for the
 * "Mongo Replica Set Transactions" job, which has a Redis service); otherwise it is skipped.
 *
 * @jest-environment node
 */
'use strict';

const REDIS_URL = process.env.MULTI_INSTANCE_REDIS_URL;
const suite = REDIS_URL ? describe : describe.skip;

suite('Socket.IO across two instances (Redis adapter)', () => {
  const http = require('http');
  let ioClient;
  let jwt;
  let WebSocketServerV2;
  const servers = [];
  const clients = [];

  async function startInstance() {
    const httpServer = http.createServer();
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const ws = new WebSocketServerV2(httpServer);
    servers.push({ httpServer, ws });
    return { ws, port: httpServer.address().port };
  }

  async function connectAs(userId, port) {
    const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    clients.push(socket);
    await new Promise((resolve, reject) => {
      socket.on('connect_error', reject);
      socket.on('auth:error', event => reject(new Error(event.error)));
      socket.on('auth:success', resolve);
      socket.on('connect', () =>
        socket.emit('auth', { token: jwt.sign({ id: userId }, process.env.JWT_SECRET) })
      );
    });
    return socket;
  }

  const received = (socket, event) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event} within 3s`)), 3000);
      socket.once(event, data => {
        clearTimeout(timer);
        resolve(data);
      });
    });

  beforeAll(async () => {
    jest.resetModules();
    process.env.REDIS_URL = REDIS_URL;
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'multi-instance-test-secret-32-characters-long';
    ioClient = require('socket.io-client').io;
    jwt = require('jsonwebtoken');
    WebSocketServerV2 = require('../../websocket-server-v2');
  });

  afterAll(async () => {
    clients.forEach(socket => socket.close());
    await Promise.all(
      servers.map(
        ({ ws, httpServer }) =>
          new Promise(resolve => {
            ws.io.close(() => resolve());
            httpServer.close();
          })
      )
    );
  });

  it('delivers an event emitted on one instance to a user connected to the other', async () => {
    const a = await startInstance();
    const b = await startInstance();
    const onB = await connectAs('user-multi-1', b.port);

    const heard = received(onB, 'messenger:v4:new-message');
    // Let the adapter finish subscribing on both instances before emitting.
    await new Promise(resolve => setTimeout(resolve, 300));
    a.ws.emitToUser('user-multi-1', 'messenger:v4:new-message', {
      conversationId: 'c1',
      message: { seq: 1 },
    });

    expect(await heard).toEqual({ conversationId: 'c1', message: { seq: 1 } });
  });

  it('and the other way round, and not to a different user', async () => {
    const a = await startInstance();
    const b = await startInstance();
    const onA = await connectAs('user-multi-2', a.port);
    const other = await connectAs('user-multi-3', a.port);
    let leaked = false;
    other.on('notification:new', () => {
      leaked = true;
    });

    const heard = received(onA, 'notification:new');
    await new Promise(resolve => setTimeout(resolve, 300));
    b.ws.emitToUser('user-multi-2', 'notification:new', { id: 'n1' });

    expect(await heard).toEqual({ id: 'n1' });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(leaked).toBe(false);
  });
});
