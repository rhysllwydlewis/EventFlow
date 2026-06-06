/**
 * Email template system tests.
 *
 * Validates:
 * - Every code-referenced template has a matching email-templates/*.html file
 * - Every template renders without null/errors via the loader
 * - Required placeholders exist in each template
 * - partner-welcome has all required variables (fixes missing template bug)
 * - supplier-verification-status supports all status variants
 * - notesSection is listed as an allowed HTML key in postmark.js
 * - The loader clears unresolved {{placeholder}} tokens
 */

'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const path = require('path');
const fs = require('fs');
const { loadEmailTemplate } = require('../../utils/postmark');

const TEMPLATES_DIR = path.join(__dirname, '../../email-templates');

// All templates referenced by application code via template: '...'
const REFERENCED_TEMPLATES = [
  'action-prompts',
  'marketing',
  'newsletter-confirm',
  'newsletter-welcome',
  'notification',
  'partner-welcome',
  'password-reset',
  'password-reset-confirmation',
  'supplier-verification-status',
  'verification',
  'welcome',
  'welcome-customer',
  'welcome-supplier',
  'subscription-activated',
  'subscription-cancelled',
  'subscription-payment-failed',
  'subscription-renewal-reminder',
  'subscription-trial-ending',
  'subscription-upgraded',
  'subscription-downgrade-scheduled',
];

describe('Email template files — coverage', () => {
  test.each(REFERENCED_TEMPLATES)('email-templates/%s.html exists on disk', name => {
    expect(fs.existsSync(path.join(TEMPLATES_DIR, `${name}.html`))).toBe(true);
  });

  test('no template file is empty', () => {
    fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .forEach(file => {
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
        expect(content.trim().length).toBeGreaterThan(100);
      });
  });
});

describe('Email template loader — rendering', () => {
  test.each(REFERENCED_TEMPLATES)('loadEmailTemplate renders %s without null', name => {
    const result = loadEmailTemplate(name, {});
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(50);
  });

  test('returns null for non-existent template', () => {
    expect(loadEmailTemplate('template-does-not-exist', {})).toBeNull();
  });

  test('substitutes {{year}} with current year', () => {
    const result = loadEmailTemplate('welcome', {});
    expect(result).toContain(String(new Date().getFullYear()));
    expect(result).not.toContain('{{year}}');
  });

  test('substitutes {{baseUrl}} — no unresolved tokens remain', () => {
    const result = loadEmailTemplate('welcome', {});
    expect(result).not.toContain('{{baseUrl}}');
  });

  test('clears unresolved {{placeholder}} tokens', () => {
    const result = loadEmailTemplate('verification', {});
    expect(result).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('substitutes provided template variables', () => {
    const result = loadEmailTemplate('verification', {
      name: 'Test User',
      verificationLink: 'https://example.com/verify?token=abc123',
    });
    expect(result).toContain('Test User');
    expect(result).toContain('https://example.com/verify?token=abc123');
  });

  test('HTML-escapes non-allowlisted variables', () => {
    const result = loadEmailTemplate('verification', {
      name: '<script>alert("xss")</script>',
      verificationLink: 'https://example.com',
    });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('does NOT escape notesSection (allowlisted HTML key)', () => {
    const notesSection = '<p style="color:red;">Test notes HTML</p>';
    const result = loadEmailTemplate('supplier-verification-status', {
      name: 'Supplier Name',
      statusTitle: 'Approved',
      statusMessage: 'Good news.',
      headerGradient: 'linear-gradient(135deg,#059669,#10B981)',
      ctaGradient: 'linear-gradient(135deg,#059669,#10B981)',
      ctaText: 'Go to Dashboard',
      notesSection,
      dashboardUrl: 'https://example.com/dashboard',
      supportEmail: 'support@event-flow.co.uk',
    });
    expect(result).toContain('<p style="color:red;">Test notes HTML</p>');
  });
});

describe('partner-welcome template', () => {
  let tpl;
  beforeAll(() => {
    tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'partner-welcome.html'), 'utf8');
  });

  test('contains {{name}} placeholder', () => expect(tpl).toContain('{{name}}'));
  test('contains {{refCode}} placeholder', () => expect(tpl).toContain('{{refCode}}'));
  test('contains {{refLink}} placeholder', () => expect(tpl).toContain('{{refLink}}'));
  test('contains {{dashboardLink}} placeholder', () => expect(tpl).toContain('{{dashboardLink}}'));
  test('contains CTA copy for dashboard', () => expect(tpl).toContain('Open Partner Dashboard'));
  test('contains VEXI attribution in footer', () => expect(tpl).toContain('VEXI'));

  test('renders correctly with full sample data', () => {
    const result = loadEmailTemplate('partner-welcome', {
      name: 'Alice Smith',
      refCode: 'EF-ALICE-99',
      refLink: 'https://event-flow.co.uk/auth?ref=EF-ALICE-99&role=supplier',
      dashboardLink: 'https://event-flow.co.uk/partner/dashboard',
    });
    expect(result).toContain('Alice Smith');
    expect(result).toContain('EF-ALICE-99');
    expect(result).not.toMatch(/\{\{[^}]+\}\}/);
  });
});

describe('supplier-verification-status template', () => {
  const baseData = {
    name: 'Test Supplier',
    statusTitle: 'Test Status',
    statusMessage: 'This is the status message.',
    headerGradient: 'linear-gradient(135deg,#059669,#10B981)',
    ctaGradient: 'linear-gradient(135deg,#059669,#10B981)',
    ctaText: 'Go to Dashboard',
    notesSection: '',
    dashboardUrl: 'https://event-flow.co.uk/dashboard-supplier',
    supportEmail: 'support@event-flow.co.uk',
  };

  test('renders without notes section', () => {
    const result = loadEmailTemplate('supplier-verification-status', baseData);
    expect(result).not.toBeNull();
    expect(result).toContain('Test Supplier');
    expect(result).toContain('Test Status');
    expect(result).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('renders with notes section HTML', () => {
    const result = loadEmailTemplate('supplier-verification-status', {
      ...baseData,
      notesSection: '<p>Please update your photos.</p>',
    });
    expect(result).toContain('Please update your photos.');
  });

  test('template contains required placeholders', () => {
    const tpl = fs.readFileSync(
      path.join(TEMPLATES_DIR, 'supplier-verification-status.html'),
      'utf8'
    );
    [
      '{{name}}',
      '{{statusTitle}}',
      '{{statusMessage}}',
      '{{notesSection}}',
      '{{dashboardUrl}}',
    ].forEach(p => {
      expect(tpl).toContain(p);
    });
  });
});

describe('Core template quality checks', () => {
  test('verification.html has {{verificationLink}} and {{name}}', () => {
    const t = fs.readFileSync(path.join(TEMPLATES_DIR, 'verification.html'), 'utf8');
    expect(t).toContain('{{verificationLink}}');
    expect(t).toContain('{{name}}');
  });

  test('password-reset.html has {{resetLink}} and {{name}}', () => {
    const t = fs.readFileSync(path.join(TEMPLATES_DIR, 'password-reset.html'), 'utf8');
    expect(t).toContain('{{resetLink}}');
    expect(t).toContain('{{name}}');
  });

  test('password-reset-confirmation.html mentions support/contact', () => {
    const t = fs.readFileSync(path.join(TEMPLATES_DIR, 'password-reset-confirmation.html'), 'utf8');
    expect(t.toLowerCase()).toMatch(/support|contact/);
  });

  test('marketing.html has {{unsubscribeLink}}', () => {
    const t = fs.readFileSync(path.join(TEMPLATES_DIR, 'marketing.html'), 'utf8');
    expect(t).toContain('{{unsubscribeLink}}');
  });

  test('action-prompts.html has {{actionsHtml}}', () => {
    const t = fs.readFileSync(path.join(TEMPLATES_DIR, 'action-prompts.html'), 'utf8');
    expect(t).toContain('{{actionsHtml}}');
  });

  test('newsletter-confirm.html has {{confirmLink}}', () => {
    const t = fs.readFileSync(path.join(TEMPLATES_DIR, 'newsletter-confirm.html'), 'utf8');
    expect(t).toContain('{{confirmLink}}');
  });

  test('all templates use {{year}} (not hard-coded years)', () => {
    fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .forEach(file => {
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
        expect(content).toContain('{{year}}');
      });
  });

  test('all templates include 600px max-width for email-client compatibility', () => {
    fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .forEach(file => {
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
        expect(content).toContain('600');
      });
  });

  test('all templates use table-based layout', () => {
    fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .forEach(file => {
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
        expect(content).toContain('<table');
      });
  });

  test('all templates have lang="en" on html element', () => {
    fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .forEach(file => {
        const content = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
        expect(content).toContain('lang="en"');
      });
  });
});

describe('postmark.js — allowed HTML keys', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../../utils/postmark.js'), 'utf8');
  });

  test('includes notesSection as an allowed HTML key', () => {
    expect(src).toContain("key === 'notesSection'");
  });

  test('preserves all original allowed HTML keys', () => {
    [
      "key === 'message'",
      "key === 'html'",
      "key === 'actionsHtml'",
      "key === 'unsubscribeSection'",
    ].forEach(k => {
      expect(src).toContain(k);
    });
  });
});
