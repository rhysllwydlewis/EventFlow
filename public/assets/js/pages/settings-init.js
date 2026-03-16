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

    // Show supplier dashboard callout for supplier accounts
    if (user.role === 'supplier') {
      const callout = document.getElementById('supplier-profile-callout');
      if (callout) {
        callout.style.display = 'block';
      }
    }

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

    status.textContent = '✓ Changes saved';
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
  document.getElementById('notification-sound-enabled').checked = soundEnabled !== 'false';
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
    const response = await fetch('/api/me/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' },
      credentials: 'include',
      body: JSON.stringify({ notify }),
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

// ===== ACCOUNT DELETION MODAL =====
(function () {
  const modal = document.getElementById('delete-account-modal');
  const step1 = document.getElementById('delete-step-1');
  const step2 = document.getElementById('delete-step-2');
  const step3 = document.getElementById('delete-step-3');

  function showStep(n) {
    step1.style.display = n === 1 ? 'block' : 'none';
    step2.style.display = n === 2 ? 'block' : 'none';
    step3.style.display = n === 3 ? 'block' : 'none';
  }

  function openModal() {
    showStep(1);
    document.getElementById('delete-email-input').value = '';
    document.getElementById('delete-email-error').style.display = 'none';
    document.getElementById('delete-step3-error').style.display = 'none';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.style.display = 'none';
    document.body.style.overflow = '';
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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });
})();
