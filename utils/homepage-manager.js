/**
 * Homepage version manager helpers.
 *
 * Keeps the current collageWidget contract working while adding explicit
 * editable slots for V1, V2 and V3 homepage management.
 */

'use strict';

const HOMEPAGE_VERSION_KEYS = ['v1', 'v2', 'v3'];
const HOMEPAGE_VERSION_SET = new Set(HOMEPAGE_VERSION_KEYS);

const DEFAULT_PEXELS_QUERIES = {
  venues: 'wedding venue elegant ballroom',
  catering: 'wedding catering food elegant',
  entertainment: 'live band wedding party',
  photography: 'wedding photography professional',
};

const DEFAULT_PEXELS_VIDEO_QUERIES = {
  venues: 'wedding venue video aerial',
  catering: 'catering food preparation video',
  entertainment: 'live band music performance video',
  photography: 'wedding videography cinematic',
};

const DEFAULT_COLLAGE_WIDGET = {
  enabled: false,
  source: 'pexels',
  mediaTypes: { photos: true, videos: true },
  intervalSeconds: 2.5,
  pexelsQueries: DEFAULT_PEXELS_QUERIES,
  pexelsVideoQueries: DEFAULT_PEXELS_VIDEO_QUERIES,
  uploadGallery: [],
  fallbackToPexels: true,
  heroVideo: {
    enabled: true,
    autoplay: false,
    muted: true,
    loop: true,
    quality: 'hd',
  },
  videoQuality: {
    preference: 'hd',
    adaptive: true,
    mobileOptimized: true,
  },
  transition: {
    effect: 'fade',
    duration: 1000,
  },
  preloading: {
    enabled: true,
    count: 3,
  },
  mobileOptimizations: {
    slowerTransitions: true,
    disableVideos: false,
    touchControls: true,
  },
  contentFiltering: {
    aspectRatio: 'any',
    orientation: 'any',
    minResolution: 'SD',
  },
  playbackControls: {
    showControls: false,
    pauseOnHover: true,
    fullscreen: false,
  },
};

const DEFAULT_VERSION_LABELS = {
  v1: 'V1 Classic',
  v2: 'V2 Modern',
  v3: 'V3 Premium Video',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isHomepageVersion(version) {
  return HOMEPAGE_VERSION_SET.has(version);
}

function normaliseHomepageVersion(version) {
  const normalised = String(version || '')
    .trim()
    .toLowerCase();
  return isHomepageVersion(normalised) ? normalised : null;
}

function getEnvHomepageVersion() {
  return normaliseHomepageVersion(process.env.HOMEPAGE_VARIANT);
}

function normaliseTabName(version, tabName) {
  const fallback = DEFAULT_VERSION_LABELS[version] || version.toUpperCase();
  const cleanName = String(tabName || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40);
  return cleanName || fallback;
}

function mergeCollageWidget(collageWidget = {}) {
  return {
    ...clone(DEFAULT_COLLAGE_WIDGET),
    ...clone(collageWidget),
    mediaTypes: {
      ...DEFAULT_COLLAGE_WIDGET.mediaTypes,
      ...(collageWidget.mediaTypes || {}),
    },
    pexelsQueries: {
      ...DEFAULT_PEXELS_QUERIES,
      ...(collageWidget.pexelsQueries || {}),
    },
    pexelsVideoQueries: {
      ...DEFAULT_PEXELS_VIDEO_QUERIES,
      ...(collageWidget.pexelsVideoQueries || {}),
    },
    heroVideo: {
      ...DEFAULT_COLLAGE_WIDGET.heroVideo,
      ...(collageWidget.heroVideo || {}),
    },
    videoQuality: {
      ...DEFAULT_COLLAGE_WIDGET.videoQuality,
      ...(collageWidget.videoQuality || {}),
    },
    transition: {
      ...DEFAULT_COLLAGE_WIDGET.transition,
      ...(collageWidget.transition || {}),
    },
    preloading: {
      ...DEFAULT_COLLAGE_WIDGET.preloading,
      ...(collageWidget.preloading || {}),
    },
    mobileOptimizations: {
      ...DEFAULT_COLLAGE_WIDGET.mobileOptimizations,
      ...(collageWidget.mobileOptimizations || {}),
    },
    contentFiltering: {
      ...DEFAULT_COLLAGE_WIDGET.contentFiltering,
      ...(collageWidget.contentFiltering || {}),
    },
    playbackControls: {
      ...DEFAULT_COLLAGE_WIDGET.playbackControls,
      ...(collageWidget.playbackControls || {}),
    },
  };
}

function buildDefaultVersion(version, existingCollageWidget = {}) {
  const baseCollageWidget = mergeCollageWidget(existingCollageWidget);
  const isV1 = version === 'v1';
  const isV3 = version === 'v3';

  return {
    id: version,
    tabName: DEFAULT_VERSION_LABELS[version],
    enabled: true,
    status: isV3 ? 'preview' : 'draft',
    previewPath: version === 'v1' ? '/' : `/home-${version}-preview`,
    description:
      version === 'v1'
        ? 'Original homepage experience with shared category and hero controls.'
        : version === 'v2'
          ? 'Modern homepage layout with collage and media controls.'
          : 'Premium video-led homepage with playlist and hero video controls.',
    settings: {
      hero: {},
      search: {},
      layout: {},
      collageWidget: {
        ...baseCollageWidget,
        enabled: isV1 ? false : baseCollageWidget.enabled,
        mediaTypes: {
          ...baseCollageWidget.mediaTypes,
          videos: isV1 ? false : baseCollageWidget.mediaTypes.videos !== false,
        },
      },
    },
    updatedAt: null,
    updatedBy: null,
  };
}

function normaliseVersion(version, existingVersion = {}, fallbackCollageWidget = {}) {
  const defaults = buildDefaultVersion(version, fallbackCollageWidget);
  const existingSettings = existingVersion.settings || {};

  return {
    ...defaults,
    ...clone(existingVersion),
    id: version,
    tabName: normaliseTabName(version, existingVersion.tabName || defaults.tabName),
    enabled: existingVersion.enabled !== undefined ? existingVersion.enabled === true : defaults.enabled,
    status: ['draft', 'preview', 'published'].includes(existingVersion.status)
      ? existingVersion.status
      : defaults.status,
    settings: {
      ...defaults.settings,
      ...clone(existingSettings),
      collageWidget: mergeCollageWidget(
        existingSettings.collageWidget || defaults.settings.collageWidget
      ),
    },
  };
}

function resolveInitialActiveVersion(settings = {}) {
  const managerVersion = normaliseHomepageVersion(settings.homepageManager?.activeVersion);
  if (managerVersion) {
    return managerVersion;
  }

  const envVersion = getEnvHomepageVersion();
  if (envVersion) {
    return envVersion;
  }

  return 'v1';
}

function buildHomepageManager(settings = {}) {
  const existingManager = settings.homepageManager || {};
  const fallbackCollageWidget = settings.collageWidget || {};
  const activeVersion = resolveInitialActiveVersion(settings);
  const versions = {};

  HOMEPAGE_VERSION_KEYS.forEach(version => {
    versions[version] = normaliseVersion(
      version,
      existingManager.versions?.[version],
      fallbackCollageWidget
    );
    versions[version].status = version === activeVersion ? 'published' : versions[version].status;
  });

  return {
    activeVersion,
    versions,
    updatedAt: existingManager.updatedAt || null,
    updatedBy: existingManager.updatedBy || null,
  };
}

function getHomepageVersion(managerOrSettings, version) {
  const manager = managerOrSettings?.versions
    ? managerOrSettings
    : buildHomepageManager(managerOrSettings || {});
  const requestedVersion = normaliseHomepageVersion(version) || manager.activeVersion;
  return manager.versions[requestedVersion] || manager.versions[manager.activeVersion];
}

function getHomepageCollageWidget(settings = {}, version) {
  const manager = buildHomepageManager(settings);
  const versionConfig = getHomepageVersion(manager, version);
  return mergeCollageWidget(versionConfig?.settings?.collageWidget || settings.collageWidget || {});
}

async function getActiveHomepageVersion() {
  const dbUnified = require('../db-unified');
  const settings = (await dbUnified.read('settings')) || {};
  return buildHomepageManager(settings).activeVersion;
}

function validateHomepageVersionPayload(payload = {}) {
  if (payload.tabName !== undefined && String(payload.tabName).trim().length > 40) {
    return 'Tab name must be 40 characters or fewer';
  }

  if (payload.status !== undefined && !['draft', 'preview', 'published'].includes(payload.status)) {
    return 'Invalid homepage status';
  }

  return null;
}

function updateHomepageVersion(settings = {}, version, payload = {}, user = {}) {
  const targetVersion = normaliseHomepageVersion(version);
  if (!targetVersion) {
    throw new Error('Invalid homepage version');
  }

  const manager = buildHomepageManager(settings);
  const currentVersion = manager.versions[targetVersion];
  const nextVersion = {
    ...currentVersion,
    ...clone(payload),
    id: targetVersion,
    tabName: normaliseTabName(targetVersion, payload.tabName || currentVersion.tabName),
    settings: {
      ...currentVersion.settings,
      ...(payload.settings || {}),
      collageWidget: mergeCollageWidget(
        payload.settings?.collageWidget || currentVersion.settings.collageWidget
      ),
    },
    updatedAt: new Date().toISOString(),
    updatedBy: user.email || currentVersion.updatedBy || null,
  };

  manager.versions[targetVersion] = nextVersion;
  manager.updatedAt = nextVersion.updatedAt;
  manager.updatedBy = nextVersion.updatedBy;

  settings.homepageManager = manager;

  if (targetVersion === manager.activeVersion) {
    settings.collageWidget = clone(nextVersion.settings.collageWidget);
  }

  return settings;
}

function publishHomepageVersion(settings = {}, version, user = {}) {
  const targetVersion = normaliseHomepageVersion(version);
  if (!targetVersion) {
    throw new Error('Invalid homepage version');
  }

  const manager = buildHomepageManager(settings);
  const now = new Date().toISOString();

  HOMEPAGE_VERSION_KEYS.forEach(key => {
    manager.versions[key].status = key === targetVersion ? 'published' : 'draft';
  });

  manager.activeVersion = targetVersion;
  manager.versions[targetVersion].enabled = true;
  manager.versions[targetVersion].updatedAt = now;
  manager.versions[targetVersion].updatedBy = user.email || null;
  manager.updatedAt = now;
  manager.updatedBy = user.email || null;

  settings.homepageManager = manager;
  settings.collageWidget = clone(manager.versions[targetVersion].settings.collageWidget);

  return settings;
}

function duplicateHomepageVersion(settings = {}, sourceVersion, targetVersion, user = {}) {
  const source = normaliseHomepageVersion(sourceVersion);
  const target = normaliseHomepageVersion(targetVersion);
  if (!source || !target || source === target) {
    throw new Error('Invalid homepage duplicate target');
  }

  const manager = buildHomepageManager(settings);
  const copied = clone(manager.versions[source]);
  const previousTarget = manager.versions[target];
  const now = new Date().toISOString();

  manager.versions[target] = {
    ...copied,
    id: target,
    tabName: previousTarget.tabName,
    status: target === manager.activeVersion ? 'published' : 'draft',
    updatedAt: now,
    updatedBy: user.email || null,
  };
  manager.updatedAt = now;
  manager.updatedBy = user.email || null;

  settings.homepageManager = manager;

  if (target === manager.activeVersion) {
    settings.collageWidget = clone(manager.versions[target].settings.collageWidget);
  }

  return settings;
}

module.exports = {
  HOMEPAGE_VERSION_KEYS,
  DEFAULT_COLLAGE_WIDGET,
  buildHomepageManager,
  duplicateHomepageVersion,
  getActiveHomepageVersion,
  getHomepageCollageWidget,
  getHomepageVersion,
  isHomepageVersion,
  mergeCollageWidget,
  normaliseHomepageVersion,
  publishHomepageVersion,
  updateHomepageVersion,
  validateHomepageVersionPayload,
};
