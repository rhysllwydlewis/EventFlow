(() => {
  'use strict';

  function getHeroVideoFiles(video) {
    const files = video?.video_files || video?.videoFiles || [];

    if (!Array.isArray(files)) {
      return [];
    }

    return files.filter(file => {
      const link = file?.link || '';
      const type = file?.file_type || file?.fileType || 'video/mp4';
      return link && type.includes('mp4');
    });
  }

  function getHeroVideoTargetWidth() {
    const viewportWidth = Math.max(
      window.innerWidth || 0,
      document.documentElement?.clientWidth || 0,
      0
    );
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    if (viewportWidth <= 720) {
      return 960;
    }

    if (viewportWidth <= 1180) {
      return 1280;
    }

    return Math.min(Math.ceil(viewportWidth * pixelRatio), 1920);
  }

  function chooseHeroVideoFile(video) {
    const files = getHeroVideoFiles(video);

    if (files.length === 0) {
      return null;
    }

    const targetWidth = getHeroVideoTargetWidth();
    const suitableFiles = files.filter(file => !file.width || file.width <= targetWidth);
    const pool = suitableFiles.length > 0 ? suitableFiles : files;

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

  function allowHeroVideoPlayback(video) {
    video.autoplay = true;
    video.setAttribute('autoplay', '');
    video.preload = 'metadata';
  }

  function playHeroVideo(video) {
    const playPromise = video.play();

    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  function setHeroVideoSource({ container, video, source, file, poster }) {
    if (!file?.link) {
      return false;
    }

    if (poster) {
      video.setAttribute('poster', poster);
    }

    container.classList.add('is-loading');
    source.src = file.link;
    source.type = file.file_type || file.fileType || 'video/mp4';
    video.preload = 'metadata';
    video.load();
    playHeroVideo(video);
    return true;
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

    video.addEventListener(
      'loadeddata',
      () => {
        container.classList.remove('is-loading');
        container.classList.add('is-ready');
      },
      { once: true }
    );

    video.addEventListener(
      'error',
      () => {
        const fallbackSrc = source.dataset.fallbackSrc;

        container.classList.remove('is-loading');

        if (fallbackSrc && source.src !== fallbackSrc) {
          source.src = fallbackSrc;
          source.type = 'video/mp4';
          video.preload = 'metadata';
          video.load();
          playHeroVideo(video);
        }
      },
      { once: true }
    );

    if (reduceMotion || saveData) {
      video.removeAttribute('autoplay');
      video.autoplay = false;
      video.pause();
      return;
    }

    allowHeroVideoPlayback(video);
    playHeroVideo(video);

    try {
      const query = 'wedding celebration cinematic venue';
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
        return;
      }

      const data = await response.json();
      const videos = Array.isArray(data.videos) ? data.videos : [];
      const nextVideo = videos.find(candidate => getHeroVideoFiles(candidate).length > 0);

      if (!nextVideo) {
        return;
      }

      const file = chooseHeroVideoFile(nextVideo);
      setHeroVideoSource({
        container,
        file,
        poster: nextVideo.image,
        source,
        video,
      });
    } catch {
      container.classList.remove('is-loading');
    }
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
