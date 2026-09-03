'use strict';
(function () {
  const MODES = ['disabled', 'popup', 'banner'];
  const modeInput = document.getElementById('signupPopupMode');
  const delayInput = document.getElementById('signupPopupDelay');
  const saveButton = document.getElementById('saveSignupPopup');
  const modeButtons = Array.from(document.querySelectorAll('.signup-popup-mode-btn'));

  if (!modeInput || !delayInput || !saveButton || modeButtons.length === 0) {
    return;
  }

  function selectMode(mode) {
    const selectedMode = MODES.includes(mode) ? mode : 'disabled';
    modeInput.value = selectedMode;
    modeButtons.forEach(button => {
      const selected = button.dataset.mode === selectedMode;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
  }

  async function loadSettings() {
    try {
      const settings = await AdminShared.adminFetch('/api/admin/settings/signup-popup', {
        method: 'GET',
      });
      selectMode(settings.mode);
      delayInput.value = Number.isInteger(settings.delaySeconds) ? settings.delaySeconds : 5;
    } catch (error) {
      AdminShared.debugError('Failed to load signup popup settings:', error);
    }
  }

  modeButtons.forEach(button => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
  });

  saveButton.addEventListener('click', async () => {
    const rawDelay = delayInput.value.trim();
    const delaySeconds = Number(rawDelay);

    if (
      rawDelay === '' ||
      !Number.isInteger(delaySeconds) ||
      delaySeconds < 0 ||
      delaySeconds > 300
    ) {
      AdminShared.showToast('Delay must be a whole number of seconds between 0 and 300', 'error');
      return;
    }

    await AdminShared.safeAction(
      saveButton,
      async () => {
        await AdminShared.fetchCSRFToken();
        const result = await AdminShared.adminFetch('/api/admin/settings/signup-popup', {
          method: 'PUT',
          body: { mode: modeInput.value, delaySeconds },
        });
        await loadSettings();
        return result;
      },
      {
        loadingText: 'Saving...',
        successMessage: 'Sign-up popup settings updated',
        errorMessage: 'Failed to update sign-up popup settings',
      }
    );
  });

  selectMode(modeInput.value);
  loadSettings();
})();
