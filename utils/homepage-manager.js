/**
 * Homepage version manager helpers.
 *
 * Keeps the current collageWidget contract working while adding explicit
 * editable slots for V1, V2 and V3 homepage management.
 */

'use strict';

const HOMEPAGE_VERSION_KEYS = ['v1', 'v2', 'v3'];
const HOMEPAGE_VERSION_SET = new Set(HOMEPAGE_VERSION_KEYS);
const HOMEPAGE_MEDIA_MODES = [
  'auto_pexels_photos',
  'auto_pexels_videos',
  'auto_pexels_mixed',
  'uploads',
  'selected_pexels',
  'selected_with_fallback',
];
const HOMEPAGE_MEDIA_TARGETS = ['hero', 'collage', 'general'];

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
  enabled: true,
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

function deriveMediaModeFromCollageWidget(collageWidget = {}) {
  if (collageWidget.source === 'uploads') {
    return 'uploads';
  }
  const mediaTypes = collageWidget.mediaTypes || {};
  const photos = mediaTypes.photos !== false;
  const videos = mediaTypes.videos === true;
  if (videos && !photos) {
    return 'auto_pexels_videos';
  }
  if (photos && !videos) {
    return 'auto_pexels_photos';
  }
  return 'auto_pexels_mixed';
}

function normaliseAssignedTargets(targets) {
  const list = Array.isArray(targets) ? targets : targets ? [targets] : ['collage'];
  const clean = list.filter(target => HOMEPAGE_MEDIA_TARGETS.includes(target));
  return clean.length ? Array.from(new Set(clean)) : ['collage'];
}

function normaliseSelectedMediaItem(item = {}) {
  const type = item.type === 'video' ? 'video' : 'photo';
  const providerId = item.providerId || item.provider_id || item.id;
  const id = String(item.id || `pexels-${type}-${providerId}`);
  return {
    id,
    provider: item.provider || 'pexels',
    providerId: providerId !== undefined ? String(providerId) : null,
    type,
    url: item.url || item.mediaUrl || '',
    thumbnailUrl: item.thumbnailUrl || item.image || item.url || item.mediaUrl || '',
    alt: String(
      item.alt || item.title || (type === 'video' ? 'Pexels video' : 'Pexels photo')
    ).slice(0, 180),
    photographer: item.photographer || item.creator || item.user?.name || 'Pexels',
    photographerUrl: item.photographerUrl || item.user?.url || null,
    pexelsUrl: item.pexelsUrl || item.urlPage || item.sourceUrl || null,
    width: item.width || null,
    height: item.height || null,
    duration: item.duration || null,
    quality: item.quality || null,
    assignedTargets: normaliseAssignedTargets(item.assignedTargets || item.target),
    categoryKey: item.categoryKey || null,
    addedAt: item.addedAt || new Date().toISOString(),
    addedBy: item.addedBy || null,
  };
}

function normaliseUploadGalleryItem(url, index = 0) {
  return {
    id: `upload-${index}-${String(url).split('/').pop() || 'media'}`,
    provider: 'upload',
    providerId: url,
    type: /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'photo',
    url,
    thumbnailUrl: null,
    alt: 'Uploaded homepage media',
    assignedTargets: ['collage'],
  };
}

function normaliseSelectedUploadItem(item = {}, index = 0) {
  const upload = typeof item === 'string' ? { url: item } : item;
  const url = upload.url || upload.mediaUrl || upload.providerId || '';
  const type = upload.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'photo';
  return {
    id: String(upload.id || `upload-${index}-${String(url).split('/').pop() || 'media'}`),
    provider: 'upload',
    providerId: String(upload.providerId || url),
    type,
    url,
    thumbnailUrl: upload.thumbnailUrl || upload.image || upload.posterUrl || null,
    alt: String(upload.alt || upload.title || 'Uploaded homepage media').slice(0, 180),
    photographer: upload.photographer || upload.creator || upload.user?.name || 'Uploaded media',
    photographerUrl: upload.photographerUrl || null,
    pexelsUrl: upload.pexelsUrl || null,
    width: upload.width || null,
    height: upload.height || null,
    duration: upload.duration || null,
    quality: upload.quality || null,
    assignedTargets: normaliseAssignedTargets(upload.assignedTargets || upload.target),
    categoryKey: upload.categoryKey || null,
    addedAt: upload.addedAt || new Date().toISOString(),
    addedBy: upload.addedBy || null,
  };
}

function normaliseSelectedUploads(selectedUploads, uploadGallery) {
  const selected = Array.isArray(selectedUploads)
    ? selectedUploads
        .filter(Boolean)
        .map((item, index) => normaliseSelectedUploadItem(item, index))
        .filter(item => item.url)
    : [];
  const existingUrls = new Set(selected.map(item => item.url || item.providerId));
  const legacy = Array.isArray(uploadGallery)
    ? uploadGallery
        .filter(url => typeof url === 'string' && url.trim() && !existingUrls.has(url))
        .map((url, index) => normaliseUploadGalleryItem(url, index))
    : [];
  return [...selected, ...legacy];
}

function normaliseMediaLibrary(mediaLibrary = {}, collageWidget = {}) {
  const mode = HOMEPAGE_MEDIA_MODES.includes(mediaLibrary.mode)
    ? mediaLibrary.mode
    : deriveMediaModeFromCollageWidget(collageWidget);
  const mediaTypes = {
    photos:
      mediaLibrary.mediaTypes?.photos !== undefined
        ? mediaLibrary.mediaTypes.photos !== false
        : collageWidget.mediaTypes?.photos !== false,
    videos:
      mediaLibrary.mediaTypes?.videos !== undefined
        ? mediaLibrary.mediaTypes.videos !== false
        : collageWidget.mediaTypes?.videos !== false,
  };
  return {
    mode,
    mediaTypes,
    fallback: {
      enabled:
        mediaLibrary.fallback?.enabled !== undefined
          ? mediaLibrary.fallback.enabled !== false
          : collageWidget.fallbackToPexels !== false,
      source: 'pexels',
      minimumItems: Number(mediaLibrary.fallback?.minimumItems || 6),
    },
    selectedPexels: Array.isArray(mediaLibrary.selectedPexels)
      ? mediaLibrary.selectedPexels
          .map(normaliseSelectedMediaItem)
          .filter(item => item.provider === 'pexels' && item.providerId && item.url)
      : [],
    selectedUploads: normaliseSelectedUploads(
      mediaLibrary.selectedUploads,
      collageWidget.uploadGallery
    ),
    hero: {
      mode: mediaLibrary.hero?.mode || 'auto',
      selectedMediaId: mediaLibrary.hero?.selectedMediaId || null,
      autoplay:
        mediaLibrary.hero?.autoplay !== undefined
          ? mediaLibrary.hero.autoplay === true
          : collageWidget.heroVideo?.autoplay === true,
      muted:
        mediaLibrary.hero?.muted !== undefined
          ? mediaLibrary.hero.muted !== false
          : collageWidget.heroVideo?.muted !== false,
      loop:
        mediaLibrary.hero?.loop !== undefined
          ? mediaLibrary.hero.loop !== false
          : collageWidget.heroVideo?.loop !== false,
      quality: mediaLibrary.hero?.quality || collageWidget.heroVideo?.quality || 'hd',
    },
    pexelsQueries: {
      ...DEFAULT_PEXELS_QUERIES,
      ...(collageWidget.pexelsQueries || {}),
      ...(mediaLibrary.pexelsQueries || {}),
    },
    pexelsVideoQueries: {
      ...DEFAULT_PEXELS_VIDEO_QUERIES,
      ...(collageWidget.pexelsVideoQueries || {}),
      ...(mediaLibrary.pexelsVideoQueries || {}),
    },
  };
}

function resolveHomepageMedia(versionSettings = {}) {
  const collageWidget = mergeCollageWidget(versionSettings.collageWidget || {});
  const mediaLibrary = normaliseMediaLibrary(versionSettings.mediaLibrary || {}, collageWidget);
  const selectedPexels = mediaLibrary.selectedPexels;
  const selectedUploads = mediaLibrary.selectedUploads || [];
  const selectedAll = [...selectedPexels, ...selectedUploads];
  const heroMedia = mediaLibrary.hero.selectedMediaId
    ? selectedAll.find(item => item.id === mediaLibrary.hero.selectedMediaId) || null
    : selectedAll.find(item => item.assignedTargets?.includes('hero')) || null;

  switch (mediaLibrary.mode) {
    case 'auto_pexels_photos':
      return {
        source: 'pexels',
        mediaTypes: { photos: true, videos: false },
        selected: [],
        heroMedia: null,
        fallback: { ...mediaLibrary.fallback, enabled: true },
        mediaLibrary,
      };
    case 'auto_pexels_videos':
      return {
        source: 'pexels',
        mediaTypes: { photos: false, videos: true },
        selected: [],
        heroMedia: null,
        fallback: { ...mediaLibrary.fallback, enabled: true },
        mediaLibrary,
      };
    case 'uploads':
      return {
        source: 'uploads',
        mediaTypes: mediaLibrary.mediaTypes,
        selected: selectedUploads,
        heroMedia,
        fallback: mediaLibrary.fallback.enabled ? mediaLibrary.fallback : null,
        mediaLibrary,
      };
    case 'selected_pexels':
      return {
        source: 'selected',
        mediaTypes: mediaLibrary.mediaTypes,
        selected: selectedPexels,
        heroMedia,
        fallback: null,
        mediaLibrary,
      };
    case 'selected_with_fallback':
      return {
        source: 'selected_with_fallback',
        mediaTypes: mediaLibrary.mediaTypes,
        selected: selectedAll,
        heroMedia,
        fallback: mediaLibrary.fallback,
        mediaLibrary,
      };
    case 'auto_pexels_mixed':
    default:
      return {
        source: 'pexels',
        mediaTypes: { photos: true, videos: true },
        selected: [],
        heroMedia: null,
        fallback: { ...mediaLibrary.fallback, enabled: true },
        mediaLibrary,
      };
  }
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol);
  } catch (_) {
    return false;
  }
}

function validatePexelsAssignmentPayload(payload = {}) {
  const media = payload.media || {};
  const target = payload.target || 'collage';
  const modeAfterAssign = payload.modeAfterAssign || 'unchanged';
  if (!HOMEPAGE_MEDIA_TARGETS.includes(target)) {
    return 'Choose a valid homepage placement.';
  }
  if (!['unchanged', 'selected_pexels', 'selected_with_fallback'].includes(modeAfterAssign)) {
    return 'Choose a valid after-save media behaviour.';
  }
  if (media.provider && media.provider !== 'pexels') {
    return 'Only Pexels media can be assigned here.';
  }
  if (!['photo', 'video'].includes(media.type)) {
    return 'Media type must be photo or video.';
  }
  if (!media.providerId && !media.id) {
    return 'Pexels media ID is required.';
  }
  if (!safeHttpUrl(media.url || media.mediaUrl)) {
    return 'Media URL must be a valid HTTP or HTTPS URL.';
  }
  if ((media.thumbnailUrl || media.image) && !safeHttpUrl(media.thumbnailUrl || media.image)) {
    return 'Thumbnail URL must be a valid HTTP or HTTPS URL.';
  }
  return null;
}

function assignPexelsMediaToVersion(settings = {}, version, payload = {}, user = {}) {
  const targetVersion = normaliseHomepageVersion(version);
  if (!targetVersion) {
    throw new Error('Invalid homepage version');
  }
  const validation = validatePexelsAssignmentPayload(payload);
  if (validation) {
    throw new Error(validation);
  }
  const manager = buildHomepageManager(settings);
  const versionConfig = manager.versions[targetVersion];
  const library = normaliseMediaLibrary(
    versionConfig.settings.mediaLibrary || {},
    versionConfig.settings.collageWidget
  );
  const item = normaliseSelectedMediaItem({
    ...payload.media,
    target: payload.target || 'collage',
    addedBy: user.email || null,
  });
  const assignedMediaTypes = {
    ...versionConfig.settings.collageWidget.mediaTypes,
    ...library.mediaTypes,
  };
  if (item.type === 'video') {
    assignedMediaTypes.videos = true;
  } else {
    assignedMediaTypes.photos = true;
  }
  library.mediaTypes = { ...library.mediaTypes, ...assignedMediaTypes };
  const modeAfterAssign = payload.modeAfterAssign || 'unchanged';
  const existing = library.selectedPexels.find(
    media =>
      media.id === item.id ||
      (media.providerId && media.providerId === item.providerId && media.type === item.type)
  );
  if (existing) {
    existing.assignedTargets = normaliseAssignedTargets([
      ...(existing.assignedTargets || []),
      ...(item.assignedTargets || []),
    ]);
    if ((payload.target || 'collage') === 'hero') {
      library.hero = { ...library.hero, mode: 'selected_pexels', selectedMediaId: existing.id };
    }
  } else {
    library.selectedPexels.push(item);
    if ((payload.target || 'collage') === 'hero') {
      library.hero = { ...library.hero, mode: 'selected_pexels', selectedMediaId: item.id };
    }
  }
  versionConfig.settings.collageWidget = {
    ...versionConfig.settings.collageWidget,
    mediaTypes: assignedMediaTypes,
  };
  if (modeAfterAssign === 'selected_pexels' || modeAfterAssign === 'selected_with_fallback') {
    library.mode = modeAfterAssign;
    versionConfig.settings.collageWidget = {
      ...versionConfig.settings.collageWidget,
      source: 'pexels',
      fallbackToPexels:
        modeAfterAssign === 'selected_with_fallback' ? library.fallback.enabled !== false : false,
    };
  }
  versionConfig.settings.mediaLibrary = library;
  return updateHomepageVersion(settings, targetVersion, { settings: versionConfig.settings }, user);
}

function removePexelsMediaFromVersion(settings = {}, version, mediaId, user = {}) {
  const targetVersion = normaliseHomepageVersion(version);
  if (!targetVersion) {
    throw new Error('Invalid homepage version');
  }
  const manager = buildHomepageManager(settings);
  const versionConfig = manager.versions[targetVersion];
  const library = normaliseMediaLibrary(
    versionConfig.settings.mediaLibrary || {},
    versionConfig.settings.collageWidget
  );
  library.selectedPexels = library.selectedPexels.filter(item => item.id !== mediaId);
  if (library.hero.selectedMediaId === mediaId) {
    library.hero = { ...library.hero, mode: 'auto', selectedMediaId: null };
  }
  versionConfig.settings.mediaLibrary = library;
  return updateHomepageVersion(settings, targetVersion, { settings: versionConfig.settings }, user);
}

function updateMediaLibraryForVersion(settings = {}, version, patch = {}, user = {}) {
  const targetVersion = normaliseHomepageVersion(version);
  if (!targetVersion) {
    throw new Error('Invalid homepage version');
  }
  const manager = buildHomepageManager(settings);
  const versionConfig = manager.versions[targetVersion];
  const library = normaliseMediaLibrary(
    versionConfig.settings.mediaLibrary || {},
    versionConfig.settings.collageWidget
  );
  if (patch.mode !== undefined) {
    if (!HOMEPAGE_MEDIA_MODES.includes(patch.mode)) {
      throw new Error('Choose a valid media source.');
    }
    library.mode = patch.mode;
    versionConfig.settings.collageWidget.source = patch.mode === 'uploads' ? 'uploads' : 'pexels';
    versionConfig.settings.collageWidget.mediaTypes =
      patch.mode === 'auto_pexels_photos'
        ? { photos: true, videos: false }
        : patch.mode === 'auto_pexels_videos'
          ? { photos: false, videos: true }
          : { ...versionConfig.settings.collageWidget.mediaTypes, ...library.mediaTypes };
  }
  if (patch.fallback) {
    library.fallback = { ...library.fallback, ...patch.fallback, source: 'pexels' };
  }
  if (patch.hero) {
    library.hero = { ...library.hero, ...patch.hero };
  }
  versionConfig.settings.mediaLibrary = library;
  return updateHomepageVersion(settings, targetVersion, { settings: versionConfig.settings }, user);
}

function hasExplicitCollageDisable(widget = {}) {
  return (
    widget.enabled === false &&
    (widget.enabledExplicit === true || Boolean(widget.updatedAt) || Boolean(widget.updatedBy))
  );
}

function getFallbackCollageWidget(settings = {}) {
  const fallback = { ...(settings.collageWidget || {}) };
  if (fallback.enabled === undefined && settings.features?.pexelsCollage === true) {
    fallback.enabled = true;
  }
  if (fallback.enabled === false && !hasExplicitCollageDisable(fallback)) {
    fallback.enabled = true;
    fallback.legacyDefaultResolved = true;
  }
  return fallback;
}

function shouldTreatDisabledAsLegacyDefault(existingWidget = {}, fallbackCollageWidget = {}) {
  if (existingWidget.enabled !== false) {
    return false;
  }
  if (fallbackCollageWidget.enabled === false) {
    return false;
  }
  if (hasExplicitCollageDisable(existingWidget)) {
    return false;
  }
  return true;
}

function buildDefaultVersion(version, existingCollageWidget = {}) {
  const baseCollageWidget = mergeCollageWidget(existingCollageWidget);
  const isV1 = version === 'v1';
  const isV3 = version === 'v3';
  const hasExplicitVideoSetting = existingCollageWidget.mediaTypes?.videos !== undefined;

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
      mediaLibrary: normaliseMediaLibrary(
        existingCollageWidget.mediaLibrary || {},
        baseCollageWidget
      ),
      collageWidget: {
        ...baseCollageWidget,
        enabled: baseCollageWidget.enabled !== false,
        mediaTypes: {
          ...baseCollageWidget.mediaTypes,
          videos:
            isV1 && !hasExplicitVideoSetting
              ? false
              : baseCollageWidget.mediaTypes.videos !== false,
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
  const existingWidget = existingSettings.collageWidget;
  const collageWidget = mergeCollageWidget(existingWidget || defaults.settings.collageWidget);

  if (shouldTreatDisabledAsLegacyDefault(existingWidget, fallbackCollageWidget)) {
    collageWidget.enabled = true;
  }

  return {
    ...defaults,
    ...clone(existingVersion),
    id: version,
    tabName: normaliseTabName(version, existingVersion.tabName || defaults.tabName),
    enabled:
      existingVersion.enabled !== undefined ? existingVersion.enabled === true : defaults.enabled,
    status: ['draft', 'preview', 'published'].includes(existingVersion.status)
      ? existingVersion.status
      : defaults.status,
    settings: {
      ...defaults.settings,
      ...clone(existingSettings),
      collageWidget,
      mediaLibrary: normaliseMediaLibrary(existingSettings.mediaLibrary || {}, collageWidget),
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
  const fallbackCollageWidget = getFallbackCollageWidget(settings);
  const activeVersion = resolveInitialActiveVersion(settings);
  const versions = {};

  HOMEPAGE_VERSION_KEYS.forEach(version => {
    versions[version] = normaliseVersion(
      version,
      existingManager.versions?.[version],
      fallbackCollageWidget
    );
    if (version === activeVersion) {
      versions[version].status = 'published';
    } else if (versions[version].status === 'published') {
      versions[version].status = 'preview';
    }
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
  const widget = mergeCollageWidget(
    versionConfig?.settings?.collageWidget || settings.collageWidget || {}
  );
  if (widget.enabled === false && !hasExplicitCollageDisable(widget)) {
    widget.enabled = true;
    widget.legacyDefaultResolved = true;
  }
  return widget;
}

async function getActiveHomepageVersion() {
  const dbUnified = require('../db-unified');
  const settings = (await dbUnified.read('settings')) || {};
  return buildHomepageManager(settings).activeVersion;
}

function validateHomepageVersionPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Invalid homepage version payload';
  }

  if (payload.tabName !== undefined && String(payload.tabName).trim().length > 40) {
    return 'Tab name must be 40 characters or fewer';
  }

  if (payload.status !== undefined && !['draft', 'preview', 'published'].includes(payload.status)) {
    return 'Invalid homepage status';
  }

  if (
    payload.settings !== undefined &&
    (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings))
  ) {
    return 'Homepage settings must be an object';
  }

  if (
    payload.settings?.collageWidget !== undefined &&
    (!payload.settings.collageWidget ||
      typeof payload.settings.collageWidget !== 'object' ||
      Array.isArray(payload.settings.collageWidget))
  ) {
    return 'Homepage collage widget settings must be an object';
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
  const nextCollageWidget = mergeCollageWidget(
    payload.settings?.collageWidget || currentVersion.settings.collageWidget
  );

  if (payload.settings?.collageWidget?.enabled !== undefined) {
    nextCollageWidget.enabledExplicit = true;
  }

  const nextVersion = {
    ...currentVersion,
    ...clone(payload),
    id: targetVersion,
    tabName: normaliseTabName(targetVersion, payload.tabName || currentVersion.tabName),
    settings: {
      ...currentVersion.settings,
      ...(payload.settings || {}),
      collageWidget: nextCollageWidget,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: user.email || currentVersion.updatedBy || null,
  };

  if (targetVersion === manager.activeVersion) {
    nextVersion.status = 'published';
  } else if (nextVersion.status === 'published') {
    nextVersion.status = 'preview';
  }

  manager.versions[targetVersion] = nextVersion;
  manager.updatedAt = nextVersion.updatedAt;
  manager.updatedBy = nextVersion.updatedBy;

  settings.homepageManager = manager;

  if (targetVersion === manager.activeVersion) {
    settings.collageWidget = clone(nextVersion.settings.collageWidget);
    settings.mediaLibrary = clone(nextVersion.settings.mediaLibrary);
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
  settings.mediaLibrary = clone(manager.versions[targetVersion].settings.mediaLibrary);

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
    settings.mediaLibrary = clone(manager.versions[target].settings.mediaLibrary);
  }

  return settings;
}

module.exports = {
  HOMEPAGE_VERSION_KEYS,
  HOMEPAGE_MEDIA_MODES,
  HOMEPAGE_MEDIA_TARGETS,
  DEFAULT_COLLAGE_WIDGET,
  assignPexelsMediaToVersion,
  buildHomepageManager,
  duplicateHomepageVersion,
  getActiveHomepageVersion,
  getHomepageCollageWidget,
  getHomepageVersion,
  normaliseMediaLibrary,
  isHomepageVersion,
  hasExplicitCollageDisable,
  mergeCollageWidget,
  normaliseHomepageVersion,
  removePexelsMediaFromVersion,
  resolveHomepageMedia,
  publishHomepageVersion,
  updateHomepageVersion,
  updateMediaLibraryForVersion,
  validatePexelsAssignmentPayload,
  validateHomepageVersionPayload,
};
