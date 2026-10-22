'use strict';

/**
 * The full-page messenger's socket client: every event the server sends must become a window event
 * the app listens for. `messenger:v4:new-message` (sent on each participant's own channel, the only
 * way a conversation that is not open hears about a message) used to be ignored.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../public/messenger/js/MessengerSocket.js'),
  'utf8'
);

function load() {
  const handlers = {};
  const dispatched = [];
  const socket = { on: (event, fn) => (handlers[event] = fn), emit: jest.fn(), connect: jest.fn() };
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    }
  }
  const window = {
    io: () => socket,
    dispatchEvent: event => dispatched.push(event),
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext({ window, CustomEvent, console, setTimeout, clearTimeout });
  vm.runInContext(`${SOURCE}\nthis.MessengerSocket = MessengerSocket;`, context);
  const client = new context.MessengerSocket({ setTyping: jest.fn() });
  client.connect('u1');
  return { handlers, dispatched };
}

describe('MessengerSocket event mapping', () => {
  it.each([
    ['messenger:v4:message', 'messenger:new-message'],
    ['messenger:v4:new-message', 'messenger:new-message'],
    ['messenger:v4:conversation-created', 'messenger:new-conversation'],
    ['messenger:v4:conversation-updated', 'messenger:conversation-updated'],
    ['messenger:v4:conversation-deleted', 'messenger:conversation-deleted'],
    ['messenger:v4:message-edited', 'messenger:message-edited'],
    ['messenger:v4:message-deleted', 'messenger:message-deleted'],
    ['messenger:v4:reaction', 'messenger:reaction-updated'],
    ['messenger:v4:read', 'messenger:conversation-read'],
    ['messenger:v4:message-delivered', 'messenger:message-delivered'],
  ])('%s becomes %s with the payload', (serverEvent, windowEvent) => {
    const { handlers, dispatched } = load();
    expect(typeof handlers[serverEvent]).toBe('function');
    const payload = { conversationId: 'c1', message: { _id: 'm1', seq: 1 } };
    handlers[serverEvent](payload);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe(windowEvent);
    expect(dispatched[0].detail).toBe(payload);
  });
});
