(async function () {
  'use strict';

  const VERSION_ORDER = ['v1', 'v2', 'v3'];
  const VERSION_FALLBACKS = {
    v1: {
      name: 'Homepage 1',
      kind: 'Original collage homepage',
      description: 'The original homepage. Best for collage-style photo and video layouts.',
      previewPath: '/',
    },
    v2: {
      name: 'Homepage 2',
      kind: 'Photo-led homepage',
      description: 'A cleaner homepage hero that can rotate photos, videos or selected media.',
      previewPath: '/home-v2-preview',
    },
    v3: {
      name: 'Homepage 3',
      kind: 'Video-led homepage',
      description: 'The premium hero with a video-first playlist and smart crop handling.',
      previewPath: '/home-v3-preview',
    },
  };
  const MODE_LABELS = {
    auto_pexels_photos: 'Automatic Pexels photos',
    auto_pexels_videos: 'Automatic Pexels videos',
    auto_pexels_mixed: 'Automatic Pexels photos and videos',
    selected_pexels: 'Selected Pexels only',
    selected_with_fallback: 'Selected media with fallback',
    uploads: 'Uploaded media only',
  };
  let manager = null;
  let mediaLibraries = {};
  let categories = [];
  let selectedVersion = 'v1';
  let editingCategoryId = null;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function toast(message, type = 'success') {
    if (window.AdminShared?.showToast) {
      window.AdminShared.showToast(message, type);
      return;
    }
    showStatus(message, type === 'error');
  }

  function confirmAction(options = {}) {
    if (window.AdminShared?.showConfirmModal) {
      return window.AdminShared.showConfirmModal(options);
    }
    showStatus(options.message || options.title || 'Confirmation is unavailable.', true);
    return false;
  }

  function showStatus(message, isError = false) {
    const status = $('#homepageStatus');
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle('is-error', isError);
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => {
      status.hidden = true;
    }, isError ? 7000 : 4200);
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Request failed.');
    }
    return data;
  }

  async function fetchCsrfToken() {
    const data = await fetchJson('/api/v1/csrf-token');
    return data.csrfToken;
  }

  async function verifyAdmin() {
    try {
      const data = await fetchJson('/api/v1/auth/me');
      if (!data.user || data.user.role !== 'admin') {
        window.location.href = '/auth';
      }
    } catch (error) {
      window.location.href = '/auth';
    }
  }

  function versionConfig(version) {
    return manager?.versions?.[version] || {};
  }

  function versionName(version) {
    const savedName = versionConfig(version).tabName;
    const legacyNames = ['V1 Classic', 'V2 Modern', 'V3 Premium Video'];
    return savedName && !legacyNames.includes(savedName)
      ? savedName
      : VERSION_FALLBACKS[version]?.name || version.toUpperCase();
  }

  function versionDescription(version) {
    return versionConfig(version).description || VERSION_FALLBACKS[version]?.description || '';
  }

  function versionPreviewPath(version) {
    return versionConfig(version).previewPath || VERSION_FALLBACKS[version]?.previewPath || '/';
  }

  function selectedLibrary(version = selectedVersion) {
    return mediaLibraries[version] || versionConfig(version).settings?.mediaLibrary || {};
  }

  function selectedSettings(version = selectedVersion) {
    return clone(versionConfig(version).settings || {});
  }

  function selectedItems(library = selectedLibrary()) {
    const items = [...(library.selectedPexels || []), ...(library.selectedUploads || [])];
    const order = Array.isArray(library.hero?.order) ? library.hero.order.map(String) : [];
    if (!order.length) {
      return items;
    }
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    return items.sort((a, b) => {
      const aIndex = orderIndex.has(String(a.id)) ? orderIndex.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(String(b.id)) ? orderIndex.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }

  function mediaSummary(version) {
    const library = selectedLibrary(version);
    const items = selectedItems(library);
    const heroCount = items.filter(item => (item.assignedTargets || []).includes('hero')).length;
    const videoCount = items.filter(item => item.type === 'video').length;
    return {
      total: items.length,
      heroCount,
      videoCount,
      mode: library.mode || 'auto_pexels_mixed',
      hasPrimary: Boolean(library.hero?.selectedMediaId),
    };
  }

  function homepageStatusText(version) {
    return version === manager?.activeVersion ? 'Live' : 'Preview';
  }

  function renderVersionCards() {
    const container = $('#homepageVersionCards');
    container.innerHTML = VERSION_ORDER.map(version => {
      const summary = mediaSummary(version);
      const isLive = version === manager.activeVersion;
      return `
        <article class="homepage-version-card ${isLive ? 'is-live' : ''}">
          <h3>${escapeHtml(versionName(version))}</h3>
          <p>${escapeHtml(VERSION_FALLBACKS[version].kind)}</p>
          <div class="homepage-card-meta">
            <span class="homepage-pill ${isLive ? 'is-live' : ''}">${homepageStatusText(version)}</span>
            <span class="homepage-pill">${escapeHtml(MODE_LABELS[summary.mode] || summary.mode)}</span>
            <span class="homepage-pill">${summary.total} selected</span>
            <span class="homepage-pill ${summary.videoCount ? 'is-video' : ''}">${summary.videoCount} videos</span>
            ${summary.hasPrimary ? '<span class="homepage-pill is-hero">Primary hero set</span>' : ''}
          </div>
          <p>${escapeHtml(versionDescription(version))}</p>
          <div class="homepage-card-actions">
            <button class="ef-cta btn btn-secondary" type="button" data-edit-version="${version}">Manage</button>
            <a class="ef-cta btn btn-secondary" href="${escapeHtml(isLive ? '/' : versionPreviewPath(version))}" target="_blank" rel="noopener">${isLive ? 'Open live' : 'Preview'}</a>
            <button class="ef-cta btn btn-primary" type="button" data-publish-version="${version}" ${isLive ? 'disabled' : ''}>Set live</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderVersionTabs() {
    const tabs = $('#heroVersionTabs');
    tabs.innerHTML = VERSION_ORDER.map(version => {
      const summary = mediaSummary(version);
      const isActive = version === selectedVersion;
      const isLive = version === manager.activeVersion;
      return `
        <button class="homepage-version-tab ${isActive ? 'is-active' : ''}" type="button" data-select-version="${version}">
          <strong>${escapeHtml(versionName(version))}</strong>
          <span>${isLive ? 'Live homepage' : 'Preview only'} · ${summary.total} selected media</span>
        </button>
      `;
    }).join('');
  }

  function setFormValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.value = value ?? '';
    }
  }

  function setChecked(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.checked = Boolean(value);
    }
  }

  function fillHeroForm() {
    const settings = selectedSettings();
    const library = selectedLibrary();
    const collage = settings.collageWidget || {};
    const mediaTypes = library.mediaTypes || collage.mediaTypes || {};
    const hero = library.hero || {};
    const transition = collage.transition || {};
    const fallback = library.fallback || {};
    const isHomepageOne = selectedVersion === 'v1';

    $('#selectedHomepageTitle').textContent = versionName(selectedVersion);
    $('#selectedHomepageDescription').textContent = versionDescription(selectedVersion);
    $('#selectedHomepagePreview').href =
      selectedVersion === manager.activeVersion ? '/' : versionPreviewPath(selectedVersion);
    $('#publishSelectedHomepage').disabled = selectedVersion === manager.activeVersion;
    $('#heroManagerContext').textContent = isHomepageOne
      ? 'Homepage 1 is the original homepage, so its hero can use collage behaviour as well as selected media.'
      : `${versionName(selectedVersion)} uses a single hero area. Selected hero media becomes the playlist before fallback is used.`;
    $('#heroEnabledLabel').textContent = isHomepageOne ? 'Enable collage hero media' : 'Enable hero media';

    setFormValue('heroSourceMode', library.mode || 'auto_pexels_mixed');
    setChecked('heroMediaPhotos', mediaTypes.photos !== false);
    setChecked('heroMediaVideos', mediaTypes.videos === true);
    setChecked('heroFallbackEnabled', fallback.enabled !== false);
    setFormValue('heroFallbackMinimum', fallback.minimumItems || 6);
    setChecked('heroEnabled', collage.enabled !== false);
    setFormValue('heroIntervalSeconds', collage.intervalSeconds || 2.5);
    setFormValue('heroTransitionEffect', transition.effect || 'fade');
    setFormValue('heroTransitionDuration', transition.duration || 1000);
    setChecked('heroAutoplay', hero.autoplay === true);
    setChecked('heroMuted', hero.muted !== false);
    setChecked('heroLoop', hero.loop !== false);
    setFormValue('heroQuality', hero.quality || collage.heroVideo?.quality || 'hd');

    const photoQueries = library.pexelsQueries || collage.pexelsQueries || {};
    const videoQueries = library.pexelsVideoQueries || collage.pexelsVideoQueries || {};
    setFormValue('queryPhotoVenues', photoQueries.venues || '');
    setFormValue('queryPhotoCatering', photoQueries.catering || '');
    setFormValue('queryPhotoEntertainment', photoQueries.entertainment || '');
    setFormValue('queryPhotoPhotography', photoQueries.photography || '');
    setFormValue('queryVideoVenues', videoQueries.venues || '');
    setFormValue('queryVideoCatering', videoQueries.catering || '');
    setFormValue('queryVideoEntertainment', videoQueries.entertainment || '');
    setFormValue('queryVideoPhotography', videoQueries.photography || '');

    renderHeroQueue();
  }

  function renderHeroQueue() {
    const container = $('#heroMediaQueue');
    const library = selectedLibrary();
    const items = selectedItems(library);
    const primaryId = library.hero?.selectedMediaId;

    if (!items.length) {
      container.innerHTML = `
        <div class="homepage-empty-state homepage-empty-state--action">
          <strong>No hero media assigned to ${escapeHtml(versionName(selectedVersion))} yet.</strong>
          <span>Use Admin Media to add Pexels photos, videos or uploaded media, then arrange the queue here.</span>
          <a class="ef-cta btn btn-secondary" href="/admin-media">Open Admin Media</a>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map((item, index) => {
      const targets = item.assignedTargets || [];
      const isHero = targets.includes('hero') || item.id === primaryId;
      const isPrimary = item.id === primaryId;
      const thumb = item.thumbnailUrl || item.url || '';
      const providerLabel = item.provider === 'upload' ? 'uploaded media' : 'Pexels media';
      return `
        <article class="homepage-media-item">
          <div class="homepage-media-thumb">
            ${item.type === 'video'
              ? `<video src="${escapeHtml(item.url)}" poster="${escapeHtml(thumb)}" muted playsinline preload="metadata"></video>`
              : `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(item.alt || '')}">`}
          </div>
          <div class="homepage-media-copy">
            <strong>${escapeHtml(item.alt || item.type || 'Homepage media')}</strong>
            <p>${escapeHtml(item.photographer || providerLabel)}</p>
            <div class="homepage-card-meta">
              <span class="homepage-pill ${item.type === 'video' ? 'is-video' : ''}">${escapeHtml(item.type || 'media')}</span>
              <span class="homepage-pill ${isHero ? 'is-hero' : ''}">${isHero ? 'In hero queue' : 'Saved, not in hero'}</span>
              ${isPrimary ? '<span class="homepage-pill is-live">Primary hero</span>' : ''}
              ${targets.includes('collage') ? '<span class="homepage-pill">Collage</span>' : ''}
              ${item.provider === 'upload' ? '<span class="homepage-pill is-warning">Upload</span>' : ''}
            </div>
          </div>
          <div class="homepage-media-actions">
            <button class="ef-cta btn btn-secondary" type="button" data-hero-use="${escapeHtml(item.id)}">${isHero ? 'Keep in hero' : 'Use in hero'}</button>
            <button class="ef-cta btn btn-secondary" type="button" data-hero-primary="${escapeHtml(item.id)}" ${isPrimary ? 'disabled' : ''}>Set primary</button>
            <button class="ef-cta btn btn-secondary" type="button" data-hero-move="${escapeHtml(item.id)}" data-hero-direction="up" ${index === 0 ? 'disabled' : ''}>Move up</button>
            <button class="ef-cta btn btn-secondary" type="button" data-hero-move="${escapeHtml(item.id)}" data-hero-direction="down" ${index === items.length - 1 ? 'disabled' : ''}>Move down</button>
            <button class="ef-cta btn btn-secondary" type="button" data-hero-remove-target="${escapeHtml(item.id)}" ${isHero ? '' : 'disabled'}>Remove from hero</button>
            <button class="ef-cta btn danger" type="button" data-hero-delete="${escapeHtml(item.id)}">Remove from homepage</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderSelectedHomepage() {
    renderVersionCards();
    renderVersionTabs();
    fillHeroForm();
  }

  function readHeroSettingsPatch() {
    const settings = selectedSettings();
    const mediaTypes = {
      photos: $('#heroMediaPhotos').checked,
      videos: $('#heroMediaVideos').checked,
    };
    const mode = $('#heroSourceMode').value;
    const fallbackEnabled = $('#heroFallbackEnabled').checked;
    const fallbackMinimum = Math.max(1, Math.min(24, Number($('#heroFallbackMinimum').value || 6)));
    const intervalSeconds = Number($('#heroIntervalSeconds').value || 2.5);
    const transitionDuration = Number($('#heroTransitionDuration').value || 1000);
    const quality = $('#heroQuality').value;
    const photoQueries = {
      venues: $('#queryPhotoVenues').value.trim(),
      catering: $('#queryPhotoCatering').value.trim(),
      entertainment: $('#queryPhotoEntertainment').value.trim(),
      photography: $('#queryPhotoPhotography').value.trim(),
    };
    const videoQueries = {
      venues: $('#queryVideoVenues').value.trim(),
      catering: $('#queryVideoCatering').value.trim(),
      entertainment: $('#queryVideoEntertainment').value.trim(),
      photography: $('#queryVideoPhotography').value.trim(),
    };

    if (!mediaTypes.photos && !mediaTypes.videos) {
      throw new Error('Choose at least one media type.');
    }
    if (intervalSeconds < 1 || intervalSeconds > 60) {
      throw new Error('Seconds between items must be between 1 and 60.');
    }
    if (transitionDuration < 300 || transitionDuration > 3000) {
      throw new Error('Transition duration must be between 300 and 3000ms.');
    }

    const currentLibrary = settings.mediaLibrary || {};
    const currentCollage = settings.collageWidget || {};
    const nextLibrary = {
      ...currentLibrary,
      mode,
      mediaTypes,
      fallback: {
        ...(currentLibrary.fallback || {}),
        enabled: fallbackEnabled,
        source: 'pexels',
        minimumItems: fallbackMinimum,
      },
      hero: {
        ...(currentLibrary.hero || {}),
        autoplay: $('#heroAutoplay').checked,
        muted: $('#heroMuted').checked,
        loop: $('#heroLoop').checked,
        quality,
      },
      pexelsQueries: photoQueries,
      pexelsVideoQueries: videoQueries,
    };
    const nextCollage = {
      ...currentCollage,
      enabled: $('#heroEnabled').checked,
      source: mode === 'uploads' ? 'uploads' : 'pexels',
      mediaTypes,
      intervalSeconds,
      fallbackToPexels: fallbackEnabled,
      heroVideo: {
        ...(currentCollage.heroVideo || {}),
        enabled: $('#heroEnabled').checked,
        autoplay: $('#heroAutoplay').checked,
        muted: $('#heroMuted').checked,
        loop: $('#heroLoop').checked,
        quality,
      },
      transition: {
        ...(currentCollage.transition || {}),
        effect: $('#heroTransitionEffect').value,
        duration: transitionDuration,
      },
      pexelsQueries: photoQueries,
      pexelsVideoQueries: videoQueries,
    };

    return {
      settings: {
        ...settings,
        mediaLibrary: nextLibrary,
        collageWidget: nextCollage,
      },
    };
  }

  async function saveHeroSettings(event) {
    event.preventDefault();
    try {
      const payload = readHeroSettingsPatch();
      const csrfToken = await fetchCsrfToken();
      const data = await fetchJson(`/api/v1/admin/homepage/manager/version/${selectedVersion}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      manager = data.manager;
      mediaLibraries[selectedVersion] = data.version.settings.mediaLibrary;
      renderSelectedHomepage();
      toast(`${versionName(selectedVersion)} hero settings saved.`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function publishVersion(version) {
    if (version === manager.activeVersion) {
      return;
    }
    const confirmed = await confirmAction({
      title: 'Set live homepage',
      message: `Make ${versionName(version)} the live homepage?`,
      confirmText: 'Set live',
    });
    if (!confirmed) {
      return;
    }
    try {
      const csrfToken = await fetchCsrfToken();
      const data = await fetchJson(`/api/v1/admin/homepage/manager/publish/${version}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      manager = data.manager;
      await loadMediaLibraries();
      selectedVersion = version;
      renderSelectedHomepage();
      toast(`${versionName(version)} is now live.`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function updateMediaItem(itemId, updater) {
    const settings = selectedSettings();
    const library = settings.mediaLibrary || {};
    const updateList = list => (list || []).map(item =>
      item.id === itemId ? updater({ ...item }) : item
    );
    library.selectedPexels = updateList(library.selectedPexels);
    library.selectedUploads = updateList(library.selectedUploads);
    settings.mediaLibrary = library;
    return settings;
  }

  async function saveVersionSettings(settings, successMessage) {
    const csrfToken = await fetchCsrfToken();
    const data = await fetchJson(`/api/v1/admin/homepage/manager/version/${selectedVersion}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ settings }),
    });
    manager = data.manager;
    mediaLibraries[selectedVersion] = data.version.settings.mediaLibrary;
    renderSelectedHomepage();
    toast(successMessage, 'success');
  }

  async function useInHero(itemId, setPrimary = false) {
    try {
      const settings = updateMediaItem(itemId, item => {
        item.assignedTargets = Array.from(new Set([...(item.assignedTargets || []), 'hero']));
        return item;
      });
      settings.mediaLibrary.hero = {
        ...(settings.mediaLibrary.hero || {}),
        mode: 'selected_pexels',
        selectedMediaId: setPrimary ? itemId : settings.mediaLibrary.hero?.selectedMediaId || itemId,
      };
      if (['auto_pexels_photos', 'auto_pexels_videos', 'auto_pexels_mixed'].includes(settings.mediaLibrary.mode)) {
        settings.mediaLibrary.mode = 'selected_with_fallback';
      }
      await saveVersionSettings(settings, 'Hero queue updated.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function moveHeroMedia(itemId, direction) {
    try {
      const settings = selectedSettings();
      const library = settings.mediaLibrary || {};
      const orderedItems = selectedItems(library);
      const currentIndex = orderedItems.findIndex(item => item.id === itemId);
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex === -1 || targetIndex < 0 || targetIndex >= orderedItems.length) {
        return;
      }
      const [item] = orderedItems.splice(currentIndex, 1);
      orderedItems.splice(targetIndex, 0, item);
      library.hero = {
        ...(library.hero || {}),
        order: orderedItems.map(item => item.id),
      };
      settings.mediaLibrary = library;
      await saveVersionSettings(settings, 'Hero media order updated.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function removeFromHero(itemId) {
    try {
      const settings = updateMediaItem(itemId, item => {
        item.assignedTargets = (item.assignedTargets || []).filter(target => target !== 'hero');
        if (!item.assignedTargets.length) {
          item.assignedTargets = ['general'];
        }
        return item;
      });
      if (settings.mediaLibrary.hero?.selectedMediaId === itemId) {
        settings.mediaLibrary.hero = {
          ...(settings.mediaLibrary.hero || {}),
          mode: 'auto',
          selectedMediaId: null,
        };
      }
      await saveVersionSettings(settings, 'Media removed from the hero queue.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteSelectedMedia(itemId) {
    const library = selectedLibrary();
    const uploadItem = (library.selectedUploads || []).find(item => item.id === itemId);
    const confirmed = await confirmAction({
      title: 'Remove homepage media',
      message: 'Remove this media from the selected homepage? It can be added again from Admin Media.',
      confirmText: 'Remove',
    });
    if (!confirmed) {
      return;
    }
    try {
      if (uploadItem) {
        const settings = selectedSettings();
        settings.mediaLibrary = {
          ...(settings.mediaLibrary || {}),
          selectedUploads: (settings.mediaLibrary?.selectedUploads || []).filter(item => item.id !== itemId),
          hero: {
            ...(settings.mediaLibrary?.hero || {}),
            selectedMediaId:
              settings.mediaLibrary?.hero?.selectedMediaId === itemId
                ? null
                : settings.mediaLibrary?.hero?.selectedMediaId || null,
            order: (settings.mediaLibrary?.hero?.order || []).filter(id => String(id) !== String(itemId)),
          },
        };
        await saveVersionSettings(settings, 'Uploaded media removed from this homepage.');
        return;
      }

      const csrfToken = await fetchCsrfToken();
      const data = await fetchJson(
        `/api/v1/admin/homepage/manager/media-library/${selectedVersion}/pexels/${encodeURIComponent(itemId)}`,
        {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': csrfToken },
        }
      );
      mediaLibraries[selectedVersion] = data.mediaLibrary;
      await loadManager();
      renderSelectedHomepage();
      toast('Selected media removed.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function loadManager() {
    const data = await fetchJson('/api/v1/admin/homepage/manager');
    manager = data.manager;
    if (!manager || typeof manager !== 'object') {
      manager = null;
      throw new Error(
        'The homepage manager returned no data. Please refresh the page or check the homepage API.'
      );
    }
    selectedVersion = VERSION_ORDER.includes(selectedVersion)
      ? selectedVersion
      : manager.activeVersion || 'v1';
  }

  async function loadMediaLibraries() {
    const data = await fetchJson('/api/v1/admin/homepage/manager/media-library');
    mediaLibraries = data.versions || {};
  }

  async function loadCategories() {
    const data = await fetchJson('/api/v1/categories');
    categories = data.items || [];
  }

  function categoryImageHtml(category) {
    if (category.heroImage) {
      return `<img src="${escapeHtml(category.heroImage)}" alt="${escapeHtml(category.name)}">`;
    }
    return '<div class="homepage-empty-state">No image selected</div>';
  }

  function renderCategoryCards() {
    const container = $('#categoryCardsGrid');
    if (!categories.length) {
      container.innerHTML = '<div class="homepage-empty-state">No categories yet. Add one to build the homepage grid.</div>';
      return;
    }
    container.innerHTML = categories.map(category => `
      <article class="homepage-category-card">
        <div class="homepage-category-card__media">${categoryImageHtml(category)}</div>
        <div class="homepage-category-card__body">
          <h4>${escapeHtml(category.name)}</h4>
          <p>${escapeHtml(category.description || 'No description set.')}</p>
          <span class="homepage-pill">/${escapeHtml(category.slug || '')}</span>
          <div class="homepage-visibility-row">
            <span>Visible on homepage</span>
            <input type="checkbox" data-category-visible="${escapeHtml(category.id)}" ${category.visible !== false ? 'checked' : ''}>
          </div>
          <div class="homepage-category-card__actions">
            <button class="ef-cta btn btn-secondary" type="button" data-edit-category="${escapeHtml(category.id)}">Edit</button>
            <button class="ef-cta btn danger" type="button" data-delete-category="${escapeHtml(category.id)}">Delete</button>
          </div>
        </div>
      </article>
    `).join('');
  }

  function renderHeroImageCards() {
    const container = $('#categoryList');
    if (!categories.length) {
      container.innerHTML = '<div class="homepage-empty-state">No category hero images to manage yet.</div>';
      return;
    }
    container.innerHTML = categories.map(category => `
      <article class="homepage-hero-image-card">
        <div class="homepage-hero-image-card__media">${categoryImageHtml(category)}</div>
        <div class="homepage-hero-image-card__body">
          <h4>${escapeHtml(category.name)}</h4>
          <p>${category.heroImage ? 'Hero image set.' : 'No hero image set.'}</p>
          <div class="homepage-hero-upload">
            <input type="file" accept="image/*" data-hero-upload="${escapeHtml(category.id)}">
            ${category.heroImage ? `<button class="ef-cta btn btn-secondary" type="button" data-remove-hero-image="${escapeHtml(category.id)}">Remove image</button>` : ''}
          </div>
        </div>
      </article>
    `).join('');
  }

  function renderCategories() {
    renderCategoryCards();
    renderHeroImageCards();
  }

  function openCategoryModal(categoryId = null) {
    editingCategoryId = categoryId;
    const category = categories.find(item => item.id === categoryId) || {};
    $('#categoryModalTitle').textContent = categoryId ? 'Edit category' : 'Add category';
    $('#categoryId').value = category.id || '';
    $('#categoryName').value = category.name || '';
    $('#categorySlug').value = category.slug || '';
    $('#categoryDescription').value = category.description || '';
    $('#categoryIcon').value = category.icon || '';
    $('#categoryHeroImage').value = category.heroImage || '';
    $('#categoryPexelsAttribution').value = category.pexelsAttribution || '';
    $('#categoryVisible').checked = category.visible !== false;
    $('#pexelsSearchQuery').value = '';
    $('#pexelsResults').hidden = true;
    $('#pexelsResultsGrid').innerHTML = '';
    $('#categoryCustomImage').value = '';
    $('#customImagePreviewWrap').hidden = true;
    $('#selectedImagePreview').hidden = !category.heroImage;
    $('#selectedImageThumbnail').src = category.heroImage || '';
    $('#selectedImageThumbnail').alt = category.name || '';
    $('#selectedImageCredit').textContent = category.pexelsAttribution || '';
    setImageTab('pexels');
    $('#categoryModal').hidden = false;
  }

  function closeCategoryModal() {
    $('#categoryModal').hidden = true;
    editingCategoryId = null;
  }

  function setImageTab(tab) {
    const usePexels = tab === 'pexels';
    $('#pexelsPanel').hidden = !usePexels;
    $('#uploadPanel').hidden = usePexels;
    $('#imgTabPexels').className = `ef-cta btn ${usePexels ? 'btn-primary' : 'btn-secondary'}`;
    $('#imgTabUpload').className = `ef-cta btn ${usePexels ? 'btn-secondary' : 'btn-primary'}`;
  }

  function slugFromName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function savedCategoryId(data) {
    return data.category?.id || data.item?.id || data.id || data.categoryId || editingCategoryId;
  }

  async function saveCategory() {
    const name = $('#categoryName').value.trim();
    const slug = $('#categorySlug').value.trim();
    if (!name || !slug) {
      toast('Enter a category name and slug.', 'error');
      return;
    }

    const payload = {
      name,
      slug,
      description: $('#categoryDescription').value.trim(),
      icon: $('#categoryIcon').value.trim(),
      heroImage: $('#categoryHeroImage').value.trim(),
      pexelsAttribution: $('#categoryPexelsAttribution').value.trim(),
      visible: $('#categoryVisible').checked,
    };

    try {
      const csrfToken = await fetchCsrfToken();
      const url = editingCategoryId
        ? `/api/v1/admin/categories/${editingCategoryId}`
        : '/api/v1/admin/categories';
      const method = editingCategoryId ? 'PUT' : 'POST';
      const data = await fetchJson(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const customFile = $('#categoryCustomImage').files[0];
      const targetId = savedCategoryId(data);
      if (customFile && targetId) {
        await uploadHeroImage(targetId, customFile, false);
      }
      closeCategoryModal();
      await loadCategories();
      renderCategories();
      toast('Category saved.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteCategory(categoryId) {
    const category = categories.find(item => item.id === categoryId);
    const confirmed = await confirmAction({
      title: 'Delete category',
      message: `Delete ${category?.name || 'this category'}?`,
      confirmText: 'Delete',
    });
    if (!confirmed) {
      return;
    }
    try {
      const csrfToken = await fetchCsrfToken();
      await fetchJson(`/api/v1/admin/categories/${categoryId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      await loadCategories();
      renderCategories();
      toast('Category deleted.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function toggleCategoryVisibility(categoryId, visible) {
    try {
      const csrfToken = await fetchCsrfToken();
      await fetchJson(`/api/v1/admin/categories/${categoryId}/visibility`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ visible }),
      });
      const category = categories.find(item => item.id === categoryId);
      if (category) {
        category.visible = visible;
      }
      renderCategories();
    } catch (error) {
      toast(error.message, 'error');
      renderCategories();
    }
  }

  async function uploadHeroImage(categoryId, file, rerender = true) {
    if (!file.type.startsWith('image/')) {
      toast('Choose an image file.', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Image must be less than 5MB.', 'error');
      return;
    }
    const csrfToken = await fetchCsrfToken();
    const formData = new FormData();
    formData.append('image', file);
    await fetchJson(`/api/v1/admin/categories/${categoryId}/hero-image`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: formData,
    });
    if (rerender) {
      await loadCategories();
      renderCategories();
      toast('Hero image uploaded.', 'success');
    }
  }

  async function removeHeroImage(categoryId) {
    const confirmed = await confirmAction({
      title: 'Remove image',
      message: 'Remove this category hero image?',
      confirmText: 'Remove',
    });
    if (!confirmed) {
      return;
    }
    try {
      const csrfToken = await fetchCsrfToken();
      await fetchJson(`/api/v1/admin/categories/${categoryId}/hero-image`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      await loadCategories();
      renderCategories();
      toast('Hero image removed.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function searchPexels() {
    const query = $('#pexelsSearchQuery').value.trim();
    if (!query) {
      toast('Enter a Pexels search term.', 'error');
      return;
    }
    const button = $('#searchPexelsBtn');
    button.disabled = true;
    button.textContent = 'Searching...';
    try {
      const data = await fetchJson(`/api/v1/pexels/search?q=${encodeURIComponent(query)}&perPage=12`);
      const photos = data.photos || [];
      $('#pexelsResults').hidden = false;
      $('#pexelsResultsGrid').innerHTML = photos.length
        ? photos.map(photo => `
          <button class="homepage-pexels-option" type="button" data-pexels-photo="${escapeHtml(photo.id)}">
            <img src="${escapeHtml(photo.src?.medium || photo.src?.small || '')}" alt="${escapeHtml(photo.alt || '')}">
            <span>${escapeHtml(photo.photographer || 'Pexels')}</span>
          </button>
        `).join('')
        : '<div class="homepage-empty-state">No photos found.</div>';
      $('#pexelsResultsGrid').dataset.photos = JSON.stringify(photos);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Search';
    }
  }

  function selectPexelsPhoto(photoId) {
    const photos = JSON.parse($('#pexelsResultsGrid').dataset.photos || '[]');
    const photo = photos.find(item => String(item.id) === String(photoId));
    if (!photo) {
      return;
    }
    $$('.homepage-pexels-option').forEach(option => option.classList.remove('is-selected'));
    const selectedOption = $$('.homepage-pexels-option')
      .find(option => option.dataset.pexelsPhoto === String(photoId));
    selectedOption?.classList.add('is-selected');
    $('#categoryHeroImage').value = photo.src?.large || photo.src?.original || photo.src?.medium || '';
    $('#categoryPexelsAttribution').value = `Photo by ${photo.photographer || 'Pexels'} on Pexels`;
    $('#selectedImageThumbnail').src = photo.src?.medium || '';
    $('#selectedImageThumbnail').alt = photo.alt || '';
    $('#selectedImageCredit').textContent = `Photo by ${photo.photographer || 'Pexels'} on Pexels`;
    $('#selectedImagePreview').hidden = false;
    $('#categoryCustomImage').value = '';
    $('#customImagePreviewWrap').hidden = true;
  }

  function bindEvents() {
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target) {
        return;
      }

      const editVersion = target.closest('[data-edit-version]')?.dataset.editVersion;
      const selectVersion = target.closest('[data-select-version]')?.dataset.selectVersion;
      const publish = target.closest('[data-publish-version]')?.dataset.publishVersion;
      const heroUse = target.closest('[data-hero-use]')?.dataset.heroUse;
      const heroPrimary = target.closest('[data-hero-primary]')?.dataset.heroPrimary;
      const heroMove = target.closest('[data-hero-move]');
      const heroRemoveTarget = target.closest('[data-hero-remove-target]')?.dataset.heroRemoveTarget;
      const heroDelete = target.closest('[data-hero-delete]')?.dataset.heroDelete;
      const editCategory = target.closest('[data-edit-category]')?.dataset.editCategory;
      const deleteCategoryId = target.closest('[data-delete-category]')?.dataset.deleteCategory;
      const removeHero = target.closest('[data-remove-hero-image]')?.dataset.removeHeroImage;
      const pexelsPhoto = target.closest('[data-pexels-photo]')?.dataset.pexelsPhoto;

      if (editVersion || selectVersion) {
        selectedVersion = editVersion || selectVersion;
        renderSelectedHomepage();
      } else if (publish) {
        publishVersion(publish);
      } else if (heroUse) {
        useInHero(heroUse, false);
      } else if (heroPrimary) {
        useInHero(heroPrimary, true);
      } else if (heroMove) {
        moveHeroMedia(heroMove.dataset.heroMove, heroMove.dataset.heroDirection);
      } else if (heroRemoveTarget) {
        removeFromHero(heroRemoveTarget);
      } else if (heroDelete) {
        deleteSelectedMedia(heroDelete);
      } else if (editCategory) {
        openCategoryModal(editCategory);
      } else if (deleteCategoryId) {
        deleteCategory(deleteCategoryId);
      } else if (removeHero) {
        removeHeroImage(removeHero);
      } else if (pexelsPhoto) {
        selectPexelsPhoto(pexelsPhoto);
      }
    });

    document.addEventListener('change', event => {
      const visibilityId = event.target.dataset.categoryVisible;
      const uploadId = event.target.dataset.heroUpload;
      if (visibilityId) {
        toggleCategoryVisibility(visibilityId, event.target.checked);
      } else if (uploadId && event.target.files[0]) {
        uploadHeroImage(uploadId, event.target.files[0]).catch(error => toast(error.message, 'error'));
        event.target.value = '';
      }
    });

    $('#heroSettingsForm').addEventListener('submit', saveHeroSettings);
    $('#resetHeroSettings').addEventListener('click', fillHeroForm);
    $('#publishSelectedHomepage').addEventListener('click', () => publishVersion(selectedVersion));
    $('#refreshBtn').addEventListener('click', initialise);
    $('#backToDashboard').addEventListener('click', () => {
      window.location.href = '/admin';
    });
    $('#addCategoryBtn').addEventListener('click', () => openCategoryModal());
    $('#closeCategoryModal').addEventListener('click', closeCategoryModal);
    $('#cancelCategoryBtn').addEventListener('click', closeCategoryModal);
    $('#saveCategoryBtn').addEventListener('click', saveCategory);
    $('#searchPexelsBtn').addEventListener('click', searchPexels);
    $('#imgTabPexels').addEventListener('click', () => setImageTab('pexels'));
    $('#imgTabUpload').addEventListener('click', () => setImageTab('upload'));
    $('#clearSelectedImage').addEventListener('click', () => {
      $('#categoryHeroImage').value = '';
      $('#categoryPexelsAttribution').value = '';
      $('#selectedImagePreview').hidden = true;
      $('#categoryCustomImage').value = '';
      $('#customImagePreviewWrap').hidden = true;
    });
    $('#categoryName').addEventListener('input', event => {
      const slugInput = $('#categorySlug');
      if (!editingCategoryId || !slugInput.value) {
        slugInput.value = slugFromName(event.target.value);
      }
    });
    $('#categoryCustomImage').addEventListener('change', event => {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = readerEvent => {
        $('#customImagePreview').src = readerEvent.target.result;
        $('#customImagePreviewWrap').hidden = false;
        $('#selectedImagePreview').hidden = true;
        $('#categoryHeroImage').value = '';
        $('#categoryPexelsAttribution').value = '';
      };
      reader.readAsDataURL(file);
    });
    $('#categoryModal').addEventListener('click', event => {
      if (event.target.id === 'categoryModal') {
        closeCategoryModal();
      }
    });
  }

  async function initialise() {
    try {
      await Promise.all([loadManager(), loadMediaLibraries(), loadCategories()]);
      if (!VERSION_ORDER.includes(selectedVersion)) {
        selectedVersion = manager.activeVersion || 'v1';
      }
      renderSelectedHomepage();
      renderCategories();
    } catch (error) {
      showStatus(error.message || 'Unable to load homepage manager.', true);
    }
  }

  await verifyAdmin();
  bindEvents();
  await initialise();
})();
