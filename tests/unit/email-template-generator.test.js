/**
 * The email templates are generated from one shell
 * (`scripts/generate-email-templates.mjs`) and committed, because the runtime
 * loader reads them from disk. Nothing else keeps the two in step, so a hand edit
 * to an `email-templates/*.html` file would be silently overwritten the next time
 * someone regenerates. `--check` regenerates in memory and compares.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-email-templates.mjs');
const TEMPLATES_DIR = path.join(ROOT, 'email-templates');
const LOGO_DIR = path.join(ROOT, 'public/assets/email');

describe('the committed email templates match their generator', () => {
  it('reports no drift', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync('node', [GENERATOR, '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      failed = true;
      output = `${error.stdout || ''}${error.stderr || ''}`;
    }
    expect(failed ? output : '').toBe('');
    expect(output).toContain('match the generator');
  });

  it('does not write anything in --check mode', () => {
    const target = path.join(TEMPLATES_DIR, 'welcome.html');
    const before = fs.readFileSync(target, 'utf8');
    execFileSync('node', [GENERATOR, '--check'], { cwd: ROOT, stdio: 'ignore' });
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
  });
});

describe('email logo assets', () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const referenced = new Set();

  beforeAll(() => {
    fs.readdirSync(TEMPLATES_DIR)
      .filter(f => f.endsWith('.html'))
      .forEach(file => {
        const html = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf8');
        for (const match of html.matchAll(/\{\{baseUrl\}\}\/assets\/email\/([\w.-]+\.png)/g)) {
          referenced.add(match[1]);
        }
      });
  });

  it('are referenced by the templates', () => {
    expect([...referenced].sort()).toEqual([
      'eventflow-mark-white.png',
      'eventflow-wordmark-white.png',
      'eventflow-wordmark.png',
    ]);
  });

  it.each(['eventflow-mark-white.png', 'eventflow-wordmark-white.png', 'eventflow-wordmark.png'])(
    '%s exists and is a PNG',
    file => {
      const buffer = fs.readFileSync(path.join(LOGO_DIR, file));
      expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      // Gmail clips messages over 102KB, so logos must stay small.
      expect(buffer.length).toBeLessThan(40 * 1024);
    }
  );

  it('every image a template references is on disk', () => {
    referenced.forEach(file => {
      expect(fs.existsSync(path.join(LOGO_DIR, file))).toBe(true);
    });
  });
});

describe('email markup helpers', () => {
  const { buildEmailButton, renderDetailRow } = require('../../utils/emailComponents');

  it('builds a button for http(s) URLs and escapes the label', () => {
    const html = buildEmailButton('https://event-flow.co.uk/a?b=1&c=2', '<b>Go</b>');
    expect(html).toContain('href="https://event-flow.co.uk/a?b=1&amp;c=2"');
    expect(html).toContain('&lt;b&gt;Go&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it.each(['javascript:alert(1)', '#', '', undefined, null, '//evil.example'])(
    'renders nothing for the non-http(s) URL %p',
    url => {
      expect(buildEmailButton(url, 'Go')).toBe('');
    }
  );

  it('keeps button padding on the table cell so Outlook honours it', () => {
    const html = buildEmailButton('https://event-flow.co.uk', 'Go');
    expect(html).toMatch(/<td[^>]*bgcolor="#006D7F"[^>]*padding:16px 40px/);
  });

  it('renders detail rows that match the rows templates inject', () => {
    const row = renderDetailRow('Trial period', '14 days');
    expect(row).toContain('Trial period');
    expect(row).toContain('14 days');
    expect(row.startsWith('<tr>')).toBe(true);
  });
});

describe('responsive and dark-mode styles', () => {
  const html = fs.readFileSync(
    path.join(TEMPLATES_DIR, 'subscription-payment-failed.html'),
    'utf8'
  );

  it('shrinks only the hero heading on phones', () => {
    // `.h1` is also the dark-mode ink class used on step titles and detail values;
    // sizing it on mobile once made those 26px.
    expect(html).toMatch(/\.hero-h1 \{ font-size: 26px !important; \}/);
    expect(html).not.toMatch(/\.h1 \{ font-size/);
  });

  it('swaps in the white wordmark for dark mode', () => {
    expect(html).toContain('class="logo-dark"');
    expect(html).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*\.logo-dark \{ display: block/
    );
  });
});

describe('send-time CTA markup uses the shared button', () => {
  jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }));

  it('campaign CTAs render the shared button with escaped text and URL', () => {
    const { buildTemplateData } = require('../../routes/admin-campaigns');
    const { message } = buildTemplateData({
      title: 'Spring',
      bodyText: 'Hello',
      ctaText: 'Book <now>',
      ctaUrl: 'https://event-flow.co.uk/offer?a=1',
    });
    expect(message).toContain('class="cta-button"');
    expect(message).toContain('href="https://event-flow.co.uk/offer?a=1"');
    expect(message).toContain('Book &lt;now&gt;');
    expect(message).toMatch(/<td[^>]*bgcolor="#006D7F"[^>]*padding:16px 40px/);
    expect(message).not.toContain('Book <now>');
  });
});
