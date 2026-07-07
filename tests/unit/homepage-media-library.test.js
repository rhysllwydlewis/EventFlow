'use strict';

const {
  assignPexelsMediaToVersion,
  buildHomepageManager,
  removePexelsMediaFromVersion,
  resolveHomepageMedia,
  updateMediaLibraryForVersion,
  validatePexelsAssignmentPayload,
} = require('../../utils/homepage-manager');

const photo = {
  provider: 'pexels',
  providerId: 123,
  type: 'photo',
  url: 'https://images.pexels.com/photos/123/test.jpeg',
  thumbnailUrl: 'https://images.pexels.com/photos/123/thumb.jpeg',
  alt: 'Elegant venue',
  photographer: 'Pexels Creator',
};

const video = {
  provider: 'pexels',
  providerId: 456,
  type: 'video',
  url: 'https://videos.pexels.com/video-files/456/video.mp4',
  thumbnailUrl: 'https://images.pexels.com/videos/456/poster.jpeg',
  alt: 'Wedding reception video',
};

describe('homepage media library normalisation and assignment', () => {
  it('defaults a missing mediaLibrary from legacy Pexels photo settings', () => {
    const manager = buildHomepageManager({
      collageWidget: { source: 'pexels', mediaTypes: { photos: true, videos: false } },
    });
    expect(manager.versions.v1.settings.mediaLibrary.mode).toBe('auto_pexels_photos');
  });

  it('defaults a missing mediaLibrary from legacy Pexels video settings', () => {
    const manager = buildHomepageManager({
      collageWidget: { source: 'pexels', mediaTypes: { photos: false, videos: true } },
    });
    expect(manager.versions.v1.settings.mediaLibrary.mode).toBe('auto_pexels_videos');
  });

  it('defaults uploads mode from legacy upload collage settings', () => {
    const manager = buildHomepageManager({ collageWidget: { source: 'uploads' } });
    expect(manager.versions.v1.settings.mediaLibrary.mode).toBe('uploads');
  });

  it('preserves selected Pexels media and keeps homepage versions independent', () => {
    let settings = {};
    settings = assignPexelsMediaToVersion(
      settings,
      'v2',
      { target: 'collage', media: photo },
      { email: 'admin@example.com' }
    );
    settings = assignPexelsMediaToVersion(
      settings,
      'v3',
      { target: 'hero', media: video },
      { email: 'admin@example.com' }
    );
    const manager = buildHomepageManager(settings);
    expect(manager.versions.v1.settings.mediaLibrary.selectedPexels).toHaveLength(0);
    expect(manager.versions.v2.settings.mediaLibrary.selectedPexels[0].providerId).toBe('123');
    expect(manager.versions.v3.settings.mediaLibrary.hero.selectedMediaId).toBe('pexels-video-456');
  });

  it('rejects invalid assignment payloads', () => {
    expect(validatePexelsAssignmentPayload({ target: 'invalid', media: photo })).toMatch(
      /valid homepage placement/
    );
    expect(
      validatePexelsAssignmentPayload({ target: 'collage', media: { ...photo, type: 'gif' } })
    ).toMatch(/photo or video/);
    expect(
      validatePexelsAssignmentPayload({
        target: 'collage',
        media: { ...photo, url: 'javascript:alert(1)' },
      })
    ).toMatch(/valid HTTP/);
  });

  it('updates duplicate selected media rather than adding another item', () => {
    let settings = assignPexelsMediaToVersion({}, 'v2', { target: 'collage', media: photo }, {});
    settings = assignPexelsMediaToVersion(settings, 'v2', { target: 'hero', media: photo }, {});
    const library = buildHomepageManager(settings).versions.v2.settings.mediaLibrary;
    expect(library.selectedPexels).toHaveLength(1);
    expect(library.selectedPexels[0].assignedTargets).toEqual(['collage', 'hero']);
  });

  it('removes selected media and resets hero selection', () => {
    let settings = assignPexelsMediaToVersion({}, 'v3', { target: 'hero', media: video }, {});
    settings = removePexelsMediaFromVersion(settings, 'v3', 'pexels-video-456', {});
    const library = buildHomepageManager(settings).versions.v3.settings.mediaLibrary;
    expect(library.selectedPexels).toHaveLength(0);
    expect(library.hero.selectedMediaId).toBeNull();
  });

  it('resolves selected-with-fallback with selected media first and selected hero video', () => {
    let settings = assignPexelsMediaToVersion({}, 'v3', { target: 'hero', media: video }, {});
    settings = updateMediaLibraryForVersion(settings, 'v3', { mode: 'selected_with_fallback' }, {});
    const version = buildHomepageManager(settings).versions.v3;
    const resolved = resolveHomepageMedia(version.settings);
    expect(resolved.source).toBe('selected_with_fallback');
    expect(resolved.selected[0].id).toBe('pexels-video-456');
    expect(resolved.heroMedia.id).toBe('pexels-video-456');
    expect(resolved.fallback.enabled).toBe(true);
  });

  it('assigns a Pexels video to V3 hero and can switch V3 to selected media with fallback', () => {
    const settings = assignPexelsMediaToVersion(
      {
        homepageManager: {
          versions: {
            v3: {
              settings: {
                collageWidget: { source: 'pexels', mediaTypes: { photos: true, videos: false } },
                mediaLibrary: { mediaTypes: { photos: true, videos: false } },
              },
            },
          },
        },
      },
      'v3',
      { target: 'hero', modeAfterAssign: 'selected_with_fallback', media: video },
      { email: 'admin@example.com' }
    );
    const version = buildHomepageManager(settings).versions.v3;
    const library = version.settings.mediaLibrary;
    expect(library.mode).toBe('selected_with_fallback');
    expect(library.mediaTypes.videos).toBe(true);
    expect(version.settings.collageWidget.mediaTypes.videos).toBe(true);
    expect(library.selectedPexels).toHaveLength(1);
    expect(library.hero.mode).toBe('selected_pexels');
    expect(library.hero.selectedMediaId).toBe('pexels-video-456');
  });

  it('resolves selected Pexels only without enabling fallback unexpectedly', () => {
    const settings = assignPexelsMediaToVersion(
      {},
      'v3',
      { target: 'hero', modeAfterAssign: 'selected_pexels', media: video },
      {}
    );
    const resolved = resolveHomepageMedia(buildHomepageManager(settings).versions.v3.settings);
    expect(resolved.source).toBe('selected');
    expect(resolved.selected).toHaveLength(1);
    expect(resolved.heroMedia.id).toBe('pexels-video-456');
    expect(resolved.fallback).toBeNull();
  });

  it('derives selected uploads from legacy upload gallery and keeps uploads mode usable', () => {
    const manager = buildHomepageManager({
      collageWidget: {
        source: 'uploads',
        uploadGallery: [
          '/uploads/homepage-collage/hero.mp4',
          '/uploads/homepage-collage/photo.jpg',
        ],
      },
    });
    const library = manager.versions.v1.settings.mediaLibrary;
    const resolved = resolveHomepageMedia(manager.versions.v1.settings);
    expect(library.mode).toBe('uploads');
    expect(library.selectedUploads).toHaveLength(2);
    expect(library.selectedUploads[0].type).toBe('video');
    expect(resolved.source).toBe('uploads');
    expect(resolved.selected).toHaveLength(2);
  });

  it('keeps legacy upload gallery visible even when selectedUploads already exists empty', () => {
    const manager = buildHomepageManager({
      collageWidget: {
        source: 'uploads',
        uploadGallery: ['/uploads/homepage-collage/existing.mp4'],
      },
      mediaLibrary: {
        mode: 'uploads',
        selectedUploads: [],
      },
    });
    expect(manager.versions.v1.settings.mediaLibrary.selectedUploads).toHaveLength(1);
    expect(resolveHomepageMedia(manager.versions.v1.settings).selected).toHaveLength(1);
  });
});
