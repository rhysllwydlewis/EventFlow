'use strict';
(() => {
  const VERSION_KEYS = ['v1', 'v2', 'v3'];
  const DEFAULT_VERSION = 'v3';

  let manager = null;
  let selectedVersion = null;
  let collageMedia = [];

  function ensureManagerSection() {
    if (document.getElementById('homepageManager')) {
      return;
    }

    const controls = document.querySelector('.controls');
    const section = document.createElement('section');
    section.className = 'card';
    section.id = 'homepageManager';
    section.style.cssText = 'padding: 24px; margin-bottom: 32px;';
    section.innerHTML = `
      <div style="display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap;">
        <div>
          <h2 style="margin: 0 0 6px; font-size: 1.5rem; font-weight: 700;">Homepage versions</h2>
          <p class="small" style="margin: 0; color: #4b5563;">Select the version to edit, preview drafts and publish a version when it is ready for the live site.</p>
        </div>
        <div class="badge" id="homepageActiveBadge" style="background: #dcfce7; color: #166534; padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; font-weight: 700;">
          Live version: loading
        </div>
      </div>

      <div id="homepageVersionTabs" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px;">
        <div class="card" style="padding: 16px;"><p class="small">Loading homepage slots...</p></div>
      </div>

      <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 360px); gap: 20px;">
        <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb;">
          <h3 id="homepageSelectedTitle" style="margin: 0 0 8px; font-size: 1.1rem;">Selected homepage version</h3>
          <p id="homepageSelectedDescription" class="small" style="margin: 0 0 14px; color: #4b5563;">Choose a homepage version to manage its settings.</p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <a id="homepagePreviewLink" class="ef-cta btn btn-secondary" href="/" target="_blank" rel="noopener noreferrer">Preview version</a>
            <button id="publishHomepageVersion" class="ef-cta btn btn-primary" type="button">Set live</button>
            <button id="duplicateHomepageVersion" class="ef-cta btn btn-secondary" type="button">Copy live settings into this version</button>
          </div>
        </div>

        <div style="padding: 16px; border: 1px solid #dbeafe; border-radius: 8px; background: #eff6ff;">
          <h3 style="margin: 0 0 8px; font-size: 1rem;">Version status</h3>
          <dl style="margin: 0; display: grid; gap: 8px; font-size: 0.9rem;">
            <div style="display: flex; justify-content: space-between; gap: 12px;">
              <dt style="color: #4b5563;">Selected</dt>
              <dd id="homepageSelectedVersion" style="margin: 0; font-weight: 700;">-</dd>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 12px;">
              <dt style="color: #4b5563;">Status</dt>
              <dd id="homepageSelectedStatus" style="margin: 0; font-weight: 700;">-</dd>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 12px;">
              <dt style="color: #4b5563;">Updated</dt>
              <dd id="homepageSelectedUpdated" style="margin: 0; font-weight: 700;">-</dd>
            </div>
          </dl>
        </div>
      </div>
    `;

    if (controls) {
      controls.insertAdjacentElement('afterend', section);
    } else {
      document.querySelector('main')?.prepend(section);
    }
  }

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
    target.textContent = `${type === 'error' ? 'Unable to complete action:' : 'Success:'} ${message}`;
    target.style.display = 'block';
    window.setTimeout(
      () => {
        target.style.display = 'none';
      },
      type === 'error' ? 5000 : 3000
    );
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
    if (!manager || typeof manager !== 'object' || !manager.versions) {
      manager = null;
      throw new Error(
        'The homepage manager returned no data. Please refresh the page or check the homepage API.'
      );
    }
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
      activeBadge.textContent = `Live version: ${(manager.activeVersion || 'v1').toUpperCase()}`;
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
            <span class="badge" style="background: ${isActive ? '#dcfce7' : '#f3f4f6'}; color: ${isActive ? '#166534' : '#374151'}; padding: 3px 8px; border-radius: 999px; font-size: 0.7rem;">${isActive ? 'Live on site' : isSelected ? 'Editing this version' : escapeHtml(slot.status || 'Draft')}</span>
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
      selectedVersion === manager.activeVersion ? 'Live on site' : slot.status || 'Draft';
    document.getElementById('homepageSelectedUpdated').textContent = formatUpdatedAt(
      slot.updatedAt
    );
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
      showMessage('Select at least one media type before saving.', 'error');
      return;
    }

    if (
      !Number.isFinite(widget.intervalSeconds) ||
      widget.intervalSeconds < 1 ||
      widget.intervalSeconds > 60
    ) {
      showMessage('Enter a transition interval between 1 and 60 seconds.', 'error');
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
      showMessage(error.error || 'Unable to save the selected homepage version.', 'error');
      return;
    }

    const data = await response.json();
    manager = data.manager;
    renderManager();
    applySelectedSlotToForm();
    showMessage('Changes saved to the selected homepage version.');
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
        showMessage('Homepage version name updated.');
      } else {
        showMessage('Unable to rename the homepage version.', 'error');
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
      showMessage('Unable to publish this homepage version.', 'error');
      return;
    }

    const data = await response.json();
    manager = data.manager;
    renderManager();
    applySelectedSlotToForm();
    showMessage('This version is now live on the site.');
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
      showMessage('Unable to copy the live homepage settings.', 'error');
      return;
    }

    const data = await response.json();
    manager = data.manager;
    renderManager();
    applySelectedSlotToForm();
    showMessage('Live homepage settings copied into the selected version.');
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
      ensureManagerSection();
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
      showMessage('Unable to initialise homepage version management.', 'error');
    }
  }

  window.addEventListener('load', init);
})();
