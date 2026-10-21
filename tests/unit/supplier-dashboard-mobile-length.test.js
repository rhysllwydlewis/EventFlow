'use strict';

/**
 * Keeping the phone page short: secondary cards fold into real <details> under 768px, the second
 * row of numbers folds into "More numbers", long lists show a few rows and "Show all", and only the
 * first two reviews show until asked. Nothing is removed on a wide screen.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const html = read('public/dashboard-supplier.html');
const css = read('public/assets/css/supplier-dashboard-home.css');
const homeJs = read('public/assets/js/pages/supplier-dashboard-home.js');
const reviewsJs = read('public/assets/js/pages/supplier-reviews-init.js');
const appJs = read('public/assets/js/app.js');

const fold = JSON.parse(
  execFileSync(
    process.execPath,
    [path.join(__dirname, '../helpers/supplier-overlays-scenario.js'), 'fold'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
  )
);

describe('phone page length', () => {
  test('six secondary cards fold into a closed <details> with "Show <name>", keeping their ids and bodies', () => {
    expect(fold.folded.map(item => item.id)).toEqual([
      'sdh-performance',
      'sdh-availability',
      'availability-calendar',
      'sdh-tips',
      'sdh-plan',
      'sdh-support',
    ]);
    fold.folded.forEach(item => {
      expect(item.open).toBe(false);
      expect(item.summary).toMatch(/^Show /);
      expect(item.bodyInside).toBe(true);
    });
    expect(fold.idsStillThere).toBe(true);
  });

  test('the cards a supplier acts on (steps, profile, packages, enquiries, reviews, messages) never fold', () => {
    expect(fold.otherCardsUntouched).toBe(true);
  });

  test('opening a fold changes its label, and the calendar is told it has room now', () => {
    expect(fold.afterOpen).toBe('Hide calendar');
    expect(fold.calendarResized).toBe(1);
  });

  test('on a wide screen everything goes back where it was', () => {
    expect(fold.unfolded).toBe(true);
    expect(fold.bodiesBack).toBe(true);
  });

  test('something that sends the supplier to a folded card (a step link) opens it first', () => {
    expect(homeJs).toContain(
      "node.closest('details.sdh-fold') || node.querySelector('details.sdh-fold')"
    );
    expect(html).toMatch(/supplier-dashboard-fold\.js\?v=\d/);
  });

  test('the second row of numbers is "More numbers" on a phone and always open on a wide screen', () => {
    expect(homeJs).toContain('<summary class="sdh-more__summary">More numbers</summary>');
    expect(homeJs).toContain("phone ? '' : ' open'");
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{[^}]*\.sdh-summary__more > summary \{\s*display: none/
    );
  });

  test('package rows fold after three on a phone and five elsewhere', () => {
    expect(appJs).toContain('PACKAGES_SHOWN_FIRST_PHONE = 3');
    expect(appJs).toContain('PACKAGES_SHOWN_FIRST = 5');
  });

  test('reviews: two on a phone until "Show all", no sort or page controls when they are pointless', () => {
    expect(reviewsJs).toContain("' sr-list--capped'");
    expect(reviewsJs).toContain('id="sr-show-all"');
    expect(reviewsJs).toContain('(reviews || []).length > 3 || pages > 1');
    expect(css).toMatch(
      /\.sr-list--capped \.sr-review-card:nth-child\(n \+ 3\) \{\s*display: none/
    );
  });
});
