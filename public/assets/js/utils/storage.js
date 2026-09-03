/**
 * LocalStorage and SessionStorage Utility Functions
 * Safe wrapper for storage operations with error handling
 */

class Storage {
  /**
   * Check if storage is available
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {boolean} - Storage availability
   */
  static isAvailable(type = 'localStorage') {
    try {
      const storage = window[type];
      const test = '__storage_test__';
      storage.setItem(test, test);
      storage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get item from storage
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if key doesn't exist
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {*} - Stored value or default
   */
  static get(key, defaultValue = null, type = 'localStorage') {
    if (!this.isAvailable(type)) {
      return defaultValue;
    }

    try {
      const item = window[type].getItem(key);

      if (item === null) {
        return defaultValue;
      }

      // Try to parse JSON
      try {
        return JSON.parse(item);
      } catch (e) {
        return item;
      }
    } catch (error) {
      console.error(`Error getting ${key} from ${type}:`, error);
      return defaultValue;
    }
  }

  /**
   * Set item in storage
   * @param {string} key - Storage key
   * @param {*} value - Value to store
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {boolean} - Success status
   */
  static set(key, value, type = 'localStorage') {
    if (!this.isAvailable(type)) {
      return false;
    }

    try {
      const item = typeof value === 'string' ? value : JSON.stringify(value);
      window[type].setItem(key, item);
      return true;
    } catch (error) {
      console.error(`Error setting ${key} in ${type}:`, error);
      return false;
    }
  }

  /**
   * Remove item from storage
   * @param {string} key - Storage key
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {boolean} - Success status
   */
  static remove(key, type = 'localStorage') {
    if (!this.isAvailable(type)) {
      return false;
    }

    try {
      window[type].removeItem(key);
      return true;
    } catch (error) {
      console.error(`Error removing ${key} from ${type}:`, error);
      return false;
    }
  }

  /**
   * Clear all items from storage
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {boolean} - Success status
   */
  static clear(type = 'localStorage') {
    if (!this.isAvailable(type)) {
      return false;
    }

    try {
      window[type].clear();
      return true;
    } catch (error) {
      console.error(`Error clearing ${type}:`, error);
      return false;
    }
  }

  /**
   * Get all keys from storage
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {Array<string>} - Array of keys
   */
  static keys(type = 'localStorage') {
    if (!this.isAvailable(type)) {
      return [];
    }

    try {
      return Object.keys(window[type]);
    } catch (error) {
      console.error(`Error getting keys from ${type}:`, error);
      return [];
    }
  }

  /**
   * Get storage size in bytes
   * @param {string} type - 'localStorage' or 'sessionStorage'
   * @returns {number} - Storage size in bytes
   */
  static size(type = 'localStorage') {
    if (!this.isAvailable(type)) {
      return 0;
    }

    try {
      let size = 0;
      for (const key in window[type]) {
        if (Object.prototype.hasOwnProperty.call(window[type], key)) {
          size += window[type][key].length + key.length;
        }
      }
      return size;
    } catch (error) {
      console.error(`Error calculating ${type} size:`, error);
      return 0;
    }
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Storage;
}

// Make available globally
if (typeof window !== 'undefined') {
  window.Storage = Storage;
}
