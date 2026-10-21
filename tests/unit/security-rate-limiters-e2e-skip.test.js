/**
 * The limiters the server really uses (server.js -> security.createRateLimiters) skip only in the
 * isolated backend browser suite: NODE_ENV=test together with E2E_MODE=full. Anywhere else they
 * keep every limit.
 */
describe('createRateLimiters in the backend browser suite', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, E2E_MODE: process.env.E2E_MODE };

  afterEach(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.E2E_MODE === undefined) {
      delete process.env.E2E_MODE;
    } else {
      process.env.E2E_MODE = saved.E2E_MODE;
    }
  });

  // Hit the auth limiter more times than its 100-request allowance and report whether it ever
  // answered 429.
  async function limited(env) {
    Object.assign(process.env, env);
    const { createRateLimiters } = require('../../middleware/security');
    const { authLimiter } = createRateLimiters();
    for (let i = 0; i < 105; i++) {
      let status = 200;
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) {
          this.headers[k] = v;
        },
        getHeader(k) {
          return this.headers[k];
        },
        status(code) {
          status = code;
          return this;
        },
        send() {
          return this;
        },
        json() {
          return this;
        },
        end() {
          return this;
        },
      };
      const req = { ip: '203.0.113.9', headers: {}, method: 'GET', app: { get: () => false } };
      await new Promise(resolve => {
        authLimiter(req, res, resolve);
        setImmediate(resolve);
      });
      if (status === 429) {
        return true;
      }
    }
    return false;
  }

  it('keeps the limit in a normal test run', async () => {
    delete process.env.E2E_MODE;
    expect(await limited({ NODE_ENV: 'test' })).toBe(true);
  });

  it('skips the limit only when NODE_ENV=test and E2E_MODE=full', async () => {
    jest.resetModules();
    expect(await limited({ NODE_ENV: 'test', E2E_MODE: 'full' })).toBe(false);
  });

  it('keeps the limit when E2E_MODE=full is set outside test', async () => {
    jest.resetModules();
    expect(await limited({ NODE_ENV: 'production', E2E_MODE: 'full' })).toBe(true);
  });
});
