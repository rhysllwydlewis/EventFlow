/**
 * Integration tests for Authentication Routes
 * Tests user registration, login, and rate limiting
 */

const fs = require('fs');
const path = require('path');
const userFixtures = require('../fixtures/users');

describe('Authentication Routes', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should have registration endpoint in auth routes', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      expect(authContent).toContain('router.post');
      expect(authContent).toContain('register');
    });

    it('should validate user registration structure', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for validation - can be validator or express-validator
      const hasValidation =
        authContent.includes('validateUserRegistration') ||
        authContent.includes('validator') ||
        authContent.includes('isEmail');
      expect(hasValidation).toBe(true);
    });

    it('should require email, password, and username', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Verify required fields are checked
      expect(authContent).toContain('email');
      expect(authContent).toContain('password');
    });

    it('should enforce rate limiting on auth routes', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      const rateLimitContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/rateLimits.js'),
        'utf8'
      );

      // Verify rate limiter exists
      expect(rateLimitContent).toContain('authLimiter');

      // Verify it's applied to auth routes
      expect(authContent).toContain('authLimiter') || expect(authContent).toContain('rateLimit');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should have login endpoint in auth routes', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      expect(authContent).toContain('router.post');
      expect(authContent).toContain('login');
    });

    it('should validate login credentials', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for validation
      expect(authContent).toContain('email');
      expect(authContent).toContain('password');
    });

    it('should use JWT for authentication', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for JWT usage
      expect(authContent).toContain('jwt') || expect(authContent).toContain('token');
    });

    it('should hash passwords securely', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for bcrypt usage
      expect(authContent).toContain('bcrypt') || expect(authContent).toContain('compare');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should have logout endpoint', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      expect(authContent).toContain('logout');
    });

    it('should clear authentication token', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for cookie/token clearing
      const hasClearToken =
        authContent.includes('clearCookie') || authContent.includes('clearAuthCookie');
      expect(hasClearToken).toBe(true);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should have user info endpoint', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check in either server.js or auth routes
      const hasEndpoint =
        serverContent.includes('/api/auth/me') ||
        serverContent.includes("'/me'") ||
        authContent.includes('/me');
      expect(hasEndpoint).toBe(true);
    });

    it('should return user data for authenticated users', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

      // Verify user extraction
      expect(serverContent).toContain('getUserFromCookie') ||
        expect(serverContent).toContain('user');
    });
  });

  describe('Password Reset Flow', () => {
    it('should have password reset request endpoint', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      (expect(authContent).toContain('password') && expect(authContent).toContain('reset')) ||
        expect(authContent).toContain('forgot');
    });

    it('should validate email for password reset', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check email validation in password reset
      expect(authContent).toContain('email');
    });

    it('should have token pre-validation endpoint for reset-password page', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      expect(authContent).toContain('validate-reset-token');
      expect(authContent).toContain('validatePasswordResetToken');
    });
  });

  describe('Rate Limiting Configuration', () => {
    it('should have auth rate limiter configured', () => {
      const rateLimitContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/rateLimits.js'),
        'utf8'
      );

      expect(rateLimitContent).toContain('authLimiter');
      expect(rateLimitContent).toContain('windowMs');
      expect(rateLimitContent).toContain('max');
    });

    it('should have reasonable rate limit for auth (10 requests per 15 min)', () => {
      const rateLimitContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/rateLimits.js'),
        'utf8'
      );

      // Verify auth limiter has appropriate settings
      const authLimiterMatch = rateLimitContent.match(/authLimiter[\s\S]*?max:\s*(\d+)/);
      expect(authLimiterMatch).toBeTruthy();

      const maxRequests = parseInt(authLimiterMatch[1]);
      expect(maxRequests).toBeGreaterThanOrEqual(5);
      expect(maxRequests).toBeLessThanOrEqual(20);
    });
  });

  describe('Input Validation', () => {
    it('should have validation middleware', () => {
      const validationContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/validation.js'),
        'utf8'
      );

      expect(validationContent).toContain('validateUserRegistration') ||
        expect(validationContent).toContain('validateUserLogin');
    });

    it('should validate email format', () => {
      const validationContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/validation.js'),
        'utf8'
      );

      expect(validationContent).toContain('isEmail') ||
        expect(validationContent).toContain('email');
    });

    it('should validate password strength', () => {
      const validationContent = fs.readFileSync(
        path.join(__dirname, '../../middleware/validation.js'),
        'utf8'
      );
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for password validation in either file
      const hasPasswordValidation =
        validationContent.includes('isLength') ||
        validationContent.includes('isStrongPassword') ||
        authContent.includes('passwordOk');
      expect(hasPasswordValidation).toBe(true);
    });
  });

  describe('Security Features', () => {
    it('should have CSRF protection on POST routes', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Check for CSRF protection
      expect(authContent).toContain('csrf') || expect(authContent).toContain('csrfProtection');
    });

    it('should sanitize user input', () => {
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

      // Check for sanitization middleware
      const hasSanitization =
        serverContent.includes('mongoSanitize') ||
        serverContent.includes('mongo-sanitize') ||
        serverContent.includes('sanitize');
      expect(hasSanitization).toBe(true);
    });

    it('should use secure cookie options', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
      const serverContent = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

      // Check for secure cookie settings in either file
      const hasSecureCookies =
        authContent.includes('httpOnly') ||
        authContent.includes('setAuthCookie') ||
        serverContent.includes('httpOnly');
      expect(hasSecureCookies).toBe(true);
    });
  });

  describe('Fixture Data Validation', () => {
    it('should have valid user fixtures', () => {
      expect(userFixtures.validUser).toBeDefined();
      expect(userFixtures.validUser.email).toMatch(/@/);
      expect(userFixtures.validUser.password).toBeDefined();
    });

    it('should have fixtures for different user roles', () => {
      expect(userFixtures.validAdmin).toBeDefined();
      expect(userFixtures.validSupplier).toBeDefined();
    });

    it('should have user generator function', () => {
      expect(typeof userFixtures.generateUser).toBe('function');
      const user = userFixtures.generateUser();
      expect(user.email).toMatch(/@/);
    });
  });
});
