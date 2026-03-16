/**
 * Password Reset Page JavaScript
 * Handles token validation, password strength checking, and password reset submission
 */
(function () {
  'use strict';

  const tokenStatusEl = document.getElementById('token-status');
  const tokenMessageEl = document.getElementById('token-message');
  const resetFormEl = document.getElementById('reset-form');
  const successMessageEl = document.getElementById('success-message');
  const newPasswordEl = document.getElementById('new-password');
  const confirmPasswordEl = document.getElementById('confirm-password');
  const submitBtn = document.getElementById('submit-btn');
  const resetStatusEl = document.getElementById('reset-status');
  const passwordStrengthEl = document.getElementById('password-strength-msg');
  const passwordMatchEl = document.getElementById('password-match-msg');

  let resetToken = null;

  /**
   * Get reset token from URL
   */
  function getTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  }

  /**
   * Validate password strength (multi-level)
   */
  function validatePassword(password) {
    const COMMON_PASSWORDS = [
      'password1',
      '12345678',
      'qwerty123',
      'letmein1',
      'welcome1',
      'monkey123',
      'dragon123',
    ];
    if (!password || password.length < 8) {
      return { valid: false, level: 'weak', message: 'Password must be at least 8 characters' };
    }
    if (!/[a-zA-Z]/.test(password)) {
      return { valid: false, level: 'weak', message: 'Password must contain at least one letter' };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, level: 'weak', message: 'Password must contain at least one number' };
    }
    if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
      return {
        valid: false,
        level: 'weak',
        message: 'This password is too common. Please choose a stronger one',
      };
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasSpecial = /[^a-zA-Z0-9]/.test(password);
    const isLong = password.length >= 12;
    if (isLong && hasUpper && hasLower && hasSpecial) {
      return { valid: true, level: 'strong', message: 'Password strength: Strong' };
    }
    if (hasSpecial && (hasUpper || hasLower)) {
      return { valid: true, level: 'good', message: 'Password strength: Good' };
    }
    if (hasUpper && hasLower) {
      return {
        valid: true,
        level: 'fair',
        message: 'Password strength: Fair — add special characters for better security',
      };
    }
    return {
      valid: true,
      level: 'weak',
      message: 'Password strength: Weak — add uppercase letters and special characters',
    };
  }

  /**
   * Show error message
   */
  function showError(message) {
    tokenStatusEl.style.display = 'block';
    tokenMessageEl.textContent = message;
    tokenMessageEl.style.color = '#b00020';
    resetFormEl.style.display = 'none';
  }

  /**
   * Validate token on page load
   */
  async function validateToken() {
    resetToken = getTokenFromUrl();

    if (!resetToken) {
      showError('❌ Invalid reset link. Please check your email and try again.');
      return;
    }

    // Validate token server-side before showing form
    let networkError = false;
    try {
      const response = await fetch('/api/auth/validate-reset-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showError(
          `❌ ${data.error || 'This reset link is invalid or has expired. Please request a new one.'}`
        );
        return;
      }
    } catch (err) {
      console.error('Token validation request failed:', err);
      networkError = true;
    }

    // Show the form
    if (!networkError) {
      // Clean validation — hide any status message and show form
      if (tokenStatusEl) {
        tokenStatusEl.style.display = 'none';
      }
    } else {
      // Network error — keep a warning visible alongside the form
      if (tokenMessageEl) {
        tokenStatusEl.style.display = 'block';
        tokenMessageEl.textContent = '⚠️ Token validity will be confirmed when you submit.';
        tokenMessageEl.style.color = '#92400e';
      }
    }
    resetFormEl.style.display = 'block';
  }

  /**
   * Check password strength in real-time
   */
  newPasswordEl.addEventListener('input', function () {
    const password = this.value;
    if (!password) {
      passwordStrengthEl.textContent = '';
      passwordStrengthEl.style.color = '#667085';
      return;
    }

    const result = validatePassword(password);
    passwordStrengthEl.textContent = result.message;
    passwordStrengthEl.style.color = result.valid ? '#0B8073' : '#b00020';
  });

  /**
   * Check if passwords match
   */
  confirmPasswordEl.addEventListener('input', function () {
    const password = newPasswordEl.value;
    const confirm = this.value;

    if (!confirm) {
      passwordMatchEl.style.display = 'none';
      return;
    }

    if (password !== confirm) {
      passwordMatchEl.textContent = 'Passwords do not match';
      passwordMatchEl.style.display = 'block';
    } else {
      passwordMatchEl.style.display = 'none';
    }
  });

  /**
   * Handle form submission
   */
  resetFormEl.addEventListener('submit', async e => {
    e.preventDefault();

    const newPassword = newPasswordEl.value;
    const confirmPassword = confirmPasswordEl.value;

    // Validate password
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      resetStatusEl.textContent = validation.message;
      resetStatusEl.style.color = '#b00020';
      return;
    }

    // Check passwords match
    if (newPassword !== confirmPassword) {
      resetStatusEl.textContent = 'Passwords do not match';
      resetStatusEl.style.color = '#b00020';
      return;
    }

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Resetting...';
    resetStatusEl.textContent = '';

    try {
      // Call the API to reset password
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
        },
        credentials: 'include',
        body: JSON.stringify({
          token: resetToken,
          password: newPassword,
        }),
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        // Success!
        resetFormEl.style.display = 'none';
        successMessageEl.style.display = 'block';
      } else {
        // Error from server
        resetStatusEl.textContent = data.error || 'Failed to reset password';
        resetStatusEl.style.color = '#b00020';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset password';
      }
    } catch (err) {
      console.error('Password reset error:', err);
      resetStatusEl.textContent = 'Network error. Please try again.';
      resetStatusEl.style.color = '#b00020';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Reset password';
    }
  });

  // Initialize on page load
  validateToken();
})();
