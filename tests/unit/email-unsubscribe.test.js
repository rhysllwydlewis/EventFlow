/**
 * Unit tests for routes/emailUnsubscribe
 * Tests token validation for the action-prompt unsubscribe flow.
 */
'use strict';

// We test verifyToken directly since it's exported
const { verifyToken } = require('../../routes/emailUnsubscribe');
const { generateActionPromptUnsubscribeToken } = require('../../services/actionPromptScheduler');

// ── verifyToken ──────────────────────────────────────────────────────────────

describe('verifyToken', () => {
  const userId = 'user123';
  const email = 'test@example.com';

  it('accepts a valid token', () => {
    const token = generateActionPromptUnsubscribeToken(userId, email);
    expect(token).not.toBeNull(); // dev fallback is available in test env
    const result = verifyToken(token);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe(userId);
    expect(result.email).toBe(email.toLowerCase());
  });

  it('rejects a token with wrong signature', () => {
    const token = generateActionPromptUnsubscribeToken(userId, email);
    const parts = token.split('.');
    const tampered = `${parts[0]}.invalidsignatureXXX`;
    const result = verifyToken(tampered);
    expect(result.valid).toBe(false);
  });

  it('rejects a token with tampered payload', () => {
    const token = generateActionPromptUnsubscribeToken(userId, email);
    const parts = token.split('.');
    const badPayload = Buffer.from(
      JSON.stringify({ userId: 'hacker', email: 'hacker@evil.com', purpose: 'actionPrompts' })
    ).toString('base64url');
    const tampered = `${badPayload}.${parts[1]}`;
    const result = verifyToken(tampered);
    expect(result.valid).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(verifyToken('').valid).toBe(false);
  });

  it('rejects a token with wrong purpose', () => {
    const crypto = require('crypto');
    const secret =
      process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'dev-fallback-secret';
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ v: 1, userId, email, purpose: 'newsletter', iat: now, exp: now + 86400 })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    const result = verifyToken(token);
    expect(result.valid).toBe(false);
  });

  it('rejects a token with missing userId', () => {
    const crypto = require('crypto');
    const secret =
      process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'dev-fallback-secret';
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ v: 1, email, purpose: 'actionPrompts', iat: now, exp: now + 86400 })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    const result = verifyToken(token);
    expect(result.valid).toBe(false);
  });

  it('is case-insensitive for email in token payload', () => {
    const token = generateActionPromptUnsubscribeToken(userId, 'TEST@EXAMPLE.COM');
    const result = verifyToken(token);
    expect(result.valid).toBe(true);
    expect(result.email).toBe('test@example.com');
  });

  it('rejects an expired token', () => {
    const crypto = require('crypto');
    const secret =
      process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'dev-fallback-secret';
    const pastSec = Math.floor(Date.now() / 1000) - 86400; // expired 1 day ago
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        userId,
        email: email.toLowerCase(),
        purpose: 'actionPrompts',
        iat: pastSec - 86400,
        exp: pastSec,
      })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    const result = verifyToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a token without exp field', () => {
    const crypto = require('crypto');
    const secret =
      process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'dev-fallback-secret';
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        userId,
        email: email.toLowerCase(),
        purpose: 'actionPrompts',
        iat: now,
        // no exp field
      })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    const result = verifyToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a valid-signature token in production when no secret is configured', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalUnsub = process.env.UNSUBSCRIBE_SECRET;
    const originalJwt = process.env.JWT_SECRET;
    try {
      // Generate token with dev fallback before switching to production mode
      const token = generateActionPromptUnsubscribeToken(userId, email);

      process.env.NODE_ENV = 'production';
      delete process.env.UNSUBSCRIBE_SECRET;
      delete process.env.JWT_SECRET;

      const result = verifyToken(token);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('no-secret');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalUnsub !== undefined) {
        process.env.UNSUBSCRIBE_SECRET = originalUnsub;
      }
      if (originalJwt !== undefined) {
        process.env.JWT_SECRET = originalJwt;
      }
    }
  });

  it('generateActionPromptUnsubscribeToken returns null in production without secret', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalUnsub = process.env.UNSUBSCRIBE_SECRET;
    const originalJwt = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.UNSUBSCRIBE_SECRET;
      delete process.env.JWT_SECRET;

      const token = generateActionPromptUnsubscribeToken(userId, email);
      expect(token).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalUnsub !== undefined) {
        process.env.UNSUBSCRIBE_SECRET = originalUnsub;
      }
      if (originalJwt !== undefined) {
        process.env.JWT_SECRET = originalJwt;
      }
    }
  });
});
