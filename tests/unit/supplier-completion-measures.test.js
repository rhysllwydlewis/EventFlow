'use strict';

/**
 * #1408: a supplier saw "Profile completeness" on the dashboard and "Profile
 * completeness" on the Profile Customisation page, but they measure different things,
 * so one could say 100% while the other said 33%. Each measure now has its own name.
 *
 * - Profile health: the weighted score the server computes (photo, description,
 *   location, banner, gallery, socials, website). The dashboard shows it and admins
 *   see the same number, which tests/unit/supplier-profile-completeness-parity.test.js
 *   keeps from drifting.
 * - Personalisation: the Profile Customisation meter (banner, tagline, highlights,
 *   services, social links).
 *
 * Admins also see a separate "Quality score"; its tooltip already says it is not the
 * profile health score.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('supplier completion measures have distinct names', () => {
  const dashboard = read('public/assets/js/pages/supplier-dashboard-home.js');
  const customisationHtml = read('public/supplier/profile-customization.html');
  const customisationJs = read('public/supplier/js/profile-customization.js');

  test('the dashboard tile is the profile health score', () => {
    expect(dashboard).toContain("'Profile health'");
    expect(dashboard).toContain('Profile health ${profile.score}%');
    expect(dashboard).not.toContain("'Profile complete'");
    expect(dashboard).not.toMatch(/Profile \$\{profile\.score\}% complete/);
  });

  test('the customisation meter is called personalisation and says how it differs', () => {
    const label = customisationHtml.match(
      /<span class="pc-completion-label"([^>]*)>([^<]*)<\/span>/
    );
    expect(label).not.toBeNull();
    expect(label[2]).toBe('Personalisation');
    expect(label[1]).toMatch(/title="[^"]*separate from the Profile health score/);
    expect(customisationHtml).not.toMatch(/pc-completion-label[^>]*>Profile completeness/);
  });

  test('the personalisation meter really measures personal touches, not overall completeness', () => {
    const meter = customisationJs.slice(customisationJs.indexOf('checks = {'));
    for (const key of ['tagline', 'highlights', 'services', 'social']) {
      expect(meter.slice(0, 600)).toContain(`${key}:`);
    }
  });

  test('no supplier-facing screen labels two different numbers "profile completeness"', () => {
    const screens = [
      dashboard,
      customisationHtml,
      read('public/dashboard-supplier.html'),
      read('public/assets/js/pages/supplier-dashboard-home.js'),
    ].join('\n');
    expect(screens).not.toMatch(
      /Profile completeness<|'Profile Completeness'|>Profile completeness/
    );
  });

  test('the unused third "Profile Completeness" checklist widget has been removed', () => {
    const widgets = read('public/assets/js/dashboard-widgets.js');
    expect(widgets).not.toContain('createProfileChecklist');
    expect(widgets).not.toContain('Profile Completeness');
  });

  test('the admin profile health widget keeps its name and stays admin-only', () => {
    expect(read('public/assets/js/components/profile-health-widget.js')).toContain(
      '<h2 id="health-widget-title">Profile Health</h2>'
    );
    expect(read('public/dashboard-supplier.html')).not.toContain('profile-health-widget');
  });
});
