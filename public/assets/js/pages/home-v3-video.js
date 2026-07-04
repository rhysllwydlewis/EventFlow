(() => {
  'use strict';

  const DEFAULT_VIDEO_QUERY = 'wedding celebration cinematic venue';
  const MIN_ROTATION_SECONDS = 8;
  const VIDEO_UPLOAD_PATTERN = /\.(mp4|webm|mov)(?:$|[?#])/i;

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
    const cleanUrl = String(url || '').split('?')[0].toLowerCase();

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

  function buildPexelsPlaylist(videos, settings = {}) {
    return videos
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
    return orderedQueries.find(query => typeof query === 'string' && query.trim()) || DEFAULT_VIDEO_QUERY;
  }

  function getRotationDelay(settings = {}) {
    const intervalSeconds = Number(settings.intervalSeconds);
    const safeSeconds = Number.isFinite(intervalSeconds) ? intervalSeconds : MIN_ROTATION_SECONDS;
    return Math.max(safeSeconds, MIN_ROTATION_SECONDS) * 1000;
  }

  function shouldDisableHeroVideo(settings = {}) {
    const mobileOptimizations = settings.mobileOptimizations || {};
    const isMobile = window.matchMedia?.('(max-width: 720px)').matches === true;

    return (
      settings.enabled === false ||
      settings.heroVideo?.enabled === false ||
      settings.mediaTypes?.videos === false ||
      (isMobile && mobileOptimizations.disableVideos === true)
    );
  }

  function applyPlaybackSettings(video, settings = {}) {
    const heroVideo = settings.heroVideo || {};
    const playbackControls = settings.playbackControls || {};

    video.muted = heroVideo.muted !== false;
    video.loop = heroVideo.loop !== false;
    video.controls = playbackControls.showControls === true;
    video.preload = 'metadata';

    if (heroVideo.autoplay === false) {
      video.removeAttribute('autoplay');
      video.autoplay = false;
      return false;
    }

    video.autoplay = true;
    video.setAttribute('autoplay', '');
    return true;
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
    }

    container.classList.add('is-loading');
    source.src = item.file.link;
    source.type = item.file.file_type || item.file.fileType || getVideoTypeFromUrl(item.file.link);
    video.preload = 'metadata';
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
    const delay = getRotationDelay(settings);

    const queueNextVideo = () => {
      window.clearTimeout(rotationTimer);
      rotationTimer = window.setTimeout(() => {
        if (document.hidden) {
          queueNextVideo();
          return;
        }

        currentIndex = (currentIndex + 1) % playlist.length;
        setHeroVideoSource({
          container,
          item: playlist[currentIndex],
          shouldPlay,
          source,
          video,
        });
        queueNextVideo();
      }, delay);
    };

    queueNextVideo();
    window.addEventListener(
      'pagehide',
      () => {
        window.clearTimeout(rotationTimer);
      },
      { once: true }
    );
  }

  async function loadHomepageVideoSettings() {
    const defaults = {
      enabled: true,
      source: 'pexels',
      mediaTypes: { videos: true },
      intervalSeconds: MIN_ROTATION_SECONDS,
      pexelsVideoQueries: { venues: DEFAULT_VIDEO_QUERY },
      uploadGallery: [],
      fallbackToPexels: true,
      heroVideo: {
        enabled: true,
        autoplay: true,
        muted: true,
        loop: true,
        quality: 'auto',
      },
      videoQuality: {
        preference: 'auto',
        adaptive: true,
        mobileOptimized: true,
      },
      mobileOptimizations: { disableVideos: false },
      playbackControls: { showControls: false },
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
        mobileOptimizations: {
          ...defaults.mobileOptimizations,
          ...(collageWidget.mobileOptimizations || {}),
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
      `/api/admin/public/pexels-video?query=${encodeURIComponent(query)}`,
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

    video.addEventListener('loadeddata', () => {
      container.classList.remove('is-loading');
      container.classList.add('is-ready');
    });

    video.addEventListener('error', () => {
      const fallbackSrc = source.dataset.fallbackSrc;

      container.classList.remove('is-loading');

      if (fallbackSrc && source.src !== fallbackSrc) {
        source.src = fallbackSrc;
        source.type = getVideoTypeFromUrl(fallbackSrc);
        video.preload = 'metadata';
        video.load();

        if (video.autoplay) {
          playHeroVideo(video);
        }
      }
    });

    if (reduceMotion || saveData || shouldDisableHeroVideo(settings)) {
      video.removeAttribute('autoplay');
      video.autoplay = false;
      video.pause();
      return;
    }

    const shouldPlay = applyPlaybackSettings(video, settings);
    let playlist = [];

    if (settings.source === 'uploads') {
      playlist = buildUploadPlaylist(settings);
    }

    if (playlist.length === 0 && settings.source === 'pexels') {
      try {
        playlist = await fetchPexelsPlaylist(settings);
      } catch {
        container.classList.remove('is-loading');
      }
    }

    if (playlist.length === 0) {
      if (shouldPlay) {
        playHeroVideo(video);
      }
      return;
    }

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
