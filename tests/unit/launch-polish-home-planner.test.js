'use strict';

/**
 * Launch polish — homepage credibility and planner first impression.
 * Quick smoke tests; proportionate to the small scope of the PR.
 */

const fs   = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '../../public');
const JS_DIR = path.resolve(__dirname, '../../public/assets/js');

const read   = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const readJs = f => fs.readFileSync(path.join(JS_DIR, f), 'utf8');

// ─── Item 1: Homepage credibility ─────────────────────────────────────────

describe('Homepage credibility — index.html', () => {
  const html = read('index.html');

  test('no fake testimonial heading "What Our Customers Say"', () => {
    expect(html).not.toContain('What Our Customers Say');
  });

  test('no fake "Real experiences from real event planners" subtitle', () => {
    expect(html).not.toContain('Real experiences from real event planners');
  });

  test('no fabricated testimonial names (Sarah & Tom, James Wilson, Emma Davies)', () => {
    expect(html).not.toContain('Sarah &amp; Tom');
    expect(html).not.toContain('Sarah & Tom');
    expect(html).not.toContain('James Wilson');
    expect(html).not.toContain('Emma Davies');
  });

  test('no fake 5-star testimonial stars (★★★★★) used as social proof', () => {
    // Stars may appear in other contexts but should not be in a testimonial context
    // We check the testimonials carousel element is gone
    expect(html).not.toContain('ef-testimonials-carousel');
  });

  test('homepage has an honest launch-context section', () => {
    // Should now contain the controlled-launch section
    expect(html).toMatch(/opening|early access|being added/i);
  });

  test('homepage category subtitle does not overclaim "full range of verified"', () => {
    expect(html).not.toContain('Explore our full range of verified UK suppliers');
  });

  test('meta description does not use "Search verified suppliers"', () => {
    const metaDesc = html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1] || '';
    expect(metaDesc).not.toMatch(/Search verified suppliers/i);
  });

  test('CTAs are still present: Start planning and Browse suppliers', () => {
    expect(html).toContain('Start planning');
    expect(html).toContain('Browse suppliers');
  });

  test('Supplier CTA section still present', () => {
    expect(html).toContain('Are you an event supplier?');
  });
});

// ─── Item 2: /start planner first impression ───────────────────────────────

describe('/start planner — start.html', () => {
  const html = read('start.html');

  test('wizard-container exists', () => {
    expect(html).toContain('id="wizard-container"');
  });

  test('pre-hydration fallback card is inside wizard-container', () => {
    const containerBlock = html.slice(
      html.indexOf('id="wizard-container"'),
      html.indexOf('</div>', html.indexOf('id="wizard-container"') + 200) + 200
    );
    expect(containerBlock).toContain('wizard-preload');
  });

  test('pre-hydration card shows the 5 planning steps', () => {
    expect(html).toContain('Event type and date');
    expect(html).toContain('Location, guests and budget');
    expect(html).toContain('Priorities and style');
    expect(html).toContain('Supplier categories to consider');
    expect(html).toContain('Review your plan');
  });

  test('pre-hydration copy is honest — no AI matching claims', () => {
    const preloadSection = html.slice(
      html.indexOf('wizard-preload'),
      html.indexOf('</div>', html.indexOf('wizard-preload') + 500) + 50
    );
    expect(preloadSection).not.toMatch(/AI|instant match|guaranteed/i);
  });

  test('start.html does not show "Version: loading" text', () => {
    expect(html).not.toMatch(/Version:\s*<span[^>]*>loading/i);
  });

  test('start-wizard.js removes preload card on first render', () => {
    const js = readJs('pages/start-wizard.js');
    expect(js).toContain('wizard-preload');
    expect(js).toContain('preload.remove()');
  });
});

// ─── Regression: previous launch-readiness fixes still intact ─────────────

describe('Regression — previous launch-readiness fixes', () => {
  test('index.html: notification dropdown has hidden attribute', () => {
    const html = read('index.html');
    // This may not be on main yet (PR #1221 may not be merged)
    // But should not have been regressed if it was present
    if (html.includes('notification-dropdown')) {
      // If the PR was already merged, check for hidden
      const hasHidden = /id="notification-dropdown"[^>]*hidden/.test(html);
      const hasDisplayNone = /id="notification-dropdown"[^>]*display: none/.test(html);
      // One of these must be true — dropdown must be hidden by default
      expect(hasHidden || hasDisplayNone).toBe(true);
    }
  });

  test('index.html: version wrapper not showing "loading" to public', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/Version:\s*<span[^>]*>loading/i);
  });

  test('start.html: no "Dashboard" in visible static HTML without being hidden', () => {
    const html = read('start.html');
    // Dashboard link must be hidden if present
    const dashLinks = html.match(/<a[^>]*>[^<]*Dashboard[^<]*<\/a>/g) || [];
    dashLinks.forEach(link => {
      expect(link).toMatch(/display: none|hidden/);
    });
  });

  test('index.html: Dashboard links have display:none in static HTML', () => {
    const html = read('index.html');
    const dashLinks = html.match(/<a[^>]*>[^<]*Dashboard[^<]*<\/a>/gs) || [];
    if (dashLinks.length > 0) {
      dashLinks.forEach(link => {
        expect(link).toMatch(/display: none|hidden/);
      });
    }
  });
});
