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
  'support-ticket-reply',
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

  test('does NOT escape ctaSection (allowlisted HTML key)', () => {
    const ctaSection =
      '<table><tr><td><a href="https://example.com">Click here</a></td></tr></table>';
    const result = loadEmailTemplate('notification', {
      name: 'Test User',
      title: 'Test notification',
      message: 'Here is your update.',
      ctaSection,
      preferencesLink: 'https://example.com/settings',
    });
    expect(result).toContain('<a href="https://example.com">Click here</a>');
  });

  test('notification renders cleanly without ctaSection (no broken empty link)', () => {
    const result = loadEmailTemplate('notification', {
      name: 'Test User',
      title: 'Test notification',
      message: 'No CTA here.',
      ctaSection: '',
      preferencesLink: 'https://example.com/settings',
    });
    expect(result).not.toContain('href=""');
    expect(result).not.toBeNull();
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
    expect(src).toContain("'notesSection'");
    expect(src).toContain("'ctaSection'");
  });

  test('preserves all original allowed HTML keys', () => {
    ["'message'", "'html'", "'actionsHtml'", "'unsubscribeSection'"].forEach(k => {
      expect(src).toContain(k);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic template-reference scanner
// Scans all JS/route source files for `template: '...'` literals and verifies
// each referenced local template exists on disk — catches future omissions
// automatically without needing to update REFERENCED_TEMPLATES.
// ─────────────────────────────────────────────────────────────────────────────
describe('Dynamic template-reference scanner', () => {
  const SOURCE_ROOTS = [
    path.join(__dirname, '../../routes'),
    path.join(__dirname, '../../services'),
    path.join(__dirname, '../../utils'),
    path.join(__dirname, '../../webhooks'),
  ];

  // Template names that are intentionally NOT local email-templates/*.html files
  // (e.g. wedding-website templates stored elsewhere, or Postmark-hosted templates)
  const NON_LOCAL_TEMPLATES = new Set(['classic']);

  function scanDir(dir) {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...scanDir(full));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
    return files;
  }

  test('every template referenced by code has a matching email-templates/*.html file', () => {
    const allFiles = SOURCE_ROOTS.flatMap(dir => scanDir(dir));
    // Match: template: 'name' or template: "name"
    const templateRef = /template:\s*['"]([a-zA-Z0-9_-]+)['"]/g;
    const missing = [];

    for (const file of allFiles) {
      const src = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = templateRef.exec(src)) !== null) {
        const name = match[1];
        if (NON_LOCAL_TEMPLATES.has(name)) {
          continue;
        }
        const templatePath = path.join(TEMPLATES_DIR, `${name}.html`);
        if (!fs.existsSync(templatePath)) {
          missing.push({
            file: path.relative(path.join(__dirname, '../..'), file),
            template: name,
          });
        }
      }
    }

    if (missing.length > 0) {
      const detail = missing
        .map(({ file, template }) => `  - "${template}" referenced in ${file}`)
        .join('\n');
      throw new Error(
        `${missing.length} template reference(s) have no matching email-templates/*.html file:\n${detail}\n\nFix: create the missing template or add the name to NON_LOCAL_TEMPLATES if intentional.`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin campaigns — backend validation
// ─────────────────────────────────────────────────────────────────────────────
describe('Admin campaigns — CAMPAIGN_SAFE_TEMPLATES allowlist', () => {
  let CAMPAIGN_SAFE_TEMPLATES;
  beforeAll(() => {
    try {
      const mod = require('../../routes/admin-campaigns');
      CAMPAIGN_SAFE_TEMPLATES = mod.CAMPAIGN_SAFE_TEMPLATES;
    } catch {
      CAMPAIGN_SAFE_TEMPLATES = null;
    }
  });

  test('CAMPAIGN_SAFE_TEMPLATES is exported from admin-campaigns.js', () => {
    expect(CAMPAIGN_SAFE_TEMPLATES).toBeTruthy();
  });

  test('marketing is in the campaign-safe allowlist', () => {
    expect(CAMPAIGN_SAFE_TEMPLATES.has('marketing')).toBe(true);
  });

  test('transactional templates are not in the campaign-safe allowlist', () => {
    const transactional = [
      'verification',
      'password-reset',
      'password-reset-confirmation',
      'welcome',
      'welcome-customer',
      'welcome-supplier',
      'partner-welcome',
      'supplier-verification-status',
    ];
    transactional.forEach(name => {
      expect(CAMPAIGN_SAFE_TEMPLATES.has(name)).toBe(false);
    });
  });

  test('every campaign-safe template file exists on disk', () => {
    if (!CAMPAIGN_SAFE_TEMPLATES) {
      return;
    }
    CAMPAIGN_SAFE_TEMPLATES.forEach(name => {
      const templatePath = path.join(TEMPLATES_DIR, `${name}.html`);
      expect(fs.existsSync(templatePath)).toBe(true);
    });
  });
});

describe('Admin campaigns — marketing.html template quality', () => {
  let tpl;
  beforeAll(() => {
    tpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'marketing.html'), 'utf8');
  });

  test('marketing template contains {{unsubscribeLink}} placeholder', () => {
    expect(tpl).toContain('{{unsubscribeLink}}');
  });

  test('marketing template contains {{message}} placeholder (raw HTML injection)', () => {
    expect(tpl).toContain('{{message}}');
  });

  test('marketing template does not have leftover unresolved placeholders when rendered with minimal data', () => {
    const result = loadEmailTemplate('marketing', {
      name: 'Test User',
      title: 'Test Campaign',
      message: '<p>Hello from EventFlow.</p>',
      unsubscribeLink: 'https://event-flow.co.uk/unsubscribe?test=1',
    });
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('marketing template renders unsubscribe link as an anchor', () => {
    const result = loadEmailTemplate('marketing', {
      name: 'Test User',
      title: 'Test',
      message: 'Body',
      unsubscribeLink: 'https://event-flow.co.uk/unsubscribe',
    });
    expect(result).toContain('href="https://event-flow.co.uk/unsubscribe"');
  });
});

describe('Raw HTML allowlist keys — construction and safety', () => {
  test('postmark.js source documents all allowlisted HTML keys', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../utils/postmark.js'), 'utf8');
    const allowedKeys = [
      'message',
      'html',
      'features',
      'actionsHtml',
      'unsubscribeSection',
      'notesSection',
      'ctaSection',
    ];
    allowedKeys.forEach(key => {
      expect(src).toContain(`'${key}'`);
    });
  });

  test('notesSection in supplier-admin.js is escaped in the backend before injection', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/supplier-admin.js'), 'utf8');
    // The function must HTML-escape admin notes before wrapping in HTML markup
    expect(src).toContain('escapeHtml');
    expect(src).toContain('notesSection');
  });

  test('ctaSection in postmark.js is backend-constructed from validated actionUrl/actionText', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../utils/postmark.js'), 'utf8');
    expect(src).toContain('ctaSection');
    // Must only be built when both url and text are present
    expect(src).toContain('actionUrl && actionText');
  });

  test('message key in admin-campaigns.js is passed through escapeHtml for CTA, not raw', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/admin-campaigns.js'), 'utf8');
    // CTA button text should be escaped
    expect(src).toContain('escapeHtml(ctaText)');
    // CTA URL should go through escapeAttr which validates http/https
    expect(src).toContain('escapeAttr(ctaUrl)');
  });
});

describe('Email preview registry, preheaders and plain text', () => {
  const registry = require('../../utils/emailTemplateRegistry');

  test('preview registry covers every local HTML template', () => {
    const files = fs
      .readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .map(f => path.basename(f, '.html'))
      .sort();
    expect(
      registry
        .listTemplateDetails()
        .map(t => t.name)
        .sort()
    ).toEqual(files);
  });

  test.each([
    'verification',
    'password-reset',
    'password-reset-confirmation',
    'welcome-customer',
    'welcome-supplier',
    'partner-welcome',
    'supplier-verification-status',
    'support-ticket-reply',
    'marketing',
    'newsletter-confirm',
    'newsletter-welcome',
    'subscription-payment-failed',
    'subscription-activated',
    'subscription-cancelled',
  ])('%s has clean plain-text output', name => {
    const detail = registry.getTemplateDetails(name);
    const text = registry.renderPlainTextTemplate(name, detail.sampleData);
    expect(text.length).toBeGreaterThan(40);
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test('preheader is injected into rendered HTML and no placeholder remains', () => {
    const html = loadEmailTemplate('verification', registry.buildSampleData('verification'));
    expect(html).toContain('ef-preheader');
    expect(html).toContain(registry.getPreheader('verification'));
    expect(html).not.toContain('{{preheader}}');
  });

  test('canonical supplier dashboard route is used in welcome-supplier email', () => {
    const html = loadEmailTemplate(
      'welcome-supplier',
      registry.buildSampleData('welcome-supplier')
    );
    expect(html).toContain('/dashboard/supplier');
    expect(html).not.toContain('/dashboard-supplier');
    expect(html).not.toContain('/profile');
    expect(html).not.toContain('/inquiries');
  });

  test('canonical customer dashboard route is used in welcome-customer email', () => {
    const html = loadEmailTemplate(
      'welcome-customer',
      registry.buildSampleData('welcome-customer')
    );
    expect(html).toContain('/dashboard/customer');
    expect(html).not.toContain('/dashboard-customer');
    expect(html).not.toContain('/checklist');
  });

  test('support ticket reply template renders escaped subject and safe reply HTML', () => {
    const registry = require('../../utils/emailTemplateRegistry');
    const html = loadEmailTemplate('support-ticket-reply', {
      name: '<img src=x onerror=alert(1)>',
      ticketSubject: '<script>alert(1)</script>',
      replyMessageHtml: 'Hello&lt;br&gt;&lt;strong&gt;escaped&lt;/strong&gt;',
      ticketUrl: 'https://event-flow.co.uk/tickets/t1',
      supportEmail: 'support@event-flow.co.uk',
      preheader: registry.getPreheader('support-ticket-reply'),
    });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Hello&lt;br&gt;&lt;strong&gt;escaped&lt;/strong&gt;');
  });

  test('ticket admin reply uses support-ticket-reply via sendMail', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../routes/tickets.js'), 'utf8');
    expect(src).toContain('postmark.sendMail');
    expect(src).toContain("template: 'support-ticket-reply'");
    expect(src).toContain('Reply to your EventFlow support ticket');
    expect(src).toContain('safeLineBreakHtml(message)');
  });

  test('email branding keeps text-only fallback and avoids remote logo dependency', () => {
    const html = loadEmailTemplate('verification', registry.buildSampleData('verification'));
    expect(html).toContain('Event planning made simple');
    expect(html).toContain('>EF</span>');
    expect(html).not.toContain('/bimi.svg');
  });
});

describe('Admin email previews route module', () => {
  test('route source uses admin auth, CSRF and single-recipient validation', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-email-previews.js'),
      'utf8'
    );
    expect(src).toContain("roleRequired('admin')");
    expect(src).toContain('csrfProtection');
    expect(src).toContain('writeLimiter');
    expect(src).toContain('[TEST]');
    expect(src).toContain('validator.isEmail');
  });
});
