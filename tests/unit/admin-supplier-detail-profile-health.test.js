/**
 * Admin supplier detail page — Profile Health stat box and the (i) info
 * popovers on Quality Score / Profile Health.
 *
 * Guards the contract between the static HTML and the page JS so a
 * future edit can't silently break the wiring (mismatched ids, a script
 * load-order regression that leaves window.ProfileHealthWidget undefined
 * when admin-supplier-detail-init.js runs, etc).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DETAIL_HTML = path.join(__dirname, '../../public/admin-supplier-detail.html');
const DETAIL_INIT = path.join(
  __dirname,
  '../../public/assets/js/pages/admin-supplier-detail-init.js'
);

let htmlContent;
let initContent;

beforeAll(() => {
  htmlContent = fs.readFileSync(DETAIL_HTML, 'utf8');
  initContent = fs.readFileSync(DETAIL_INIT, 'utf8');
});

describe('Admin supplier detail — Profile Health stat box', () => {
  it('renders a Profile Health stat box distinct from Quality Score', () => {
    expect(htmlContent).toContain('id="profileHealthScore"');
    expect(htmlContent).toContain('id="profileHealthChecklist"');
    expect(htmlContent).toContain('Profile Health');
    expect(htmlContent).toContain('Quality Score');
  });

  it('loads ProfileHealthWidget before admin-supplier-detail-init.js so window.ProfileHealthWidget exists in time', () => {
    const widgetIdx = htmlContent.indexOf('/assets/js/components/profile-health-widget.js');
    const initIdx = htmlContent.indexOf('/assets/js/pages/admin-supplier-detail-init.js');
    expect(widgetIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(-1);
    expect(widgetIdx).toBeLessThan(initIdx);
  });

  it('page JS reuses ProfileHealthWidget.calculate rather than a new formula', () => {
    expect(initContent).toContain('window.ProfileHealthWidget');
    expect(initContent).toContain('.calculate(supplierData)');
  });

  it('falls back gracefully when ProfileHealthWidget failed to load', () => {
    const fnBody = initContent.slice(initContent.indexOf('function renderProfileHealth()'));
    expect(fnBody).toContain("typeof window.ProfileHealthWidget.calculate !== 'function'");
  });

  it('renders the per-item checklist so support staff can see what is missing', () => {
    const fnBody = initContent.slice(
      initContent.indexOf('function renderProfileHealth()'),
      initContent.indexOf('function setupStatInfoPopovers()')
    );
    expect(fnBody).toContain('completedItems');
    expect(fnBody).toContain('incompleteItems');
    expect(fnBody).toContain('profileHealthChecklist');
  });
});

describe('Admin supplier detail — stat box info popovers', () => {
  it('both stat boxes have an (i) button wired to a popover via aria-controls', () => {
    expect(htmlContent).toContain('id="qualityScoreInfoBtn"');
    expect(htmlContent).toContain('aria-controls="qualityScoreInfoPopover"');
    expect(htmlContent).toContain('id="qualityScoreInfoPopover"');

    expect(htmlContent).toContain('id="profileHealthInfoBtn"');
    expect(htmlContent).toContain('aria-controls="profileHealthInfoPopover"');
    expect(htmlContent).toContain('id="profileHealthInfoPopover"');
  });

  it('explains why Quality Score can look low for a new, complete profile', () => {
    const popoverStart = htmlContent.indexOf('id="qualityScoreInfoPopover"');
    const popoverBlock = htmlContent.slice(popoverStart, popoverStart + 900);
    expect(popoverBlock).toMatch(/activity|response rate|reviews|bookings/i);
  });

  it('closes on Escape and outside click, and toggles aria-expanded', () => {
    const fnBody = initContent.slice(initContent.indexOf('function setupStatInfoPopovers()'));
    expect(fnBody).toContain("event.key === 'Escape'");
    expect(fnBody).toContain("addEventListener('click', () => closeAll(null))");
    expect(fnBody).toContain("setAttribute('aria-expanded'");
  });
});
