const FORM_INIT_MAX_RETRIES = 40; // 40 × 50 ms = 2 s max wait
let formInitRetries = 0;

function initFormValidation() {
  // FormValidator and ErrorBoundary load via defer — they may not be ready yet.
  // Poll with a bounded retry loop (max FORM_INIT_MAX_RETRIES attempts).
  if (typeof FormValidator === 'undefined' || typeof ErrorBoundary === 'undefined') {
    if (formInitRetries < FORM_INIT_MAX_RETRIES) {
      formInitRetries += 1;
      setTimeout(initFormValidation, 50);
    } else if (typeof console !== 'undefined') {
      console.warn(
        '[auth-form-init] FormValidator or ErrorBoundary not available after max retries — skipping validation setup'
      );
    }
    return;
  }

  // Initialize error boundary
  window.errorBoundary = new ErrorBoundary({
    onError: function (errorInfo) {
      console.error('Error caught:', errorInfo);
    },
  });

  // Initialize form validation for login form
  const loginForm = document.querySelector('#login-form');
  if (loginForm) {
    const loginValidator = new FormValidator(loginForm, {
      validateOnBlur: true,
      validateOnInput: false,
    });

    // Store reference to validator for other scripts
    loginForm._validator = loginValidator;

    // Validate before app.js's submit handler runs. Capture phase, so on the
    // form itself this fires ahead of the handlers registered earlier. Without
    // it an invalid form still reached app.js, which (a) repeated the field
    // errors as a summary line — three messages for two empty fields — and
    // (b) sent the sign-in request anyway when the email was malformed.
    loginForm.addEventListener(
      'submit',
      e => {
        loginValidator.clearAllErrors();
        if (loginValidator.validateAll()) {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();

        // The messages sit under their own fields; clear any stale summary
        // from a previous attempt so the two cannot disagree.
        const loginErrorEl = document.getElementById('login-error');
        if (loginErrorEl) {
          loginErrorEl.textContent = '';
          loginErrorEl.style.display = 'none';
        }
        const loginStatusEl = document.getElementById('login-status');
        if (loginStatusEl) {
          loginStatusEl.textContent = '';
        }
        const firstInvalid = loginForm.querySelector('.form-field-error');
        if (firstInvalid) {
          firstInvalid.focus();
        }
      },
      true
    );

    // Listen for valid submissions
    loginForm.addEventListener('validsubmit', () => {
      // The existing auth-init.js will handle the actual submission
    });
  }

  // Initialize form validation for registration form
  const registerForm = document.querySelector('#register-form');
  if (registerForm) {
    const registerValidator = new FormValidator(registerForm, {
      validateOnBlur: true,
      validateOnInput: false,
    });

    // Add custom password strength validation
    registerValidator.addValidator('reg-password', {
      required: true,
      password: true,
      minLength: 8,
    });

    // Listen for valid submissions
    registerForm.addEventListener('validsubmit', () => {
      // The existing auth-init.js will handle the actual submission
    });
  }
}

// Script runs with defer — DOM is always ready; call directly
initFormValidation();
