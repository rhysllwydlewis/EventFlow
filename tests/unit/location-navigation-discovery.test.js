/**
 * Location discovery entry points: the primary navigation stays compact while
 * the homepage and footer retain crawlable, useful routes into the city hub.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const homepage = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

function navigationMarkup(fileName) {
  const html = fs.readFileSync(path.join(root, 'public', fileName), 'utf8');
  const header = html.match(/<header\b[\s\S]*?<\/header>/i);
  return { html, header: header ? header[0] : '' };
}

describe('public location discovery', () => {
  it.each(['locations.html', 'location.html'])(
    'keeps Locations out of the primary and mobile navigation in %s',
    fileName => {
      const { html, header } = navigationMarkup(fileName);

      expect(header).not.toMatch(/href=["']\/locations["']/i);
      expect(html).toMatch(/<footer[\s\S]*?href=["']\/locations["']/i);
      expect(html).toContain('/assets/css/locations-public-refresh.css?v=3');
    }
  );

  it('promotes location discovery near the bottom of the homepage', () => {
    const locationSection = homepage.match(
      /<section class="ef-home-locations"[\s\S]*?<\/section>/i
    );

    expect(locationSection).not.toBeNull();
    expect(homepage.indexOf('class="ef-home-locations"')).toBeGreaterThan(
      homepage.indexOf('id="guides-section"')
    );
    expect(locationSection[0]).toContain('Find event suppliers near you');
    expect(locationSection[0]).toContain('action="/suppliers"');
    expect(locationSection[0]).toContain('href="/locations"');
    expect(locationSection[0]).toContain('name="location"');
    expect(locationSection[0]).toContain('Where is your event?');
    // The city list is a fixed editorial selection, so it must not be labelled
    // as a live popularity ranking — nothing here measures popularity.
    expect(locationSection[0]).toContain('Major UK cities');
    expect(locationSection[0]).not.toContain('Popular right now');
    expect(homepage).toContain('/assets/css/homepage-locations-refresh.css?v=1');
  });
});
