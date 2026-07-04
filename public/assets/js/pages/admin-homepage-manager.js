(() => {
  'use strict';

  const VERSION_KEYS = ['v1', 'v2', 'v3'];
  const DEFAULT_VERSION = 'v3';

  let manager = null;
  let selectedVersion = DEFAULT_VERSION;
  let collageMedia = [];

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showMessage(message, type = 'success') {
    const successEl = document.getElementById('collageWidgetSuccess');
    const errorEl = document.getElementById('collageWidgetError');
    if (!successEl || !errorEl) {
      return;
    }

    successEl.style.display = 'none';
    errorEl.style.display = 'none';

    const target = type === 'error' ? errorEl : successEl;
    target.textContent = `${type === 'error' ? 'X' : 'OK'} ${message}`;
    target.style.display = 'block';
    window.setTimeout(() => {
      target.style.display = 'none';
    }, type === 'error' ? 5000 : 3000);
  }

  async function getCsrfToken() {
    const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
    const data = await response.json();
    return data.csrfToken;
  }

  async function loadManager() {
    const response = await fetch('/api/v1/admin/homepage/manager', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error('Failed to load homepage manager');
    }

    const data = await response.json();
    manager = data.manager;
    if (!manager.versions[selectedVersion]) {
      selectedVersion = manager.activeVersion || DEFAULT_VERSION;
    }
    renderManager();
    applySelectedSlotToForm();
  }

  function getSelectedSlot() {
    return manager?.versions?.[selectedVersion] || null;
  }

  function formatUpdatedAt(value) {
    if (!value) {
      return '-';
    }
    try {
      return new Date(value).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  }

  function renderManager() {
    const tabsContainer = document.getElementById('homepageVersionTabs');
    if (!manager || !tabsContainer) {
      return;
    }

    const activeBadge = document.getElementById('homepageActiveBadge');
    if (activeBadge) {
      activeBadge.textContent = `Active: ${(manager.activeVersion || 'v1').toUpperCase()}`;
    }

    tabsContainer.innerHTML = VERSION_KEYS.map(version => {
      const slot = manager.versions[version];
      const isSelected = version === selectedVersion;
      const isActive = version === manager.activeVersion;

      return `
        <button
          type="button"
          class="homepage-version-tab ${isSelected ? 'is-selected' : ''}"
          data-version="${version}"
          style="text-align: left; padding: 16px; border: 2px solid ${isSelected ? '#0B8073' : '#e5e7eb'}; border-radius: 8px; background: ${isSelected ? '#ecfdf5' : '#ffffff'}; cursor: pointer;"
        >
          <span style="display: flex; justify-content: space-between; gap: 8px; align-items: center;">
            <strong class="homepage-version-name" data-version="${version}" title="Double-click to rename">${escapeHtml(slot.tabName)}</strong>
            <span class="badge" style="background: ${isActive ? '#dcfce7' : '#f3f4f6'}; color: ${isActive ? '#166534' : '#374151'}; padding: 3px 8px; border-radius: 999px; font-size: 0.7rem;">${isActive ? 'Live' : escapeHtml(slot.status || 'draft')}</span>
          </span>
          <span class="small" style="display: block; color: #6b7280; margin-top: 8px;">${escapeHtml(slot.description || '')}</span>
        </button>
      `;
    }).join('');

    tabsContainer.querySelectorAll('.homepage-version-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        selectedVersion = tab.dataset.version;
        renderManager();
        applySelectedSlotToForm();
      });
    });

    tabsContainer.querySelectorAll('.homepage-version-name').forEach(nameEl => {
      nameEl.addEventListener('dblclick', event => {
        event.stopPropagation();
        startRename(nameEl);
      });
    });

    const slot = getSelectedSlot();
    if (!slot) {
      return;
    }

    document.getElementById('homepageSelectedTitle').textContent = slot.tabName;
    document.getElementById('homepageSelectedDescription').textContent = slot.description || '';
    document.getElementById('homepageSelectedVersion').textContent = selectedVersion.toUpperCase();
    document.getElementById('homepageSelectedStatus').textContent =
      selectedVersion === manager.activeVersion ? 'Published' : slot.status || 'Draft';
    document.getElementById('homepageSelectedUpdated').textContent = formatUpdatedAt(slot.updatedAt);
    document.getElementById('homepagePreviewLink').href = slot.previewPath || '/';
    document.getElementById('publishHomepageVersion').disabled =
      selectedVersion === manager.activeVersion;
    document.getElementById('duplicateHomepageVersion').disabled =
      selectedVersion === manager.activeVersion;
  }

  function setChecked(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.checked = value === true;
    }
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.value = value ?? '';
    }
  }

  function applySelectedSlotToForm() {
    const slot = getSelectedSlot();
    const widget = slot?.settings?.collageWidget || {};

    setChecked('collageWidgetEnabled', widget.enabled === true);
    setChecked('sourcePexels', (widget.source || 'pexels') === 'pexels');
    setChecked('sourceUploads', widget.source === 'uploads');
    setChecked('mediaTypePhotos', widget.mediaTypes?.photos !== false);
    setChecked('mediaTypeVideos', widget.mediaTypes?.videos !== false);
    setValue('intervalSeconds', widget.intervalSeconds || 2.5);

    setChecked('heroVideoEnabled', widget.heroVideo?.enabled !== false);
    setChecked('heroVideoAutoplay', widget.heroVideo?.autoplay === true);
    setChecked('heroVideoMuted', widget.heroVideo?.muted !== false);
    setChecked('heroVideoLoop', widget.heroVideo?.loop !== false);
    setValue('heroVideoQuality', widget.heroVideo?.quality || 'hd');

    setValue('videoQualityPreference', widget.videoQuality?.preference || 'hd');
    setChecked('videoQualityAdaptive', widget.videoQuality?.adaptive !== false);
    setChecked('videoQualityMobileOptimized', widget.videoQuality?.mobileOptimized !== false);

    setValue('transitionEffect', widget.transition?.effect || 'fade');
    setValue('transitionDuration', widget.transition?.duration || 1000);
    setChecked('preloadingEnabled', widget.preloading?.enabled !== false);
    setValue('preloadingCount', widget.preloading?.count ?? 3);

    setChecked('mobileSlowerTransitions', widget.mobileOptimizations?.slowerTransitions !== false);
    setChecked('mobileDisableVideos', widget.mobileOptimizations?.disableVideos === true);
    setChecked('mobileTouchControls', widget.mobileOptimizations?.touchControls !== false);

    setValue('filterAspectRatio', widget.contentFiltering?.aspectRatio || 'any');
    setValue('filterOrientation', widget.contentFiltering?.orientation || 'any');
    setValue('filterMinResolution', widget.contentFiltering?.minResolution || 'SD');

    setChecked('playbackShowControls', widget.playbackControls?.showControls === true);
    setChecked('playbackPauseOnHover', widget.playbackControls?.pauseOnHover !== false);
    setChecked('playbackFullscreen', widget.playbackControls?.fullscreen === true);

    const photoQueries = widget.pexelsQueries || {};
    setValue('pexelsQueryVenues', photoQueries.venues || '');
    setValue('pexelsQueryCatering', photoQueries.catering || '');
    setValue('pexelsQueryEntertainment', photoQueries.entertainment || '');
    setValue('pexelsQueryPhotography', photoQueries.photography || '');

    const videoQueries = widget.pexelsVideoQueries || {};
    setValue('pexelsVideoQueryVenues', videoQueries.venues || '');
    setValue('pexelsVideoQueryCatering', videoQueries.catering || '');
    setValue('pexelsVideoQueryEntertainment', videoQueries.entertainment || '');
    setValue('pexelsVideoQueryPhotography', videoQueries.photography || '');
    setChecked('fallbackToPexels', widget.fallbackToPexels !== false);
  }

  function collectWidgetFromForm() {
    return {
      enabled: document.getElementById('collageWidgetEnabled').checked,
      source: document.querySelector('input[name="collageSource"]:checked')?.value || 'pexels',
      mediaTypes: {
        photos: document.getElementById('mediaTypePhotos').checked,
        videos: document.getElementById('mediaTypeVideos').checked,
      },
      intervalSeconds: parseFloat(document.getElementById('intervalSeconds').value),
      pexelsQueries: {
        venues: document.getElementById('pexelsQueryVenues').value,
        catering: document.getElementById('pexelsQueryCatering').value,
        entertainment: document.getElementById('pexelsQueryEntertainment').value,
        photography: document.getElementById('pexelsQueryPhotography').value,
      },
      pexelsVideoQueries: {
        venues: document.getElementById('pexelsVideoQueryVenues').value,
        catering: document.getElementById('pexelsVideoQueryCatering').value,
        entertainment: document.getElementById('pexelsVideoQueryEntertainment').value,
        photography: document.getElementById('pexelsVideoQueryPhotography').value,
      },
      uploadGallery: collageMedia.map(item => item.url),
      fallbackToPexels: document.getElementById('fallbackToPexels').checked,
      heroVideo: {
        enabled: document.getElementById('heroVideoEnabled').checked,
        autoplay: document.getElementById('heroVideoAutoplay').checked,
        muted: document.getElementById('heroVideoMuted').checked,
        loop: document.getElementById('heroVideoLoop').checked,
        quality: document.getElementById('heroVideoQuality').value,
      },
      videoQuality: {
        preference: document.getElementById('videoQualityPreference').value,
        adaptive: document.getElementById('videoQualityAdaptive').checked,
        mobileOptimized: document.getElementById('videoQualityMobileOptimized').checked,
      },
      transition: {
        effect: document.getElementById('transitionEffect').value,
        duration: parseInt(document.getElementById('transitionDuration').value, 10),
      },
      preloading: {
        enabled: document.getElementById('preloadingEnabled').checked,
        count: parseInt(document.getElementById('preloadingCount').value, 10),
      },
      mobileOptimizations: {
        slowerTransitions: document.getElementById('mobileSlowerTransitions').checked,
        disableVideos: document.getElementById('mobileDisableVideos').checked,
        touchControls: document.getElementById('mobileTouchControls').checked,
      },
      contentFiltering: {
        aspectRatio: document.getElementById('filterAspectRatio').value,
        orientation: document.getElementById('filterOrientation').value,
        minResolution: document.getElementById('filterMinResolution').value,
      },
      playbackControls: {
        showControls: document.getElementById('playbackShowControls').checked,
        pauseOnHover: document.getElementById('playbackPauseOnHover').checked,
        fullscreen: document.getElementById('playbackFullscreen').checked,
      },
    };
  }

  async function saveSelectedSlot(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const widget = collectWidgetFromForm();

    if (!widget.mediaTypes.photos && !widget.mediaTypes.videos) {
      showMessage('Please select at least one media type', 'error');
      return;
    }

    if (!Number.isFinite(widget.intervalSeconds) || widget.intervalSeconds < 1 || widget.intervalSeconds > 60) {
      showMessage('Interval must be between 1 and 60 seconds', 'error');
      return;
    }

    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/v1/admin/homepage/manager/version/${selectedVersion}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({
        status: selectedVersion === manager.activeVersion ? 'published' : 'preview',
        settings: { collageWidget: widget },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      showMessage(error.error || 'Failed to save homepage slot', 'error');
      return;
    }

    const data = await response.json();
    manager = data.manager;
    renderManager();
    applySelectedSlotToForm();
    showMessage('Homepage slot saved successfully');
  }

  function startRename(nameEl) {
    const version = nameEl.dataset.version;
    const currentName = manager.versions[version]?.tabName || version.toUpperCase();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.maxLength = 40;
    input.style.width = '100%';
    input.style.padding = '6px 8px';
    input.style.border = '1px solid #0B8073';
    input.style.borderRadius = '6px';

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = async save => {
      const nextName = input.value.trim();
      if (!save || !nextName || nextName === currentName) {
        renderManager();
        return;
      }

      const csrfToken = await getCsrfToken();
      const response = await fetch(`/api/v1/admin/homepage/manager/version/${version}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ tabName: nextName }),
      });

      if (response.ok) {
        const data = await response.json();
        manager = data.manager;
        showMessage('Homepage tab renamed');
      } else {
        showMessage('Failed to rename homepage tab', 'error');
      }
      renderManager();
    };

    input.addEventListener('blur', () => commit(true), { once: true });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        commit(false);
      }
    });
  }

  async function publishSelected() {
    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/v1/admin/homepage/manager/publish/${selectedVersion}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      showMessage('Failed to publish homepage version', 'error');
      return;
    }

    const data = await response.json();
    manager = data.manager;
    renderManager();
    applySelectedSlotToForm();
    showMessage('Homepage version published');
  }

  async function duplicateLiveIntoSelected() {
    if (!manager || selectedVersion === manager.activeVersion) {
      return;
    }

    const csrfToken = await getCsrfToken();
    const response = await fetch('/api/v1/admin/homepage/manager/duplicate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({
        sourceVersion: manager.activeVersion,
        targetVersion: selectedVersion,
      }),
    });

    if (!response.ok) {
      showMessage('Failed to duplicate homepage settings', 'error');
      return;
    }

    const data = await response.json();
    manager = data.manager;
    renderManager();
    applySelectedSlotToForm();
    showMessage('Homepage settings duplicated');
  }

  async function loadCollageMediaUrls() {
    try {
      const response = await fetch('/api/v1/admin/homepage/collage-media', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        collageMedia = data.media || [];
      }
    } catch {
      collageMedia = [];
    }
  }

  async function init() {
    try {
      await loadCollageMediaUrls();
      await loadManager();

      const saveButton = document.getElementById('saveCollageWidget');
      saveButton?.addEventListener('click', saveSelectedSlot, true);
      document.getElementById('publishHomepageVersion')?.addEventListener('click', publishSelected);
      document
        .getElementById('duplicateHomepageVersion')
        ?.addEventListener('click', duplicateLiveIntoSelected);
      document.getElementById('refreshBtn')?.addEventListener('click', () => {
        window.setTimeout(loadManager, 250);
      });
    } catch (error) {
      console.error('Homepage manager failed to initialise:', error);
      showMessage('Failed to initialise homepage manager', 'error');
    }
  }

  window.addEventListener('load', init);
})();
