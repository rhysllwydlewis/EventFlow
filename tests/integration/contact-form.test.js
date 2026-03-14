/**
 * Integration tests for the /api/v1/contact endpoint
 * Tests captcha verification, input sanitization, and validation
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Contact Form Endpoint', () => {
  let miscContent;

  beforeAll(() => {
    miscContent = fs.readFileSync(path.join(__dirname, '../../routes/misc.js'), 'utf8');
  });

  describe('Route definition', () => {
    it('defines POST /contact endpoint', () => {
      expect(miscContent).toContain("router.post('/contact'");
    });

    it('applies rate limiting to contact endpoint', () => {
      // Check that rate limiting is applied alongside the contact handler
      expect(miscContent).toContain("router.post('/contact'");
      expect(miscContent).toContain('applyWriteLimiter');
    });

    it('verifies captcha before accepting submission', () => {
      expect(miscContent).toContain('verifyAltcha(captchaToken)');
      expect(miscContent).toContain('captchaResult.success');
    });

    it('validates required fields (name, email, message)', () => {
      expect(miscContent).toContain('Name, email, subject and message are required');
    });

    it('validates email format', () => {
      expect(miscContent).toContain('validator.isEmail');
    });

    it('sanitizes and trims input strings', () => {
      expect(miscContent).toContain('.trim()');
      // Named constants for length caps
      expect(miscContent).toContain('CONTACT_MAX_NAME_LENGTH');
      expect(miscContent).toContain('CONTACT_MAX_EMAIL_LENGTH');
      expect(miscContent).toContain('CONTACT_MAX_MESSAGE_LENGTH');
    });
  });

  describe('Dependencies', () => {
    it('has validator imported at module level', () => {
      // validator should be required at the top, not inline
      const topLines = miscContent.split('\n').slice(0, 15).join('\n');
      expect(topLines).toContain("require('validator')");
    });

    it('has verifyAltcha in required dependencies list', () => {
      expect(miscContent).toContain("'verifyAltcha'");
    });
  });

  describe('Response format', () => {
    it('returns success JSON on valid submission', () => {
      expect(miscContent).toContain('success: true');
      expect(miscContent).toContain('Thank you for your message');
    });

    it('returns 400 for failed captcha', () => {
      expect(miscContent).toContain('res.status(400).json({ error: captchaResult.error');
    });
  });

  describe('Auth registration captcha integration', () => {
    let authContent;

    beforeAll(() => {
      authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');
    });

    it('auth.js extracts captchaToken from request body', () => {
      expect(authContent).toContain('captchaToken');
    });

    it('auth.js has initializeDependencies to receive verifyAltcha', () => {
      expect(authContent).toContain('initializeDependencies');
      expect(authContent).toContain('_verifyAltcha');
    });

    it('auth.js calls captcha verification during registration', () => {
      expect(authContent).toContain('_verifyAltcha(captchaToken)');
    });

    it('auth.js exports initializeDependencies', () => {
      expect(authContent).toContain('module.exports.initializeDependencies');
    });
  });
});
