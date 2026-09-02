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

    // Override the handleSubmit to also show #login-error
    const originalHandleSubmit = loginValidator.handleSubmit.bind(loginValidator);
    loginValidator.handleSubmit = function (e) {
      const result = originalHandleSubmit(e);
      const loginErrorEl = document.getElementById('login-error');

      // Show #login-error if validation failed
      if (!result && loginErrorEl) {
        const errors = loginValidator.getErrors();
        if (errors.length > 0) {
          const errorMessages = errors.map(([_field, msg]) => msg).join(', ');
          loginErrorEl.textContent = errorMessages || 'Please fix the errors above';
          loginErrorEl.style.display = 'block';
        }
      } else if (result && loginErrorEl) {
        // Clear errors when validation passes
        loginErrorEl.textContent = '';
        loginErrorEl.style.display = 'none';
      }
      // Don't clear the error here - let app.js manage #login-error for API responses
      return result;
    };

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
