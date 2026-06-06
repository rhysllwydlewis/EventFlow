/**
 * Unit tests for Admin Campaigns page JS
 *
 * Verifies that admin-campaigns-init.js:
 *   - Uses AdminShared.api() for all API calls (not bare fetch)
 *   - Targets the three campaigns API endpoints
 *   - Registers a debounced preview refresh on editor inputs
 *   - Sends the correct payload shape for test and campaign send
 */

'use strict';

const fs = require('fs');
const path = require('path');

const INIT_JS = path.join(__dirname, '../../public/assets/js/pages/admin-campaigns-init.js');
const HTML_PAGE = path.join(__dirname, '../../public/admin-campaigns.html');
const REGISTRY = path.join(__dirname, '../../config/adminRegistry.js');

let initContent;
let htmlContent;

beforeAll(() => {
  initContent = fs.readFileSync(INIT_JS, 'utf8');
  htmlContent = fs.readFileSync(HTML_PAGE, 'utf8');
});

// ── Uses AdminShared.api() ────────────────────────────────────────────────────

describe('admin-campaigns-init.js — uses AdminShared.api()', () => {
  it('calls AdminShared.api for the preview endpoint', () => {
    expect(initContent).toContain("AdminShared.api('/api/admin/campaigns/preview'");
  });

  it('calls AdminShared.api for the test endpoint', () => {
    expect(initContent).toContain("AdminShared.api('/api/admin/campaigns/test'");
  });

  it('calls AdminShared.api for the send endpoint', () => {
    expect(initContent).toContain("AdminShared.api('/api/admin/campaigns/send'");
  });

  it('calls AdminShared.api for the recipient count endpoint', () => {
    expect(initContent).toContain("AdminShared.api('/api/admin/campaigns/recipient-count'");
  });

  it('uses AdminShared.showConfirmModal (not bare confirm) for send confirmation', () => {
    expect(initContent).toContain('AdminShared.showConfirmModal(');
  });

  it('does NOT use bare fetch() for campaign API calls', () => {
    // Remove comment lines to avoid false positives
    const code = initContent
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/\bfetch\s*\(/);
  });
});

// ── Debounced preview ─────────────────────────────────────────────────────────

describe('admin-campaigns-init.js — debounced live preview', () => {
  it('defines a debounce utility function', () => {
    expect(initContent).toContain('function debounce(');
  });

  it('debounces the preview refresh', () => {
    expect(initContent).toContain('debouncedRefreshPreview');
    expect(initContent).toContain('debounce(refreshPreview');
  });

  it('wires preview refresh to editor input events', () => {
    expect(initContent).toContain("addEventListener('input', debouncedRefreshPreview)");
  });
});

// ── Editor fields ─────────────────────────────────────────────────────────────

describe('admin-campaigns-init.js — editor field handling', () => {
  it('reads campaignSubject field', () => {
    expect(initContent).toContain("getElementById('campaignSubject')");
  });

  it('reads campaignTitle field', () => {
    expect(initContent).toContain("getElementById('campaignTitle')");
  });

  it('reads campaignMessage textarea', () => {
    expect(initContent).toContain("getElementById('campaignMessage')");
  });

  it('reads campaignCtaText field', () => {
    expect(initContent).toContain("getElementById('campaignCtaText')");
  });

  it('reads campaignCtaUrl field', () => {
    expect(initContent).toContain("getElementById('campaignCtaUrl')");
  });

  it('reads audience selector', () => {
    expect(initContent).toContain("getElementById('campaignAudience')");
  });

  it('reads subjectCharCounter element', () => {
    expect(initContent).toContain("getElementById('subjectCharCounter')");
  });

  it('pre-fills subject with default value', () => {
    expect(initContent).toContain("subjectEl.value = 'News from EventFlow'");
  });

  it('getEditorValues uses null-safe property access', () => {
    // All five fields should be guarded with a conditional before .value
    expect(initContent).toContain('subjectEl ? subjectEl.value.trim()');
    expect(initContent).toContain('titleEl ? titleEl.value.trim()');
    expect(initContent).toContain('messageEl ? messageEl.value');
  });
});

// ── Character counter ─────────────────────────────────────────────────────────

describe('admin-campaigns-init.js — character counter', () => {
  it('defines updateCharCounter function', () => {
    expect(initContent).toContain('function updateCharCounter(');
  });

  it('updates counter text with length / max format', () => {
    expect(initContent).toContain('/ ${max}');
  });

  it('adds warn class near limit', () => {
    expect(initContent).toContain('campaigns-char-counter--warn');
  });

  it('adds danger class at limit', () => {
    expect(initContent).toContain('campaigns-char-counter--danger');
  });

  it('wires up input event on subject field', () => {
    expect(initContent).toContain("addEventListener('input', updateCharCounter)");
  });
});

// ── Payload shape ─────────────────────────────────────────────────────────────

describe('admin-campaigns-init.js — API payload shape', () => {
  it('sends POST method for preview', () => {
    expect(initContent).toContain("'POST', values");
  });

  it('sends POST method for test', () => {
    const testIdx = initContent.indexOf("'/api/admin/campaigns/test'");
    const block = initContent.substring(testIdx, testIdx + 100);
    expect(block).toContain("'POST'");
  });

  it('sends POST method for send', () => {
    const sendIdx = initContent.indexOf("'/api/admin/campaigns/send'");
    const block = initContent.substring(sendIdx, sendIdx + 100);
    expect(block).toContain("'POST'");
  });

  it('includes audience in send payload', () => {
    expect(initContent).toContain('audience');
  });
});

// ── Status feedback ───────────────────────────────────────────────────────────

describe('admin-campaigns-init.js — status feedback', () => {
  it('has setStatus helper', () => {
    expect(initContent).toContain('function setStatus(');
  });

  it('shows success status after send', () => {
    expect(initContent).toContain("'success'");
  });

  it('shows error status on failure', () => {
    expect(initContent).toContain("'error'");
  });
});

// ── HTML page structure ───────────────────────────────────────────────────────

describe('admin-campaigns.html — page structure', () => {
  it('loads dashboard-guard.js', () => {
    expect(htmlContent).toContain('dashboard-guard.js');
  });

  it('mounts admin navbar via #adminNavbarMount', () => {
    expect(htmlContent).toContain('id="adminNavbarMount"');
  });

  it('loads admin-navbar.js', () => {
    expect(htmlContent).toContain('admin-navbar.js');
  });

  it('loads admin-shared.js', () => {
    expect(htmlContent).toContain('admin-shared.js');
  });

  it('loads admin-campaigns-init.js', () => {
    expect(htmlContent).toContain('admin-campaigns-init.js');
  });

  it('has send test button', () => {
    expect(htmlContent).toContain('id="campaignTestBtn"');
  });

  it('has send campaign button', () => {
    expect(htmlContent).toContain('id="campaignSendBtn"');
  });

  it('has live preview iframe', () => {
    expect(htmlContent).toContain('id="campaignPreviewFrame"');
  });

  it('has audience selector', () => {
    expect(htmlContent).toContain('id="campaignAudience"');
  });

  it('has split layout container', () => {
    expect(htmlContent).toContain('campaigns-layout');
  });

  it('has test delivery block with tinted background class', () => {
    expect(htmlContent).toContain('campaigns-test-block');
  });

  it('has send-to-recipients block with tinted background class', () => {
    expect(htmlContent).toContain('campaigns-send-block');
  });

  it('has subject character counter element', () => {
    expect(htmlContent).toContain('id="subjectCharCounter"');
  });

  it('test email input has aria-label (no hidden label wrapper)', () => {
    expect(htmlContent).toContain('aria-label="Test email address"');
  });
});

// ── Registry ──────────────────────────────────────────────────────────────────

describe('adminRegistry — campaigns page registered', () => {
  let registryContent;

  beforeAll(() => {
    registryContent = fs.readFileSync(REGISTRY, 'utf8');
  });

  it('admin-campaigns route is in registry', () => {
    expect(registryContent).toContain("route: '/admin-campaigns'");
  });

  it('admin-campaigns is visible in nav', () => {
    const idx = registryContent.indexOf("'/admin-campaigns'");
    const block = registryContent.substring(idx, idx + 200);
    expect(block).toContain('inNav: true');
  });
});

// ── Admin Navbar ──────────────────────────────────────────────────────────────

describe('admin-navbar.js — campaigns nav item', () => {
  const NAVBAR_JS = path.join(__dirname, '../../public/assets/js/admin-navbar.js');
  let navbarContent;

  beforeAll(() => {
    navbarContent = fs.readFileSync(NAVBAR_JS, 'utf8');
  });

  it('admin-navbar.js contains campaigns nav item', () => {
    expect(navbarContent).toContain("href: '/admin-campaigns'");
  });

  it('campaigns nav item is in operations group', () => {
    const idx = navbarContent.indexOf("href: '/admin-campaigns'");
    const block = navbarContent.substring(idx, idx + 200);
    expect(block).toContain("group: 'operations'");
  });

  it('campaigns nav item has the 📣 icon', () => {
    const idx = navbarContent.indexOf("href: '/admin-campaigns'");
    const block = navbarContent.substring(idx, idx + 200);
    expect(block).toContain("icon: '📣'");
  });
});

describe('admin-campaigns backend safety helpers', () => {
  it('sanitises dangerous advanced HTML before rendering campaign message', () => {
    const { buildTemplateData } = require('../../routes/admin-campaigns');
    const data = buildTemplateData({
      title: 'Safety',
      bodyHtml:
        '<p onclick="alert(1)">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
      ctaText: 'Read more',
      ctaUrl: 'https://event-flow.co.uk/guides',
    });
    expect(data.message).toContain('<p>Hello</p>');
    expect(data.message).not.toContain('<script>');
    expect(data.message).not.toContain('onclick=');
    expect(data.message).not.toContain('javascript:');
  });

  it('validates CTA text and URL together', () => {
    const { validateCampaignLinks } = require('../../routes/admin-campaigns');
    expect(validateCampaignLinks({ ctaText: 'Open', ctaUrl: '' })).toContain('together');
    expect(validateCampaignLinks({ ctaText: '', ctaUrl: 'https://event-flow.co.uk' })).toContain(
      'together'
    );
    expect(validateCampaignLinks({ ctaText: 'Open', ctaUrl: '/relative' })).toContain(
      'http:// or https://'
    );
    expect(validateCampaignLinks({ ctaText: 'Open', ctaUrl: 'https://event-flow.co.uk' })).toBe('');
  });
});

describe('admin-email-previews page registration', () => {
  it('adminRegistry registers the slash route', () => {
    const registryContent = fs.readFileSync(REGISTRY, 'utf8');
    expect(registryContent).toContain("route: '/admin-email-previews'");
  });

  it('admin navbar includes email previews', () => {
    const navbarContent = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/admin-navbar.js'),
      'utf8'
    );
    expect(navbarContent).toContain("href: '/admin/email-previews'");
  });
});
