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
    // Manually craft a token with wrong purpose using same secret
    const crypto = require('crypto');
    const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'fallback-secret';
    const payload = Buffer.from(JSON.stringify({ userId, email, purpose: 'newsletter' })).toString(
      'base64url'
    );
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    const result = verifyToken(token);
    expect(result.valid).toBe(false);
  });

  it('rejects a token with missing userId', () => {
    const crypto = require('crypto');
    const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'fallback-secret';
    const payload = Buffer.from(JSON.stringify({ email, purpose: 'actionPrompts' })).toString(
      'base64url'
    );
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
});
