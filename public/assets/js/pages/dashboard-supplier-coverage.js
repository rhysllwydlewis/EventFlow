/**
 * Supplier coverage controls.
 *
 * The base postcode decides which city page a supplier appears on, so it is
 * checked here against the same pattern the API uses: a supplier finds out
 * about a typo while they are looking at the field, not after a failed save.
 * Optional throughout — leaving it blank simply means the platform falls back
 * to whatever the free-text location says.
 */
(function () {
  const input = document.getElementById('sup-base-postcode');
  const error = document.getElementById('sup-base-postcode-error');
  const radius = document.getElementById('sup-travel-radius');
  const nationwide = document.getElementById('sup-travel-nationwide');

  if (!input || !error) {
    return;
  }

  const ukPostcodeRegex = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i;

  const isAcceptable = () => {
    const value = input.value.trim();
    return value === '' || ukPostcodeRegex.test(value);
  };

  const clearError = () => {
    error.textContent = '';
    error.classList.remove('visible');
    error.setAttribute('aria-hidden', 'true');
    input.setAttribute('aria-invalid', 'false');
  };

  const showError = () => {
    error.textContent =
      'Please enter a valid UK postcode (for example CF10 1AA), or leave it blank.';
    error.classList.add('visible');
    error.setAttribute('aria-hidden', 'false');
    input.setAttribute('aria-invalid', 'true');
  };

  input.addEventListener('input', () => {
    if (isAcceptable()) {
      clearError();
    }
  });

  input.addEventListener('blur', () => {
    if (isAcceptable()) {
      clearError();
    } else {
      showError();
    }
  });

  // A supplier who covers the whole UK has no use for a mileage figure.
  if (radius && nationwide) {
    const syncRadiusState = () => {
      radius.disabled = nationwide.checked;
    };
    nationwide.addEventListener('change', syncRadiusState);
    syncRadiusState();
  }

  window.validateBasePostcode = function () {
    if (isAcceptable()) {
      clearError();
      return true;
    }
    showError();
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };
})();
