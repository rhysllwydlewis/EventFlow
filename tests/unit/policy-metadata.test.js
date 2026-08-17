'use strict';

const fs = require('fs');
const path = require('path');

const {
  POLICY_METADATA,
  formatPolicyDate,
  getPolicyPlaceholders,
} = require('../../config/policyMetadata');
const { getPlaceholders } = require('../../config/content-config');

const ROOT = path.resolve(__dirname, '../..');
const POLICY_PAGES = [
  'public/legal.html',
  'public/terms.html',
  'public/privacy.html',
  'public/data-rights.html',
  'public/community-guidelines.html',
  'public/community-help.html',
];

function render(content) {
  return Object.entries(getPlaceholders()).reduce(
    (html, [key, value]) => html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    content
  );
}

describe('reviewed policy metadata', () => {
  it('uses complete ISO dates and real source files for every policy', () => {
    Object.values(POLICY_METADATA).forEach(policy => {
      expect(policy.version).toMatch(/^\d+\.\d+$/);
      expect(policy.lastMaterialUpdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(policy.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(policy.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(policy.lastReviewed >= policy.lastMaterialUpdate).toBe(true);
      expect(fs.existsSync(path.join(ROOT, policy.sourcePath))).toBe(true);
      expect(() => formatPolicyDate(policy.lastMaterialUpdate)).not.toThrow();
    });
  });

  it('provides separate updated, effective, reviewed and version placeholders', () => {
    const placeholders = getPolicyPlaceholders();
    expect(placeholders.POLICY_TERMS_LAST_UPDATED).toBe('6 August 2026');
    expect(placeholders.POLICY_TERMS_LAST_REVIEWED).toBe('6 August 2026');
    expect(placeholders.POLICY_COOKIE_POLICY_LAST_UPDATED).toBe('6 August 2026');
    expect(placeholders.POLICY_COOKIE_POLICY_LAST_REVIEWED).toBe('6 August 2026');
    expect(placeholders.POLICY_PRIVACY_VERSION).toBe('1.2');
  });

  it('renders every public policy page without unresolved placeholders', () => {
    POLICY_PAGES.forEach(file => {
      const rendered = render(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      expect(rendered).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    });
  });

  it('does not use one shared legal date on distinct public policies', () => {
    POLICY_PAGES.forEach(file => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(source).not.toContain('{{LEGAL_LAST_UPDATED}}');
      expect(source).not.toContain('{{LEGAL_EFFECTIVE_DATE}}');
    });
  });

  it('keeps every Legal Hub navigation fragment connected to a section', () => {
    const source = fs.readFileSync(path.join(ROOT, 'public/legal.html'), 'utf8');
    const fragments = [...source.matchAll(/<a href="#([a-z0-9-]+)"/g)].map(match => match[1]);
    expect(fragments.length).toBeGreaterThan(10);
    fragments.forEach(fragment => {
      expect(source).toContain(`id="${fragment}"`);
    });
    expect(source).not.toContain('href="#changelog"');
  });

  it('keeps the processor and storage inventory aligned with the implementation', () => {
    const privacy = fs.readFileSync(path.join(ROOT, 'public/privacy.html'), 'utf8');

    expect(privacy).toContain('<strong>Postmark:</strong>');
    expect(privacy).toContain('<strong>MongoDB:</strong>');
    expect(privacy).toContain('<strong>Google Identity Services:</strong>');
    expect(privacy).toContain('<strong>Sign in with Apple:</strong>');
    expect(privacy).not.toMatch(/AWS S3|AWS SES|SendGrid|Custom SMTP Servers/);
    expect(privacy).not.toContain('TLS 1.3');
  });
});
