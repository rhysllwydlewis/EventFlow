'use strict';

/**
 * The server-side profile-completeness calculation must agree with the browser's
 * ProfileHealthWidget (public/assets/js/components/profile-health-widget.js) for
 * every profile, because the dashboard shows one number and the other must never
 * contradict it. This test loads the real browser file into a sandbox and feeds
 * both implementations the same fixtures.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  computeProfileCompleteness,
  PROFILE_COMPLETENESS_CHECKS,
} = require('../../services/supplierProfileCompleteness');
const { hydrateSupplierProfilePhoto } = require('../../utils/supplierProfilePhoto');

const WIDGET_PATH = path.join(
  __dirname,
  '../../public/assets/js/components/profile-health-widget.js'
);

/**
 * Load the browser widget into an isolated context.
 *
 * @returns {{calculate: Function}} The widget's public API
 */
function loadBrowserWidget() {
  const sandbox = { window: {}, console };
  vm.runInNewContext(fs.readFileSync(WIDGET_PATH, 'utf8'), sandbox);
  return sandbox.window.ProfileHealthWidget;
}

const widget = loadBrowserWidget();

const LONG_TEXT = 'a'.repeat(100);

const FIXTURES = {
  'empty profile': {},
  'only a logo': { logo: 'l.png' },
  'logo under profileImage': { profileImage: 'p.png' },
  'description of 99 characters': { description_long: 'a'.repeat(99) },
  'description of exactly 100 characters': { description_long: LONG_TEXT },
  'whitespace padded description under 100': { description_short: `  ${'a'.repeat(90)}   ` },
  'description via legacy blurb': { blurb: LONG_TEXT },
  'location without postcode': { location: 'Cardiff' },
  'postcode without location': { basePostcode: 'CF10 1AA' },
  'location with basePostcode': { location: 'Cardiff', basePostcode: 'CF10 1AA' },
  'location with venuePostcode': { location: 'Cardiff', venuePostcode: 'CF10 1AA' },
  'bare postcode field is ignored': { location: 'Cardiff', postcode: 'CF10 1AA' },
  'banner via bannerUrl': { bannerUrl: 'b.jpg' },
  'banner via coverImage': { coverImage: 'c.jpg' },
  'two gallery photos': { photosGallery: ['a', 'b'] },
  'three gallery photos': { photosGallery: ['a', 'b', 'c'] },
  'three legacy images': { images: ['a', 'b', 'c'] },
  'duplicate photo across both schemas': { photosGallery: ['a', 'b'], images: ['b'] },
  'gallery objects keyed by url': { photosGallery: [{ url: 'a' }, { large: 'b' }, { src: 'c' }] },
  'two socials': { socialLinks: { instagram: 'i', facebook: 'f' } },
  'one social': { socialLinks: { instagram: 'i' } },
  'legacy socials object': { socials: { twitter: 't', tiktok: 'k' } },
  'empty canonical key keeps legacy value': {
    socials: { twitter: 't', tiktok: 'k' },
    socialLinks: { twitter: '' },
  },
  'canonical value overrides legacy': {
    socials: { twitter: 'old' },
    socialLinks: { twitter: 'new', facebook: 'f' },
  },
  'socials with blank values only': { socialLinks: { instagram: '', facebook: '  ' } },
  'website only': { website: 'https://example.com' },
  'everything present': {
    logo: 'l.png',
    description_long: LONG_TEXT,
    location: 'Cardiff',
    basePostcode: 'CF10 1AA',
    bannerUrl: 'b.jpg',
    photosGallery: ['a', 'b', 'c'],
    socialLinks: { instagram: 'i', facebook: 'f' },
    website: 'https://example.com',
  },
};

describe('server profile completeness agrees with the browser Profile Health widget', () => {
  test('the browser widget loaded and exposes calculate()', () => {
    expect(typeof widget.calculate).toBe('function');
  });

  test.each(Object.entries(FIXTURES))('%s', (name, supplier) => {
    const browser = widget.calculate(supplier);
    const server = computeProfileCompleteness(supplier);

    expect(server.score).toBe(browser.percentage);
    const browserDone = browser.completedItems.map(item => item.id).sort();
    const serverDone = server.checks
      .filter(check => check.done)
      .map(check => check.id)
      .sort();
    expect(serverDone).toEqual(browserDone);
  });

  test('ids, labels and weights are identical to the browser criteria', () => {
    const browser = widget.calculate({});
    const browserCriteria = [...browser.completedItems, ...browser.incompleteItems].map(item => ({
      id: item.id,
      label: item.label,
      weight: item.weight,
    }));
    const serverCriteria = PROFILE_COMPLETENESS_CHECKS.map(check => ({
      id: check.id,
      label: check.label,
      weight: check.weight,
    }));

    expect(serverCriteria).toEqual(browserCriteria);
  });

  test('weights add up to 100', () => {
    expect(PROFILE_COMPLETENESS_CHECKS.reduce((sum, check) => sum + check.weight, 0)).toBe(100);
  });

  test('a photo that only exists on the owner account avatar counts, as it does in the browser', () => {
    const owner = { id: 'user-1', avatarUrl: 'https://img.example/me.png' };
    const hydrated = hydrateSupplierProfilePhoto({ id: 'sup-1', ownerUserId: 'user-1' }, owner);

    expect(widget.calculate(hydrated).percentage).toBe(15);
    expect(computeProfileCompleteness(hydrated).score).toBe(15);
    // Without hydration neither implementation sees a photo.
    expect(computeProfileCompleteness({ id: 'sup-1' }).score).toBe(0);
  });

  test('every check carries a navigation href', () => {
    computeProfileCompleteness({}).checks.forEach(check => {
      expect(check.href).toMatch(/^\//);
    });
  });

  test('tolerates null input', () => {
    expect(computeProfileCompleteness(null).score).toBe(0);
  });
});
