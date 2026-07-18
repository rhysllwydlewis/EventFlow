'use strict';

const { configureHTTPSRedirect } = require('../../middleware/security');

function responseDouble() {
  return {
    setHeader: jest.fn(),
    redirect: jest.fn(),
  };
}

function requestDouble({
  host = 'event-flow.co.uk',
  path = '/',
  originalUrl = path,
  secure = true,
  forwardedProto,
} = {}) {
  return {
    path,
    originalUrl,
    url: originalUrl,
    secure,
    headers: {
      host,
      ...(forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}),
    },
  };
}

describe('canonical production host redirect', () => {
  const originalCanonical = process.env.CANONICAL_BASE_URL;
  const originalBase = process.env.BASE_URL;

  beforeEach(() => {
    process.env.CANONICAL_BASE_URL = 'https://event-flow.co.uk';
    process.env.BASE_URL = 'https://event-flow.co.uk';
  });

  afterAll(() => {
    if (originalCanonical === undefined) delete process.env.CANONICAL_BASE_URL;
    else process.env.CANONICAL_BASE_URL = originalCanonical;

    if (originalBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = originalBase;
  });

  test('does nothing outside production', () => {
    const req = requestDouble({ secure: false });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(false)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test.each(['/api/health', '/api/ready'])('does not redirect Railway probe %s', probe => {
    const req = requestDouble({ path: probe, originalUrl: probe, secure: false });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects a known HTTP host to canonical HTTPS with path and query intact', () => {
    const req = requestDouble({
      host: 'www.event-flow.co.uk',
      originalUrl: '/marketplace?category=decor',
      secure: false,
      forwardedProto: 'http',
    });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.redirect).toHaveBeenCalledWith(
      308,
      'https://event-flow.co.uk/marketplace?category=decor'
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects the secure alternate host to the canonical host', () => {
    const req = requestDouble({
      host: 'www.event-flow.co.uk',
      originalUrl: '/suppliers',
      secure: true,
    });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(308, 'https://event-flow.co.uk/suppliers');
    expect(next).not.toHaveBeenCalled();
  });

  test('allows an already-secure canonical request through', () => {
    const req = requestDouble({ host: 'event-flow.co.uk', secure: true });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('never reflects an unknown Host header into a redirect', () => {
    const req = requestDouble({
      host: 'attacker.example',
      originalUrl: '/login',
      secure: false,
      forwardedProto: 'http',
    });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('fails open without redirecting when canonical configuration is malformed', () => {
    process.env.CANONICAL_BASE_URL = 'not a URL';
    process.env.BASE_URL = '';
    const req = requestDouble({ host: 'www.event-flow.co.uk', secure: true });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('fails open when canonical configuration points outside approved production hosts', () => {
    process.env.CANONICAL_BASE_URL = 'https://attacker.example/redirect';
    process.env.BASE_URL = '';
    const req = requestDouble({ host: 'www.event-flow.co.uk', secure: true });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('honours an explicitly configured www canonical origin', () => {
    process.env.CANONICAL_BASE_URL = 'https://www.event-flow.co.uk/path-is-ignored';
    const req = requestDouble({
      host: 'event-flow.co.uk',
      originalUrl: '/pricing',
      secure: true,
    });
    const res = responseDouble();
    const next = jest.fn();

    configureHTTPSRedirect(true)(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(308, 'https://www.event-flow.co.uk/pricing');
    expect(next).not.toHaveBeenCalled();
  });
});
