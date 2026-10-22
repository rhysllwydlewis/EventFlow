'use strict';

const { getAppWebSocketServer } = require('../../utils/appWebSocket');

const appWith = values => ({ get: key => values[key] });

describe('getAppWebSocketServer', () => {
  it('returns the v2 server when there is one', () => {
    const v2 = { name: 'v2' };
    expect(
      getAppWebSocketServer({ app: appWith({ wsServerV2: v2, wsServer: { name: 'v1' } }) })
    ).toBe(v2);
  });

  it('falls back to the v1 server', () => {
    const v1 = { name: 'v1' };
    expect(getAppWebSocketServer({ app: appWith({ wsServer: v1 }) })).toBe(v1);
  });

  it('does not read the key nothing sets', () => {
    expect(getAppWebSocketServer({ app: appWith({ websocketServer: { name: 'ghost' } }) })).toBe(
      null
    );
  });

  it.each([undefined, null, {}, { app: {} }, { app: { get: 'nope' } }])(
    'returns null for %j',
    req => {
      expect(getAppWebSocketServer(req)).toBe(null);
    }
  );
});
