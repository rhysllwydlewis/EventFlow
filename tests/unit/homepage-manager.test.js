const {
  buildHomepageManager,
  duplicateHomepageVersion,
  getHomepageCollageWidget,
  publishHomepageVersion,
  updateHomepageVersion,
} = require('../../utils/homepage-manager');

describe('homepage manager helper', () => {
  test('migrates legacy collage widget into three editable homepage slots', () => {
    const settings = {
      collageWidget: {
        enabled: true,
        source: 'uploads',
        uploadGallery: ['/uploads/collage/hero.mp4'],
        heroVideo: { autoplay: true },
      },
    };

    const manager = buildHomepageManager(settings);

    expect(manager.activeVersion).toBe('v1');
    expect(manager.versions.v1.tabName).toBe('V1 Classic');
    expect(manager.versions.v2.settings.collageWidget.source).toBe('uploads');
    expect(manager.versions.v3.settings.collageWidget.uploadGallery).toEqual([
      '/uploads/collage/hero.mp4',
    ]);
    expect(manager.versions.v3.settings.collageWidget.heroVideo.autoplay).toBe(true);
  });

  test('updates editable tab name and only changes the selected homepage slot', () => {
    const settings = {};

    updateHomepageVersion(
      settings,
      'v3',
      {
        tabName: 'Premium Launch',
        settings: {
          collageWidget: {
            enabled: true,
            intervalSeconds: 7,
          },
        },
      },
      { email: 'admin@example.com' }
    );

    const manager = buildHomepageManager(settings);

    expect(manager.versions.v3.tabName).toBe('Premium Launch');
    expect(manager.versions.v3.settings.collageWidget.intervalSeconds).toBe(7);
    expect(manager.versions.v2.settings.collageWidget.intervalSeconds).toBe(2.5);
  });

  test('publishing a homepage version sets active version and syncs legacy collage widget', () => {
    const settings = {};

    updateHomepageVersion(
      settings,
      'v3',
      {
        settings: {
          collageWidget: {
            enabled: true,
            source: 'uploads',
            uploadGallery: ['/uploads/collage/v3.mp4'],
          },
        },
      },
      { email: 'admin@example.com' }
    );

    publishHomepageVersion(settings, 'v3', { email: 'admin@example.com' });

    const manager = buildHomepageManager(settings);

    expect(manager.activeVersion).toBe('v3');
    expect(manager.versions.v3.status).toBe('published');
    expect(settings.collageWidget.uploadGallery).toEqual(['/uploads/collage/v3.mp4']);
    expect(getHomepageCollageWidget(settings).source).toBe('uploads');
  });

  test('duplicates live settings into another slot but preserves the target tab name', () => {
    const settings = {};

    updateHomepageVersion(settings, 'v3', { tabName: 'My V3' }, { email: 'admin@example.com' });
    updateHomepageVersion(
      settings,
      'v2',
      {
        settings: {
          collageWidget: {
            enabled: true,
            intervalSeconds: 11,
          },
        },
      },
      { email: 'admin@example.com' }
    );
    publishHomepageVersion(settings, 'v2', { email: 'admin@example.com' });
    duplicateHomepageVersion(settings, 'v2', 'v3', { email: 'admin@example.com' });

    const manager = buildHomepageManager(settings);

    expect(manager.versions.v3.tabName).toBe('My V3');
    expect(manager.versions.v3.settings.collageWidget.intervalSeconds).toBe(11);
    expect(manager.versions.v3.status).toBe('draft');
  });
});
