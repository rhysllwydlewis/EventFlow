'use strict';

const {
  buildAdminManagementOverview,
  buildContentSummary,
  buildHomepageSummary,
  buildMediaSummary,
  isPendingPhoto,
} = require('../../utils/admin-management-overview');

describe('admin management overview helper', () => {
  test('summarises the active homepage version and collage controls', () => {
    const summary = buildHomepageSummary({
      homepageManager: {
        activeVersion: 'v3',
        versions: {
          v3: {
            tabName: 'Launch Hero',
            status: 'published',
            settings: {
              collageWidget: {
                enabled: true,
                source: 'uploads',
                mediaTypes: { photos: true, videos: true },
                uploadGallery: ['/uploads/homepage-collage/hero.mp4'],
              },
            },
          },
        },
      },
      categories: [{ name: 'Venues' }, { name: 'Catering', visible: false }],
    });

    expect(summary.activeVersion).toBe('v3');
    expect(summary.activeVersionLabel).toBe('Launch Hero');
    expect(summary.collageEnabled).toBe(true);
    expect(summary.collageSource).toBe('uploads');
    expect(summary.uploadGalleryCount).toBe(1);
    expect(summary.categories).toEqual({ total: 2, visible: 1 });
  });

  test('detects content readiness for hero, announcements, FAQs and featured packages', () => {
    const summary = buildContentSummary(
      {
        homepage: {
          title: 'Plan it',
          subtitle: 'Find suppliers',
          ctaText: 'Start',
          heroImage: '/uploads/hero.jpg',
        },
        announcements: [{ active: true }, { active: false }],
        faqs: [{ category: 'Booking' }, { category: 'Booking' }, { category: 'Payments' }],
      },
      [{ featured: true, approved: true }, { featured: true, approved: false }, { featured: false }]
    );

    expect(summary.heroComplete).toBe(true);
    expect(summary.heroHasImage).toBe(true);
    expect(summary.announcements).toEqual({ total: 2, active: 1, inactive: 1 });
    expect(summary.faqs).toEqual({ total: 3, categories: 2 });
    expect(summary.featuredPackages).toEqual({ total: 2, approved: 1 });
  });

  test('accepts singleton content documents returned as arrays from Mongo-style reads', () => {
    const summary = buildContentSummary([
      {
        homepage: {
          title: 'Plan',
          subtitle: 'Book',
          ctaText: 'Start',
        },
        announcements: [{ active: true }],
        faqs: [{ category: 'General' }],
      },
    ]);

    expect(summary.heroComplete).toBe(true);
    expect(summary.announcements.active).toBe(1);
    expect(summary.faqs.total).toBe(1);
  });

  test('treats legacy unreviewed photos as pending without misclassifying approved photos', () => {
    expect(isPendingPhoto({ status: 'pending' })).toBe(true);
    expect(isPendingPhoto({ approved: false, rejected: false })).toBe(true);
    expect(isPendingPhoto({ status: 'approved', approved: true })).toBe(false);
    expect(isPendingPhoto({ rejected: true })).toBe(false);
  });

  test('summarises media review state and Pexels metrics', () => {
    const summary = buildMediaSummary({
      photos: [
        { status: 'pending' },
        { approved: true },
        { rejected: true },
        { approved: false, rejected: false },
      ],
      collageMedia: [{ type: 'photo' }, { type: 'video' }],
      pexelsStatus: { configured: true },
      pexelsMetrics: { successRate: 98, cacheHitRate: 44, totalRequests: 20 },
    });

    expect(summary.supplierPhotos).toEqual({
      total: 4,
      pending: 0,
      storedPending: 2,
      approved: 1,
      rejected: 1,
      autoApprove: true,
    });
    expect(summary.homepageCollage).toEqual({ total: 2, photos: 1, videos: 1 });
    expect(summary.pexels).toMatchObject({ configured: true, successRate: 98, cacheHitRate: 44 });
  });

  test('keeps manual photo review counts when photo auto-approve is disabled', () => {
    const overview = buildAdminManagementOverview({
      settings: { features: { photoAutoApprove: false } },
      photos: [{ status: 'pending' }, { approved: false, rejected: false }],
    });

    expect(overview.media.supplierPhotos.pending).toBe(2);
    expect(overview.recommendations.map(item => item.id)).toContain('media-pending-photos');
  });

  test('uses legacy pexels feature flag when migrating homepage collage state', () => {
    const overview = buildAdminManagementOverview({
      settings: {
        features: { pexelsCollage: true },
      },
      pexelsStatus: { configured: true },
    });

    expect(overview.homepage.collageEnabled).toBe(true);
    expect(overview.recommendations.map(item => item.id)).not.toContain(
      'homepage-collage-disabled'
    );
  });

  test('builds operational recommendations for incomplete admin surfaces', () => {
    const overview = buildAdminManagementOverview({
      now: new Date('2026-07-05T12:00:00.000Z'),
      settings: {
        features: { photoAutoApprove: false },
        homepageManager: {
          activeVersion: 'v2',
          versions: {
            v2: {
              settings: {
                collageWidget: {
                  enabled: false,
                  enabledExplicit: true,
                  source: 'uploads',
                  uploadGallery: [],
                },
              },
            },
          },
        },
      },
      content: {
        homepage: { title: '', subtitle: 'Sub', ctaText: 'Go' },
        announcements: [],
        faqs: [],
      },
      photos: [{ status: 'pending' }],
      packages: [],
      pexelsStatus: { configured: false },
      dbStatus: { backend: 'mongodb', connected: true },
    });

    expect(overview.generatedAt).toBe('2026-07-05T12:00:00.000Z');
    expect(overview.recommendations.map(item => item.id)).toEqual(
      expect.arrayContaining([
        'homepage-collage-disabled',
        'content-hero-incomplete',
        'content-no-featured-packages',
        'media-pending-photos',
      ])
    );
    expect(overview.recommendations.map(item => item.id)).not.toContain(
      'homepage-upload-gallery-empty'
    );
    expect(overview.recommendations.map(item => item.id)).not.toContain(
      'media-pexels-not-configured'
    );
  });
});
