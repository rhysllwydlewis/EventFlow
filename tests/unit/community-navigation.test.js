/**
 * Navigation parity for EventFlow Community.
 *
 * Community is a first-class destination, so it must appear in the shared
 * desktop navigation and burger menu on every page that has them, and it must
 * be discoverable to crawlers through robots.txt and the sitemap.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', '..', 'public');

/**
 * List every HTML file under public/, recursively.
 * @param {string} dir Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return htmlFiles(full);
    }
    return entry.isFile() && entry.name.endsWith('.html') ? [full] : [];
  });
}

const allHtml = htmlFiles(publicDir);
const withDesktopNav = allHtml.filter(file =>
  fs.readFileSync(file, 'utf8').includes('href="/marketplace" class="ef-nav-link')
);
const withMobileNav = allHtml.filter(file =>
  fs.readFileSync(file, 'utf8').includes('href="/marketplace" class="ef-mobile-link')
);

describe('community navigation parity', () => {
  it('finds pages carrying the shared navigation', () => {
    expect(withDesktopNav.length).toBeGreaterThan(10);
    expect(withMobileNav.length).toBeGreaterThan(10);
  });

  it.each(withDesktopNav.map(file => path.relative(publicDir, file)))(
    '%s has Community in the desktop navigation',
    relative => {
      const html = fs.readFileSync(path.join(publicDir, relative), 'utf8');
      expect(html).toContain('href="/community" class="ef-nav-link');
    }
  );

  it.each(withMobileNav.map(file => path.relative(publicDir, file)))(
    '%s has Community in the burger menu',
    relative => {
      const html = fs.readFileSync(path.join(publicDir, relative), 'utf8');
      expect(html).toContain('href="/community" class="ef-mobile-link');
    }
  );

  it('keeps the bottom navigation untouched so mobile is not overcrowded', () => {
    const home = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const bottomMenu = /<[^>]*id="ef-bottom-menu"[\s\S]{0,2000}?<\/(nav|div)>/.exec(home);
    if (bottomMenu) {
      expect(bottomMenu[0]).not.toContain('/community');
    }
  });
});

describe('community discoverability', () => {
  it('allows /community in robots.txt', () => {
    const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
    expect(robots).toContain('Allow: /community');
  });

  it('lists the community entry points in the sitemap generator', () => {
    const sitemap = fs.readFileSync(path.join(__dirname, '..', '..', 'sitemap.js'), 'utf8');
    expect(sitemap).toContain("'/community'");
    expect(sitemap).toContain("'/community/discussions'");
    expect(sitemap).toContain('community_discussions');
    expect(sitemap).toContain('community_categories');
  });

  it('only sitemaps published and archived discussions', () => {
    const sitemap = fs.readFileSync(path.join(__dirname, '..', '..', 'sitemap.js'), 'utf8');
    expect(sitemap).toContain(
      "discussion.state === 'published' || discussion.state === 'archived'"
    );
  });

  it('links Community from the public destinations footer', () => {
    // The public destinations footer is the one that lists the site's browsable
    // areas (it always includes the Events Calendar). Admin, dashboard and
    // article footers carry shorter, context-specific link lists and are not in
    // scope here. Match the footer element itself rather than any prose that
    // happens to link to another EventFlow page.
    const footerPages = allHtml.filter(file => {
      const footer = /<footer[\s\S]*?<\/footer>/i.exec(fs.readFileSync(file, 'utf8'));
      return Boolean(
        footer && footer[0].includes('<a href="/public-calendar">Events Calendar</a>')
      );
    });
    expect(footerPages.length).toBeGreaterThan(0);
    footerPages.forEach(file => {
      const footer = /<footer[\s\S]*?<\/footer>/i.exec(fs.readFileSync(file, 'utf8'))[0];
      expect(footer).toContain('<a href="/community">Community</a>');
    });
  });
});

describe('community route registration', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const routesSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'index.js'),
    'utf8'
  );

  it('mounts the community pages before the static handlers', () => {
    const communityIndex = serverSource.indexOf("require('./routes/community-pages')");
    const staticIndex = serverSource.indexOf('app.use(express.static(');
    expect(communityIndex).toBeGreaterThan(-1);
    expect(communityIndex).toBeLessThan(staticIndex);
  });

  it('mounts every community API router under the versioned path', () => {
    expect(routesSource).toContain("app.use('/api/v1/community', communityRoutes)");
    expect(routesSource).toContain("app.use('/api/v1/community', communityInteractionRoutes)");
    expect(routesSource).toContain("app.use('/api/v1/community', communityDiscoveryRoutes)");
    expect(routesSource).toContain("app.use('/api/v1/admin/community', adminCommunityRoutes)");
  });

  it('registers the community collections with the local store', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', '..', 'store.js'), 'utf8');
    [
      'community_categories',
      'community_discussions',
      'community_replies',
      'community_reports',
      'community_restrictions',
    ].forEach(collection => {
      expect(store).toContain(collection);
    });
  });
});
