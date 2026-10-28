'use strict';

/**
 * Admin audit Group 8 (page merges): External contacts folded into Enquiries, Campaigns and
 * Email previews folded into the Email Centre, Cashouts and the Campaign report folded into the
 * Partner Programme page. Each retired address must still work and land on the right tab.
 */

const fs = require('fs');
const path = require('path');
const { REGISTRY } = require('../../config/adminRegistry');

const ROOT = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PAGES = 'public/assets/js/pages/';

// retired page -> where it now lives
const MERGES = [
  { from: 'admin-external-contacts', to: '/admin-tickets', tab: 'external' },
  { from: 'admin-campaigns', to: '/admin-emails', tab: 'campaigns' },
  { from: 'admin-email-previews', to: '/admin-emails', tab: 'templates' },
  { from: 'admin-cashout-requests', to: '/admin-partners', tab: 'cashouts' },
  { from: 'admin-partner-campaign-report', to: '/admin-partners', tab: 'report' },
];

describe('retired pages', () => {
  it.each(MERGES)('$from no longer has a page file', ({ from }) => {
    expect(fs.existsSync(path.join(ROOT, `public/${from}.html`))).toBe(false);
  });

  it.each(MERGES)('$from is a registry redirect to the $tab tab and is not in the menu', m => {
    const entry = REGISTRY.find(page => page.route === `/${m.from}`);
    expect(entry).toBeDefined();
    expect(entry.redirect).toBe(`${m.to}?tab=${m.tab}`);
    expect(entry.inNav).toBe(false);
  });

  it.each(MERGES)('$from is not a menu tile', ({ from }) => {
    const navbar = read('public/assets/js/admin-navbar.js');
    expect(navbar).not.toContain(`href: '/${from}'`);
  });

  it('the static server and the app both redirect cashouts and the report, keeping the query', () => {
    for (const file of ['server.js', 'scripts/serve-static.js']) {
      const source = read(file);
      expect(source).toContain("['/admin-cashout-requests', 'cashouts']");
      expect(source).toContain("['/admin-partner-campaign-report', 'report']");
      expect(source).toContain('`${qs}&tab=${tab}`');
      expect(source).toContain('/admin-partners${base}');
    }
  });

  it('no longer lists a retired page as a static admin page or guards it separately', () => {
    expect(read('scripts/serve-static.js')).not.toMatch(/^\s+'admin-cashout-requests',$/m);
    expect(read('server.js')).not.toContain('Admin Cashout Requests Page Protection');
  });

  it('the dashboard router no longer serves a retired page (the redirects run before it)', () => {
    const source = read('routes/dashboard.js');
    expect(source).not.toContain('admin-cashout-requests');
    expect(source).not.toContain('email-previews');
  });
});

describe('notification links', () => {
  it('cashout notifications open the Cashouts tab, with the request when there is one', () => {
    const source = read('services/partnerCashoutOperationsRuntime.js');
    expect(source).not.toContain('/admin-cashout-requests.html');
    expect(source).toContain('/admin-partners?tab=cashouts&request=${request.id}');
    expect(source).toContain("actionUrl: '/admin-partners?tab=cashouts'");
  });
});

describe('the Partner Programme page', () => {
  const html = read('public/admin-partners.html');

  it('has a tab and a panel for Partners, Cashouts and the Campaign report', () => {
    for (const name of ['partners', 'cashouts', 'report']) {
      expect(html).toContain(`id="tab-${name}"`);
      expect(html).toContain(`id="panel-${name}"`);
    }
  });

  it('loads the tab helper and both merged scripts, with their styles', () => {
    expect(html).toMatch(/utils\/admin-tabs\.js\?v=/);
    expect(html).toMatch(/admin-cashout-requests-init\.js\?v=/);
    expect(html).toMatch(/admin-partner-campaign-report-init\.js\?v=/);
    expect(html).toMatch(/admin-cashout-requests\.css\?v=/);
    expect(html).toMatch(/admin-partner-campaign-report\.css\?v=/);
  });

  it('opens the Cashouts tab from the old gift-card payout block', () => {
    expect(html).toContain('data-open-tab="cashouts"');
    expect(read(`${PAGES}admin-partners-init.js`)).toContain('[data-open-tab]');
  });

  it('keeps the cashout confirmation dialog and toast outside the tab, so they show on every tab', () => {
    const panelStart = html.indexOf('id="panel-cashouts"');
    const panelEnd = html.indexOf('id="panel-report"');
    expect(html.indexOf('acr-modal-overlay')).toBeGreaterThan(panelEnd);
    expect(panelStart).toBeGreaterThan(-1);
  });

  it('the cashout and report scripts wait for their tab instead of loading on page open', () => {
    const cashouts = read(`${PAGES}admin-cashout-requests-init.js`);
    const report = read(`${PAGES}admin-partner-campaign-report-init.js`);
    expect(cashouts).toContain('window.AdminCashouts = {');
    expect(report).toContain('window.AdminCampaignReport = {');
    for (const script of [cashouts, report]) {
      expect(script).not.toContain("document.addEventListener('DOMContentLoaded', init)");
      expect(script).toContain('let started = false;');
    }
    const partners = read(`${PAGES}admin-partners-init.js`);
    expect(partners).toContain('window.AdminCashouts.start()');
    expect(partners).toContain('window.AdminCampaignReport.start()');
  });
});

describe('the Enquiries and Email Centre pages', () => {
  it('Enquiries has the External tab and loads the helper before its scripts', () => {
    const html = read('public/admin-tickets.html');
    expect(html).toContain('id="tab-external"');
    expect(html.indexOf('utils/admin-tabs.js')).toBeLessThan(html.indexOf('admin-tickets-init.js'));
    expect(read(`${PAGES}admin-external-contacts-init.js`)).toContain(
      'window.AdminExternalContacts = {'
    );
  });

  it('the Email Centre mounts Campaigns and Templates lazily', () => {
    const html = read('public/admin-emails.html');
    expect(html).toContain('data-tab="campaigns"');
    expect(html).toContain('data-tab="templates"');
    const script = read(`${PAGES}admin-emails-init.js`);
    expect(script).toContain('window.AdminTabs.mount');
    expect(script).toContain('AdminCampaigns');
    expect(script).toContain('AdminEmailPreviews');
  });
});

describe('the External tab badge', () => {
  it('shows the count the navbar already fetched, before the tab is opened', () => {
    const navbar = read('public/assets/js/admin-navbar.js');
    expect(navbar).toContain("new CustomEvent('admin:pending-counts'");
    expect(navbar).toContain('window.AdminPendingCounts = pending;');
    const script = read(`${PAGES}admin-external-contacts-init.js`);
    expect(script).toContain("document.addEventListener('admin:pending-counts'");
    expect(script).toContain('showNavbarCount(window.AdminPendingCounts);');
    // once the tab's own list has loaded, the count from that list takes over
    expect(script).toContain('if (!started && pending');
  });
});

describe('the menu', () => {
  it('shows the Partner Programme page as "Partners" and no longer lists Cashout Requests', () => {
    const navbar = read('public/assets/js/admin-navbar.js');
    expect(navbar).toContain("label: 'Partners'");
    expect(navbar).not.toContain("label: 'Cashout Requests'");
  });
});
