/* Settings page (customer and supplier accounts).
 *
 * One /api/me/settings request feeds every preference on the page; the account itself comes from
 * /api/v1/auth/me. Confirmations (remove photo, switch to customer, delete account) are native
 * <dialog> elements, so focus stays inside, Escape closes and focus returns to the button. */

'use strict';

(function () {
  const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
  const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  let _user = null;
  let _userEmail = '';
  let _newsletterStatus = 'not-subscribed';
  // The digest <select> shows its markup default until the settings request answers; saving before
  // then would overwrite the person's real cadence with that default.
  let _emailPrefsLoaded = false;
  let _firstRender = true;

  const byId = id => document.getElementById(id);

  /** Shows a message in a status element, coloured by state ('success', 'error', 'warn', 'info'). */
  function setStatus(el, message, state) {
    if (!el) {
      return;
    }
    el.textContent = message || '';
    if (message && state) {
      el.dataset.state = state;
    } else {
      delete el.dataset.state;
    }
  }

  /** Clears a status line after a while, unless something else has been written to it since. */
  function clearStatusLater(el, message, ms) {
    setTimeout(() => {
      if (el && el.textContent === message) {
        setStatus(el, '');
      }
    }, ms);
  }

  /** A request to our own API with the session cookie and CSRF token; never throws on HTTP errors. */
  async function api(url, { method = 'GET', body } = {}) {
    const headers = { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' };
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(url, { method, headers, credentials: 'include', body: payload });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  // ===== Avatar =====

  function getInitials(firstName, lastName) {
    const first = (firstName || '').trim().charAt(0).toUpperCase();
    const last = (lastName || '').trim().charAt(0).toUpperCase();
    return first + last || '?';
  }

  function showInitialsAvatar(initials) {
    const wrapper = byId('avatar-wrapper');
    if (!wrapper) {
      return;
    }
    const img = wrapper.querySelector('img');
    if (img) {
      img.remove();
    }
    let placeholder = wrapper.querySelector('.avatar-initials');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'avatar-initials';
      placeholder.setAttribute('role', 'img');
      wrapper.insertBefore(placeholder, wrapper.firstChild);
    }
    placeholder.textContent = initials;
    placeholder.setAttribute('aria-label', 'Your profile initials');
  }

  /** Shows a photo, falling back to initials if the image cannot be loaded. */
  function showAvatarPhoto(url) {
    const wrapper = byId('avatar-wrapper');
    if (!wrapper) {
      return;
    }
    let img = wrapper.querySelector('img');
    if (!img) {
      const placeholder = wrapper.querySelector('.avatar-initials');
      img = document.createElement('img');
      img.id = 'avatar-preview';
      img.alt = 'Your profile photo';
      if (placeholder) {
        placeholder.replaceWith(img);
      } else {
        wrapper.insertBefore(img, wrapper.firstChild);
      }
    }
    img.addEventListener(
      'error',
      () => showInitialsAvatar(getInitials(_user?.firstName, _user?.lastName)),
      { once: true }
    );
    img.src = url;
  }

  (function setUpAvatar() {
    const uploadBtn = byId('avatar-upload-btn');
    const uploadInput = byId('avatar-upload-input');
    const deleteBtn = byId('avatar-delete-btn');
    const statusEl = byId('avatar-status');
    const spinner = byId('avatar-loading');
    const removeDialog = byId('remove-photo-dialog');

    const setLoading = on => spinner && spinner.classList.toggle('visible', on);

    uploadBtn?.addEventListener('click', () => uploadInput?.click());

    uploadInput?.addEventListener('change', async () => {
      const file = uploadInput.files[0];
      if (!file) {
        return;
      }
      // The same checks the server makes, so the answer is instant.
      if (!AVATAR_TYPES.includes(file.type)) {
        setStatus(statusEl, 'Please choose a JPG, PNG or WebP image.', 'error');
        uploadInput.value = '';
        return;
      }
      if (file.size > AVATAR_MAX_BYTES) {
        setStatus(
          statusEl,
          'That photo is larger than 5 MB. Please choose a smaller one.',
          'error'
        );
        uploadInput.value = '';
        return;
      }
      setStatus(statusEl, 'Uploading…', 'info');
      setLoading(true);
      try {
        const body = new FormData();
        body.append('avatar', file);
        const { ok, data } = await api('/api/profile/avatar', { method: 'POST', body });
        if (!ok) {
          throw new Error(data.error || 'Upload failed');
        }
        if (data.avatarUrl) {
          showAvatarPhoto(`${data.avatarUrl}?t=${Date.now()}`);
        }
        setStatus(statusEl, 'Photo updated', 'success');
        clearStatusLater(statusEl, 'Photo updated', 3000);
      } catch (err) {
        setStatus(statusEl, err.message || 'Upload failed', 'error');
      } finally {
        setLoading(false);
        uploadInput.value = '';
      }
    });

    deleteBtn?.addEventListener('click', () => removeDialog?.showModal());
    byId('remove-photo-cancel')?.addEventListener('click', () => removeDialog.close());
    removeDialog?.addEventListener('click', e => {
      if (e.target === removeDialog) {
        removeDialog.close();
      }
    });

    byId('remove-photo-confirm')?.addEventListener('click', async () => {
      removeDialog.close();
      setStatus(statusEl, 'Removing…', 'info');
      setLoading(true);
      try {
        const { ok, data } = await api('/api/profile/avatar', { method: 'DELETE' });
        if (!ok) {
          throw new Error(data.error || 'Delete failed');
        }
        showInitialsAvatar(
          getInitials(byId('profile-firstName')?.value, byId('profile-lastName')?.value)
        );
        setStatus(statusEl, 'Photo removed', 'success');
        clearStatusLater(statusEl, 'Photo removed', 3000);
      } catch (err) {
        setStatus(statusEl, err.message || 'Delete failed', 'error');
      } finally {
        setLoading(false);
      }
    });
  })();

  // ===== Account and preferences =====

  function setHidden(id, hidden) {
    const el = byId(id);
    if (el) {
      el.hidden = hidden;
    }
  }

  function updateApSubPrefsVisibility() {
    const masterEnabled = byId('ap-enabled')?.checked !== false;
    const subPrefs = byId('ap-sub-prefs');
    if (subPrefs) {
      subPrefs.style.opacity = masterEnabled ? '1' : '0.45';
      subPrefs.style.pointerEvents = masterEnabled ? 'auto' : 'none';
      subPrefs.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = !masterEnabled;
      });
    }
  }
  byId('ap-enabled')?.addEventListener('change', updateApSubPrefsVisibility);

  function renderNewsletterStatus() {
    const text = byId('newsletter-status-text');
    const btn = byId('newsletter-toggle-btn');
    if (!text || !btn) {
      return;
    }
    btn.disabled = false;
    if (_newsletterStatus === 'active') {
      text.textContent = "You're subscribed to our newsletter";
      btn.textContent = 'Unsubscribe';
    } else if (_newsletterStatus === 'pending-confirmation') {
      text.textContent = 'Check your inbox to confirm your subscription';
      btn.textContent = 'Resend confirmation';
    } else {
      text.textContent = "You're not subscribed to our newsletter";
      btn.textContent = 'Subscribe';
    }
  }

  function setChecked(id, value) {
    const el = byId(id);
    if (el) {
      el.checked = value;
    }
  }

  /** Fills every preference control from the /api/me/settings answer. */
  function applySettings(settings, user) {
    setChecked('notify', settings.notify !== false);

    _newsletterStatus = settings.newsletterStatus || 'not-subscribed';
    renderNewsletterStatus();

    const cadence = byId('community-digest-cadence');
    if (cadence) {
      cadence.value = settings.communityDigestCadence || 'weekly';
    }

    if (user.role === 'supplier') {
      const ap = settings.emailPrefs?.actionPrompts || {};
      setChecked('ap-enabled', ap.enabled !== false);
      setChecked('ap-missing-packages', ap.missingPackages !== false);
      setChecked('ap-incomplete-profile', ap.incompleteProfile !== false);
      setChecked('ap-missing-photos', ap.missingPhotos !== false);
      setChecked('ap-uncategorized', ap.uncategorized !== false);
      setChecked('ap-packages-missing-photos', ap.packagesMissingPhotos !== false);
      updateApSubPrefsVisibility();
    }
    if (user.role === 'customer') {
      setHidden('browse-nudge-row', false);
      setChecked('browse-nudge-enabled', settings.browseNudgeOptOut !== true);
    }
    if (settings.verified === false) {
      setHidden('verification-reminder-row', false);
      setChecked('verification-reminder-enabled', settings.verificationReminderOptOut !== true);
    }
    _emailPrefsLoaded = true;
  }

  function renderAccountType(user) {
    const card = byId('account-type-card');
    if (!card) {
      return;
    }
    // Admin accounts don't go through this flow, so the card stays hidden.
    const show = user.role !== 'admin';
    card.hidden = !show;
    setHidden('settings-nav-account-type', !show);
    if (!show) {
      return;
    }

    const isSupplier = user.role === 'supplier';
    const badge = byId('account-type-badge');
    if (badge) {
      badge.textContent = isSupplier ? 'Currently: Supplier' : 'Currently: Customer';
    }
    setHidden('account-type-become-supplier', isSupplier);
    setHidden('account-type-become-customer', !isSupplier);

    if (!isSupplier) {
      const company = byId('at-company');
      if (company && !company.value && user.company) {
        company.value = user.company;
      }
      const location = byId('at-location');
      if (location && !location.value && user.location) {
        location.value = user.location;
      }
    }

    // The card is hidden until this point, so the browser has already given up on a
    // #account-type-card fragment by the time it exists. Links that send people here to fix a wrong
    // account type rely on this scroll.
    if (_firstRender && window.location.hash === '#account-type-card') {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  function showLoadError(show) {
    setHidden('profile-load-error', !show);
  }

  /**
   * Loads the account and its preferences. `quiet` refreshes the fields in place (after a save)
   * without hiding the form or losing the scroll position.
   */
  async function loadProfile({ quiet = false } = {}) {
    if (!quiet) {
      setHidden('profile-loading', false);
      setHidden('profile-form', true);
      showLoadError(false);
    }
    try {
      const [meResponse, settingsResponse] = await Promise.all([
        fetch('/api/v1/auth/me', { credentials: 'include' }),
        fetch('/api/me/settings', { credentials: 'include' }).catch(() => null),
      ]);
      if (!meResponse.ok) {
        throw new Error('Failed to load profile');
      }
      const { user } = await meResponse.json();
      if (!user) {
        window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const settings = settingsResponse?.ok
        ? await settingsResponse.json().catch(() => null)
        : null;

      _user = user;
      _userEmail = (user.email || '').toLowerCase();

      byId('profile-firstName').value = user.firstName || '';
      byId('profile-lastName').value = user.lastName || '';
      byId('profile-email').value = user.email || '';
      byId('profile-phone').value = user.phone || '';
      byId('profile-location').value = user.location || '';
      byId('profile-postcode').value = user.postcode || '';
      setHidden('email-change-hint', true);

      renderAccountType(user);

      const isSupplier = user.role === 'supplier';
      setHidden('supplier-profile-callout', !isSupplier);
      setHidden('supplier-reminder-prefs', !isSupplier);

      if (settings) {
        applySettings(settings, user);
      } else {
        // Preferences could not be read: the form still works, but saving must not overwrite them
        // with the page's defaults, so the guarded fields stay out of the save request.
        setChecked('notify', user.notify !== false);
        setHidden('browse-nudge-row', user.role !== 'customer');
        const text = byId('newsletter-status-text');
        if (text) {
          text.textContent = 'Could not load your newsletter status';
        }
      }

      const unverified = settings ? settings.verified === false : user.verified === false;
      setHidden('email-unverified-notice', !unverified);

      if (user.avatarUrl) {
        showAvatarPhoto(user.avatarUrl);
      } else {
        showInitialsAvatar(getInitials(user.firstName, user.lastName));
      }

      setHidden('profile-loading', true);
      setHidden('profile-form', false);
      _firstRender = false;
    } catch (error) {
      console.error('Error loading profile:', error);
      if (!quiet) {
        // Show a retry, not a blank form: saving blank fields would wipe the person's details.
        setHidden('profile-loading', true);
        showLoadError(true);
      }
    }
  }

  byId('profile-retry-btn')?.addEventListener('click', () => loadProfile());

  // Email-change hint: only once the address differs from the saved one.
  byId('profile-email')?.addEventListener('input', event => {
    const changed = event.target.value.trim().toLowerCase() !== _userEmail;
    setHidden('email-change-hint', !changed);
  });

  byId('resend-verification-btn')?.addEventListener('click', async function () {
    const status = byId('resend-verification-status');
    this.disabled = true;
    setStatus(status, 'Sending…', 'info');
    try {
      const { ok } = await api('/api/v1/auth/resend-verification', {
        method: 'POST',
        body: { email: _userEmail },
      });
      if (!ok) {
        throw new Error('failed');
      }
      setStatus(status, 'Verification email sent. Please check your inbox.', 'success');
    } catch {
      setStatus(status, 'Could not send the email. Please try again.', 'error');
      this.disabled = false;
    }
  });

  // ===== Save profile =====
  byId('profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = byId('profile-status');
    const submitBtn = byId('profile-save-btn');
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
      setStatus(status, '');

      const formData = {
        firstName: byId('profile-firstName').value.trim(),
        lastName: byId('profile-lastName').value.trim(),
        phone: byId('profile-phone').value.trim(),
        location: byId('profile-location').value.trim(),
        postcode: byId('profile-postcode').value.trim(),
      };
      const newEmail = byId('profile-email').value.trim();
      if (newEmail && newEmail.toLowerCase() !== _userEmail) {
        formData.email = newEmail;
      }

      const { ok, data } = await api('/api/profile', { method: 'PUT', body: formData });
      if (!ok) {
        throw new Error(data.error || 'Failed to update account');
      }

      const message = formData.email
        ? 'Changes saved. Please check your new email to verify it.'
        : 'Changes saved';
      setStatus(status, message, 'success');
      clearStatusLater(status, message, 6000);
      await loadProfile({ quiet: true });
    } catch (error) {
      setStatus(status, error.message || 'Failed to update account', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save changes';
    }
  });

  // ===== Newsletter =====
  byId('newsletter-toggle-btn')?.addEventListener('click', async function () {
    const btn = this;
    const text = byId('newsletter-status-text');
    btn.disabled = true;
    try {
      const subscribed = _newsletterStatus === 'active';
      // Always the account's saved address, never whatever is currently typed in the email box.
      const { ok, data } = await api(
        subscribed ? '/api/newsletter/unsubscribe' : '/api/newsletter/subscribe',
        { method: 'POST', body: { email: _userEmail } }
      );
      if (!ok) {
        throw new Error(data.error || 'Request failed');
      }
      _newsletterStatus = subscribed ? 'unsubscribed' : 'pending-confirmation';
      renderNewsletterStatus();
    } catch {
      if (text) {
        text.textContent = 'Could not update your newsletter subscription. Please try again.';
      }
      btn.disabled = false;
    }
  });

  // ===== Notification sound (kept on this device) =====
  function updateVolumeControlVisibility() {
    const enabled = byId('notification-sound-enabled').checked;
    const control = byId('volume-control');
    control.style.opacity = enabled ? '1' : '0.5';
    control.style.pointerEvents = enabled ? 'auto' : 'none';
    byId('notification-volume').disabled = !enabled;
  }

  function loadNotificationSettings() {
    const volume = localStorage.getItem('ef_notification_volume') || '30';
    byId('notification-sound-enabled').checked =
      localStorage.getItem('ef_notification_sound_enabled') !== 'false';
    byId('notification-volume').value = volume;
    byId('volume-value').textContent = volume;
    byId('notification-volume').setAttribute('aria-valuetext', `${volume} percent`);
    updateVolumeControlVisibility();
  }

  byId('notification-volume').addEventListener('input', event => {
    const value = event.target.value;
    byId('volume-value').textContent = value;
    event.target.setAttribute('aria-valuetext', `${value} percent`);
  });
  byId('notification-sound-enabled').addEventListener('change', updateVolumeControlVisibility);

  byId('test-notification-sound').addEventListener('click', function () {
    const volume = parseInt(byId('notification-volume').value, 10) / 100;
    const feedback = byId('test-sound-feedback');
    const btn = this;
    setStatus(feedback, '');
    if (!byId('notification-sound-enabled').checked) {
      setStatus(feedback, 'Sounds are switched off', 'warn');
      return;
    }
    if (volume === 0) {
      setStatus(feedback, 'Volume is 0%', 'warn');
      return;
    }
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
      oscillator.onended = () => audioContext.close();
      btn.disabled = true;
      setStatus(feedback, 'Sound played', 'success');
      setTimeout(() => {
        btn.disabled = false;
        setStatus(feedback, '');
      }, 2000);
    } catch (error) {
      setStatus(feedback, error.message || 'Could not play the sound', 'error');
    }
  });

  // ===== Save preferences =====
  byId('save-settings').addEventListener('click', async function () {
    const btn = this;
    const status = byId('settings-status');
    const soundEnabled = byId('notification-sound-enabled').checked;
    const volume = byId('notification-volume').value;

    const payload = { notify: byId('notify').checked };
    // Everything below is only sent once the saved values have been read, so a failed read can
    // never be saved over with the page's defaults.
    if (_emailPrefsLoaded) {
      if (!byId('supplier-reminder-prefs').hidden) {
        payload.emailPrefs = {
          actionPrompts: {
            enabled: byId('ap-enabled').checked,
            missingPackages: byId('ap-missing-packages').checked,
            incompleteProfile: byId('ap-incomplete-profile').checked,
            missingPhotos: byId('ap-missing-photos').checked,
            uncategorized: byId('ap-uncategorized').checked,
            packagesMissingPhotos: byId('ap-packages-missing-photos').checked,
          },
        };
      }
      payload.communityDigestCadence = byId('community-digest-cadence').value;
      if (!byId('browse-nudge-row').hidden) {
        payload.browseNudgeOptOut = !byId('browse-nudge-enabled').checked;
      }
      if (!byId('verification-reminder-row').hidden) {
        payload.verificationReminderOptOut = !byId('verification-reminder-enabled').checked;
      }
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    setStatus(status, '');
    try {
      const { ok } = await api('/api/me/settings', { method: 'POST', body: payload });
      if (!ok) {
        throw new Error('Failed to save');
      }
      // The sound settings live on this device; they are kept only once the rest has saved too, so
      // a failed save never leaves the page half-changed.
      localStorage.setItem('ef_notification_sound_enabled', String(soundEnabled));
      localStorage.setItem('ef_notification_volume', volume);
      setStatus(status, 'Preferences saved', 'success');
      clearStatusLater(status, 'Preferences saved', 3000);
    } catch {
      setStatus(status, 'Could not save your preferences. Please try again.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save preferences';
    }
  });

  loadNotificationSettings();

  // ===== Change password =====
  (function setUpPasswordForm() {
    const form = byId('change-password-form');
    if (!form) {
      return;
    }
    const newInput = byId('cp-new');
    const bar = byId('cp-strength-bar');
    const label = byId('cp-strength-label');
    const status = byId('cp-status');
    const saveBtn = byId('cp-save-btn');
    const LEVELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

    const strengthOf = pw =>
      [
        pw.length >= 8,
        pw.length >= 12,
        /[A-Z]/.test(pw),
        /[0-9]/.test(pw),
        /[^A-Za-z0-9]/.test(pw),
      ].filter(Boolean).length;
    // The server's rule, so the answer is the same before and after sending.
    const meetsRule = pw => pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

    newInput.addEventListener('input', () => {
      const pw = newInput.value;
      bar.hidden = label.hidden = !pw;
      if (!pw) {
        return;
      }
      const level = Math.max(strengthOf(pw), 1);
      bar.dataset.strength = String(level);
      label.dataset.strength = String(level);
      label.textContent = LEVELS[level - 1];
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const currentPassword = byId('cp-current').value;
      const newPassword = newInput.value;
      const confirmPassword = byId('cp-confirm').value;
      setStatus(status, '');

      let problem = '';
      if (!currentPassword || !newPassword || !confirmPassword) {
        problem = 'All fields are required';
      } else if (newPassword !== confirmPassword) {
        problem = 'New passwords do not match';
      } else if (!meetsRule(newPassword)) {
        problem = 'Password must be at least 8 characters, with a letter and a number';
      }
      if (problem) {
        setStatus(status, problem, 'error');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Updating…';
      try {
        const { ok, data } = await api('/api/auth/change-password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        });
        if (!ok) {
          throw new Error(data.error || 'Failed to update password');
        }
        form.reset();
        bar.hidden = label.hidden = true;
        setStatus(status, 'Password updated', 'success');
        clearStatusLater(status, 'Password updated', 4000);
      } catch (err) {
        setStatus(status, err.message || 'Failed to update password', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Update password';
      }
    });
  })();

  // ===== Delete account (three steps in one native dialog) =====
  (function setUpDeleteAccount() {
    const dialog = byId('delete-account-modal');
    if (!dialog) {
      return;
    }
    const steps = [byId('delete-step-1'), byId('delete-step-2'), byId('delete-step-3')];
    const titleIds = ['delete-modal-title', 'delete-modal-title-2', 'delete-modal-title-3'];
    const emailInput = byId('delete-email-input');
    const emailError = byId('delete-email-error');
    const finalError = byId('delete-step3-error');
    const confirmBtn = byId('delete-step3-confirm');
    let deleting = false;

    function showStep(n) {
      steps.forEach((el, i) => {
        el.hidden = i + 1 !== n;
      });
      dialog.setAttribute('aria-labelledby', titleIds[n - 1]);
    }

    byId('delete-account-btn').addEventListener('click', () => {
      showStep(1);
      emailInput.value = '';
      emailError.hidden = true;
      finalError.hidden = true;
      document.body.style.overflow = 'hidden';
      dialog.showModal();
      byId('delete-step1-cancel').focus();
    });

    dialog.addEventListener('close', () => {
      document.body.style.overflow = '';
    });
    // A deletion that is already running cannot be backed out of with Escape.
    dialog.addEventListener('cancel', event => {
      if (deleting) {
        event.preventDefault();
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && !deleting) {
        dialog.close();
      }
    });

    byId('delete-modal-close').addEventListener('click', () => dialog.close());
    byId('delete-step1-cancel').addEventListener('click', () => dialog.close());
    byId('delete-step1-next').addEventListener('click', () => {
      showStep(2);
      emailInput.focus();
    });
    byId('delete-step2-back').addEventListener('click', () => showStep(1));

    byId('delete-step2-next').addEventListener('click', () => {
      const typed = emailInput.value.trim().toLowerCase();
      if (!typed || typed !== _userEmail) {
        emailError.textContent = typed
          ? 'That email does not match your account. Please try again.'
          : 'Please enter your email address.';
        emailError.hidden = false;
        emailInput.focus();
        return;
      }
      emailError.hidden = true;
      showStep(3);
      byId('delete-step3-back').focus();
    });
    emailInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        byId('delete-step2-next').click();
      }
    });
    byId('delete-step3-back').addEventListener('click', () => showStep(2));

    confirmBtn.addEventListener('click', async () => {
      deleting = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      finalError.hidden = true;
      try {
        const { ok, data } = await api('/api/profile', {
          method: 'DELETE',
          body: { email: _userEmail },
        });
        if (!ok) {
          throw new Error(data.error || 'Deletion failed');
        }
        deleting = false;
        dialog.close();
        localStorage.clear();
        window.location.href = '/?deleted=1';
      } catch (err) {
        deleting = false;
        finalError.textContent = err.message || 'An error occurred. Please try again.';
        finalError.hidden = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Yes, permanently delete';
      }
    });
  })();

  // ===== Account type (customer <-> supplier) =====
  (function setUpAccountType() {
    const pillCustomer = byId('account-type-pill-customer');
    const pillSupplier = byId('account-type-pill-supplier');
    const supplierFields = byId('account-type-supplier-fields');
    const supplierSubmitBtn = byId('account-type-supplier-submit');
    const customerTriggerBtn = byId('account-type-customer-trigger');
    const downgradeDialog = byId('downgrade-dialog');
    const convertInput = byId('account-type-convert-confirm');
    const downgradeConfirm = byId('downgrade-confirm');

    function setActivePill(active, inactive) {
      active.classList.add('is-active');
      active.setAttribute('aria-pressed', 'true');
      inactive.classList.remove('is-active');
      inactive.setAttribute('aria-pressed', 'false');
    }
    pillCustomer?.addEventListener('click', () => {
      setActivePill(pillCustomer, pillSupplier);
      supplierFields.hidden = true;
    });
    pillSupplier?.addEventListener('click', () => {
      setActivePill(pillSupplier, pillCustomer);
      supplierFields.hidden = false;
    });

    /** Returns true when the account type changed (the page is then on its way elsewhere). */
    async function submitAccountTypeConversion(targetRole, supplierInfo) {
      const statusEl = byId(
        targetRole === 'supplier' ? 'account-type-supplier-status' : 'account-type-customer-status'
      );
      const btn = targetRole === 'supplier' ? supplierSubmitBtn : customerTriggerBtn;
      setStatus(statusEl, '');
      if (btn) {
        btn.disabled = true;
      }
      try {
        const { ok, data } = await api('/api/v1/me/settings/account-type', {
          method: 'POST',
          body: { targetRole, supplierInfo },
        });
        if (!ok) {
          let message = data.error || 'Failed to change account type';
          if (data.code === 'COOLDOWN_ACTIVE' && data.retryAfterDays) {
            message = `You can change your account type again in ${data.retryAfterDays} day(s).`;
          }
          throw new Error(message);
        }
        setStatus(statusEl, 'Account type updated. Redirecting…', 'success');
        if (typeof Toast !== 'undefined') {
          Toast.success('Account type updated');
        }
        setTimeout(() => {
          window.location.href = data.redirect || '/settings';
        }, 900);
        return true;
      } catch (err) {
        console.error('Account type conversion error:', err);
        setStatus(statusEl, err.message, 'error');
        if (typeof Toast !== 'undefined') {
          Toast.error(err.message);
        }
        if (btn) {
          btn.disabled = false;
        }
        return false;
      }
    }

    supplierSubmitBtn?.addEventListener('click', () => {
      const company = byId('at-company').value.trim();
      const category = byId('at-category').value;
      const location = byId('at-location').value.trim();
      if (!company) {
        setStatus(
          byId('account-type-supplier-status'),
          'Business or company name is required',
          'error'
        );
        byId('at-company').focus();
        return;
      }
      submitAccountTypeConversion('supplier', { company, category, location });
    });

    // Switching to a customer needs the word CONVERT typed; the button stays off until it is.
    const typedConvert = () => convertInput.value.trim().toUpperCase() === 'CONVERT';
    customerTriggerBtn?.addEventListener('click', () => {
      convertInput.value = '';
      downgradeConfirm.disabled = true;
      downgradeDialog.showModal();
      convertInput.focus();
    });
    convertInput?.addEventListener('input', () => {
      downgradeConfirm.disabled = !typedConvert();
    });
    convertInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (typedConvert()) {
          downgradeConfirm.click();
        }
      }
    });
    byId('downgrade-cancel')?.addEventListener('click', () => downgradeDialog.close());
    downgradeDialog?.addEventListener('click', event => {
      if (event.target === downgradeDialog) {
        downgradeDialog.close();
      }
    });
    downgradeConfirm?.addEventListener('click', async () => {
      if (!typedConvert()) {
        return;
      }
      downgradeConfirm.disabled = true;
      downgradeConfirm.textContent = 'Switching…';
      const changed = await submitAccountTypeConversion('customer');
      downgradeConfirm.textContent = 'Switch to customer';
      if (!changed) {
        // The reason is shown beside the button that opened the dialog.
        downgradeDialog.close();
      }
    });
  })();

  loadProfile();
})();
