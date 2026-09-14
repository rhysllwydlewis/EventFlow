'use strict';
(function () {
  const statusBox = document.getElementById('opsAssistantStatus');
  const statusText = document.getElementById('opsAssistantStatusText');
  const generateButton = document.getElementById('generateOpsAssistantSecret');
  const resultBox = document.getElementById('opsAssistantSecretResult');
  const secretValue = document.getElementById('opsAssistantSecretValue');
  const secretInstructions = document.getElementById('opsAssistantSecretInstructions');

  if (!statusBox || !statusText || !generateButton || !resultBox || !secretValue) {
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

  generateButton.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Generate a new Ops Assistant secret? The old one will keep working until you replace it in your environment variables.'
    );
    if (!confirmed) {
      return;
    }

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
