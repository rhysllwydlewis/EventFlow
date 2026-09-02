'use strict';

// ===== SHARED HELPERS =====
function getInitials(firstName, lastName) {
  return (
    ((firstName || '')[0] || '').toUpperCase() + ((lastName || '')[0] || '').toUpperCase() || '?'
  );
}

function showInitialsAvatar(initials) {
  const wrapper = document.getElementById('avatar-wrapper');
  if (!wrapper) {
    return;
  }
  const existing = wrapper.querySelector('img, .avatar-initials');
  const div = document.createElement('div');
  div.className = 'avatar-initials';
  div.textContent = initials;
  if (existing) {
    existing.replaceWith(div);
  } else {
    wrapper.insertBefore(div, wrapper.firstChild);
  }
}

// ===== AVATAR ERROR FALLBACK =====
(function () {
  const img = document.getElementById('avatar-preview');
  if (!img) {
    return;
  }
  img.addEventListener('error', () => {
    const firstName = document.getElementById('profile-firstName')?.value || '';
    const lastName = document.getElementById('profile-lastName')?.value || '';
    showInitialsAvatar(getInitials(firstName, lastName));
  });
})();

// ===== LOAD PROFILE =====
let _userEmail = ''; // store for deletion confirmation

async function loadProfile() {
  const loadingEl = document.getElementById('profile-loading');
  const formEl = document.getElementById('profile-form');
  try {
    if (loadingEl) {
      loadingEl.style.display = 'flex';
    }
    if (formEl) {
      formEl.style.display = 'none';
    }

    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Failed to load profile');
    }
    const data = await response.json();
    const user = data.user;

    if (!user) {
      window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }

    // Cache email for deletion confirmation
    _userEmail = (user.email || '').toLowerCase();

    // Populate form fields
    document.getElementById('profile-firstName').value = user.firstName || '';
    document.getElementById('profile-lastName').value = user.lastName || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-phone').value = user.phone || '';
    document.getElementById('profile-location').value = user.location || '';
    document.getElementById('profile-postcode').value = user.postcode || '';

    // Notification
    document.getElementById('notify').checked = user.notify !== false;

    renderAccountType(user);

    // Show supplier dashboard callout for supplier accounts
    if (user.role === 'supplier') {
      const callout = document.getElementById('supplier-profile-callout');
      if (callout) {
        callout.style.display = 'block';
      }
      // Show supplier reminder email prefs section
      const reminderPrefs = document.getElementById('supplier-reminder-prefs');
      if (reminderPrefs) {
        reminderPrefs.style.display = 'block';
      }
      // Update sub-prefs visibility based on master toggle
      updateApSubPrefsVisibility();
      // Load email prefs from settings API
      loadEmailPrefs();
    }

    loadEmailNotificationPrefs(user);

    // Avatar preview
    const avatarPreview = document.getElementById('avatar-preview');
    if (avatarPreview) {
      if (user.avatarUrl) {
        avatarPreview.src = user.avatarUrl;
      } else {
        showInitialsAvatar(getInitials(user.firstName, user.lastName));
      }
    }

    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
    if (formEl) {
      formEl.style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading profile:', error);
    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
    if (formEl) {
      formEl.style.display = 'block';
    }
    const status = document.getElementById('profile-status');
    if (status) {
      status.textContent = '✗ Error loading account details';
      status.style.color = '#ef4444';
    }
  }
}

// ===== SAVE PROFILE =====
document.getElementById('profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  const status = document.getElementById('profile-status');
  const submitBtn = document.getElementById('profile-save-btn');
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    status.textContent = '';

    const formData = {
      firstName: document.getElementById('profile-firstName').value.trim(),
      lastName: document.getElementById('profile-lastName').value.trim(),
      phone: document.getElementById('profile-phone').value.trim(),
      location: document.getElementById('profile-location').value.trim(),
      postcode: document.getElementById('profile-postcode').value.trim(),
    };

    const newEmail = document.getElementById('profile-email').value.trim();
    if (newEmail && newEmail !== _userEmail) {
      formData.email = newEmail;
    }

    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
      credentials: 'include',
      body: JSON.stringify(formData),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update account');
    }

    const emailChanged = !!formData.email;
    if (emailChanged) {
      status.textContent = '✓ Changes saved — please check your new email to verify it';
    } else {
      status.textContent = '✓ Changes saved';
    }
    status.style.color = '#10b981';
    setTimeout(() => {
      loadProfile();
    }, 1200);
  } catch (error) {
    console.error('Error updating profile:', error);
    status.textContent = `✗ ${error.message}`;
    status.style.color = '#ef4444';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Changes';
  }
});

// ===== AVATAR UPLOAD / DELETE =====
(function () {
  const uploadInput = document.getElementById('avatar-upload-input');
  const deleteBtn = document.getElementById('avatar-delete-btn');
  const avatarStatus = document.getElementById('avatar-status');
  const loadingEl = document.getElementById('avatar-loading');

  function setAvatarStatus(msg, color) {
    if (avatarStatus) {
      avatarStatus.textContent = msg;
      avatarStatus.style.color = color || '';
    }
  }
  function setAvatarLoading(on) {
    if (loadingEl) {
      loadingEl.classList.toggle('visible', on);
    }
  }

  if (uploadInput) {
    uploadInput.addEventListener('change', async function () {
      const file = this.files[0];
      if (!file) {
        return;
      }
      setAvatarStatus('Uploading…', '#6b7280');
      setAvatarLoading(true);
      const fd = new FormData();
      fd.append('avatar', file);
      try {
        const resp = await fetch('/api/profile/avatar', {
          method: 'POST',
          headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
          credentials: 'include',
          body: fd,
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.error || 'Upload failed');
        }

        const wrapper = document.getElementById('avatar-wrapper');
        let imgEl = wrapper && wrapper.querySelector('img');
        if (!imgEl) {
          const placeholder = wrapper && wrapper.querySelector('.avatar-initials');
          if (placeholder) {
            imgEl = document.createElement('img');
            imgEl.id = 'avatar-preview';
            imgEl.alt = 'Your profile photo';
            placeholder.replaceWith(imgEl);
          }
        }
        if (imgEl && result.avatarUrl) {
          imgEl.src = `${result.avatarUrl}?t=${Date.now()}`;
        }
        setAvatarStatus('✓ Photo updated', '#10b981');
        setTimeout(() => setAvatarStatus(''), 3000);
      } catch (err) {
        console.error('Avatar upload error:', err);
        setAvatarStatus(`✗ ${err.message}`, '#ef4444');
      } finally {
        setAvatarLoading(false);
        uploadInput.value = '';
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Remove your profile photo?')) {
        return;
      }
      setAvatarStatus('Removing…', '#6b7280');
      setAvatarLoading(true);
      try {
        const resp = await fetch('/api/profile/avatar', {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
          credentials: 'include',
        });
        const result = await resp.json();
        if (!resp.ok) {
          throw new Error(result.error || 'Delete failed');
        }

        const firstName = document.getElementById('profile-firstName')?.value || '';
        const lastName = document.getElementById('profile-lastName')?.value || '';
        showInitialsAvatar(getInitials(firstName, lastName));
        setAvatarStatus('✓ Photo removed', '#10b981');
        setTimeout(() => setAvatarStatus(''), 3000);
      } catch (err) {
        console.error('Avatar delete error:', err);
        setAvatarStatus(`✗ ${err.message}`, '#ef4444');
      } finally {
        setAvatarLoading(false);
      }
    });
  }
})();

// Load profile on page load
loadProfile();

// Show email-change hint when the user modifies the email field
(function () {
  const emailInput = document.getElementById('profile-email');
  const emailHint = document.getElementById('email-change-hint');
  if (emailInput && emailHint) {
    emailInput.addEventListener('input', () => {
      const changed = emailInput.value.trim().toLowerCase() !== _userEmail.toLowerCase();
      emailHint.style.display = changed ? 'block' : 'none';
    });
  }
})();

// ===== ACTION PROMPT PREFS (loaded after profile to know the role) =====
function updateApSubPrefsVisibility() {
  const masterEnabled = document.getElementById('ap-enabled')?.checked !== false;
  const subPrefs = document.getElementById('ap-sub-prefs');
  if (subPrefs) {
    subPrefs.style.opacity = masterEnabled ? '1' : '0.45';
    subPrefs.style.pointerEvents = masterEnabled ? 'auto' : 'none';
    subPrefs.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.disabled = !masterEnabled;
    });
  }
}

// Load email prefs from API and populate supplier reminder checkboxes
async function loadEmailPrefs() {
  try {
    const r = await fetch('/api/me/settings', { credentials: 'include' });
    if (!r.ok) {
      return;
    }
    const d = await r.json();
    const ap = d.emailPrefs?.actionPrompts;
    if (!ap) {
      return;
    }

    const setChecked = (id, val) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = val;
      }
    };
    setChecked('ap-enabled', ap.enabled !== false);
    setChecked('ap-missing-packages', ap.missingPackages !== false);
    setChecked('ap-incomplete-profile', ap.incompleteProfile !== false);
    setChecked('ap-missing-photos', ap.missingPhotos !== false);
    updateApSubPrefsVisibility();
  } catch (e) {
    // Non-fatal — defaults are all ON
  }
}

// Wire master toggle visibility
document.getElementById('ap-enabled')?.addEventListener('change', updateApSubPrefsVisibility);

// ===== EMAIL & NOTIFICATION PREFERENCES (all account types) =====
let _newsletterStatus = 'not-subscribed';
// Guards the cadence dropdown in the save handler below: the <select> has
// no `selected` option in the markup, so the browser default is its first
// option ("Immediately") until loadEmailNotificationPrefs's fetch resolves
// and overwrites it with the user's real saved value. Without this flag, a
// save triggered before that fetch resolves would silently downgrade the
// user's digest cadence to "Immediately".
let _emailPrefsLoaded = false;

function renderNewsletterStatus() {
  const text = document.getElementById('newsletter-status-text');
  const btn = document.getElementById('newsletter-toggle-btn');
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

async function loadEmailNotificationPrefs(user) {
  try {
    const r = await fetch('/api/me/settings', { credentials: 'include' });
    if (!r.ok) {
      return;
    }
    const d = await r.json();

    _newsletterStatus = d.newsletterStatus || 'not-subscribed';
    renderNewsletterStatus();

    const cadenceSelect = document.getElementById('community-digest-cadence');
    if (cadenceSelect) {
      cadenceSelect.value = d.communityDigestCadence || 'weekly';
    }

    if (user && user.role === 'customer') {
      const row = document.getElementById('browse-nudge-row');
      if (row) {
        row.style.display = 'flex';
      }
      const cb = document.getElementById('browse-nudge-enabled');
      if (cb) {
        cb.checked = d.browseNudgeOptOut !== true;
      }
    }

    if (!d.verified) {
      const row = document.getElementById('verification-reminder-row');
      if (row) {
        row.style.display = 'flex';
      }
      const cb = document.getElementById('verification-reminder-enabled');
      if (cb) {
        cb.checked = d.verificationReminderOptOut !== true;
      }
    }
    _emailPrefsLoaded = true;
  } catch (e) {
    // Non-fatal — section keeps its default state
  }
}

document.getElementById('newsletter-toggle-btn')?.addEventListener('click', async function () {
  const btn = this;
  btn.disabled = true;
  try {
    const endpoint =
      _newsletterStatus === 'active' ? '/api/newsletter/unsubscribe' : '/api/newsletter/subscribe';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
      credentials: 'include',
      body: JSON.stringify({ email: document.getElementById('profile-email')?.value || '' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    _newsletterStatus = _newsletterStatus === 'active' ? 'unsubscribed' : 'pending-confirmation';
    renderNewsletterStatus();
  } catch (e) {
    const text = document.getElementById('newsletter-status-text');
    if (text) {
      text.textContent = '✗ Could not update newsletter subscription';
    }
    btn.disabled = false;
  }
});

// ===== RESTART TOUR =====
document.getElementById('restart-tour').addEventListener('click', function () {
  localStorage.removeItem('ef_homepage_tour_completed');
  const btn = this;
  btn.textContent = '✓ Tour Reset!';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = 'Restart Tour';
    btn.disabled = false;
  }, 2000);
});

// ===== NOTIFICATION SOUND SETTINGS =====
function loadNotificationSettings() {
  const soundEnabled = localStorage.getItem('ef_notification_sound_enabled');
  const volume = localStorage.getItem('ef_notification_volume');
  const soundToggle = document.getElementById('notification-sound-enabled');
  soundToggle.checked = soundEnabled !== 'false';
  soundToggle.setAttribute('role', 'switch');
  soundToggle.setAttribute('aria-checked', String(soundEnabled !== 'false'));
  soundToggle.addEventListener('change', () => {
    soundToggle.setAttribute('aria-checked', String(soundToggle.checked));
  });
  document.getElementById('notification-volume').value = volume || '30';
  document.getElementById('volume-value').textContent = volume || '30';
  updateVolumeControlVisibility();
}

function updateVolumeControlVisibility() {
  const soundEnabled = document.getElementById('notification-sound-enabled').checked;
  const volumeControl = document.getElementById('volume-control');
  volumeControl.style.opacity = soundEnabled ? '1' : '0.5';
  volumeControl.style.pointerEvents = soundEnabled ? 'auto' : 'none';
}

document.getElementById('notification-volume').addEventListener('input', e => {
  const value = e.target.value;
  document.getElementById('volume-value').textContent = value;
  e.target.setAttribute('aria-valuenow', value);
  e.target.setAttribute('aria-valuetext', `${value} percent`);
});

document
  .getElementById('notification-sound-enabled')
  .addEventListener('change', updateVolumeControlVisibility);

document.getElementById('test-notification-sound').addEventListener('click', function () {
  const volume = parseInt(document.getElementById('notification-volume').value, 10) / 100;
  const soundEnabled = document.getElementById('notification-sound-enabled').checked;
  const feedback = document.getElementById('test-sound-feedback');
  const btn = this;
  feedback.textContent = '';
  feedback.style.color = '';
  if (!soundEnabled) {
    feedback.textContent = '⚠ Sounds are disabled';
    feedback.style.color = '#f59e0b';
    return;
  }
  if (volume === 0) {
    feedback.textContent = '⚠ Volume is 0%';
    feedback.style.color = '#f59e0b';
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
    btn.textContent = '✓ Playing…';
    btn.disabled = true;
    feedback.textContent = '✓ Sound played';
    feedback.style.color = '#10b981';
    setTimeout(() => {
      btn.textContent = 'Test Sound';
      btn.disabled = false;
      feedback.textContent = '';
    }, 2000);
  } catch (error) {
    feedback.textContent = `✗ ${error.message}`;
    feedback.style.color = '#ef4444';
  }
});

document.getElementById('save-settings').addEventListener('click', async () => {
  const soundEnabled = document.getElementById('notification-sound-enabled').checked;
  const volume = document.getElementById('notification-volume').value;
  const notify = document.getElementById('notify').checked;
  const status = document.getElementById('settings-status');
  try {
    localStorage.setItem('ef_notification_sound_enabled', soundEnabled);
    localStorage.setItem('ef_notification_volume', volume);

    // Build payload — include emailPrefs if supplier prefs section is visible
    const payload = { notify };
    const reminderPrefs = document.getElementById('supplier-reminder-prefs');
    if (reminderPrefs && reminderPrefs.style.display !== 'none') {
      payload.emailPrefs = {
        actionPrompts: {
          enabled: document.getElementById('ap-enabled')?.checked !== false,
          missingPackages: document.getElementById('ap-missing-packages')?.checked !== false,
          incompleteProfile: document.getElementById('ap-incomplete-profile')?.checked !== false,
          missingPhotos: document.getElementById('ap-missing-photos')?.checked !== false,
        },
      };
    }

    const cadenceSelect = document.getElementById('community-digest-cadence');
    if (cadenceSelect && _emailPrefsLoaded) {
      payload.communityDigestCadence = cadenceSelect.value;
    }

    const browseNudgeRow = document.getElementById('browse-nudge-row');
    if (browseNudgeRow && browseNudgeRow.style.display !== 'none') {
      payload.browseNudgeOptOut =
        document.getElementById('browse-nudge-enabled')?.checked === false;
    }

    const verificationReminderRow = document.getElementById('verification-reminder-row');
    if (verificationReminderRow && verificationReminderRow.style.display !== 'none') {
      payload.verificationReminderOptOut =
        document.getElementById('verification-reminder-enabled')?.checked === false;
    }

    const response = await fetch('/api/me/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error('Failed to save');
    }
    status.textContent = '✓ Preferences saved';
    status.style.color = '#10b981';
    setTimeout(() => {
      status.textContent = '';
    }, 3000);
  } catch (error) {
    status.textContent = '✗ Error saving preferences';
    status.style.color = '#ef4444';
    setTimeout(() => {
      status.textContent = '';
    }, 5000);
  }
});

loadNotificationSettings();

// ===== CHANGE PASSWORD FORM =====
(function () {
  const form = document.getElementById('change-password-form');
  if (!form) {
    return;
  }

  // Password strength indicator
  const newPwInput = document.getElementById('cp-new');
  const strengthBar = document.getElementById('cp-strength-bar');
  const strengthFill = document.getElementById('cp-strength-fill');
  const strengthLabel = document.getElementById('cp-strength-label');

  function calcStrength(pw) {
    let score = 0;
    if (pw.length >= 8) {
      score++;
    }
    if (pw.length >= 12) {
      score++;
    }
    if (/[A-Z]/.test(pw)) {
      score++;
    }
    if (/[0-9]/.test(pw)) {
      score++;
    }
    if (/[^A-Za-z0-9]/.test(pw)) {
      score++;
    }
    return score;
  }

  newPwInput &&
    newPwInput.addEventListener('input', () => {
      const pw = newPwInput.value;
      if (!pw) {
        strengthBar.style.display = 'none';
        strengthLabel.style.display = 'none';
        return;
      }
      strengthBar.style.display = 'block';
      strengthLabel.style.display = 'block';
      const score = calcStrength(pw);
      const levels = [
        { pct: '20%', color: '#ef4444', text: 'Very weak' },
        { pct: '40%', color: '#f97316', text: 'Weak' },
        { pct: '60%', color: '#eab308', text: 'Fair' },
        { pct: '80%', color: '#22c55e', text: 'Strong' },
        { pct: '100%', color: '#10b981', text: 'Very strong' },
      ];
      const lvl = levels[Math.min(Math.max(score - 1, 0), levels.length - 1)];
      strengthFill.style.width = lvl.pct;
      strengthFill.style.background = lvl.color;
      strengthLabel.textContent = lvl.text;
      strengthLabel.style.color = lvl.color;
    });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const status = document.getElementById('cp-status');
    const saveBtn = document.getElementById('cp-save-btn');
    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    const confirmPassword = document.getElementById('cp-confirm').value;

    status.textContent = '';
    status.style.color = '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      status.textContent = '✗ All fields are required';
      status.style.color = '#ef4444';
      return;
    }

    if (newPassword !== confirmPassword) {
      status.textContent = '✗ New passwords do not match';
      status.style.color = '#ef4444';
      return;
    }

    if (newPassword.length < 8) {
      status.textContent = '✗ Password must be at least 8 characters';
      status.style.color = '#ef4444';
      return;
    }

    try {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Updating…';

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update password');
      }

      form.reset();
      status.textContent = '✓ Password updated';
      status.style.color = '#10b981';
      setTimeout(() => {
        status.textContent = '';
      }, 4000);
    } catch (err) {
      status.textContent = `✗ ${err.message}`;
      status.style.color = '#ef4444';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Update Password';
    }
  });
})();

// ===== ACCOUNT DELETION MODAL =====
(function () {
  const modal = document.getElementById('delete-account-modal');
  const step1 = document.getElementById('delete-step-1');
  const step2 = document.getElementById('delete-step-2');
  const step3 = document.getElementById('delete-step-3');

  function showStep(n) {
    [step1, step2, step3].forEach((el, i) => {
      if (el) {
        el.hidden = i + 1 !== n;
      }
    });
  }

  let _deleteModalOpener = null;
  const _escapeHandler = e => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };

  function openModal() {
    showStep(1);
    document.getElementById('delete-email-input').value = '';
    document.getElementById('delete-email-error').style.display = 'none';
    document.getElementById('delete-step3-error').style.display = 'none';
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    _deleteModalOpener = document.activeElement;
    document.addEventListener('keydown', _escapeHandler);
    // Focus the close button for keyboard users
    requestAnimationFrame(() => {
      const closeBtn = document.getElementById('delete-modal-close');
      if (closeBtn) {
        closeBtn.focus();
      }
    });
  }

  function closeModal() {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', _escapeHandler);
    if (_deleteModalOpener && typeof _deleteModalOpener.focus === 'function') {
      _deleteModalOpener.focus();
    }
  }

  // Open modal
  document.getElementById('delete-account-btn').addEventListener('click', openModal);

  // Close on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close button (step 1)
  document.getElementById('delete-modal-close').addEventListener('click', closeModal);

  // Step 1 → cancel
  document.getElementById('delete-step1-cancel').addEventListener('click', closeModal);

  // Step 1 → continue
  document.getElementById('delete-step1-next').addEventListener('click', () => {
    showStep(2);
    document.getElementById('delete-email-input').focus();
  });

  // Step 2 → back
  document.getElementById('delete-step2-back').addEventListener('click', () => {
    showStep(1);
  });

  // Step 2 → verify email
  document.getElementById('delete-step2-next').addEventListener('click', () => {
    const inputEmail = (document.getElementById('delete-email-input').value || '')
      .trim()
      .toLowerCase();
    const errEl = document.getElementById('delete-email-error');
    if (!inputEmail) {
      errEl.textContent = 'Please enter your email address.';
      errEl.style.display = 'block';
      return;
    }
    if (inputEmail !== _userEmail) {
      errEl.textContent = 'That email does not match your account. Please try again.';
      errEl.style.display = 'block';
      document.getElementById('delete-email-input').focus();
      return;
    }
    errEl.style.display = 'none';
    showStep(3);
  });

  // Also allow pressing Enter in email field to advance
  document.getElementById('delete-email-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('delete-step2-next').click();
    }
  });

  // Step 3 → back
  document.getElementById('delete-step3-back').addEventListener('click', () => {
    showStep(2);
  });

  // Step 3 → final confirm — delete account
  document.getElementById('delete-step3-confirm').addEventListener('click', async function () {
    const btn = this;
    const errEl = document.getElementById('delete-step3-error');
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    errEl.style.display = 'none';

    try {
      const resp = await fetch('/api/profile', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({ email: _userEmail }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        throw new Error(result.error || 'Deletion failed');
      }

      // Success — clear session data and redirect
      closeModal();
      localStorage.clear();
      window.location.href = '/?deleted=1';
    } catch (err) {
      console.error('Account deletion error:', err);
      errEl.textContent = err.message || 'An error occurred. Please try again.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Yes, Permanently Delete';
    }
  });

  // Close modal on Escape key
  // Escape key handled by _escapeHandler (registered on modal open)
})();

// ===== ACCOUNT TYPE (customer <-> supplier self-service conversion) =====
function renderAccountType(user) {
  const card = document.getElementById('account-type-card');
  if (!card) {
    return;
  }
  // Admin accounts don't go through this flow — the card stays hidden.
  if (user.role === 'admin') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const badge = document.getElementById('account-type-badge');
  const becomeSupplier = document.getElementById('account-type-become-supplier');
  const becomeCustomer = document.getElementById('account-type-become-customer');

  if (user.role === 'supplier') {
    if (badge) {
      badge.textContent = 'Currently: Supplier';
    }
    if (becomeSupplier) {
      becomeSupplier.style.display = 'none';
    }
    if (becomeCustomer) {
      becomeCustomer.style.display = 'block';
    }
  } else {
    if (badge) {
      badge.textContent = 'Currently: Customer';
    }
    if (becomeSupplier) {
      becomeSupplier.style.display = 'block';
    }
    if (becomeCustomer) {
      becomeCustomer.style.display = 'none';
    }
    const companyInput = document.getElementById('at-company');
    if (companyInput && !companyInput.value && user.company) {
      companyInput.value = user.company;
    }
    const locationInput = document.getElementById('at-location');
    if (locationInput && !locationInput.value && user.location) {
      locationInput.value = user.location;
    }
  }
}

(function () {
  const pillCustomer = document.getElementById('account-type-pill-customer');
  const pillSupplier = document.getElementById('account-type-pill-supplier');
  const supplierFields = document.getElementById('account-type-supplier-fields');
  const supplierSubmitBtn = document.getElementById('account-type-supplier-submit');
  const customerTriggerBtn = document.getElementById('account-type-customer-trigger');

  function setActivePill(active, inactive) {
    active.classList.add('is-active');
    active.setAttribute('aria-pressed', 'true');
    inactive.classList.remove('is-active');
    inactive.setAttribute('aria-pressed', 'false');
  }

  if (pillCustomer && pillSupplier && supplierFields) {
    pillCustomer.addEventListener('click', () => {
      setActivePill(pillCustomer, pillSupplier);
      supplierFields.style.display = 'none';
    });
    pillSupplier.addEventListener('click', () => {
      setActivePill(pillSupplier, pillCustomer);
      supplierFields.style.display = 'block';
    });
  }

  async function submitAccountTypeConversion(targetRole, supplierInfo) {
    const statusEl = document.getElementById(
      targetRole === 'supplier' ? 'account-type-supplier-status' : 'account-type-customer-status'
    );
    const btn = targetRole === 'supplier' ? supplierSubmitBtn : customerTriggerBtn;

    if (statusEl) {
      statusEl.textContent = '';
      statusEl.style.color = '';
    }
    if (btn) {
      btn.disabled = true;
    }

    try {
      const resp = await fetch('/api/v1/me/settings/account-type', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({ targetRole, supplierInfo }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        let message = data.error || 'Failed to change account type';
        if (data.code === 'COOLDOWN_ACTIVE' && data.retryAfterDays) {
          message = `You can change your account type again in ${data.retryAfterDays} day(s).`;
        }
        throw new Error(message);
      }

      if (statusEl) {
        statusEl.textContent = '✓ Account type updated — redirecting…';
        statusEl.style.color = '#10b981';
      }
      if (typeof Toast !== 'undefined') {
        Toast.success('Account type updated');
      }
      setTimeout(() => {
        window.location.href = data.redirect || '/settings';
      }, 900);
    } catch (err) {
      console.error('Account type conversion error:', err);
      if (statusEl) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.style.color = '#ef4444';
      }
      if (typeof Toast !== 'undefined') {
        Toast.error(err.message);
      }
      if (btn) {
        btn.disabled = false;
      }
    }
  }

  if (supplierSubmitBtn) {
    supplierSubmitBtn.addEventListener('click', () => {
      const company = document.getElementById('at-company').value.trim();
      const category = document.getElementById('at-category').value;
      const location = document.getElementById('at-location').value.trim();
      const statusEl = document.getElementById('account-type-supplier-status');

      if (!company) {
        if (statusEl) {
          statusEl.textContent = '✗ Business/company name is required';
          statusEl.style.color = '#ef4444';
        }
        document.getElementById('at-company').focus();
        return;
      }

      submitAccountTypeConversion('supplier', { company, category, location });
    });
  }

  function openDowngradeConfirmModal() {
    if (typeof Modal === 'undefined') {
      // components.js failed to load — fail safe to a plain confirm() rather than silently doing nothing.
      if (window.confirm('Switch to a customer account? Your supplier listing will be paused.')) {
        submitAccountTypeConversion('customer');
      }
      return;
    }

    const content = document.createElement('div');
    content.innerHTML = `
      <p class="settings-body-text">Switching to a customer account will:</p>
      <ul class="settings-danger-list" style="margin:0.5rem 0 0.75rem;">
        <li>Pause your supplier listing — it stops appearing in search and the marketplace</li>
        <li>Cancel any active Pro subscription</li>
        <li>Keep your business data — switching back to supplier later reactivates it, pending a quick re-review</li>
      </ul>
      <label for="account-type-convert-confirm" class="settings-body-text" style="font-weight:600;display:block;">
        Type <strong>CONVERT</strong> to confirm
      </label>
      <input type="text" id="account-type-convert-confirm" class="settings-convert-confirm-input" autocomplete="off" placeholder="CONVERT">
    `;

    const modal = new Modal({
      title: 'Switch to a customer account',
      content,
      confirmText: 'Switch to Customer',
      cancelText: 'Keep Supplier Account',
      onConfirm: () => {
        const typed = (document.getElementById('account-type-convert-confirm')?.value || '')
          .trim()
          .toUpperCase();
        if (typed !== 'CONVERT') {
          if (typeof Toast !== 'undefined') {
            Toast.error('Please type CONVERT to confirm — try again.');
          }
          return;
        }
        submitAccountTypeConversion('customer');
      },
    });
    modal.show();
  }

  if (customerTriggerBtn) {
    customerTriggerBtn.addEventListener('click', openDowngradeConfirmModal);
  }
})();
