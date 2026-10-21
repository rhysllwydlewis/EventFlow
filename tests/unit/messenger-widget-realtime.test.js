'use strict';

/**
 * The inbox widget on the dashboards must hear about a new message as it arrives, not at its next
 * poll: it keeps its own authenticated socket, waits for the Socket.IO client if that is still
 * loading, refreshes on the user's own channel, and (when it shows only part of the inbox) asks the
 * badge manager for the full unread total instead of announcing its partial one.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const runner = path.join(__dirname, '../helpers/messenger-widget-scenario.js');

/** Runs the scenario and returns what the widget did. */
const run = options =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, Buffer.from(JSON.stringify(options), 'utf8').toString('base64')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
    )
  );

describe('MessengerWidgetV4 real-time updates', () => {
  const log = run({ broadcastUnread: false });

  test('connects to this site, and says who it is once the connection opens', () => {
    expect(log.ioCalls).toEqual([{ url: 'http://localhost', path: '/socket.io' }]);
    expect(log.authAfterConnect).toEqual([{ event: 'auth', payload: { userId: 'u1' } }]);
  });

  test('refreshes its list the moment a message arrives on the user channel', () => {
    expect(log.listenedTo).toEqual(
      expect.arrayContaining([
        'messenger:v4:new-message',
        'messenger:v4:conversation-created',
        'messenger:v4:conversation-updated',
        'messenger:v4:read',
      ])
    );
    expect(log.refetchedOnNewMessage).toBeGreaterThanOrEqual(1);
    expect(log.unreadShown).toContain('Hello');
  });

  test('showing part of the inbox, it asks the badge manager for the full total instead of announcing its own', () => {
    expect(log.badgeRefreshes).toBeGreaterThanOrEqual(1);
    expect(log.broadcasts).toEqual([]);
  });

  test('showing the whole inbox, it announces its own count as before', () => {
    const whole = run({ broadcastUnread: true });
    expect(whole.broadcasts.length).toBeGreaterThanOrEqual(1);
    expect(whole.broadcasts[whole.broadcasts.length - 1]).toBe(1);
    expect(whole.badgeRefreshes).toBe(0);
  });

  test('waits for a Socket.IO client that is still loading, instead of giving up on it', () => {
    const late = run({ ioLate: true, broadcastUnread: false });
    expect(late.ioBeforeLate).toBe(0);
    expect(late.ioAfter).toBe(1);
    expect(late.authAfterConnect).toHaveLength(1);
    expect(late.refetchedOnNewMessage).toBeGreaterThanOrEqual(1);
  });
});
