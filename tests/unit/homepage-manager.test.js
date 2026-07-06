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

  test('defaults homepage collage on and resolves legacy unmarked false to enabled', () => {
    expect(buildHomepageManager({}).versions.v1.settings.collageWidget.enabled).toBe(true);

    const legacyManager = buildHomepageManager({
      collageWidget: { enabled: false },
    });

    expect(legacyManager.versions.v1.settings.collageWidget.enabled).toBe(true);
    expect(getHomepageCollageWidget({ collageWidget: { enabled: false } }).enabled).toBe(true);
  });

  test('preserves explicit homepage collage disable intent', () => {
    const explicitManager = buildHomepageManager({
      collageWidget: { enabled: false, enabledExplicit: true, updatedBy: 'admin@example.com' },
    });

    expect(explicitManager.versions.v1.settings.collageWidget.enabled).toBe(false);
    expect(
      getHomepageCollageWidget({
        collageWidget: { enabled: false, updatedAt: '2026-07-05T12:00:00.000Z' },
      }).enabled
    ).toBe(false);
  });

  test('migrates old stored homepage slot defaults to collage on', () => {
    const migratedManager = buildHomepageManager({
      homepageManager: {
        activeVersion: 'v3',
        versions: {
          v3: {
            settings: {
              collageWidget: { enabled: false, source: 'pexels' },
            },
          },
        },
      },
    });

    expect(migratedManager.versions.v3.settings.collageWidget.enabled).toBe(true);

    const settings = {};
    updateHomepageVersion(
      settings,
      'v3',
      { settings: { collageWidget: { enabled: false } } },
      { email: 'admin@example.com' }
    );

    expect(buildHomepageManager(settings).versions.v3.settings.collageWidget.enabled).toBe(false);
    expect(buildHomepageManager(settings).versions.v3.settings.collageWidget.enabledExplicit).toBe(
      true
    );
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
