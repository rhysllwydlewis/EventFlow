'use strict';

const { JSDOM } = require('jsdom');

describe('supplier profile health aliases', () => {
  let dom;

  beforeEach(() => {
    jest.resetModules();
    dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://event-flow.co.uk/dashboard/supplier',
    });
    global.window = dom.window;
    global.document = dom.window.document;
    require('../../public/assets/js/components/profile-health-widget.js');
  });

  afterEach(() => {
    dom.window.close();
    delete global.window;
    delete global.document;
  });

  test('empty canonical gallery still counts populated legacy images', () => {
    const result = window.ProfileHealthWidget.calculate({
      photosGallery: [],
      images: ['/api/photos/a', '/api/photos/b', '/api/photos/c'],
    });

    expect(result.completedItems.map(item => item.id)).toContain('gallery');
  });

  test('modern and legacy social maps are merged before counting platforms', () => {
    const result = window.ProfileHealthWidget.calculate({
      socials: { facebook: 'https://facebook.com/example' },
      socialLinks: { instagram: 'https://instagram.com/example' },
    });

    expect(result.completedItems.map(item => item.id)).toContain('socials');
  });

  test('empty canonical social values do not erase populated legacy values', () => {
    const result = window.ProfileHealthWidget.calculate({
      socials: {
        facebook: 'https://facebook.com/example',
        instagram: 'https://instagram.com/example',
      },
      socialLinks: { facebook: '' },
    });

    expect(result.completedItems.map(item => item.id)).toContain('socials');
  });

  test('description and banner aliases satisfy their canonical health checks', () => {
    const result = window.ProfileHealthWidget.calculate({
      description_long: 'A'.repeat(120),
      bannerUrl: '/api/photos/banner',
    });
    const completed = result.completedItems.map(item => item.id);

    expect(completed).toContain('description');
    expect(completed).toContain('coverImage');
  });
});
