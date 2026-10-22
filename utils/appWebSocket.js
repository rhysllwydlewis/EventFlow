/**
 * The running WebSocket server, from the Express app.
 *
 * server.js stores it as `wsServerV2` (the default) or `wsServer` (when WEBSOCKET_MODE=v1). Several
 * routes read a key that nothing sets (`websocketServer`), so their live notifications never went
 * out. Read it here, in one place.
 */

'use strict';

/**
 * @param {Object} [req] - Express request (or anything with `.app.get`)
 * @returns {Object|null} The WebSocket server, or null when none is running
 */
function getAppWebSocketServer(req) {
  const app = req && req.app;
  if (!app || typeof app.get !== 'function') {
    return null;
  }
  return app.get('wsServerV2') || app.get('wsServer') || null;
}

module.exports = { getAppWebSocketServer };
