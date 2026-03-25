/**
 * Unit tests for authentication middleware
 */

const jwt = require('jsonwebtoken');

// Mock db-unified so authRequired can verify user without a real database
jest.mock('../../db-unified', () => ({
  findOne: jest.fn().mockResolvedValue({ id: '123', email: 'test@example.com', role: 'customer' }),
}));

const {
  setAuthCookie,
  clearAuthCookie,
  getUserFromCookie,
  authRequired,
  roleRequired,
} = require('../../middleware/auth');

const JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

describe('Auth Middleware', () => {
  describe('setAuthCookie', () => {
    it('should set httpOnly cookie without maxAge when remember is false', () => {
      const res = {
        cookie: jest.fn(),
      };
      const token = 'test-token';

      setAuthCookie(res, token, { remember: false });

      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        token,
        expect.objectContaining({
          httpOnly: true,
        })
      );
      // Ensure maxAge is NOT set (session-only cookie)
      const callArgs = res.cookie.mock.calls[0][2];
      expect(callArgs.maxAge).toBeUndefined();
    });

    it('should set httpOnly cookie with maxAge when remember is true', () => {
      const res = {
        cookie: jest.fn(),
      };
      const token = 'test-token';

      setAuthCookie(res, token, { remember: true });

      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        token,
        expect.objectContaining({
          httpOnly: true,
          maxAge: expect.any(Number),
        })
      );
    });

    it('should set secure cookie in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const res = {
        cookie: jest.fn(),
      };
      const token = 'test-token';

      setAuthCookie(res, token, { remember: true });

      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        token,
        expect.objectContaining({
          secure: true,
          sameSite: 'lax',
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should set non-secure cookie in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const res = {
        cookie: jest.fn(),
      };
      const token = 'test-token';

      setAuthCookie(res, token, { remember: true });

      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        token,
        expect.objectContaining({
          secure: false,
          sameSite: 'lax',
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should always set path "/" on the auth cookie', () => {
      const res = {
        cookie: jest.fn(),
      };
      const token = 'test-token';

      setAuthCookie(res, token, { remember: false });

      expect(res.cookie).toHaveBeenCalledWith(
        'token',
        token,
        expect.objectContaining({
          path: '/',
        })
      );
    });
  });

  describe('clearAuthCookie', () => {
    it('should clear token cookie', () => {
      const res = {
        clearCookie: jest.fn(),
      };

      clearAuthCookie(res);

      expect(res.clearCookie).toHaveBeenCalledWith('token');
    });

    it('should clear cookie with proper options', () => {
      const res = {
        clearCookie: jest.fn(),
      };

      clearAuthCookie(res);

      // Should be called multiple times with different options
      expect(res.clearCookie).toHaveBeenCalled();
      expect(res.clearCookie.mock.calls.length).toBeGreaterThanOrEqual(2);

      // First call with full options
      expect(res.clearCookie).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({
          httpOnly: true,
          path: '/',
        })
      );

      // Second call without options for legacy compatibility
      expect(res.clearCookie).toHaveBeenCalledWith('token');
    });

    it('should clear cookie with domain variants in production when COOKIE_DOMAIN is set', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalCookieDomain = process.env.COOKIE_DOMAIN;
      process.env.NODE_ENV = 'production';
      process.env.COOKIE_DOMAIN = '.example.com';

      const res = {
        clearCookie: jest.fn(),
      };

      clearAuthCookie(res);

      // Should attempt to clear with domain variants for production
      expect(res.clearCookie).toHaveBeenCalled();
      expect(res.clearCookie.mock.calls.length).toBeGreaterThanOrEqual(3);

      // Check for domain-specific clearing
      const domainCalls = res.clearCookie.mock.calls.filter(
        call => call[1] && call[1].domain !== undefined
      );
      expect(domainCalls.length).toBeGreaterThan(0);

      process.env.NODE_ENV = originalEnv;
      if (originalCookieDomain === undefined) {
        delete process.env.COOKIE_DOMAIN;
      } else {
        process.env.COOKIE_DOMAIN = originalCookieDomain;
      }
    });

    it('should NOT clear with domain variants in production when COOKIE_DOMAIN is not set', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalCookieDomain = process.env.COOKIE_DOMAIN;
      process.env.NODE_ENV = 'production';
      delete process.env.COOKIE_DOMAIN;

      const res = {
        clearCookie: jest.fn(),
      };

      clearAuthCookie(res);

      // Should only clear twice (with and without options) — no domain-specific clearing
      expect(res.clearCookie.mock.calls.length).toBe(2);

      const domainCalls = res.clearCookie.mock.calls.filter(
        call => call[1] && call[1].domain !== undefined
      );
      expect(domainCalls.length).toBe(0);

      process.env.NODE_ENV = originalEnv;
      if (originalCookieDomain !== undefined) {
        process.env.COOKIE_DOMAIN = originalCookieDomain;
      }
    });

    it('should not use domain variants in development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const res = {
        clearCookie: jest.fn(),
      };

      clearAuthCookie(res);

      // In development, should only clear twice (with and without options)
      expect(res.clearCookie.mock.calls.length).toBe(2);

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('getUserFromCookie', () => {
    it('should return user from valid JWT cookie', () => {
      const payload = { id: '123', email: 'test@example.com', role: 'customer' };
      const token = jwt.sign(payload, JWT_SECRET);

      const req = {
        cookies: { token },
      };

      const user = getUserFromCookie(req);

      expect(user).toBeDefined();
      expect(user.id).toBe('123');
      expect(user.email).toBe('test@example.com');
      expect(user.role).toBe('customer');
    });

    it('should return null if no cookie present', () => {
      const req = {
        cookies: {},
      };

      const user = getUserFromCookie(req);

      expect(user).toBeNull();
    });

    it('should return null if cookies object missing', () => {
      const req = {};

      const user = getUserFromCookie(req);

      expect(user).toBeNull();
    });

    it('should return null for invalid JWT token', () => {
      const req = {
        cookies: { token: 'invalid.jwt.token' },
      };

      const user = getUserFromCookie(req);

      expect(user).toBeNull();
    });

    it('should return null for expired JWT token', () => {
      const payload = { id: '123', email: 'test@example.com' };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '-1s' });

      const req = {
        cookies: { token },
      };

      const user = getUserFromCookie(req);

      expect(user).toBeNull();
    });
  });

  describe('authRequired', () => {
    it('should attach user to request and call next for valid auth', async () => {
      const payload = { id: '123', email: 'test@example.com', role: 'customer' };
      const token = jwt.sign(payload, JWT_SECRET);

      const req = {
        cookies: { token },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await authRequired(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('123');
      expect(req.userId).toBe('123');
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 401 if no authentication', () => {
      const req = {
        cookies: {},
        get: jest.fn().mockReturnValue('test-user-agent'),
        path: '/test',
        method: 'GET',
        ip: '127.0.0.1',
        originalUrl: '/test',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn(),
      };
      const next = jest.fn();

      authRequired(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthenticated',
        message: 'Please log in to access this resource.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should redirect browser navigation to /auth?reason=unauthenticated when no token', () => {
      const req = {
        cookies: {},
        path: '/dashboard/supplier',
        originalUrl: '/dashboard/supplier',
        method: 'GET',
        ip: '127.0.0.1',
        xhr: false,
        get: jest.fn(header => {
          if (header === 'sec-fetch-mode') {
            return 'navigate';
          }
          if (header === 'user-agent') {
            return 'Mozilla/5.0';
          }
          return null;
        }),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn(),
      };
      const next = jest.fn();

      authRequired(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        `/auth?reason=unauthenticated&next=${encodeURIComponent('/dashboard/supplier')}`
      );
      expect(res.status).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 for invalid token', () => {
      const req = {
        cookies: { token: 'invalid.token' },
        get: jest.fn().mockReturnValue('test-user-agent'),
        path: '/test',
        method: 'GET',
        ip: '127.0.0.1',
        originalUrl: '/test',
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn(),
      };
      const next = jest.fn();

      authRequired(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthenticated',
        message: 'Please log in to access this resource.',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('roleRequired', () => {
    it('should allow access for matching role', () => {
      const middleware = roleRequired('admin');

      const req = {
        user: { id: '123', role: 'admin' },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 403 for non-matching role', () => {
      const middleware = roleRequired('admin');

      const req = {
        user: { id: '123', role: 'customer' },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'This action requires admin role. Your current role is customer.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should redirect browser navigation to /auth?reason=forbidden when wrong role', () => {
      const middleware = roleRequired('supplier');

      const req = {
        user: { id: '123', role: 'customer' },
        path: '/dashboard/supplier',
        originalUrl: '/dashboard/supplier',
        xhr: false,
        get: jest.fn(header => {
          if (header === 'sec-fetch-mode') {
            return 'navigate';
          }
          return null;
        }),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith('/auth?reason=forbidden&required=supplier');
      expect(res.status).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 if no user present', () => {
      const middleware = roleRequired('admin');

      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        redirect: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unauthenticated',
        message: 'Please log in to access this resource.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should work with supplier role', () => {
      const middleware = roleRequired('supplier');

      const req = {
        user: { id: '456', role: 'supplier' },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should work with customer role', () => {
      const middleware = roleRequired('customer');

      const req = {
        user: { id: '789', role: 'customer' },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
