'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const widgetSource = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/components/profile-health-widget.js'),
  'utf8'
);

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
});
