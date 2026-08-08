'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the browser IIFE in a minimal sandbox. This avoids pulling the ESM-only
// jsdom dependency into the repository's CommonJS Jest configuration.
const widgetSource = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/components/profile-health-widget.js'),
  'utf8'
);

// Regression coverage for canonical and legacy supplier-profile aliases.
describe('supplier profile health aliases', () => {
  let widget;

  beforeEach(() => {
    const sandbox = {
      window: {},
      document: {},
      console: { warn: jest.fn() },
    };

    vm.runInNewContext(widgetSource, sandbox, {
      filename: 'profile-health-widget.js',
    });
    widget = sandbox.window.ProfileHealthWidget;
  });

  test('empty canonical gallery still counts populated legacy images', () => {
    const result = widget.calculate({
      photosGallery: [],
      images: ['/api/photos/a', '/api/photos/b', '/api/photos/c'],
    });

    expect(result.completedItems.map(item => item.id)).toContain('gallery');
  });

  test('the same mixed-schema photo cannot count twice toward gallery completion', () => {
    const result = widget.calculate({
      photosGallery: [{ url: '/api/photos/a' }, { url: '/api/photos/b' }],
      images: [{ url: '/api/photos/a' }],
    });

    expect(result.completedItems.map(item => item.id)).not.toContain('gallery');
  });

  test('modern and legacy social maps are merged before counting platforms', () => {
    const result = widget.calculate({
      socials: { facebook: 'https://facebook.com/example' },
      socialLinks: { instagram: 'https://instagram.com/example' },
    });

    expect(result.completedItems.map(item => item.id)).toContain('socials');
  });

  test('empty canonical social values do not erase populated legacy values', () => {
    const result = widget.calculate({
      socials: {
        facebook: 'https://facebook.com/example',
        instagram: 'https://instagram.com/example',
      },
      socialLinks: { facebook: '' },
    });

    expect(result.completedItems.map(item => item.id)).toContain('socials');
  });

  test('description and banner aliases satisfy their canonical health checks', () => {
    const result = widget.calculate({
      description_long: 'A'.repeat(120),
      bannerUrl: '/api/photos/banner',
    });
    const completed = result.completedItems.map(item => item.id);

    expect(completed).toContain('description');
    expect(completed).toContain('coverImage');
  });

  // Regression coverage: phone/business hours/FAQs were removed from the
  // criteria because no supplier-facing page exposes an input for them —
  // scoring against unfillable fields isn't a completeness signal, it's
  // just a permanent penalty. See the comment above HEALTH_CRITERIA.
  test('does not score contact/business-hours/FAQ criteria that have no supplier-facing input', () => {
    const result = widget.calculate({
      email: 'supplier@example.com',
      phone: '01234 567890',
      businessHours: { mon: '9-5' },
      faqs: ['q1', 'q2', 'q3'],
    });
    const ids = [...result.completedItems, ...result.incompleteItems].map(item => item.id);

    expect(ids).not.toContain('contact');
    expect(ids).not.toContain('businessHours');
    expect(ids).not.toContain('faqs');
  });

  test('the 7 remaining criteria weight to exactly 100 points', () => {
    const result = widget.calculate({});
    expect(result.totalPoints).toBe(100);
    expect(result.completedItems.length + result.incompleteItems.length).toBe(7);
  });

  test('credits the location criterion for basePostcode, the field the dashboard postcode input actually saves to', () => {
    const withBasePostcode = widget.calculate({ location: 'Cardiff', basePostcode: 'CF10 1AA' });
    expect(withBasePostcode.completedItems.map(item => item.id)).toContain('location');

    const withBarePostcode = widget.calculate({ location: 'Cardiff', postcode: 'CF10 1AA' });
    expect(withBarePostcode.completedItems.map(item => item.id)).not.toContain('location');
  });

  test('venuePostcode still satisfies the location criterion for Venues-category suppliers', () => {
    const result = widget.calculate({ location: 'Cardiff', venuePostcode: 'CF10 1AA' });
    expect(result.completedItems.map(item => item.id)).toContain('location');
  });

  test('a fully-completable profile can reach 100%', () => {
    const result = widget.calculate({
      logo: '/api/photos/logo',
      description_long: 'A'.repeat(120),
      location: 'Cardiff',
      basePostcode: 'CF10 1AA',
      bannerUrl: '/api/photos/banner',
      photosGallery: ['/api/photos/a', '/api/photos/b', '/api/photos/c'],
      socialLinks: { instagram: 'https://instagram.com/x', facebook: 'https://facebook.com/x' },
      website: 'https://example.com',
    });

    expect(result.percentage).toBe(100);
  });
});
