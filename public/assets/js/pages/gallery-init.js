/**
 * Photos page (/gallery): add, review and remove the photos on a supplier profile or a package.
 *
 * The page manages one gallery at a time, chosen with the picker at the top. A link such as
 * /gallery?type=package&id=<packageId> (the dashboard's "Photos" links) opens that gallery; with no
 * id the supplier's own profile is opened. Everything is reported on the page itself (status lines
 * and native dialogs), never with alert() or confirm().
 *
 * Requests:
 *   GET    /api/me/suppliers, /api/me/packages      the galleries this account can manage
 *   GET    /api/me/suppliers/:id/photos             a profile's photos
 *   GET    /api/me/packages/:id/photos              a package's photos
 *   POST   /api/photos/upload/batch?type=&id=       upload (multipart, field "photos")
 *   DELETE /api/me/suppliers/:id/photos/:photoId    delete a profile photo
 *   DELETE /api/me/packages/:id/photos              delete a package photo (body: { url })
 *   GET    /api/v2/subscriptions/me                 the plan's photo limit (profiles only)
 * Every write carries the CSRF token (X-CSRF-Token) and is retried once with a fresh token.
 */
(function () {
  'use strict';

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_FILES_PER_UPLOAD = 10;
  const DASHBOARDS = { customer: '/dashboard/customer', supplier: '/dashboard/supplier' };

  const state = {
    user: null,
    suppliers: [],
    packages: [],
    target: null, // { type: 'supplier' | 'package', id, name }
    photos: [],
    view: [], // the photos on screen (after the filter), in order
    filter: 'all',
    staged: [], // { file, url, key }
    limit: null, // the plan's photo limit for a profile, when known
    busy: false,
    loadSeq: 0, // a slow response for a gallery that is no longer shown is dropped
    pendingDelete: null,
    lightboxIndex: 0,
  };

  const byId = id => document.getElementById(id);
  const el = {};

  /* ---------------------------------------------------------------- *
   * Small helpers
   * ---------------------------------------------------------------- */

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  /** Only web addresses and site paths are used as image sources. */
  function safeImageUrl(value) {
    const url = typeof value === 'string' ? value.trim() : '';
    return /^(https?:\/\/|\/(?![/\\]))/i.test(url) ? url : '';
  }

  /** Writes a message into a status line; the stylesheet colours it from data-state. */
  function setStatus(node, text, kind) {
    node.textContent = text || '';
    node.dataset.state = text ? kind || 'info' : '';
  }

  function show(node, visible) {
    node.hidden = !visible;
  }

  /** A response body as JSON, or as { error } when it is plain text (a rate limiter's, say). */
  async function readBody(response) {
    const text = await response.text().catch(() => '');
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text.trim().slice(0, 200) };
    }
  }

  async function api(path, options) {
    try {
      const response = await fetch(path, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        ...options,
      });
      return { ok: response.ok, status: response.status, data: await readBody(response) };
    } catch {
      return {
        ok: false,
        status: 0,
        data: { error: 'The connection failed. Check it and try again.' },
      };
    }
  }

  /* ---------------------------------------------------------------- *
   * CSRF
   * ---------------------------------------------------------------- */

  async function csrfToken(forceFresh) {
    if (forceFresh) {
      window.__CSRF_TOKEN__ = null;
    }
    if (!window.__CSRF_TOKEN__) {
      const result = await api('/api/csrf-token');
      if (result.ok && result.data.csrfToken) {
        window.__CSRF_TOKEN__ = result.data.csrfToken;
      }
    }
    return window.__CSRF_TOKEN__ || '';
  }

  const isCsrfRefusal = result => result.status === 403 && /csrf/i.test(result.data?.error || '');

  /** A write request with the CSRF token, retried once with a fresh token if it is refused. */
  async function write(path, method, json) {
    const send = async fresh => {
      const headers = { Accept: 'application/json', 'X-CSRF-Token': await csrfToken(fresh) };
      if (json) {
        headers['Content-Type'] = 'application/json';
      }
      return api(path, { method, headers, body: json ? JSON.stringify(json) : undefined });
    };
    const first = await send(false);
    return isCsrfRefusal(first) ? send(true) : first;
  }

  /** The upload, with the real progress of the request (fetch cannot report it). */
  function sendUpload(url, formData, onProgress) {
    const attempt = token =>
      new Promise(resolve => {
        const request = new XMLHttpRequest();
        request.open('POST', url);
        request.withCredentials = true;
        request.setRequestHeader('Accept', 'application/json');
        request.setRequestHeader('X-CSRF-Token', token);
        request.upload.addEventListener('progress', event => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
        request.addEventListener('load', () => {
          let data;
          try {
            data = request.responseText ? JSON.parse(request.responseText) : {};
          } catch {
            data = { error: (request.responseText || '').trim().slice(0, 200) };
          }
          resolve({
            ok: request.status >= 200 && request.status < 300,
            status: request.status,
            data,
          });
        });
        request.addEventListener('error', () =>
          resolve({
            ok: false,
            status: 0,
            data: { error: 'The connection failed. Check it and try again.' },
          })
        );
        request.send(formData);
      });

    return csrfToken(false)
      .then(attempt)
      .then(async first => (isCsrfRefusal(first) ? attempt(await csrfToken(true)) : first));
  }

  /* ---------------------------------------------------------------- *
   * Which gallery
   * ---------------------------------------------------------------- */

  function requestedTarget() {
    const params = new URLSearchParams(window.location.search);
    return {
      type: params.get('type') === 'package' ? 'package' : 'supplier',
      id: params.get('id') || params.get('supplierId') || '',
    };
  }

  const optionValue = target => `${target.type}:${target.id}`;

  function targetFromValue(value) {
    const [type, ...rest] = String(value).split(':');
    const id = rest.join(':');
    const list = type === 'package' ? state.packages : state.suppliers;
    const found = list.find(item => String(item.id || item._id) === id);
    return found
      ? { type, id, name: found.name || found.title || 'Unnamed' }
      : { type, id, name: type === 'package' ? 'Package' : 'Profile' };
  }

  function renderTargetPicker() {
    const select = el.target;
    select.replaceChildren();
    const group = (label, items, type) => {
      if (!items.length) {
        return;
      }
      const optgroup = document.createElement('optgroup');
      optgroup.label = label;
      items.forEach(item => {
        const option = document.createElement('option');
        option.value = optionValue({ type, id: item.id || item._id });
        option.textContent = item.name || item.title || 'Unnamed';
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    };
    group(state.suppliers.length > 1 ? 'Profiles' : 'Profile', state.suppliers, 'supplier');
    group('Packages', state.packages, 'package');

    // A gallery opened by link that is not in the lists (an admin's, say) still gets an entry.
    const current = optionValue(state.target);
    if (!Array.from(select.options).some(option => option.value === current)) {
      const option = document.createElement('option');
      option.value = current;
      option.textContent = state.target.name;
      select.appendChild(option);
    }
    select.value = current;
    select.disabled = false;
  }

  function chooseDefaultTarget() {
    const requested = requestedTarget();
    if (requested.id) {
      const list = requested.type === 'package' ? state.packages : state.suppliers;
      const found = list.find(item => String(item.id || item._id) === requested.id);
      if (found) {
        return {
          type: requested.type,
          id: requested.id,
          name: found.name || found.title || 'Unnamed',
        };
      }
      // Not one of this account's galleries by the lists: the server still decides (an admin).
      if (state.user?.role === 'admin') {
        return {
          type: requested.type,
          id: requested.id,
          name: requested.type === 'package' ? 'Package' : 'Profile',
        };
      }
    }
    const first = state.suppliers[0];
    return first
      ? { type: 'supplier', id: first.id || first._id, name: first.name || 'Your profile' }
      : null;
  }

  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('type', state.target.type);
    url.searchParams.set('id', state.target.id);
    url.searchParams.delete('supplierId');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  /* ---------------------------------------------------------------- *
   * Page states
   * ---------------------------------------------------------------- */

  function showState(title, text, link) {
    el.stateTitle.textContent = title;
    el.stateText.textContent = text;
    if (link) {
      el.stateLink.textContent = link.label;
      el.stateLink.href = link.href;
    }
    show(el.stateLink, Boolean(link));
    show(el.state, true);
    show(el.stack, false);
  }

  function describeTarget() {
    const count = state.photos.length;
    if (state.target.type === 'supplier' && Number.isFinite(state.limit)) {
      el.targetMeta.textContent = `${count} of ${state.limit} photos used on your plan`;
    } else {
      el.targetMeta.textContent = count ? plural(count, 'photo') : '';
    }
  }

  /** How many more photos this gallery can take, or Infinity when nothing limits it. */
  function remainingSlots() {
    if (state.target?.type === 'supplier' && Number.isFinite(state.limit)) {
      return Math.max(0, state.limit - state.photos.length);
    }
    return Infinity;
  }

  /* ---------------------------------------------------------------- *
   * Loading and showing the photos
   * ---------------------------------------------------------------- */

  async function loadLimit() {
    state.limit = null;
    // The limit belongs to the account that owns the profile; an admin looking at someone else's
    // would be shown their own plan's.
    if (state.target.type !== 'supplier' || state.user?.role === 'admin') {
      return;
    }
    const result = await api('/api/v2/subscriptions/me');
    const limit = result.ok ? result.data?.limits?.maxPhotos : null;
    state.limit = Number.isFinite(limit) ? limit : null;
  }

  /**
   * Loads the gallery on screen. After the person's own upload or delete the photos already shown
   * stay in place until the new list arrives (`quiet`), so the page does not collapse to a loading
   * skeleton and lose its scroll position; a first load or a different gallery shows the skeleton.
   */
  async function loadPhotos({ quiet = false } = {}) {
    const seq = ++state.loadSeq;
    const { type, id } = state.target;
    const keepShowing = quiet && state.photos.length > 0;
    show(el.error, false);
    if (!keepShowing) {
      show(el.loading, true);
      show(el.grid, false);
      show(el.empty, false);
      show(el.filterWrap, false);
    }
    el.photosCard.setAttribute('aria-busy', 'true');

    const path =
      type === 'package'
        ? `/api/me/packages/${encodeURIComponent(id)}/photos`
        : `/api/me/suppliers/${encodeURIComponent(id)}/photos`;
    const result = await api(path);
    if (seq !== state.loadSeq) {
      return;
    }
    el.photosCard.removeAttribute('aria-busy');
    show(el.loading, false);

    if (!result.ok) {
      state.photos = [];
      el.grid.replaceChildren();
      show(el.grid, false);
      show(el.empty, false);
      show(el.filterWrap, false);
      el.errorText.textContent =
        result.status === 404 || result.status === 403
          ? 'This gallery could not be found, or it is not yours to manage.'
          : result.data?.error || 'The photos could not be loaded.';
      show(el.error, true);
      el.count.textContent = '';
      describeTarget();
      renderStaged();
      return;
    }

    state.photos = Array.isArray(result.data.photos) ? result.data.photos : [];
    describeTarget();
    renderPhotos();
    renderStaged();
  }

  function visiblePhotos() {
    if (state.filter === 'pending') {
      return state.photos.filter(photo => photo.approved === false);
    }
    if (state.filter === 'approved') {
      return state.photos.filter(photo => photo.approved !== false);
    }
    return state.photos;
  }

  function renderPhotos() {
    const total = state.photos.length;
    const hasPending = state.photos.some(photo => photo.approved === false);
    if (!hasPending) {
      state.filter = 'all';
      el.filter.value = 'all';
    }
    show(el.filterWrap, hasPending);

    state.view = visiblePhotos();
    el.grid.replaceChildren();

    if (total === 0) {
      el.count.textContent = '';
      el.emptyTitle.textContent = 'No photos yet';
      el.emptyText.textContent = 'Photos you add above will show here.';
      show(el.grid, false);
      show(el.empty, true);
      return;
    }

    el.count.textContent =
      state.view.length === total
        ? plural(total, 'photo')
        : `${state.view.length} of ${plural(total, 'photo')}`;

    if (state.view.length === 0) {
      el.emptyTitle.textContent = 'No photos match';
      el.emptyText.textContent = 'Choose a different filter to see the rest.';
      show(el.grid, false);
      show(el.empty, true);
      return;
    }

    show(el.empty, false);
    state.view.forEach((photo, index) => {
      const number = state.photos.indexOf(photo) + 1;
      const item = document.createElement('li');
      item.className = 'gallery-tile';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'gallery-tile__open';
      open.setAttribute('aria-label', `View photo ${number} of ${total}`);
      open.addEventListener('click', () => openLightbox(index));

      const img = document.createElement('img');
      img.className = 'gallery-tile__img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = safeImageUrl(photo.thumbnail) || safeImageUrl(photo.url) || 'data:,';
      open.appendChild(img);

      if (photo.approved === false) {
        const pill = document.createElement('span');
        pill.className = 'gallery-pill';
        pill.textContent = 'Awaiting approval';
        open.appendChild(pill);
      }

      const foot = document.createElement('div');
      foot.className = 'gallery-tile__foot';
      const label = document.createElement('span');
      label.className = 'gallery-tile__label';
      label.textContent = `Photo ${number}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gallery-btn gallery-btn--danger-outline gallery-btn-sm';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', `Delete photo ${number}`);
      remove.addEventListener('click', () => openDelete(photo, number));
      foot.append(label, remove);

      item.append(open, foot);
      el.grid.appendChild(item);
    });
    show(el.grid, true);
  }

  /* ---------------------------------------------------------------- *
   * Adding photos
   * ---------------------------------------------------------------- */

  const fileKey = file => `${file.name}:${file.size}:${file.lastModified}`;

  function addFiles(fileList) {
    if (state.busy || !state.target) {
      return;
    }
    const problems = [];
    let added = 0;
    const slots = remainingSlots();

    Array.from(fileList).forEach(file => {
      if (state.staged.some(entry => entry.key === fileKey(file))) {
        return;
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        problems.push(`${file.name} is not a JPEG, PNG, WebP or GIF image.`);
      } else if (file.size > MAX_FILE_BYTES) {
        problems.push(`${file.name} is larger than 10 MB.`);
      } else if (state.staged.length >= MAX_FILES_PER_UPLOAD) {
        problems.push(
          `Up to ${MAX_FILES_PER_UPLOAD} photos can be added at a time, so ${file.name} was left out.`
        );
      } else if (state.staged.length >= slots) {
        problems.push(
          `Your plan has room for ${plural(slots, 'more photo')}, so ${file.name} was left out.`
        );
      } else {
        state.staged.push({ file, url: URL.createObjectURL(file), key: fileKey(file) });
        added += 1;
      }
    });

    renderStaged();
    if (problems.length) {
      setStatus(el.uploadStatus, problems.join(' '), added ? 'warn' : 'error');
    } else {
      setStatus(el.uploadStatus, '');
    }
  }

  function clearStaged() {
    state.staged.forEach(entry => URL.revokeObjectURL(entry.url));
    state.staged = [];
  }

  function renderStaged() {
    el.staged.replaceChildren();
    state.staged.forEach(entry => {
      const item = document.createElement('li');
      item.className = 'gallery-staged__item';

      const thumb = document.createElement('img');
      thumb.className = 'gallery-staged__thumb';
      thumb.alt = '';
      thumb.src = entry.url;

      const text = document.createElement('span');
      text.className = 'gallery-staged__text';
      const name = document.createElement('span');
      name.className = 'gallery-staged__name';
      name.textContent = entry.file.name;
      const size = document.createElement('span');
      size.className = 'gallery-staged__size';
      size.textContent = formatSize(entry.file.size);
      text.append(name, size);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gallery-staged__remove';
      remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
      remove.disabled = state.busy;
      remove.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(entry.url);
        state.staged = state.staged.filter(other => other !== entry);
        renderStaged();
        setStatus(el.uploadStatus, '');
      });

      item.append(thumb, text, remove);
      el.staged.appendChild(item);
    });

    const count = state.staged.length;
    show(el.staged, count > 0);
    show(el.actions, count > 0);
    el.clear.disabled = state.busy;
    el.upload.disabled = count === 0 || state.busy || !state.target;
    el.upload.textContent = count ? `Upload ${plural(count, 'photo')}` : 'Upload photos';
    el.browse.disabled = state.busy || !state.target;
    el.target.disabled = state.busy;
    el.drop.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  }

  function setProgress(percent) {
    el.progress.setAttribute('aria-valuenow', String(percent));
    el.progressFill.style.setProperty('--gl-progress', `${percent}%`);
  }

  async function upload() {
    if (!state.staged.length || state.busy || !state.target) {
      return;
    }
    state.busy = true;
    setProgress(0);
    show(el.progress, true);
    setStatus(el.uploadStatus, `Uploading ${plural(state.staged.length, 'photo')}…`, 'info');
    renderStaged();

    const form = new FormData();
    state.staged.forEach(entry => form.append('photos', entry.file));
    const { type, id } = state.target;
    const result = await sendUpload(
      `/api/photos/upload/batch?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
      form,
      setProgress
    );

    state.busy = false;
    show(el.progress, false);
    const data = result.data || {};

    if (!result.ok) {
      if (Number.isFinite(data.limit)) {
        state.limit = data.limit;
        describeTarget();
      }
      setStatus(
        el.uploadStatus,
        data.error || `The upload failed (error ${result.status}).`,
        'error'
      );
      renderStaged();
      return;
    }

    const failed = Array.isArray(data.errors) ? data.errors : [];
    const uploaded = Number.isFinite(data.uploaded)
      ? data.uploaded
      : state.staged.length - failed.length;
    if (uploaded > 0) {
      clearStaged();
    }
    if (failed.length) {
      const reasons = failed.map(item => `${item.filename || 'A photo'}: ${item.error}`).join(' ');
      setStatus(
        el.uploadStatus,
        `${plural(uploaded, 'photo')} added. Some could not be uploaded. ${reasons}`,
        uploaded ? 'warn' : 'error'
      );
    } else if (data.pending) {
      setStatus(
        el.uploadStatus,
        `${plural(uploaded, 'photo')} uploaded. They will show here once they have been approved.`,
        'success'
      );
    } else {
      setStatus(el.uploadStatus, `${plural(uploaded, 'photo')} added.`, 'success');
    }
    renderStaged();
    await loadPhotos({ quiet: true });
  }

  /* ---------------------------------------------------------------- *
   * Deleting a photo
   * ---------------------------------------------------------------- */

  function openDelete(photo, number) {
    state.pendingDelete = photo;
    el.deleteText.textContent = `Photo ${number} will be removed from ${state.target.name}. This cannot be undone.`;
    el.deleteThumb.src = safeImageUrl(photo.thumbnail) || safeImageUrl(photo.url) || 'data:,';
    show(el.deleteError, false);
    el.deleteConfirm.disabled = false;
    el.deleteCancel.disabled = false;
    el.deleteDialog.showModal();
  }

  async function confirmDelete() {
    const photo = state.pendingDelete;
    if (!photo || !state.target) {
      return;
    }
    el.deleteConfirm.disabled = true;
    el.deleteCancel.disabled = true;
    show(el.deleteError, false);

    const { type, id } = state.target;
    const result =
      type === 'package'
        ? await write(`/api/me/packages/${encodeURIComponent(id)}/photos`, 'DELETE', {
            url: photo.url,
          })
        : await write(
            `/api/me/suppliers/${encodeURIComponent(id)}/photos/${encodeURIComponent(photo.id)}`,
            'DELETE'
          );

    el.deleteCancel.disabled = false;
    if (!result.ok) {
      el.deleteConfirm.disabled = false;
      el.deleteError.textContent = result.data?.error || 'The photo could not be deleted.';
      show(el.deleteError, true);
      return;
    }

    state.pendingDelete = null;
    el.deleteDialog.close();
    await loadPhotos({ quiet: true });
    setStatus(el.photosStatus, 'Photo deleted.', 'success');
    // The photo that had focus is gone, so keyboard users start again at the section heading.
    el.photosTitle.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- *
   * Viewer
   * ---------------------------------------------------------------- */

  function showLightboxPhoto(index) {
    const total = state.view.length;
    if (!total) {
      return;
    }
    state.lightboxIndex = (index + total) % total;
    const photo = state.view[state.lightboxIndex];
    const large = safeImageUrl(photo.large) || safeImageUrl(photo.url);
    el.lightboxImage.src = large || 'data:,';
    el.lightboxImage.alt = `Photo ${state.photos.indexOf(photo) + 1} of ${state.photos.length}`;
    el.lightboxCount.textContent = `Photo ${state.lightboxIndex + 1} of ${total}`;
    el.lightboxFull.href = large || '#';
    show(el.lightboxPrev, total > 1);
    show(el.lightboxNext, total > 1);
  }

  function openLightbox(index) {
    showLightboxPhoto(index);
    el.lightbox.showModal();
  }

  /* ---------------------------------------------------------------- *
   * Start-up and wiring
   * ---------------------------------------------------------------- */

  async function selectTarget(target) {
    clearStaged();
    state.target = target;
    state.filter = 'all';
    el.filter.value = 'all';
    state.photos = [];
    setStatus(el.uploadStatus, '');
    setStatus(el.photosStatus, '');
    el.targetMeta.textContent = '';
    renderTargetPicker();
    renderStaged();
    syncUrl();
    await Promise.all([loadLimit(), loadPhotos()]);
    // The photo count and the plan's limit arrive separately; describe the gallery once both are in.
    describeTarget();
    renderStaged();
  }

  function wire() {
    el.browse.addEventListener('click', () => el.fileInput.click());
    el.fileInput.addEventListener('change', () => {
      addFiles(el.fileInput.files);
      el.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(name =>
      el.drop.addEventListener(name, event => {
        event.preventDefault();
        if (!state.busy && state.target) {
          el.drop.classList.add('is-dragover');
        }
      })
    );
    ['dragleave', 'drop'].forEach(name =>
      el.drop.addEventListener(name, () => el.drop.classList.remove('is-dragover'))
    );
    el.drop.addEventListener('drop', event => {
      event.preventDefault();
      addFiles(event.dataTransfer ? event.dataTransfer.files : []);
    });
    // A photo dropped just outside the zone must not make the browser open it.
    ['dragover', 'drop'].forEach(name =>
      document.addEventListener(name, event => {
        if (!el.drop.contains(event.target)) {
          event.preventDefault();
        }
      })
    );

    el.upload.addEventListener('click', upload);
    el.clear.addEventListener('click', () => {
      clearStaged();
      renderStaged();
      setStatus(el.uploadStatus, '');
    });

    el.target.addEventListener('change', () => selectTarget(targetFromValue(el.target.value)));
    el.filter.addEventListener('change', () => {
      state.filter = el.filter.value;
      renderPhotos();
    });
    el.retry.addEventListener('click', () => {
      setStatus(el.photosStatus, '');
      loadPhotos();
    });

    el.deleteConfirm.addEventListener('click', confirmDelete);
    el.deleteCancel.addEventListener('click', () => el.deleteDialog.close());
    el.deleteDialog.addEventListener('close', () => {
      state.pendingDelete = null;
    });

    el.lightboxClose.addEventListener('click', () => el.lightbox.close());
    el.lightboxPrev.addEventListener('click', () => showLightboxPhoto(state.lightboxIndex - 1));
    el.lightboxNext.addEventListener('click', () => showLightboxPhoto(state.lightboxIndex + 1));
    el.lightbox.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') {
        showLightboxPhoto(state.lightboxIndex - 1);
      } else if (event.key === 'ArrowRight') {
        showLightboxPhoto(state.lightboxIndex + 1);
      }
    });
    // A click on the dark area around the photo closes the viewer.
    el.lightbox.addEventListener('click', event => {
      if (
        event.target === el.lightbox ||
        event.target.classList.contains('gallery-lightbox__stage')
      ) {
        el.lightbox.close();
      }
    });

    window.addEventListener('beforeunload', clearStaged);
  }

  async function init() {
    [
      'dashboard-link',
      'state',
      'state-title',
      'state-text',
      'state-link',
      'stack',
      'target',
      'target-meta',
      'drop',
      'browse',
      'file-input',
      'staged',
      'progress',
      'progress-fill',
      'upload-status',
      'actions',
      'upload',
      'clear',
      'photos-card',
      'photos-title',
      'count',
      'filter-wrap',
      'filter',
      'photos-status',
      'loading',
      'grid',
      'empty',
      'empty-title',
      'empty-text',
      'error',
      'error-text',
      'retry',
      'delete-dialog',
      'delete-thumb',
      'delete-text',
      'delete-error',
      'delete-cancel',
      'delete-confirm',
      'lightbox',
      'lightbox-count',
      'lightbox-full',
      'lightbox-close',
      'lightbox-prev',
      'lightbox-next',
      'lightbox-image',
    ].forEach(name => {
      // gallery-photos-card is looked up as el.photosCard, and so on.
      const key = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      el[key] = byId(`gallery-${name}`);
    });

    wire();

    const [me, suppliers, packages] = await Promise.all([
      api('/api/v1/auth/me'),
      api('/api/me/suppliers'),
      api('/api/me/packages'),
    ]);

    if (me.status === 401) {
      showState(
        'Log in to manage your photos',
        'Your session has ended or you are not logged in.',
        {
          label: 'Log in',
          href: `/auth?redirect=${encodeURIComponent('/gallery')}`,
        }
      );
      return;
    }

    state.user = me.ok ? me.data?.user || me.data : null;
    const dashboard =
      DASHBOARDS[state.user?.role] || (state.user?.role === 'admin' ? '/admin' : '');
    if (dashboard) {
      el.dashboardLink.href = dashboard;
      show(el.dashboardLink, true);
    }

    state.suppliers =
      suppliers.ok && Array.isArray(suppliers.data.items) ? suppliers.data.items : [];
    state.packages = packages.ok && Array.isArray(packages.data.items) ? packages.data.items : [];

    // Both lists failing for a reason other than "this is not a supplier account" (403) means the
    // page could not find out, which is not the same as having nothing to manage.
    const refused = result => result.status === 403;
    if (!suppliers.ok && !packages.ok && !refused(suppliers) && !refused(packages)) {
      showState(
        'Your photos could not be loaded',
        'The connection failed or the server did not answer. Check it and try again.',
        { label: 'Try again', href: window.location.href }
      );
      return;
    }

    const target = chooseDefaultTarget();
    if (!target) {
      if (state.user?.role === 'supplier') {
        showState(
          'Create your profile first',
          'Photos are added to your supplier profile or to a package, so you need a profile before you can add any.',
          { label: 'Go to your dashboard', href: '/dashboard/supplier' }
        );
      } else {
        showState(
          'Photo galleries are for supplier accounts',
          'Suppliers add photos to their profile and packages here. Your account does not have a gallery to manage.',
          dashboard ? { label: 'Back to dashboard', href: dashboard } : null
        );
      }
      return;
    }

    show(el.stack, true);
    await selectTarget(target);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
