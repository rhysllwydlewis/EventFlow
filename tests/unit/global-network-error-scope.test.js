'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const handlerSource = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/utils/global-error-handler.js'),
  'utf8'
);

function loadHandler(fetchImplementation) {
  const notify = jest.fn();
  const captureException = jest.fn();
  const window = {
    location: {
      hostname: 'event-flow.co.uk',
      origin: 'https://event-flow.co.uk',
    },
    fetch: fetchImplementation,
    EventFlowNotifications: { error: notify },
    Sentry: { captureException },
    addEventListener: jest.fn(),
    setTimeout: jest.fn(),
  };
  const document = { addEventListener: jest.fn() };
  const console = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  vm.runInNewContext(handlerSource, {
    window,
    document,
    console,
    URL,
    Error,
    Element: class Element {},
    setTimeout: jest.fn(),
  });

  return { window, notify, captureException };
}

describe('global network error scope', () => {
  it('does not present a third-party request failure as an EventFlow outage', async () => {
    const nativeFetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const context = loadHandler(nativeFetch);

    await expect(
      context.window.fetch('https://www.google.com/rmkt/collect?random=123')
    ).rejects.toThrow('Failed to fetch');

    expect(context.notify).not.toHaveBeenCalled();
    expect(context.captureException).not.toHaveBeenCalled();
  });

  it('still reports a failed EventFlow API request', async () => {
    const nativeFetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const context = loadHandler(nativeFetch);

    await expect(context.window.fetch('/api/v1/auth/me')).rejects.toThrow('Failed to fetch');

    expect(context.notify).toHaveBeenCalledWith(
      'Network error. Please check your connection and try again.'
    );
    expect(context.captureException).toHaveBeenCalledTimes(1);
  });
});
