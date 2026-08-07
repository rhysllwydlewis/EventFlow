/**
 * Static source assertions for MessengerSocket's reconnect fallback.
 *
 * Socket.IO's built-in `reconnectionAttempts` budget (5, set at connect())
 * makes it give up retrying on its own — before this change, once that
 * budget was exhausted the chat UI just showed a static "please refresh"
 * message with no further attempt to recover. This verifies the fallback
 * retry loop and manual "Retry now" affordance are wired in, following the
 * same source-inspection style as the other messenger client tests in this
 * suite (no live Socket.IO connection is exercised).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MESSENGER_DIR = path.resolve(__dirname, '..', '..', 'public', 'messenger');

describe('MessengerSocket reconnect fallback', () => {
  let socketSrc;

  beforeAll(() => {
    socketSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerSocket.js'), 'utf8');
  });

  it('starts a fallback retry loop once the reconnection budget is exhausted', () => {
    expect(socketSrc).toContain('_scheduleFallbackRetry');
    const connectErrorBlock = socketSrc.match(
      /this\.socket\.on\('connect_error'[\s\S]*?\n {4}\}\);/
    );
    expect(connectErrorBlock).toBeTruthy();
    expect(connectErrorBlock[0]).toContain('reconnectAttempts >= this.maxReconnectAttempts');
    expect(connectErrorBlock[0]).toContain('this._scheduleFallbackRetry()');
  });

  it('clears the fallback timer on successful (re)connect', () => {
    const connectBlock = socketSrc.match(
      /this\.socket\.on\('connect', \(\) => \{[\s\S]*?\n {4}\}\);/
    );
    expect(connectBlock).toBeTruthy();
    expect(connectBlock[0]).toContain('this._clearFallbackRetry()');
  });

  it('backs off between fallback retries up to a capped delay', () => {
    expect(socketSrc).toContain('_maxFallbackRetryDelayMs');
    expect(socketSrc).toMatch(/Math\.min\(\s*this\._fallbackRetryDelayMs \* 1\.5/);
  });

  it('exposes a manualReconnect() method that resets state and reconnects immediately', () => {
    const manualReconnectBlock = socketSrc.match(/manualReconnect\(\)\s*\{[\s\S]*?\n {2}\}/);
    expect(manualReconnectBlock).toBeTruthy();
    expect(manualReconnectBlock[0]).toContain('this._clearFallbackRetry()');
    expect(manualReconnectBlock[0]).toContain('this.reconnectAttempts = 0');
    expect(manualReconnectBlock[0]).toContain('this.socket.connect()');
  });

  it('disconnect() tears down any pending fallback timer', () => {
    const disconnectBlock = socketSrc.match(/disconnect\(\)\s*\{[\s\S]*?\n {2}\}/);
    expect(disconnectBlock).toBeTruthy();
    expect(disconnectBlock[0]).toContain('this._clearFallbackRetry()');
  });
});

describe('MessengerAppV4 connection-failed banner', () => {
  let appSrc;

  beforeAll(() => {
    appSrc = fs.readFileSync(path.join(MESSENGER_DIR, 'js', 'MessengerAppV4.js'), 'utf8');
  });

  it('shows a manual retry affordance instead of only a static message', () => {
    expect(appSrc).toContain('_showConnectionFailedBanner');
    expect(appSrc).toContain('this.socket?.manualReconnect()');
  });

  it('hides the banner once the connection recovers', () => {
    expect(appSrc).toContain('_hideGlobalError');
    const connectedBlock = appSrc.match(
      /window\.addEventListener\('messenger:connected', async \(\) => \{[\s\S]*?\n {4}\}\);/
    );
    expect(connectedBlock).toBeTruthy();
    expect(connectedBlock[0]).toContain('this._hideGlobalError()');
  });
});
