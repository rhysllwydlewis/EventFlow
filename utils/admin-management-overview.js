'use strict';

const { buildHomepageManager } = require('./homepage-manager');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObjectRecord(value) {
  if (!Array.isArray(value)) {
    return value && typeof value === 'object' ? value : {};
  }

  return (
    value.find(
      item => item && (item.homepage || item.announcements || item.faqs || item.homepageManager)
    ) ||
    value.find(item => item && typeof item === 'object') ||
    {}
  );
}

function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function countWhere(items, predicate) {
  return asArray(items).filter(predicate).length;
}

function isPendingPhoto(photo = {}) {
  const status = String(photo.status || '').toLowerCase();
  if (status === 'pending') {
    return true;
  }
  if (status === 'approved' || status === 'rejected') {
    return false;
  }
  return photo.approved !== true && photo.rejected !== true;
}

function isApprovedPhoto(photo = {}) {
  return photo.approved === true || String(photo.status || '').toLowerCase() === 'approved';
}

function isRejectedPhoto(photo = {}) {
  return photo.rejected === true || String(photo.status || '').toLowerCase() === 'rejected';
}

function getFeaturedPackages(packages) {
  return asArray(packages).filter(pkg => pkg && pkg.featured === true);
}

function getEnabledCategories(settings = {}) {
  const categories = asArray(settings.categories);
  return {
    total: categories.length,
    visible: countWhere(categories, category => category && category.visible !== false),
  };
}

function buildRecommendation(id, severity, surface, title, detail, href) {
  return { id, severity, surface, title, detail, href };
}

function buildHomepageSummary(settings = {}) {
  settings = asObjectRecord(settings);
  const manager = buildHomepageManager(settings);
  const activeVersion = manager.versions[manager.activeVersion] || {};
  const versionList = Object.values(manager.versions || {});
  const activeCollage = activeVersion.settings?.collageWidget || settings.collageWidget || {};
  const categories = getEnabledCategories(settings);

  return {
    activeVersion: manager.activeVersion,
    activeVersionLabel: activeVersion.tabName || manager.activeVersion.toUpperCase(),
    versionCount: versionList.length,
    publishedVersions: countWhere(versionList, version => version.status === 'published'),
    previewVersions: countWhere(versionList, version => version.status === 'preview'),
    draftVersions: countWhere(versionList, version => version.status === 'draft'),
    collageEnabled: activeCollage.enabled === true,
    collageSource: activeCollage.source || 'pexels',
    collageMediaTypes: {
      photos: activeCollage.mediaTypes?.photos !== false,
      videos: activeCollage.mediaTypes?.videos === true,
    },
    uploadGalleryCount: asArray(activeCollage.uploadGallery).length,
    fallbackToPexels: activeCollage.fallbackToPexels !== false,
    categories,
    updatedAt: manager.updatedAt || activeVersion.updatedAt || null,
  };
}

function buildContentSummary(content = {}, packages = []) {
  content = asObjectRecord(content);
  const homepage = content.homepage || {};
  const announcements = asArray(content.announcements);
  const faqs = asArray(content.faqs);
  const featuredPackages = getFeaturedPackages(packages);

  return {
    heroComplete:
      isFilled(homepage.title) && isFilled(homepage.subtitle) && isFilled(homepage.ctaText),
    heroHasImage: isFilled(homepage.heroImage),
    heroUpdatedAt: homepage.updatedAt || homepage.heroImageUpdatedAt || null,
    announcements: {
      total: announcements.length,
      active: countWhere(announcements, announcement => announcement.active !== false),
      inactive: countWhere(announcements, announcement => announcement.active === false),
    },
    faqs: {
      total: faqs.length,
      categories: new Set(faqs.map(faq => faq.category || 'General')).size,
    },
    featuredPackages: {
      total: featuredPackages.length,
      approved: countWhere(featuredPackages, pkg => pkg.approved !== false),
    },
  };
}

function buildMediaSummary({
  photos = [],
  collageMedia = [],
  pexelsStatus = {},
  pexelsMetrics = {},
  photoAutoApprove = true,
}) {
  const approved = countWhere(photos, isApprovedPhoto);
  const rejected = countWhere(photos, isRejectedPhoto);
  const storedPending = countWhere(photos, isPendingPhoto);
  const pending = photoAutoApprove ? 0 : storedPending;
  const metrics = pexelsMetrics || {};

  return {
    supplierPhotos: {
      total: asArray(photos).length,
      pending,
      storedPending,
      approved,
      rejected,
      autoApprove: photoAutoApprove,
    },
    homepageCollage: {
      total: asArray(collageMedia).length,
      photos: countWhere(collageMedia, item => item.type === 'photo' || item.type === 'image'),
      videos: countWhere(collageMedia, item => item.type === 'video'),
    },
    pexels: {
      configured: pexelsStatus.configured === true,
      successRate: metrics.successRate || 0,
      cacheHitRate: metrics.cacheHitRate || 0,
      totalRequests: metrics.totalRequests || 0,
      circuitBreaker: metrics.circuitBreaker || null,
    },
  };
}

function buildRecommendations({ homepage, content, media, dbStatus }) {
  const recommendations = [];

  if (dbStatus && dbStatus.connected === false) {
    recommendations.push(
      buildRecommendation(
        'database-disconnected',
        'critical',
        'all',
        'Database connection needs attention',
        'The admin dashboard could not confirm a live database connection.',
        '/admin'
      )
    );
  }

  if (!homepage.collageEnabled) {
    recommendations.push(
      buildRecommendation(
        'homepage-collage-disabled',
        'warning',
        'homepage',
        'Homepage collage is disabled',
        'Turn the active homepage version collage on when the media-led homepage should be live.',
        '/admin-homepage'
      )
    );
  }

  if (
    homepage.collageEnabled &&
    homepage.collageSource === 'uploads' &&
    homepage.uploadGalleryCount === 0 &&
    !homepage.fallbackToPexels
  ) {
    recommendations.push(
      buildRecommendation(
        'homepage-upload-gallery-empty',
        'warning',
        'homepage',
        'Upload gallery is empty',
        'The active homepage version uses uploaded media, has no gallery URLs attached, and Pexels fallback is off.',
        '/admin-homepage'
      )
    );
  }

  if (!content.heroComplete) {
    recommendations.push(
      buildRecommendation(
        'content-hero-incomplete',
        'action',
        'content',
        'Homepage hero copy is incomplete',
        'Add title, subtitle and CTA copy so homepage messaging has a complete fallback.',
        '/admin-content?tab=homepage'
      )
    );
  }

  if (content.announcements.active === 0) {
    recommendations.push(
      buildRecommendation(
        'content-no-active-announcement',
        'info',
        'content',
        'No active announcements',
        'That is fine when there is nothing to broadcast, but this panel is ready when you need it.',
        '/admin-content?tab=announcements'
      )
    );
  }

  if (content.featuredPackages.total === 0) {
    recommendations.push(
      buildRecommendation(
        'content-no-featured-packages',
        'action',
        'content',
        'No featured packages selected',
        'Feature packages to keep the content page and marketplace highlights populated.',
        '/admin-content?tab=featured'
      )
    );
  }

  if (media.supplierPhotos.pending > 0) {
    recommendations.push(
      buildRecommendation(
        'media-pending-photos',
        'action',
        'media',
        'Supplier photos awaiting review',
        `${media.supplierPhotos.pending} photo${media.supplierPhotos.pending === 1 ? '' : 's'} need approval or rejection.`,
        '/admin-photos'
      )
    );
  }

  const homepageNeedsPexels =
    homepage.collageEnabled &&
    (homepage.collageSource === 'pexels' ||
      (homepage.collageSource === 'uploads' && homepage.fallbackToPexels));

  if (homepageNeedsPexels && !media.pexels.configured) {
    recommendations.push(
      buildRecommendation(
        'media-pexels-not-configured',
        'warning',
        'media',
        'Pexels API is not configured',
        'Stock media browsing will be unavailable until PEXELS_API_KEY is configured.',
        '/admin-media'
      )
    );
  }

  return recommendations;
}

function buildAdminManagementOverview(input = {}) {
  const homepage = buildHomepageSummary(input.settings || {});
  const content = buildContentSummary(input.content || {}, input.packages || []);
  const media = buildMediaSummary({
    photos: input.photos || [],
    collageMedia: input.collageMedia || [],
    pexelsStatus: input.pexelsStatus || {},
    pexelsMetrics: input.pexelsMetrics || {},
    photoAutoApprove: (input.settings?.features || {}).photoAutoApprove !== false,
  });
  const recommendations = buildRecommendations({
    homepage,
    content,
    media,
    dbStatus: input.dbStatus,
  });

  return {
    generatedAt: (input.now || new Date()).toISOString(),
    database: input.dbStatus || null,
    homepage,
    content,
    media,
    recommendations,
  };
}

module.exports = {
  buildAdminManagementOverview,
  buildContentSummary,
  buildHomepageSummary,
  buildMediaSummary,
  isPendingPhoto,
};
