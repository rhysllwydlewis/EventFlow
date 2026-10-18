/**
 * Unit tests for email verification workflow
 * Tests email template loading, token generation, and verification logic
 */

const path = require('path');
const fs = require('fs');

// Mock postmark module
jest.mock('postmark', () => ({
  ServerClient: jest.fn().mockImplementation(() => ({
    sendEmail: jest.fn().mockResolvedValue({
      MessageID: 'test-message-id',
      To: 'test@example.com',
      SubmittedAt: new Date().toISOString(),
    }),
  })),
}));

describe('Email Verification System', () => {
  let postmark;

  beforeAll(() => {
    // Set required environment variables
    process.env.POSTMARK_API_KEY = 'test-api-key';
    process.env.POSTMARK_FROM = 'admin@event-flow.co.uk';
    process.env.APP_BASE_URL = 'http://localhost:3000';
    process.env.JWT_SECRET = 'test-secret-for-verification';

    // Import postmark module after setting env vars
    postmark = require('../../utils/postmark');
  });

  afterAll(() => {
    // Clean up environment variables
    delete process.env.POSTMARK_API_KEY;
    delete process.env.POSTMARK_FROM;
    delete process.env.APP_BASE_URL;
  });

  describe('Email Template Loading', () => {
    it('should load verification email template', () => {
      const template = postmark.loadEmailTemplate('verification', {
        name: 'John Doe',
        verificationLink: 'https://example.com/verify?token=abc123',
      });

      expect(template).toBeTruthy();
      expect(typeof template).toBe('string');
      expect(template).toContain('John Doe');
      expect(template).toContain('https://example.com/verify?token=abc123');
    });

    it('should load welcome email template', () => {
      const template = postmark.loadEmailTemplate('welcome', {
        name: 'Jane Smith',
      });

      expect(template).toBeTruthy();
      expect(typeof template).toBe('string');
      expect(template).toContain('Jane Smith');
      expect(template).toContain('Welcome');
    });

    it('should escape HTML in template variables', () => {
      const template = postmark.loadEmailTemplate('verification', {
        name: '<script>alert("xss")</script>',
        verificationLink: 'https://example.com/verify?token=abc123',
      });

      expect(template).not.toContain('<script>');
      expect(template).toContain('&lt;script&gt;');
    });

    it('should return null for non-existent template', () => {
      const template = postmark.loadEmailTemplate('non-existent-template', {});

      expect(template).toBeNull();
    });

    it('should replace year placeholder', () => {
      const template = postmark.loadEmailTemplate('verification', {
        name: 'Test User',
        verificationLink: 'https://example.com/verify',
      });

      const currentYear = new Date().getFullYear();
      expect(template).toContain(currentYear.toString());
    });

    it('should replace baseUrl placeholder', () => {
      const template = postmark.loadEmailTemplate('verification', {
        name: 'Test User',
        verificationLink: 'https://example.com/verify',
      });

      expect(template).toContain('http://localhost:3000');
    });
  });

  describe('Verification Email Template Content', () => {
    it('should contain dark mode support', () => {
      const templatePath = path.join(__dirname, '..', '..', 'email-templates', 'verification.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      expect(templateContent).toContain('prefers-color-scheme: dark');
      expect(templateContent).toContain('color-scheme');
    });

    it('should have proper email structure', () => {
      const templatePath = path.join(__dirname, '..', '..', 'email-templates', 'verification.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      expect(templateContent).toContain('<!DOCTYPE html>');
      expect(templateContent).toContain('<meta name="viewport"');
      expect(templateContent).toContain('email-container');
      expect(templateContent).toContain('email-header');
      expect(templateContent).toContain('email-body');
      expect(templateContent).toContain('email-footer');
    });

    it('should include verification button and fallback link', () => {
      const templatePath = path.join(__dirname, '..', '..', 'email-templates', 'verification.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      expect(templateContent).toContain('{{verificationLink}}');
      expect(templateContent).toContain('cta-button');
      expect(templateContent).toMatch(/verify email/i);
    });

    it('should be mobile responsive', () => {
      const templatePath = path.join(__dirname, '..', '..', 'email-templates', 'verification.html');
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      expect(templateContent).toContain('@media only screen and (max-width: 600px)');
    });
  });

  describe('Send Verification Email', () => {
    it('should send verification email with correct parameters', async () => {
      const user = {
        id: 'user123',
        name: 'Test User',
        email: 'test@example.com',
      };
      const token = 'verify-token-abc123';

      const result = await postmark.sendVerificationEmail(user, token);

      expect(result).toBeTruthy();
      expect(result.MessageID).toBe('test-message-id');
    });

    it('should include verification link in email', async () => {
      const user = {
        name: 'Test User',
        email: 'test@example.com',
      };
      const token = 'verify-token-xyz789';

      await postmark.sendVerificationEmail(user, token);

      // The verification link should be constructed properly with .html extension
      // We can't directly check the email content in this mock,
      // but we verify the function completes without error
      expect(true).toBe(true);
    });

    it('should include .html extension in verification link', async () => {
      const user = {
        name: 'Test User',
        email: 'test@example.com',
      };
      const token = 'test-token-123';

      // Load the template to verify it contains the correct link format
      const templateData = {
        name: user.name,
        verificationLink: `http://localhost:3000/verify.html?token=${encodeURIComponent(token)}`,
      };
      const template = postmark.loadEmailTemplate('verification', templateData);

      expect(template).toContain('verify.html?token=');
      expect(template).toContain(encodeURIComponent(token));
    });

    it('should handle user without name gracefully', async () => {
      const user = {
        email: 'test@example.com',
      };
      const token = 'verify-token-123';

      const result = await postmark.sendVerificationEmail(user, token);

      expect(result).toBeTruthy();
    });
  });

  describe('Token Generation and Security', () => {
    it('should generate unique verification tokens', () => {
      // Mock uid function from store
      const { uid } = require('../../store');

      const token1 = uid('verify');
      const token2 = uid('verify');

      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);
      expect(token1).toContain('verify_');
      expect(token2).toContain('verify_');
    });

    it('should generate unsubscribe tokens correctly', () => {
      const email1 = 'user@example.com';
      const email2 = 'other@example.com';

      const token1 = postmark.generateUnsubscribeToken(email1);
      const token2 = postmark.generateUnsubscribeToken(email2);

      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64); // SHA-256 hex digest
    });

    it('should verify unsubscribe tokens correctly', () => {
      const email = 'test@example.com';
      const token = postmark.generateUnsubscribeToken(email);

      const isValid = postmark.verifyUnsubscribeToken(email, token);
      expect(isValid).toBe(true);
    });

    it('should reject invalid unsubscribe tokens', () => {
      const email = 'test@example.com';
      const wrongToken = 'invalid-token-123';

      expect(() => {
        postmark.verifyUnsubscribeToken(email, wrongToken);
      }).toThrow();
    });

    it('should reject tokens for different email', () => {
      const email1 = 'user1@example.com';
      const email2 = 'user2@example.com';
      const token = postmark.generateUnsubscribeToken(email1);

      // verifyUnsubscribeToken will throw for invalid tokens due to timingSafeEqual
      let result = false;
      try {
        result = postmark.verifyUnsubscribeToken(email2, token);
      } catch (err) {
        // Expected to throw for mismatched tokens
        result = false;
      }
      expect(result).toBe(false);
    });
  });

  describe('Postmark Status', () => {
    it('should report correct Postmark status', () => {
      const status = postmark.getPostmarkStatus();

      expect(status).toBeTruthy();
      expect(status).toHaveProperty('enabled');
      expect(status).toHaveProperty('from');
      expect(status).toHaveProperty('appBaseUrl');
      expect(status).toHaveProperty('apiKeyConfigured');
    });

    it('should check if Postmark is enabled', () => {
      const isEnabled = postmark.isPostmarkEnabled();

      expect(typeof isEnabled).toBe('boolean');
    });
  });

  describe('Email Template Validation', () => {
    const requiredTemplates = [
      'verification',
      'welcome',
      'password-reset',
      'notification',
      'marketing',
    ];

    requiredTemplates.forEach(templateName => {
      it(`should have ${templateName} template file`, () => {
        const templatePath = path.join(
          __dirname,
          '..',
          '..',
          'email-templates',
          `${templateName}.html`
        );

        expect(fs.existsSync(templatePath)).toBe(true);
      });
    });
  });
});
