'use strict';
(() => {
  const container = document.querySelector('#adminManagementOverview')?.parentElement;
  if (!container || !document.getElementById('photoGrid')) {
    return;
  }

  const state = {
    manager: null,
    media: [],
    selected: null,
    busy: false,
  };

  const style = document.createElement('style');
  style.textContent = `
    .admin-upload-library {
      margin: 0 0 22px;
      padding: 22px;
      border: 1px solid #dbe5ec;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 12px 34px rgba(15, 23, 42, .06);
    }
    .admin-upload-library__header,
    .admin-upload-library__actions,
    .admin-upload-card__actions,
    .admin-upload-assignment__actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .admin-upload-library h2,
    .admin-upload-library p { margin: 0; }
    .admin-upload-library__intro { color: #64748b; margin-top: 5px !important; }
    .admin-upload-library__actions { margin-top: 16px; justify-content: flex-start; }
    .admin-upload-library__picker {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 8px 12px;
      border: 1px dashed #71bcb2;
      border-radius: 10px;
      background: #f2fbf8;
      cursor: pointer;
      font-weight: 750;
      color: #0b6f64;
    }
    .admin-upload-library__picker input { max-width: 280px; }
    .admin-upload-library__status { min-height: 22px; margin-top: 12px !important; font-weight: 650; }
    .admin-upload-library__status.is-error { color: #b42318; }
    .admin-upload-library__status.is-success { color: #087a67; }
    .admin-upload-library__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .admin-upload-card {
      overflow: hidden;
      border: 1px solid #dce5ed;
      border-radius: 13px;
      background: #fff;
    }
    .admin-upload-card__media {
      display: grid;
      place-items: center;
      aspect-ratio: 16 / 9;
      background: #eef3f6;
      overflow: hidden;
    }
    .admin-upload-card__media img,
    .admin-upload-card__media video { width: 100%; height: 100%; object-fit: cover; }
    .admin-upload-card__body { padding: 13px; }
    .admin-upload-card__body strong { display: block; overflow-wrap: anywhere; }
    .admin-upload-card__meta { color: #64748b; font-size: .82rem; margin: 5px 0 10px; }
    .admin-upload-card__badges { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .admin-upload-card__badge {
      padding: 4px 7px;
      border-radius: 999px;
      background: #e8f7f3;
      color: #08665c;
      font-size: .73rem;
      font-weight: 800;
    }
    .admin-upload-card__actions { justify-content: flex-start; }
    .admin-upload-card__actions button { min-height: 38px; }
    .admin-upload-empty {
      grid-column: 1 / -1;
      padding: 28px;
      border: 1px dashed #c8d4df;
      border-radius: 12px;
      color: #64748b;
      text-align: center;
      background: #fafcfd;
    }
    .admin-upload-assignment[hidden] { display: none; }
    .admin-upload-assignment {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgba(15, 23, 42, .62);
    }
    .admin-upload-assignment__panel {
      width: min(620px, 100%);
      max-height: 92vh;
      overflow: auto;
      padding: 22px;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 24px 70px rgba(15, 23, 42, .28);
    }
    .admin-upload-assignment__panel h2 { margin: 0 0 6px; }
    .admin-upload-assignment__panel > p { margin: 0 0 16px; color: #64748b; }
    .admin-upload-assignment__panel label { display: grid; gap: 6px; margin-top: 12px; font-weight: 750; }
    .admin-upload-assignment__panel select {
      min-height: 44px;
      border: 1px solid #cfd9e3;
      border-radius: 9px;
      padding: 8px 10px;
      background: #fff;
      font: inherit;
    }
    .admin-upload-assignment__actions { justify-content: flex-end; margin-top: 20px; }
    .admin-upload-library[aria-busy='true'] { opacity: .72; }
    @media (max-width: 640px) {
      .admin-upload-library { padding: 16px; }
      .admin-upload-library__picker { width: 100%; align-items: flex-start; flex-direction: column; }
      .admin-upload-library__picker input { max-width: 100%; width: 100%; }
      .admin-upload-card__actions button { flex: 1 1 100%; }
    }
  `;
  document.head.appendChild(style);

  const section = document.createElement('section');
  section.className = 'admin-upload-library';
  section.setAttribute('aria-labelledby', 'uploadedMediaHeading');
  section.innerHTML = `
    <div class="admin-upload-library__header">
      <div>
        <h2 id="uploadedMediaHeading">Uploaded media library</h2>
        <p class="admin-upload-library__intro">Upload your own photos or videos, then assign them to a homepage hero, collage or general media queue.</p>
      </div>
      <button id="refreshUploadedMedia" class="ef-cta btn-secondary" type="button">Refresh uploads</button>
    </div>
    <div class="admin-upload-library__actions">
      <label class="admin-upload-library__picker">
        <span>Choose photos or videos</span>
        <input id="uploadedMediaFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple>
      </label>
      <button id="uploadMediaFiles" class="ef-cta" type="button">Upload selected files</button>
    </div>
    <p id="uploadedMediaStatus" class="admin-upload-library__status" role="status" aria-live="polite"></p>
    <div id="uploadedMediaGrid" class="admin-upload-library__grid" aria-live="polite"></div>
  `;
  container.insertBefore(section, container.querySelector('.card'));

  const modal = document.createElement('div');
  modal.className = 'admin-upload-assignment';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="admin-upload-assignment__panel" role="dialog" aria-modal="true" aria-labelledby="uploadedAssignmentHeading">
      <h2 id="uploadedAssignmentHeading">Assign uploaded media</h2>
      <p id="uploadedAssignmentSummary"></p>
      <label>Homepage
        <select id="uploadedAssignmentVersion"></select>
      </label>
      <label>Placement
        <select id="uploadedAssignmentTarget">
          <option value="hero">Hero media</option>
          <option value="collage">Collage / grid</option>
          <option value="general">General homepage media</option>
        </select>
      </label>
      <label>Media behaviour
        <select id="uploadedAssignmentMode">
          <option value="selected_with_fallback">Selected media with automatic Pexels fallback</option>
          <option value="uploads">Uploaded media only</option>
        </select>
      </label>
      <div class="admin-upload-assignment__actions">
        <button id="uploadedAssignmentCancel" class="ef-cta btn-secondary" type="button">Cancel</button>
        <button id="uploadedAssignmentSave" class="ef-cta" type="button">Save assignment</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const grid = document.getElementById('uploadedMediaGrid');
  const status = document.getElementById('uploadedMediaStatus');
  const fileInput = document.getElementById('uploadedMediaFiles');
  const uploadButton = document.getElementById('uploadMediaFiles');
  const versionSelect = document.getElementById('uploadedAssignmentVersion');

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = `admin-upload-library__status${type ? ` is-${type}` : ''}`;
  }

  function setBusy(busy) {
    state.busy = busy;
    section.setAttribute('aria-busy', String(busy));
    uploadButton.disabled = busy;
    document.getElementById('refreshUploadedMedia').disabled = busy;
    document.getElementById('uploadedAssignmentSave').disabled = busy;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Request failed.');
    }
    return data;
  }

  async function csrfToken() {
    return (await api('/api/v1/csrf-token')).csrfToken;
  }

  function versionName(version) {
    return state.manager?.versions?.[version]?.tabName || `Homepage ${version.slice(1)}`;
  }

  function selectedUploadsFor(version) {
    return state.manager?.versions?.[version]?.settings?.mediaLibrary?.selectedUploads || [];
  }

  function assignmentBadges(item) {
    if (!state.manager) {
      return [];
    }
    return Object.keys(state.manager.versions || {}).flatMap(version =>
      selectedUploadsFor(version)
        .filter(upload => upload.url === item.url || upload.providerId === item.url)
        .map(upload => {
          const targets = upload.assignedTargets || [];
          return `${versionName(version)}${targets.includes('hero') ? ' hero' : ''}`;
        })
    );
  }

  function render() {
    if (!state.media.length) {
      grid.innerHTML =
        '<div class="admin-upload-empty">No uploaded media yet. Choose files above to create your reusable homepage library.</div>';
      return;
    }

    grid.innerHTML = state.media
      .map(item => {
        const badges = assignmentBadges(item);
        const preview =
          item.type === 'video'
            ? `<video src="${escapeHtml(item.url)}" muted playsinline preload="metadata"></video>`
            : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.filename)}" loading="lazy">`;
        return `
          <article class="admin-upload-card" data-upload-filename="${escapeHtml(item.filename)}">
            <div class="admin-upload-card__media">${preview}</div>
            <div class="admin-upload-card__body">
              <strong>${escapeHtml(item.filename)}</strong>
              <div class="admin-upload-card__meta">${escapeHtml(item.type)} · ${escapeHtml(formatBytes(item.size))}</div>
              <div class="admin-upload-card__badges">
                ${badges.map(label => `<span class="admin-upload-card__badge">${escapeHtml(label)}</span>`).join('')}
              </div>
              <div class="admin-upload-card__actions">
                <button class="ef-cta" type="button" data-assign-upload="${escapeHtml(item.filename)}">Assign to homepage</button>
                <button class="ef-cta btn-secondary" type="button" data-copy-upload="${escapeHtml(item.url)}">Copy URL</button>
                <button class="ef-cta btn-secondary" type="button" data-delete-upload="${escapeHtml(item.filename)}">Delete file</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function syncVersionOptions() {
    const versions = state.manager?.versions || {};
    const current = versionSelect.value;
    versionSelect.innerHTML = ['v1', 'v2', 'v3']
      .map(version => `<option value="${version}">${escapeHtml(versionName(version))}</option>`)
      .join('');
    if (versions[current]) {
      versionSelect.value = current;
    }

    const pexelsVersionSelect = document.getElementById('assignmentVersion');
    if (pexelsVersionSelect) {
      Array.from(pexelsVersionSelect.options).forEach(option => {
        option.textContent = versionName(option.value);
      });
    }
  }

  async function load() {
    setBusy(true);
    setStatus('Loading uploaded media…');
    try {
      const [mediaData, managerData] = await Promise.all([
        api('/api/v1/admin/homepage/collage-media'),
        api('/api/v1/admin/homepage/manager'),
      ]);
      state.media = mediaData.media || [];
      state.manager = managerData.manager;
      syncVersionOptions();
      render();
      setStatus(
        `${state.media.length} uploaded media file${state.media.length === 1 ? '' : 's'} available.`
      );
    } catch (error) {
      setStatus(error.message, 'error');
      grid.innerHTML = '<div class="admin-upload-empty">Unable to load uploaded media.</div>';
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles() {
    const files = Array.from(fileInput.files || []);
    if (!files.length) {
      setStatus('Choose at least one photo or video.', 'error');
      return;
    }
    if (files.length > 10) {
      setStatus('Upload a maximum of 10 files at once.', 'error');
      return;
    }
    const oversized = files.find(file => file.size > 10 * 1024 * 1024);
    if (oversized) {
      setStatus(`${oversized.name} exceeds the 10 MB upload limit.`, 'error');
      return;
    }

    setBusy(true);
    setStatus(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('media', file));
      await api('/api/v1/admin/homepage/collage-media', {
        method: 'POST',
        headers: { 'X-CSRF-Token': await csrfToken() },
        body: formData,
      });
      fileInput.value = '';
      setStatus('Upload complete.', 'success');
      await load();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function openAssignment(item) {
    state.selected = item;
    document.getElementById('uploadedAssignmentSummary').textContent =
      `${item.filename} will be stored in the selected homepage media library.`;
    modal.hidden = false;
    document.getElementById('uploadedAssignmentSave').focus();
  }

  function closeAssignment() {
    modal.hidden = true;
    state.selected = null;
  }

  async function saveAssignment() {
    if (!state.selected || !state.manager) {
      return;
    }
    const version = versionSelect.value;
    const target = document.getElementById('uploadedAssignmentTarget').value;
    const mode = document.getElementById('uploadedAssignmentMode').value;
    const versionConfig = state.manager.versions?.[version];
    if (!versionConfig) {
      setStatus('The selected homepage could not be loaded.', 'error');
      return;
    }

    const settings = JSON.parse(JSON.stringify(versionConfig.settings || {}));
    const library = settings.mediaLibrary || {};
    const existing = Array.isArray(library.selectedUploads) ? library.selectedUploads : [];
    const id = `upload-${state.selected.filename}`;
    const item = {
      id,
      provider: 'upload',
      providerId: state.selected.url,
      type: state.selected.type,
      url: state.selected.url,
      thumbnailUrl: state.selected.type === 'photo' ? state.selected.url : null,
      alt: state.selected.filename,
      photographer: 'Uploaded media',
      assignedTargets: [target],
      addedAt: new Date().toISOString(),
    };
    const previous = existing.find(upload => upload.id === id || upload.url === item.url);
    library.selectedUploads = previous
      ? existing.map(upload =>
          upload === previous
            ? {
                ...upload,
                assignedTargets: Array.from(new Set([...(upload.assignedTargets || []), target])),
              }
            : upload
        )
      : [...existing, item];
    library.mediaTypes = {
      ...(library.mediaTypes || {}),
      photos: state.selected.type === 'photo' ? true : library.mediaTypes?.photos !== false,
      videos: state.selected.type === 'video' ? true : library.mediaTypes?.videos === true,
    };
    library.mode = mode;
    library.fallback = {
      ...(library.fallback || {}),
      enabled: mode === 'selected_with_fallback',
      source: 'pexels',
    };
    library.hero = {
      ...(library.hero || {}),
      selectedMediaId: target === 'hero' ? id : library.hero?.selectedMediaId || null,
      order: Array.from(new Set([...(library.hero?.order || []), id])),
    };
    settings.mediaLibrary = library;
    settings.collageWidget = {
      ...(settings.collageWidget || {}),
      source: mode === 'uploads' ? 'uploads' : 'pexels',
      fallbackToPexels: mode === 'selected_with_fallback',
      uploadGallery: Array.from(
        new Set([
          ...(settings.collageWidget?.uploadGallery || []).filter(Boolean),
          ...library.selectedUploads.map(upload => upload.url).filter(Boolean),
        ])
      ),
      mediaTypes: library.mediaTypes,
    };
    const assignedFilename = state.selected.filename;

    setBusy(true);
    try {
      const data = await api(`/api/v1/admin/homepage/manager/version/${version}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': await csrfToken(),
        },
        body: JSON.stringify({ settings }),
      });
      state.manager = data.manager;
      closeAssignment();
      syncVersionOptions();
      render();
      setStatus(`${assignedFilename} assigned to ${versionName(version)}.`, 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFile(item) {
    const assignments = assignmentBadges(item);
    if (assignments.length) {
      setStatus(
        `Remove this file from ${assignments.join(', ')} before deleting the physical upload.`,
        'error'
      );
      return;
    }
    const message = 'Delete this uploaded media file?';
    const confirmed = window.AdminShared?.showConfirmModal
      ? await window.AdminShared.showConfirmModal({
          title: 'Delete uploaded media',
          message,
          confirmText: 'Delete',
        })
      : window.confirm(message);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await api(`/api/v1/admin/homepage/collage-media/${encodeURIComponent(item.filename)}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': await csrfToken() },
      });
      setStatus('Uploaded media deleted.', 'success');
      await load();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  section.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || state.busy) {
      return;
    }
    const assign = target.closest('[data-assign-upload]')?.dataset.assignUpload;
    const copy = target.closest('[data-copy-upload]')?.dataset.copyUpload;
    const remove = target.closest('[data-delete-upload]')?.dataset.deleteUpload;
    if (assign) {
      const item = state.media.find(media => media.filename === assign);
      if (item) {
        openAssignment(item);
      }
    } else if (copy) {
      navigator.clipboard
        .writeText(copy)
        .then(() => setStatus('Media URL copied.', 'success'))
        .catch(() => setStatus('Unable to copy the media URL.', 'error'));
    } else if (remove) {
      const item = state.media.find(media => media.filename === remove);
      if (item) {
        deleteFile(item);
      }
    }
  });

  modal.addEventListener('click', event => {
    if (event.target === modal) {
      closeAssignment();
    }
  });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeAssignment();
    }
  });
  document.getElementById('uploadedAssignmentCancel').addEventListener('click', closeAssignment);
  document.getElementById('uploadedAssignmentSave').addEventListener('click', saveAssignment);
  document.getElementById('refreshUploadedMedia').addEventListener('click', load);
  uploadButton.addEventListener('click', uploadFiles);

  load();
})();
