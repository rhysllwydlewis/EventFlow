(() => {
  'use strict';

  const DEFAULT_VIDEO_QUERY = 'wedding celebration cinematic venue';
  const DEFAULT_ROTATION_SECONDS = 8;
  const MIN_ROTATION_SECONDS = 1;
  const MOBILE_TRANSITION_MULTIPLIER = 1.5;
  const VIDEO_UPLOAD_PATTERN = /\.(mp4|webm|mov)(?:$|[?#])/i;
  const TRANSITION_EFFECTS = new Set(['fade', 'slide', 'zoom', 'crossfade']);

  function isMobileViewport() {
    return window.matchMedia?.('(max-width: 720px)').matches === true;
  }

  function getHeroVideoFiles(video) {
    const files = video?.video_files || video?.videoFiles || [];

    if (!Array.isArray(files)) {
      return [];
    }

    return files.filter(file => {
      const link = file?.link || '';
      const type = file?.file_type || file?.fileType || 'video/mp4';
      return link && type.includes('video/');
    });
  }

  function getVideoDimensions(video) {
    const files = getHeroVideoFiles(video);
    const fileWithDimensions = [...files]
      .filter(file => Number(file.width) > 0 && Number(file.height) > 0)
      .sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0];

    return {
      width: Number(video?.width || fileWithDimensions?.width || 0),
      height: Number(video?.height || fileWithDimensions?.height || 0),
    };
  }

  function getHeroVideoTargetWidth(settings = {}) {
    const preference = settings.videoQuality?.preference || settings.heroVideo?.quality || 'auto';
    const mobileOptimized = settings.videoQuality?.mobileOptimized !== false;
    const viewportWidth = Math.max(
      window.innerWidth || 0,
      document.documentElement?.clientWidth || 0,
      0
    );
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    if (preference === 'sd') {
      return 960;
    }

    if (preference === 'hd' && settings.videoQuality?.adaptive === false) {
      return 1920;
    }

    if (mobileOptimized && viewportWidth <= 720) {
      return 960;
    }

    if (mobileOptimized && viewportWidth <= 1180) {
      return 1280;
    }

    return Math.min(Math.ceil(viewportWidth * pixelRatio), 1920);
  }

  function videoPassesContentFilters(video, settings = {}) {
    const filtering = settings.contentFiltering || {};
    const { width, height } = getVideoDimensions(video);

    if (!width || !height) {
      return true;
    }

    if (filtering.orientation === 'landscape' && width <= height) {
      return false;
    }

    if (filtering.orientation === 'portrait' && height <= width) {
      return false;
    }

    if (filtering.orientation === 'square') {
      const squareTolerance = Math.abs(width - height) / Math.max(width, height);
      if (squareTolerance > 0.1) {
        return false;
      }
    }

    if (filtering.aspectRatio && filtering.aspectRatio !== 'any') {
      const ratio = width / height;
      const targetRatios = {
        '16:9': 16 / 9,
        '4:3': 4 / 3,
        '1:1': 1,
        '9:16': 9 / 16,
      };
      const targetRatio = targetRatios[filtering.aspectRatio];

      if (targetRatio && Math.abs(ratio - targetRatio) > 0.18) {
        return false;
      }
    }

    const minWidths = {
      SD: 640,
      HD: 1280,
      '4K': 3840,
    };
    const minWidth = minWidths[filtering.minResolution];

    return !minWidth || width >= minWidth;
  }

  function chooseHeroVideoFile(video, settings = {}) {
    const files = getHeroVideoFiles(video);

    if (files.length === 0) {
      return null;
    }

    const preference = settings.videoQuality?.preference || settings.heroVideo?.quality || 'auto';
    const targetWidth = getHeroVideoTargetWidth(settings);
    const qualityFiles =
      preference === 'hd' || preference === 'sd'
        ? files.filter(file => file.quality === preference)
        : files;
    const qualityPool = qualityFiles.length > 0 ? qualityFiles : files;
    const suitableFiles = qualityPool.filter(file => !file.width || file.width <= targetWidth);
    const pool = suitableFiles.length > 0 ? suitableFiles : qualityPool;

    return [...pool].sort((a, b) => {
      const widthScore = (b.width || 0) - (a.width || 0);

      if (widthScore !== 0) {
        return widthScore;
      }

      const aIsHd = a.quality === 'hd' ? 1 : 0;
      const bIsHd = b.quality === 'hd' ? 1 : 0;
      return bIsHd - aIsHd;
    })[0];
  }

  function getVideoTypeFromUrl(url) {
    const cleanUrl = String(url || '')
      .split('?')[0]
      .toLowerCase();

    if (cleanUrl.endsWith('.webm')) {
      return 'video/webm';
    }

    if (cleanUrl.endsWith('.mov')) {
      return 'video/quicktime';
    }

    return 'video/mp4';
  }

  function buildUploadPlaylist(settings = {}) {
    const uploadGallery = Array.isArray(settings.uploadGallery) ? settings.uploadGallery : [];

    return uploadGallery
      .filter(url => typeof url === 'string' && VIDEO_UPLOAD_PATTERN.test(url))
      .map((url, index) => ({
        id: `upload-${index}`,
        image: '',
        file: {
          file_type: getVideoTypeFromUrl(url),
          link: url,
          quality: 'upload',
        },
      }));
  }

  function normaliseSelectedVideoItem(item, fallbackId = 'selected-video') {
    if (!item || item.type !== 'video' || !item.url) {
      return null;
    }

    return {
      id: item.id || `selected-${item.providerId || fallbackId}`,
      image: item.thumbnailUrl || item.image || '',
      file: {
        file_type: item.fileType || item.file_type || getVideoTypeFromUrl(item.url),
        link: item.url,
        quality: item.quality || 'selected',
      },
    };
  }

  function buildSelectedPlaylist(settings = {}) {
    const playlist = [];
    const heroItem = normaliseSelectedVideoItem(settings.heroSelectedMedia, 'hero');

    if (heroItem) {
      playlist.push(heroItem);
    }

    const selectedMedia = Array.isArray(settings.selectedMedia) ? settings.selectedMedia : [];
    selectedMedia.forEach((item, index) => {
      const targets = Array.isArray(item?.assignedTargets) ? item.assignedTargets : [];
      const isHeroCandidate = targets.includes('hero') || targets.includes('general');
      const selectedItem = isHeroCandidate
        ? normaliseSelectedVideoItem(item, `media-${index}`)
        : null;

      if (
        selectedItem &&
        !playlist.some(existing => existing.file.link === selectedItem.file.link)
      ) {
        playlist.push(selectedItem);
      }
    });

    return playlist;
  }

  function buildPexelsPlaylist(videos, settings = {}) {
    const filteredVideos = videos.filter(video => videoPassesContentFilters(video, settings));
    const sourceVideos = filteredVideos.length > 0 ? filteredVideos : videos;

    return sourceVideos
      .map(video => ({
        id: video.id,
        image: video.image,
        file: chooseHeroVideoFile(video, settings),
      }))
      .filter(item => item.file?.link);
  }

  function getPreferredVideoQuery(settings = {}) {
    const queries = settings.pexelsVideoQueries || {};
    const orderedQueries = [
      queries.venues,
      queries.photography,
      queries.entertainment,
      queries.catering,
    ];
    return (
      orderedQueries.find(query => typeof query === 'string' && query.trim()) || DEFAULT_VIDEO_QUERY
    );
  }

  function getRotationDelay(settings = {}) {
    const intervalSeconds = Number(settings.intervalSeconds);
    const safeSeconds = Number.isFinite(intervalSeconds)
      ? intervalSeconds
      : DEFAULT_ROTATION_SECONDS;
    const multiplier =
      isMobileViewport() && settings.mobileOptimizations?.slowerTransitions === true
        ? MOBILE_TRANSITION_MULTIPLIER
        : 1;

    return Math.max(safeSeconds, MIN_ROTATION_SECONDS) * 1000 * multiplier;
  }

  function shouldDisableHeroVideo(settings = {}) {
    const mobileOptimizations = settings.mobileOptimizations || {};

    return (
      settings.enabled === false ||
      settings.heroVideo?.enabled === false ||
      settings.mediaTypes?.videos === false ||
      (isMobileViewport() && mobileOptimizations.disableVideos === true)
    );
  }

  function applyTransitionSettings(container, settings = {}) {
    const duration = Number(settings.transition?.duration);
    const mobileDurationMultiplier =
      isMobileViewport() && settings.mobileOptimizations?.slowerTransitions === true
        ? MOBILE_TRANSITION_MULTIPLIER
        : 1;
    const effect = TRANSITION_EFFECTS.has(settings.transition?.effect)
      ? settings.transition.effect
      : 'fade';

    container.dataset.transitionEffect = effect;

    if (Number.isFinite(duration)) {
      const clampedDuration = Math.max(300, Math.min(duration * mobileDurationMultiplier, 4500));
      container.style.setProperty('--hv3-video-transition-duration', `${clampedDuration}ms`);
    }
  }

  function applyPlaybackSettings(video, settings = {}) {
    const heroVideo = settings.heroVideo || {};
    const playbackControls = settings.playbackControls || {};

    video.muted = heroVideo.muted !== false;
    video.loop = heroVideo.loop !== false;
    video.controls = playbackControls.showControls === true;
    video.preload = settings.preloading?.enabled === false ? 'none' : 'metadata';
    video.disableRemotePlayback = true;

    if (playbackControls.fullscreen === true) {
      video.setAttribute('controlsList', 'nodownload noremoteplayback');
    } else {
      video.setAttribute('controlsList', 'nofullscreen nodownload noremoteplayback');
    }

    if (heroVideo.autoplay === false) {
      video.removeAttribute('autoplay');
      video.autoplay = false;
      return false;
    }

    video.autoplay = true;
    video.setAttribute('autoplay', '');
    return true;
  }

  function applyHoverPause(container, video, settings = {}, shouldPlay) {
    if (!shouldPlay || settings.playbackControls?.pauseOnHover !== true) {
      return;
    }

    container.addEventListener('mouseenter', () => {
      video.pause();
    });

    container.addEventListener('mouseleave', () => {
      playHeroVideo(video);
    });
  }

  function playHeroVideo(video) {
    const playPromise = video.play();

    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  function setHeroVideoSource({ container, video, source, item, shouldPlay }) {
    if (!item?.file?.link) {
      return false;
    }

    if (item.image) {
      video.setAttribute('poster', item.image);
    } else {
      video.removeAttribute('poster');
    }

    container.classList.add('is-loading');
    container.classList.remove('is-ready');
    source.src = item.file.link;
    source.type = item.file.file_type || item.file.fileType || getVideoTypeFromUrl(item.file.link);
    video.preload = video.preload === 'none' ? 'none' : 'metadata';
    video.load();

    if (shouldPlay) {
      playHeroVideo(video);
    }

    return true;
  }

  function startHeroVideoRotation({ container, video, source, playlist, settings, shouldPlay }) {
    if (playlist.length <= 1) {
      return;
    }

    let currentIndex = 0;
    let rotationTimer = null;
    let touchStartX = 0;
    const failedIndexes = new Set();
    const delay = getRotationDelay(settings);
    const shouldLoopPlaylist = settings.heroVideo?.loop !== false;

    video.loop = false;

    const getAdjacentIndex = (direction = 1) => {
      let nextIndex = currentIndex;

      for (let attempts = 0; attempts < playlist.length; attempts++) {
        nextIndex += direction;

        if (nextIndex >= playlist.length) {
          if (!shouldLoopPlaylist) {
            return null;
          }
          nextIndex = 0;
        }

        if (nextIndex < 0) {
          if (!shouldLoopPlaylist) {
            return null;
          }
          nextIndex = playlist.length - 1;
        }

        if (!failedIndexes.has(nextIndex)) {
          return nextIndex;
        }
      }

      return null;
    };

    const advanceVideo = ({ respectVisibility = true, direction = 1 } = {}) => {
      if (respectVisibility && document.hidden) {
        return true;
      }

      const nextIndex = getAdjacentIndex(direction);

      if (nextIndex === null) {
        source.removeAttribute('src');
        video.removeAttribute('autoplay');
        video.autoplay = false;
        video.pause();
        video.load();
        container.classList.remove('is-loading');
        return false;
      }

      currentIndex = nextIndex;
      return setHeroVideoSource({
        container,
        item: playlist[currentIndex],
        shouldPlay,
        source,
        video,
      });
    };

    const queueNextVideo = () => {
      window.clearTimeout(rotationTimer);
      rotationTimer = window.setTimeout(() => {
        if (advanceVideo()) {
          queueNextVideo();
        }
      }, delay);
    };

    const handleVideoEnded = () => {
      window.clearTimeout(rotationTimer);
      if (advanceVideo()) {
        queueNextVideo();
      }
    };

    const handleVideoError = () => {
      failedIndexes.add(currentIndex);
      container.classList.remove('is-loading');
      if (advanceVideo({ respectVisibility: false })) {
        queueNextVideo();
      }
    };

    const handleTouchStart = event => {
      touchStartX = event.touches?.[0]?.clientX || 0;
    };

    const handleTouchEnd = event => {
      if (settings.mobileOptimizations?.touchControls === false || !touchStartX) {
        return;
      }

      const touchEndX = event.changedTouches?.[0]?.clientX || touchStartX;
      const deltaX = touchEndX - touchStartX;

      touchStartX = 0;

      if (Math.abs(deltaX) < 48) {
        return;
      }

      window.clearTimeout(rotationTimer);
      if (advanceVideo({ respectVisibility: false, direction: deltaX < 0 ? 1 : -1 })) {
        queueNextVideo();
      }
    };

    video.addEventListener('ended', handleVideoEnded);
    video.addEventListener('error', handleVideoError);
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    queueNextVideo();

    window.addEventListener(
      'pagehide',
      () => {
        window.clearTimeout(rotationTimer);
        video.removeEventListener('ended', handleVideoEnded);
        video.removeEventListener('error', handleVideoError);
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchend', handleTouchEnd);
      },
      { once: true }
    );
  }

  async function loadHomepageVideoSettings() {
    const defaults = {
      enabled: true,
      source: 'pexels',
      mediaTypes: { videos: true },
      intervalSeconds: DEFAULT_ROTATION_SECONDS,
      pexelsVideoQueries: { venues: DEFAULT_VIDEO_QUERY },
      uploadGallery: [],
      selectedMedia: [],
      heroSelectedMedia: null,
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

    try {
      const response = await fetch('/api/v1/public/homepage-settings', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        return defaults;
      }

      const data = await response.json();
      const collageWidget = data.collageWidget || {};

      return {
        ...defaults,
        ...collageWidget,
        mediaTypes: { ...defaults.mediaTypes, ...(collageWidget.mediaTypes || {}) },
        heroVideo: { ...defaults.heroVideo, ...(collageWidget.heroVideo || {}) },
        videoQuality: { ...defaults.videoQuality, ...(collageWidget.videoQuality || {}) },
        transition: { ...defaults.transition, ...(collageWidget.transition || {}) },
        preloading: { ...defaults.preloading, ...(collageWidget.preloading || {}) },
        mobileOptimizations: {
          ...defaults.mobileOptimizations,
          ...(collageWidget.mobileOptimizations || {}),
        },
        contentFiltering: {
          ...defaults.contentFiltering,
          ...(collageWidget.contentFiltering || {}),
        },
        playbackControls: {
          ...defaults.playbackControls,
          ...(collageWidget.playbackControls || {}),
        },
      };
    } catch {
      return defaults;
    }
  }

  async function fetchPexelsPlaylist(settings) {
    const query = getPreferredVideoQuery(settings);
    const response = await fetch(
      `/api/v1/public/homepage-video?query=${encodeURIComponent(query)}`,
      {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const videos = Array.isArray(data.videos) ? data.videos : [];
    return buildPexelsPlaylist(videos, settings);
  }

  async function initialisePexelsHeroVideo() {
    const container = document.querySelector('[data-hv3-pexels-video]');
    const video = container?.querySelector('[data-hv3-video-media]');
    const source = container?.querySelector('[data-hv3-video-source]');

    if (!container || !video || !source || typeof fetch !== 'function') {
      return;
    }

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = window.navigator?.connection?.saveData === true;
    const settings = await loadHomepageVideoSettings();

    applyTransitionSettings(container, settings);

    video.addEventListener('loadeddata', () => {
      container.classList.remove('is-loading');
      container.classList.add('is-ready');
    });

    if (reduceMotion || saveData || shouldDisableHeroVideo(settings)) {
      source.removeAttribute('src');
      video.removeAttribute('autoplay');
      video.autoplay = false;
      video.pause();
      video.load();
      container.classList.remove('is-loading');
      return;
    }

    const shouldPlay = applyPlaybackSettings(video, settings);
    let playlist = [];
    const selectedMediaSource =
      settings.source === 'selected' || settings.source === 'selected_with_fallback';

    if (selectedMediaSource) {
      playlist = buildSelectedPlaylist(settings);
    }

    if (playlist.length === 0 && settings.source === 'uploads') {
      playlist = buildUploadPlaylist(settings);
    }

    const canFetchPexels =
      settings.source === 'pexels' ||
      (settings.source === 'uploads' && settings.fallbackToPexels !== false) ||
      (settings.source === 'selected_with_fallback' && settings.fallbackToPexels !== false);

    if (playlist.length === 0 && canFetchPexels) {
      try {
        playlist = await fetchPexelsPlaylist(settings);
      } catch {
        container.classList.remove('is-loading');
      }
    }

    if (playlist.length === 0) {
      source.removeAttribute('src');
      video.removeAttribute('autoplay');
      video.autoplay = false;
      video.pause();
      video.load();
      container.classList.remove('is-loading');
      container.classList.add('is-ready');
      return;
    }

    video.loop = playlist.length <= 1 && settings.heroVideo?.loop !== false;
    applyHoverPause(container, video, settings, shouldPlay);
    setHeroVideoSource({
      container,
      item: playlist[0],
      shouldPlay,
      source,
      video,
    });
    startHeroVideoRotation({
      container,
      playlist,
      settings,
      shouldPlay,
      source,
      video,
    });
  }

  function initialisePopularSearches() {
    const categoryField = document.getElementById('hv2-category');
    const keywordField = document.getElementById('hv2-keyword');
    const locationField = document.getElementById('hv2-location');
    const searchForm = document.querySelector('.hv2-search');
    const popularButtons = document.querySelectorAll('.hv2-popular button[data-category]');

    popularButtons.forEach(button => {
      button.addEventListener('click', () => {
        if (categoryField) {
          categoryField.value = button.dataset.category || '';
        }

        if (keywordField) {
          keywordField.value = button.textContent.trim();
        }

        if (locationField && button.dataset.location) {
          locationField.value = button.dataset.location;
        }

        if (searchForm) {
          searchForm.requestSubmit();
        }
      });
    });
  }

  function initialiseSearchState() {
    const searchForm = document.querySelector('.hv2-search');

    if (!searchForm) {
      return;
    }

    searchForm.addEventListener('submit', () => {
      const submitButton = searchForm.querySelector('.hv2-search__button');

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }
    });
  }

  function initialiseHomeV3Video() {
    initialisePexelsHeroVideo();
    initialisePopularSearches();
    initialiseSearchState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseHomeV3Video);
  } else {
    initialiseHomeV3Video();
  }
})();
