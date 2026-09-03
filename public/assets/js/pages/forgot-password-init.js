/**
 * Forgot Password Page — form submission handler
 *
 * Sends the user's email to POST /api/v1/auth/forgot and
 * shows a success or error message in response.
 */
'use strict';
(function () {
  const form = document.getElementById('forgot-form');
  const emailInput = document.getElementById('forgot-email');
  const emailError = document.getElementById('forgot-email-error');
  const submitBtn = document.getElementById('forgot-submit-btn');
  const statusEl = document.getElementById('forgot-status');
  const successEl = document.getElementById('forgot-success');

  if (!form || !emailInput || !submitBtn) {
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();

    // Clear previous state
    if (emailError) {
      emailError.textContent = '';
    }
    if (statusEl) {
      statusEl.textContent = '';
    }

    const email = emailInput.value.trim();

    // Basic client-side validation
    if (!email) {
      if (emailError) {
        emailError.textContent = 'Please enter your email address.';
      }
      emailInput.focus();
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      if (emailError) {
        emailError.textContent = 'Please enter a valid email address.';
      }
      emailInput.focus();
      return;
    }

    // Disable submit button during request
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-busy', 'true');

    try {
      const csrfToken = window.__CSRF_TOKEN__ || '';
      await fetch('/api/v1/auth/forgot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      // Always show the same success message regardless of whether the
      // account exists, to prevent email enumeration attacks.
      if (form) {
        form.style.display = 'none';
      }
      if (successEl) {
        successEl.style.display = 'block';
      }
    } catch (_err) {
      if (statusEl) {
        statusEl.textContent = 'Something went wrong. Please try again in a moment.';
      }
      submitBtn.disabled = false;
      submitBtn.removeAttribute('aria-busy');
    }
  });
})();
