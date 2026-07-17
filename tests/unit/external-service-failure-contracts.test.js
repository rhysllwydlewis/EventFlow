'use strict';

const cache = {
  get: jest.fn(),
  set: jest.fn(),
};
const logger = {
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('../../cache', () => cache);
jest.mock('../../utils/logger', () => logger);

const { geocodePostcode } = require('../../utils/geocoding');

describe('external geocoding failure contracts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test('returns null rather than leaking a network exception', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('socket reset by peer'));

    await expect(geocodePostcode('CF10 1AA')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith('Postcode lookup error:', 'socket reset by peer');
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('treats provider error responses as a safe unavailable result', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(geocodePostcode('CF10 1AA')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('Postcode lookup failed for CF101AA: 429');
    expect(cache.set).not.toHaveBeenCalled();
  });

  test('aborts a stalled provider request at the five-second boundary', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    );

    const pending = geocodePostcode('CF10 1AA');
    await jest.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith('Postcode lookup timeout:', 'CF101AA');
  });

  test('caches a valid provider response using the normalised postcode key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 200,
        result: {
          latitude: 51.4816,
          longitude: -3.1791,
          postcode: 'CF10 1AA',
        },
      }),
    });

    await expect(geocodePostcode('cf10 1aa')).resolves.toEqual({
      latitude: 51.4816,
      longitude: -3.1791,
      postcode: 'CF10 1AA',
    });
    expect(cache.get).toHaveBeenCalledWith('geocode:CF101AA');
    expect(cache.set).toHaveBeenCalledWith(
      'geocode:CF101AA',
      JSON.stringify({ latitude: 51.4816, longitude: -3.1791, postcode: 'CF10 1AA' }),
      86400
    );
  });
});
