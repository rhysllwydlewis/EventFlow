/**
 * Supplier dashboard: the banner image field in the profile editor.
 *
 * The banner is the wide image at the top of the public profile. It is uploaded straight to the
 * supplier's banner route (POST /api/me/suppliers/:id/banner, one image, stored as a short
 * /api/photos/... URL) and removed by clearing `bannerUrl` on the profile (PATCH). Both apply as
 * soon as they succeed, the way the photo gallery does, and the field says so. A profile that
 * does not exist yet has nothing to attach a banner to, so the field asks for the profile to be
 * saved first.
 */
'use strict';

(function () {
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_BYTES = 5 * 1024 * 1024;

  const ids = {
    field: 'sdh-banner-field',
    preview: 'sdh-banner-preview',
    image: 'sdh-banner-img',
    empty: 'sdh-banner-empty',
    upload: 'sdh-banner-upload',
    remove: 'sdh-banner-remove',
    input: 'sdh-banner-input',
    status: 'sdh-banner-status',
  };

  /** Looks up an element by id. */
  const byId = id => document.getElementById(id);

  /** The supplier being edited: the profile app.js cached, or null when there is none yet. */
  function currentSupplier() {
    const list = window._efCachedSuppliers;
    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  }

  /**
   * The banner address as something safe to put in an <img src>: an http(s) address or a
   * same-site path, resolved by the URL parser. Anything else (a data: URL, a script address,
   * a protocol-relative one) is not shown.
   */
  function safeImageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }
    try {
      const parsed = new URL(value.trim(), window.location.origin);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return '';
      }
      return parsed.origin === window.location.origin
        ? `${parsed.pathname}${parsed.search}`
        : parsed.href;
    } catch {
      return '';
    }
  }

  /** Writes a message under the field. `tone` is "error", "success" or "info". */
  function say(message, tone) {
    const status = byId(ids.status);
    if (!status) {
      return;
    }
    status.textContent = message || '';
    if (tone) {
      status.setAttribute('data-tone', tone);
    } else {
      status.removeAttribute('data-tone');
    }
  }

  /** What to tell the supplier about a failed request: a dropped connection reads as one, not as "Failed to fetch". */
  function problem(error, fallback) {
    if (error instanceof TypeError) {
      return `${fallback} Check your connection and try again.`;
    }
    return error?.message || fallback;
  }

  /** Marks the field as working (buttons off, preview dimmed) or idle. */
  function setBusy(busy) {
    byId(ids.field)?.setAttribute('aria-busy', String(busy));
    [ids.upload, ids.remove].forEach(id => {
      const button = byId(id);
      if (button) {
        button.disabled = busy;
      }
    });
  }

  /** Draws the field for the current supplier: the banner or "No banner yet", and the right buttons. */
  function render() {
    const supplier = currentSupplier();
    const url = safeImageUrl(supplier?.bannerUrl || supplier?.coverImage);
    const image = byId(ids.image);
    const empty = byId(ids.empty);
    const preview = byId(ids.preview);
    const uploadButton = byId(ids.upload);
    const remove = byId(ids.remove);
    if (!image || !empty || !preview || !uploadButton || !remove) {
      return;
    }
    if (url) {
      image.src = url;
      image.hidden = false;
      empty.hidden = true;
      preview.dataset.state = 'filled';
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      empty.hidden = false;
      empty.textContent = supplier ? 'No banner yet' : 'Save your profile first, then add a banner';
      preview.dataset.state = 'empty';
    }
    uploadButton.textContent = url ? 'Change banner' : 'Add banner';
    uploadButton.disabled = !supplier;
    remove.hidden = !url;
  }

  /** Reads a file as a data URL, for the upload route. */
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  /** Updates the cached profile so the editor, the next open and the summary agree. */
  function rememberBanner(url) {
    const supplier = currentSupplier();
    if (supplier) {
      supplier.bannerUrl = url;
      supplier.coverImage = url;
    }
  }

  /** Checks a chosen file, uploads it and shows the result. */
  async function upload(file) {
    const supplier = currentSupplier();
    const home = window.SupplierDashboardHome;
    if (!supplier || !home || typeof home.sendJson !== 'function') {
      say('Save your profile first, then add a banner.', 'error');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      say('Use a JPG, PNG or WebP image.', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      say('That image is over 5 MB. Choose a smaller one.', 'error');
      return;
    }
    setBusy(true);
    say('Uploading banner…', 'info');
    try {
      const dataUrl = await readAsDataUrl(file);
      const result = await home.sendJson(
        `/api/me/suppliers/${encodeURIComponent(supplier.id)}/banner`,
        'POST',
        { image: dataUrl }
      );
      const url = result.data?.url || result.data?.supplier?.bannerUrl || '';
      if (!result.ok || !url) {
        say(
          result.data?.details || result.data?.error || 'The banner could not be uploaded.',
          'error'
        );
        return;
      }
      rememberBanner(url);
      say('Banner saved.', 'success');
      document.dispatchEvent(new CustomEvent('sdh:changed'));
    } catch (error) {
      say(problem(error, 'The banner could not be uploaded.'), 'error');
    } finally {
      setBusy(false);
      render();
    }
  }

  /** Asks, then clears the banner on the profile. */
  async function removeBanner() {
    const supplier = currentSupplier();
    const home = window.SupplierDashboardHome;
    if (!supplier || !home || typeof home.sendJson !== 'function') {
      return;
    }
    const confirmed = await home.confirm({
      title: 'Remove your banner?',
      message: 'Your public profile will show the default banner until you add another.',
      confirmLabel: 'Remove banner',
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    say('Removing banner…', 'info');
    try {
      const result = await home.sendJson(
        `/api/me/suppliers/${encodeURIComponent(supplier.id)}`,
        'PATCH',
        { bannerUrl: '' }
      );
      if (!result.ok) {
        say(result.data?.error || 'The banner could not be removed.', 'error');
        return;
      }
      rememberBanner('');
      say('Banner removed.', 'success');
      document.dispatchEvent(new CustomEvent('sdh:changed'));
    } catch (error) {
      say(problem(error, 'The banner could not be removed.'), 'error');
    } finally {
      setBusy(false);
      render();
      byId(ids.upload)?.focus();
    }
  }

  /** Wires the buttons and redraws whenever the editor opens or the profile list changes. */
  function init() {
    const uploadButton = byId(ids.upload);
    const input = byId(ids.input);
    if (!uploadButton || !input) {
      return;
    }
    uploadButton.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) {
        upload(file);
      }
    });
    byId(ids.remove)?.addEventListener('click', removeBanner);
    document.addEventListener('sdh:overlay-opened', event => {
      if (event.detail?.name === 'profile') {
        say('', '');
        render();
      }
    });
    document.addEventListener('sdh:suppliers', render);
    render();
  }

  window.SupplierDashboardBanner = { safeImageUrl, render };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
