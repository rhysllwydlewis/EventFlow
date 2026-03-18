/**
 * Dark Mode Toggle Component
 * Dark mode has been disabled — EventFlow uses light theme only.
 * This file forces light theme and removes any persisted dark preference.
 */

class DarkModeToggle {
  constructor() {
    this.init();
  }

  init() {
    // Always enforce light theme — dark mode is disabled site-wide
    this.setTheme('light');
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      // Clear any previously saved dark preference
      localStorage.removeItem('theme');
    } catch (e) {
      // localStorage may be unavailable; proceed silently
    }
  }

  toggleTheme() {
    // No-op: dark mode is disabled
  }
}

// Initialize when DOM is ready to clear any residual dark theme
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.darkModeToggle = new DarkModeToggle();
    });
  } else {
    window.darkModeToggle = new DarkModeToggle();
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DarkModeToggle;
}
