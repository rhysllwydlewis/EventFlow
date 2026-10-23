'use strict';

/**
 * Runs MessengerWidgetV4 in jsdom against a scripted API and a fake Socket.IO client, and prints
 * what it did as JSON. Run in a child process like the other jsdom scenarios here.
 *
 * usage: node messenger-widget-scenario.js <base64 json options>
 * options: { ioLate: bool, broadcastUnread: bool, lastMessage: object|null }
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const options = JSON.parse(Buffer.from(process.argv[2] || 'e30=', 'base64').toString('utf8'));
const source = fs.readFileSync(
  path.join(__dirname, '../../public/messenger/js/MessengerWidgetV4.js'),
  'utf8'
);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dom = new JSDOM('<!doctype html><div id="w"></div>', {
    url: 'http://localhost/dashboard/supplier',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.console.error = () => {};

  // What the server would answer: one conversation whose unread count we can change.
  let unread = 0;
  const log = { fetches: 0, ioCalls: [], emitted: [], badgeRefreshes: 0, broadcasts: [] };
  window.fetch = async url => {
    if (String(url).includes('/api/v4/messenger/conversations')) {
      log.fetches += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          conversations: [
            {
              _id: 'c1',
              participants: [
                { userId: 'u1', unreadCount: unread, role: 'supplier' },
                { userId: 'u2', displayName: 'Cara', role: 'customer' },
              ],
              lastMessage:
                'lastMessage' in options
                  ? options.lastMessage
                  : { content: 'Hello', senderId: 'u2', sentAt: new Date().toISOString() },
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  window.unreadBadgeManager = {
    refresh() {
      log.badgeRefreshes += 1;
    },
  };
  window.addEventListener('messenger:unread-count', event =>
    log.broadcasts.push(event.detail.count)
  );

  // A fake Socket.IO client: remembers its handlers so the test can fire server events.
  const handlers = {};
  const socket = {
    on(event, handler) {
      handlers[event] = handler;
    },
    emit(event, payload) {
      log.emitted.push({ event, payload });
    },
    disconnect() {},
  };
  const fakeIo = (url, opts) => {
    log.ioCalls.push({ url, path: opts && opts.path });
    return socket;
  };
  if (!options.ioLate) {
    window.io = fakeIo;
  }

  window.eval(source);
  new window.MessengerWidgetV4('w', {
    currentUserId: 'u1',
    maxItems: 20,
    refreshIntervalMs: 3600000,
    broadcastUnread: options.broadcastUnread !== false,
  });
  await wait(150);
  log.fetchesAtStart = log.fetches;
  log.previews = Array.from(window.document.querySelectorAll('.mwv4__preview')).map(el =>
    el.textContent.replace(/\s+/g, ' ').trim()
  );
  log.ioBeforeLate = log.ioCalls.length;

  if (options.ioLate) {
    // The client script finishes loading some time after the widget started.
    window.io = fakeIo;
    await wait(700);
  }
  log.ioAfter = log.ioCalls.length;

  // The connection opens: the widget must say who it is.
  if (handlers.connect) {
    handlers.connect();
  }
  log.authAfterConnect = log.emitted.filter(entry => entry.event === 'auth');

  // A message arrives for the supplier on their own channel.
  unread = 1;
  const before = log.fetches;
  if (handlers['messenger:v4:new-message']) {
    handlers['messenger:v4:new-message']({ conversationId: 'c1' });
  }
  await wait(150);
  log.refetchedOnNewMessage = log.fetches - before;
  log.listenedTo = Object.keys(handlers).sort();
  log.unreadShown = (window.document.querySelector('#w').textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
  process.stdout.write(JSON.stringify(log));
  process.exit(0);
})().catch(error => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
