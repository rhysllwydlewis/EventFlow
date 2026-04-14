/**
 * Formatter Utility Functions
 * Date, currency, and text formatting helpers
 */

const Formatters = {
  /**
   * Format date to locale string
   * @param {Date|string|number} date - Date to format
   * @param {string} locale - Locale string (default: 'en-US')
   * @param {Object} options - Intl.DateTimeFormat options
   * @returns {string} - Formatted date
   */
  date(date, locale = 'en-GB', options = {}) {
    try {
      const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

      if (isNaN(dateObj.getTime())) {
        return 'Invalid date';
      }

      const defaultOptions = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Europe/London',
      };

      return new Intl.DateTimeFormat(locale, { ...defaultOptions, ...options }).format(dateObj);
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  },

  /**
   * Format date to relative time (e.g., "2 hours ago")
   * @param {Date|string|number} date - Date to format
   * @returns {string} - Relative time string
   */
  relativeTime(date) {
    try {
      const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;

      if (isNaN(dateObj.getTime())) {
        return 'Invalid date';
      }

      const now = new Date();
      const diffMs = now - dateObj;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);
      const diffMonth = Math.floor(diffDay / 30);
      const diffYear = Math.floor(diffDay / 365);

      if (diffSec < 60) {
        return 'just now';
      }
      if (diffMin < 60) {
        return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
      }
      if (diffHour < 24) {
        return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
      }
      if (diffDay < 30) {
        return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
      }
      if (diffMonth < 12) {
        return `${diffMonth} month${diffMonth !== 1 ? 's' : ''} ago`;
      }
      return `${diffYear} year${diffYear !== 1 ? 's' : ''} ago`;
    } catch (error) {
      console.error('Error formatting relative time:', error);
      return 'Invalid date';
    }
  },

  /**
   * Format currency
   * @param {number} amount - Amount to format
   * @param {string} currency - Currency code (default: 'USD')
   * @param {string} locale - Locale string (default: 'en-US')
   * @returns {string} - Formatted currency
   */
  currency(amount, currency = 'GBP', locale = 'en-GB') {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).format(amount);
    } catch (error) {
      console.error('Error formatting currency:', error);
      return `${amount} ${currency}`;
    }
  },

  /**
   * Format number with thousands separator
   * @param {number} number - Number to format
   * @param {string} locale - Locale string (default: 'en-US')
   * @returns {string} - Formatted number
   */
  number(number, locale = 'en-GB') {
    try {
      return new Intl.NumberFormat(locale).format(number);
    } catch (error) {
      console.error('Error formatting number:', error);
      return String(number);
    }
  },

  /**
   * Truncate text to specified length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @param {string} suffix - Suffix to add (default: '...')
   * @returns {string} - Truncated text
   */
  truncate(text, maxLength = 100, suffix = '...') {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - suffix.length) + suffix;
  },

  /**
   * Capitalize first letter of string
   * @param {string} text - Text to capitalize
   * @returns {string} - Capitalized text
   */
  capitalize(text) {
    if (!text) {
      return '';
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  },

  /**
   * Convert to title case
   * @param {string} text - Text to convert
   * @returns {string} - Title case text
   */
  titleCase(text) {
    if (!text) {
      return '';
    }
    return text
      .toLowerCase()
      .split(' ')
      .map(word => this.capitalize(word))
      .join(' ');
  },

  /**
   * Format file size
   * @param {number} bytes - File size in bytes
   * @param {number} decimals - Number of decimal places (default: 2)
   * @returns {string} - Formatted file size
   */
  fileSize(bytes, decimals = 2) {
    if (bytes === 0) {
      return '0 Bytes';
    }

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  },

  /**
   * Format phone number (US format)
   * @param {string} phone - Phone number to format
   * @returns {string} - Formatted phone number
   */
  phone(phone) {
    if (!phone) {
      return '';
    }

    const cleaned = `${phone}`.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);

    if (match) {
      return `(${match[1]}) ${match[2]}-${match[3]}`;
    }

    return phone;
  },
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Formatters;
}

// Make available globally
if (typeof window !== 'undefined') {
  window.Formatters = Formatters;
}
