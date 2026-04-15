const { chromium, devices } = require('/home/runner/work/EventFlow/EventFlow/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:4173';
const OUT = path.resolve(__dirname, '../docs/screenshots/mobile');
fs.mkdirSync(OUT, { recursive: true });

// iPhone 13 dimensions (375×812)
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const pages = [
  // Public / Marketing
  { slug: 'public--homepage',                path: '/',                                       section: 'Public' },
  { slug: 'public--auth',                    path: '/auth.html',                              section: 'Public' },
  { slug: 'public--forgot-password',         path: '/forgot-password.html',                   section: 'Public' },
  { slug: 'public--reset-password',          path: '/reset-password.html',                    section: 'Public' },
  { slug: 'public--verify',                  path: '/verify.html',                            section: 'Public' },
  { slug: 'public--suppliers',               path: '/suppliers.html',                         section: 'Public' },
  { slug: 'public--supplier-profile',        path: '/supplier.html',                          section: 'Public' },
  { slug: 'public--marketplace',             path: '/marketplace.html',                       section: 'Public' },
  { slug: 'public--category',                path: '/category.html',                          section: 'Public' },
  { slug: 'public--for-suppliers',           path: '/for-suppliers.html',                     section: 'Public' },
  { slug: 'public--pricing',                 path: '/pricing.html',                           section: 'Public' },
  { slug: 'public--start',                   path: '/start.html',                             section: 'Public' },
  { slug: 'public--contact',                 path: '/contact.html',                           section: 'Public' },
  { slug: 'public--faq',                     path: '/faq.html',                               section: 'Public' },
  { slug: 'public--guides',                  path: '/guides.html',                            section: 'Public' },
  { slug: 'public--public-calendar',         path: '/public-calendar.html',                   section: 'Public' },
  { slug: 'public--compare',                 path: '/compare.html',                           section: 'Public' },
  { slug: 'public--package',                 path: '/package.html',                           section: 'Public' },
  { slug: 'public--gallery',                 path: '/gallery.html',                           section: 'Public' },
  { slug: 'public--legal',                   path: '/legal.html',                             section: 'Public' },
  { slug: 'public--privacy',                 path: '/privacy.html',                           section: 'Public' },
  { slug: 'public--terms',                   path: '/terms.html',                             section: 'Public' },
  { slug: 'public--credits',                 path: '/credits.html',                           section: 'Public' },
  { slug: 'public--data-rights',             path: '/data-rights.html',                       section: 'Public' },
  { slug: 'public--plan',                    path: '/plan.html',                              section: 'Public' },
  { slug: 'public--offline',                 path: '/offline.html',                           section: 'Public' },
  { slug: 'public--maintenance',             path: '/maintenance.html',                       section: 'Public' },
  // Customer
  { slug: 'customer--dashboard',             path: '/dashboard-customer.html',                section: 'Customer' },
  { slug: 'customer--dashboard-legacy',      path: '/dashboard.html',                         section: 'Customer' },
  { slug: 'customer--guests',                path: '/guests.html',                            section: 'Customer' },
  { slug: 'customer--budget',                path: '/budget.html',                            section: 'Customer' },
  { slug: 'customer--timeline',              path: '/timeline.html',                          section: 'Customer' },
  { slug: 'customer--notifications',         path: '/notifications.html',                     section: 'Customer' },
  { slug: 'customer--settings',              path: '/settings.html',                          section: 'Customer' },
  { slug: 'customer--messages',              path: '/messages.html',                          section: 'Customer' },
  { slug: 'customer--conversation',          path: '/conversation.html',                      section: 'Customer' },
  { slug: 'customer--checkout',              path: '/checkout.html',                          section: 'Customer' },
  { slug: 'customer--payment-success',       path: '/payment-success.html',                   section: 'Customer' },
  { slug: 'customer--payment-cancel',        path: '/payment-cancel.html',                    section: 'Customer' },
  // Supplier
  { slug: 'supplier--dashboard',             path: '/dashboard-supplier.html',                section: 'Supplier' },
  { slug: 'supplier--subscription',          path: '/supplier/subscription.html',             section: 'Supplier' },
  { slug: 'supplier--marketplace-listing',   path: '/supplier/marketplace-new-listing.html',  section: 'Supplier' },
  { slug: 'supplier--profile-customization', path: '/supplier/profile-customization.html',    section: 'Supplier' },
  { slug: 'supplier--my-listings',           path: '/my-marketplace-listings.html',           section: 'Supplier' },
  { slug: 'supplier--card-showcase',         path: '/supplier-card-showcase.html',            section: 'Supplier' },
  // Partner
  { slug: 'partner--index',                  path: '/partner/index.html',                     section: 'Partner' },
  { slug: 'partner--dashboard',              path: '/partner/dashboard.html',                 section: 'Partner' },
  // Admin
  { slug: 'admin--dashboard',                path: '/admin.html',                             section: 'Admin' },
  { slug: 'admin--homepage',                 path: '/admin-homepage.html',                    section: 'Admin' },
  { slug: 'admin--suppliers',                path: '/admin-suppliers.html',                   section: 'Admin' },
  { slug: 'admin--supplier-detail',          path: '/admin-supplier-detail.html',             section: 'Admin' },
  { slug: 'admin--users',                    path: '/admin-users.html',                       section: 'Admin' },
  { slug: 'admin--user-detail',              path: '/admin-user-detail.html',                 section: 'Admin' },
  { slug: 'admin--analytics',                path: '/admin-analytics.html',                   section: 'Admin' },
  { slug: 'admin--reports',                  path: '/admin-reports.html',                     section: 'Admin' },
  { slug: 'admin--packages',                 path: '/admin-packages.html',                    section: 'Admin' },
  { slug: 'admin--marketplace',              path: '/admin-marketplace.html',                 section: 'Admin' },
  { slug: 'admin--reviews',                  path: '/admin-reviews.html',                     section: 'Admin' },
  { slug: 'admin--media',                    path: '/admin-media.html',                       section: 'Admin' },
  { slug: 'admin--pexels',                   path: '/admin-pexels.html',                      section: 'Admin' },
  { slug: 'admin--photos',                   path: '/admin-photos.html',                      section: 'Admin' },
  { slug: 'admin--content',                  path: '/admin-content.html',                     section: 'Admin' },
  { slug: 'admin--content-dates',            path: '/admin-content-dates.html',               section: 'Admin' },
  { slug: 'admin--payments',                 path: '/admin-payments.html',                    section: 'Admin' },
  { slug: 'admin--cashout-requests',         path: '/admin-cashout-requests.html',            section: 'Admin' },
  { slug: 'admin--tickets',                  path: '/admin-tickets.html',                     section: 'Admin' },
  { slug: 'admin--campaigns',                path: '/admin-campaigns.html',                   section: 'Admin' },
  { slug: 'admin--partners',                 path: '/admin-partners.html',                    section: 'Admin' },
  { slug: 'admin--search',                   path: '/admin-search.html',                      section: 'Admin' },
  { slug: 'admin--settings',                 path: '/admin-settings.html',                    section: 'Admin' },
  { slug: 'admin--exports',                  path: '/admin-exports.html',                     section: 'Admin' },
  { slug: 'admin--audit',                    path: '/admin-audit.html',                       section: 'Admin' },
  { slug: 'admin--messenger',                path: '/admin-messenger.html',                   section: 'Admin' },
  { slug: 'admin--debug',                    path: '/admin-debug.html',                       section: 'Admin' },
  // Messenger
  { slug: 'messenger--main',                 path: '/messenger/index.html',                   section: 'Messenger' },
  // Newsletter
  { slug: 'newsletter--confirmed',           path: '/newsletter/confirmed.html',              section: 'Newsletter' },
  { slug: 'newsletter--expired',             path: '/newsletter/expired.html',                section: 'Newsletter' },
];

async function screenshot(browser, p) {
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    userAgent: MOBILE_UA,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Block external/analytics requests that can hang
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const blocked = ['google', 'stripe', 'cloudinary', 'sentry', 'segment', 'hotjar',
                     'facebook', 'twitter', 'linkedin', 'crisp', 'intercom', 'mixpanel',
                     'amplitude', 'analytics', 'fonts.googleapis', 'fonts.gstatic', 'cdn'];
    if (blocked.some(b => url.includes(b)) && !url.includes('127.0.0.1')) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2500);
    const file = path.join(OUT, p.slug + '.png');
    await page.screenshot({ path: file, fullPage: true });
    const size = fs.statSync(file).size;
    await context.close();
    console.log('✓', p.slug, `(${Math.round(size/1024)}KB)`);
    return { ...p, file: p.slug + '.png', ok: true, bytes: size };
  } catch (e) {
    await context.close();
    console.log('✗', p.slug, e.message.slice(0, 80));
    return { ...p, ok: false, error: e.message.slice(0, 120) };
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const p of pages) {
    const result = await screenshot(browser, p);
    results.push(result);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(results, null, 2));
  const ok = results.filter(r => r.ok).length;
  console.log(`\nDone: ${ok}/${results.length} mobile screenshots saved to ${OUT}`);
}

run().catch(console.error);
