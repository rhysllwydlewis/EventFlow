'use strict';

/**
 * The dashboard's "Suggested for you" panel, rendered by the real widget in jsdom: where each
 * card goes, which photo it shows, and which placeholder it falls back to.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const avatar = require('../../public/assets/js/utils/supplier-avatar.js');

const root = path.join(__dirname, '../..');
const runner = path.join(__dirname, '../helpers/suggestions-widget-scenario.js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const run = scenario =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [runner, Buffer.from(JSON.stringify(scenario), 'utf8').toString('base64')],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
    )
  );

/** jsdom reports colours as rgb(); the palette is hex. */
const rgb = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const profilePath = '/supplier/snapshot-photography--0123456789abcdef';
const supplier = (extra = {}) => ({
  id: 's1',
  name: 'Snapshot Photography',
  category: 'Photography',
  location: 'Bristol & South West',
  publicProfilePath: profilePath,
  ...extra,
});

describe('where a card goes', () => {
  test("a card opens the supplier's own profile, not the supplier directory", () => {
    const { cards } = run({ results: [supplier()] });
    expect(cards[0].href).toBe(profilePath);
    expect(cards[0].href).not.toBe('/suppliers');
  });

  test('each card goes to its own supplier', () => {
    const second = supplier({
      id: 's2',
      name: 'Green Oak Catering',
      publicProfilePath: '/supplier/green-oak-catering--fedcba9876543210',
    });
    const { cards } = run({ results: [supplier(), second] });
    expect(cards.map(c => c.href)).toEqual([
      profilePath,
      '/supplier/green-oak-catering--fedcba9876543210',
    ]);
  });

  test('a supplier the server could not build a link for still opens the directory', () => {
    const { cards } = run({ results: [supplier({ publicProfilePath: undefined })] });
    expect(cards[0].href).toBe('/suppliers');
  });

  test('without the link helper a card still never uses the unvalidated address from the response', () => {
    const { cards } = run({
      results: [supplier({ publicProfilePath: '" onmouseover="alert(1)' })],
      withoutLinkHelper: true,
    });
    expect(cards[0].href).toBe('/suppliers');
  });

  test('a link that is not a supplier profile path is not followed', () => {
    const { cards } = run({
      results: [supplier({ publicProfilePath: 'javascript:alert(1)' })],
    });
    expect(cards[0].href).toBe('/suppliers');
  });
});

describe('profile photos', () => {
  test('a supplier with a profile photo shows it', () => {
    const { cards } = run({
      results: [supplier({ profilePhotoUrl: 'https://img.example.test/p.jpg' })],
    });
    expect(cards[0].avatar).toMatchObject({ kind: 'photo', src: 'https://img.example.test/p.jpg' });
  });

  test.each([
    ['displayAvatarUrl', 'https://img.example.test/display.jpg'],
    ['avatarUrl', '/uploads/avatar.jpg'],
    ['logo', 'https://img.example.test/logo.png'],
  ])('a supplier whose only photo is %s still shows it', (field, url) => {
    const { cards } = run({ results: [supplier({ [field]: url })] });
    expect(cards[0].avatar).toMatchObject({ kind: 'photo', src: url });
  });

  test('the profile photo wins over the logo, as everywhere else on the site', () => {
    const { cards } = run({
      results: [
        supplier({ logo: 'https://img.example.test/logo.png', profilePhotoUrl: '/uploads/me.jpg' }),
      ],
    });
    expect(cards[0].avatar.src).toBe('/uploads/me.jpg');
  });

  test('an unsafe photo address is never used', () => {
    const { cards } = run({
      results: [
        supplier({ profilePhotoUrl: 'javascript:alert(1)', avatarUrl: 'data:text/html,x' }),
      ],
    });
    expect(cards[0].avatar.kind).toBe('initials');
  });

  test('the photo is decorative, because the name sits beside it', () => {
    const { cards } = run({ results: [supplier({ avatarUrl: '/uploads/a.jpg' })] });
    expect(cards[0].avatar.alt).toBe('');
  });

  test('a photo that fails to load is replaced by the placeholder, with the same colour', () => {
    const s = supplier({ profilePhotoUrl: 'https://img.example.test/broken.jpg' });
    const { cards } = run({ results: [s], failImages: true });
    expect(cards[0].avatar.kind).toBe('initials');
    expect(cards[0].avatar.text).toBe('SP');
    expect(cards[0].avatar.background).toContain('linear-gradient');
  });
});

describe('the placeholder', () => {
  test('is the shared one: the initials and the colour every other supplier avatar uses', () => {
    const s = supplier();
    const { cards } = run({ results: [s] });
    expect(cards[0].avatar.kind).toBe('initials');
    expect(cards[0].avatar.text).toBe(avatar.getSupplierInitials(s.name));
    const [from, to] = avatar.getSupplierAvatarColors(s);
    expect(cards[0].avatar.background).toBe(
      `linear-gradient(135deg, ${rgb(from)} 0%, ${rgb(to)} 100%)`
    );
  });

  test('the same supplier always gets the same colour, and different suppliers can differ', () => {
    const other = supplier({ id: 's2', name: 'Luxury Car Hire', publicProfilePath: undefined });
    const first = run({ results: [supplier(), other] }).cards.map(c => c.avatar.background);
    const again = run({ results: [supplier(), other] }).cards.map(c => c.avatar.background);
    expect(first).toEqual(again);
    const distinct = new Set(
      Array.from({ length: 12 }, (_, i) =>
        avatar.getSupplierAvatarGradient({ id: `supplier-${i}` })
      )
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  test('a single-word name gets one letter, and no name gets "?", never an invented letter', () => {
    const { cards } = run({
      results: [supplier({ name: 'Cocktailhire' }), supplier({ id: 's9', name: '' })],
    });
    expect(cards[0].avatar.text).toBe('C');
    expect(cards[1].avatar.text).toBe('?');
  });

  test('is hidden from screen readers (the name is right beside it)', () => {
    const { cards } = run({ results: [supplier()] });
    expect(cards[0].avatar.hiddenFromScreenReaders).toBe(true);
  });

  test('its colour is put on from script, never written as a style attribute in the markup', () => {
    const source = read('public/assets/js/recommendations-widget.js');
    expect(source).not.toMatch(/style="/);
    expect(source).toMatch(/el\.style\.background = el\.dataset\.avatarGradient/);
  });

  test('is white initials, like the supplier cards, and not the old pale-green badge', () => {
    const css = read('public/assets/css/customer-dashboard-home.css');
    const rule = css.match(/\.cdh-page \.recommendation-avatar--fallback \{[^}]*\}/)[0];
    expect(rule).toMatch(/color: #fff;/);
    expect(rule).not.toMatch(/accent-soft/);
  });
});

describe('what the panel asks for and says', () => {
  test('sends the plan location and the categories it still needs', () => {
    const { requested } = run({
      results: [supplier()],
      dataset: { location: 'Cardiff, Wales', needed: 'Photography,Videography' },
    });
    const url = new URL(requested[0], 'http://localhost');
    expect(url.pathname).toBe('/api/v2/search/personalized');
    expect(url.searchParams.get('location')).toBe('Cardiff, Wales');
    expect(url.searchParams.get('needed')).toBe('Photography,Videography');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  test('sends nothing it has no value for', () => {
    const { requested } = run({ results: [supplier()] });
    const url = new URL(requested[0], 'http://localhost');
    expect([...url.searchParams.keys()]).toEqual(['limit']);
  });

  test('shows the reason when there is one and nothing when there is not', () => {
    const { cards } = run({
      results: [
        supplier({ rankingReason: 'Still to find: Photography' }),
        supplier({ id: 's2', rankingReason: '', publicProfilePath: undefined }),
      ],
    });
    expect(cards[0].reason).toBe('Still to find: Photography');
    expect(cards[1].reason).toBeNull();
  });

  test('a supplier name that is markup is shown as text', () => {
    const { cards } = run({
      results: [supplier({ name: '<img src=x onerror=alert(1)> Events' })],
    });
    expect(cards[0].name).toBe('<img src=x onerror=alert(1)> Events');
    // No element was made from the name: just the avatar badge, name, category and meta lines.
    expect(cards[0].imageCount).toBe(0);
  });

  test('the panel stays hidden when there is nothing to suggest or the request fails', () => {
    expect(run({ results: [] }).hidden).toBe(true);
    expect(run({ results: [supplier()], apiFails: true }).hidden).toBe(true);
  });
});
