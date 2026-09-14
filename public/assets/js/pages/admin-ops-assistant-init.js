'use strict';
(function () {
  const statusBox = document.getElementById('opsAssistantStatus');
  const statusText = document.getElementById('opsAssistantStatusText');
  const generateButton = document.getElementById('generateOpsAssistantSecret');
  const resultBox = document.getElementById('opsAssistantSecretResult');
  const secretValue = document.getElementById('opsAssistantSecretValue');
  const secretInstructions = document.getElementById('opsAssistantSecretInstructions');
  const confirmModal = document.getElementById('opsAssistantConfirmModal');
  const confirmCancel = document.getElementById('opsAssistantConfirmCancel');
  const confirmGenerate = document.getElementById('opsAssistantConfirmGenerate');

  if (
    !statusBox ||
    !statusText ||
    !generateButton ||
    !resultBox ||
    !secretValue ||
    !secretInstructions ||
    !confirmModal ||
    !confirmCancel ||
    !confirmGenerate
  ) {
    return;
  }

  async function loadStatus() {
    try {
      const result = await AdminShared.adminFetch('/api/v1/admin/ops-assistant', {
        method: 'GET',
      });
      const enabled = result.enabled ? 'Enabled' : 'Disabled';
      const configured = result.secretConfigured
        ? 'a secret is configured'
        : 'no secret configured yet';
      statusText.textContent = `${enabled} (${configured})`;
      statusBox.style.display = 'block';
    } catch (error) {
      AdminShared.debugError('Failed to load Ops Assistant status:', error);
    }
  }

  function openConfirmModal() {
    confirmModal.style.display = 'flex';
  }

  function closeConfirmModal() {
    confirmModal.style.display = 'none';
  }

  generateButton.addEventListener('click', openConfirmModal);
  confirmCancel.addEventListener('click', closeConfirmModal);
  confirmModal.addEventListener('click', event => {
    if (event.target === confirmModal) {
      closeConfirmModal();
    }
  });

  confirmGenerate.addEventListener('click', async () => {
    closeConfirmModal();

    await AdminShared.safeAction(
      generateButton,
      async () => {
        await AdminShared.fetchCSRFToken();
        const result = await AdminShared.adminFetch('/api/v1/admin/ops-assistant/generate-secret', {
          method: 'POST',
        });
        secretValue.textContent = result.secret;
        secretInstructions.textContent = result.instructions || '';
        resultBox.style.display = 'block';
        await loadStatus();
        return result;
      },
      {
        loadingText: 'Generating...',
        successMessage: 'New secret generated -- copy it now',
        errorMessage: 'Failed to generate a new secret',
      }
    );
  });

  loadStatus();
})();
