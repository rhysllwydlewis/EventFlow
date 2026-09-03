/**
 * Customer Management Module for EventFlow
 * Handles customer CRUD operations via MongoDB API
 *
 * NOTE: This module has been migrated from Firebase to MongoDB.
 * All operations now use the EventFlow REST API backed by MongoDB.
 */

const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
class CustomerManager {
  constructor() {
    this.pollingIntervals = [];
    this.apiBase = '/api';
  }

  /**
   * Create or update customer profile via MongoDB API
   * @param {string} userId - User ID
   * @param {Object} customerData - Customer information
   * @returns {Promise<string>} Customer ID
   */
  async saveCustomer(userId, customerData) {
    try {
      const response = await fetch(`${this.apiBase}/customers/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(customerData),
      });

      if (!response.ok) {
        throw new Error('Failed to save customer');
      }

      if (isDevelopment) {
        console.log('Customer saved:', userId);
      }
      return userId;
    } catch (error) {
      console.error('Error saving customer:', error);
      throw error;
    }
  }

  /**
   * Get customer by user ID via MongoDB API
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Customer data
   */
  async getCustomer(userId) {
    try {
      const response = await fetch(`${this.apiBase}/customers/${userId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error('Failed to fetch customer');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting customer:', error);
      throw error;
    }
  }

  /**
   * Get all customers via MongoDB API
   * @param {Object} _options - Query options (reserved for future use)
   * @returns {Promise<Array>} Array of customers
   */
  async getAllCustomers(_options = {}) {
    try {
      const response = await fetch(`${this.apiBase}/customers`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch customers');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting customers:', error);
      throw error;
    }
  }

  /**
   * Update customer profile via MongoDB API
   * @param {string} userId - User ID
   * @param {Object} updates - Fields to update
   */
  updateCustomer(userId, updates) {
    return this.saveCustomer(userId, updates);
  }

  /**
   * Delete customer via MongoDB API
   * @param {string} userId - User ID
   */
  async deleteCustomer(userId) {
    try {
      const response = await fetch(`${this.apiBase}/customers/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete customer');
      }

      if (isDevelopment) {
        console.log('Customer deleted:', userId);
      }
    } catch (error) {
      console.error('Error deleting customer:', error);
      throw error;
    }
  }

  /**
   * Listen to customer changes using polling
   * (MongoDB doesn't have real-time updates like Firebase)
   * @param {string} userId - User ID
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  listenToCustomer(userId, callback) {
    console.warn('Real-time updates not available with MongoDB. Using polling instead.');

    const pollInterval = setInterval(async () => {
      try {
        const customer = await this.getCustomer(userId);
        callback(customer);
      } catch (error) {
        console.error('Error polling customer:', error);
        callback(null);
      }
    }, 5000); // Poll every 5 seconds

    this.pollingIntervals.push(pollInterval);

    // Return unsubscribe function
    return () => {
      clearInterval(pollInterval);
      this.pollingIntervals = this.pollingIntervals.filter(i => i !== pollInterval);
    };
  }

  /**
   * Listen to all customers using polling
   * @param {Object} options - Query options
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  listenToCustomers(options = {}, callback) {
    console.warn('Real-time updates not available with MongoDB. Using polling instead.');

    const pollInterval = setInterval(async () => {
      try {
        const customers = await this.getAllCustomers(options);
        callback(customers);
      } catch (error) {
        console.error('Error polling customers:', error);
        callback([]);
      }
    }, 5000); // Poll every 5 seconds

    this.pollingIntervals.push(pollInterval);

    // Return unsubscribe function
    return () => {
      clearInterval(pollInterval);
      this.pollingIntervals = this.pollingIntervals.filter(i => i !== pollInterval);
    };
  }

  /**
   * Get customer's event history via MongoDB API
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of events
   */
  async getCustomerEvents(userId) {
    try {
      const response = await fetch(`${this.apiBase}/customers/${userId}/events`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch customer events');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting customer events:', error);
      throw error;
    }
  }

  /**
   * Get customer's saved suppliers via MongoDB API
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of supplier IDs
   */
  async getSavedSuppliers(userId) {
    try {
      const response = await fetch(`${this.apiBase}/customers/${userId}/saved-suppliers`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch saved suppliers');
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting saved suppliers:', error);
      throw error;
    }
  }

  /**
   * Save a supplier to customer's favorites via MongoDB API
   * @param {string} userId - User ID
   * @param {string} supplierId - Supplier ID
   */
  async saveSupplier(userId, supplierId) {
    try {
      const response = await fetch(`${this.apiBase}/customers/${userId}/saved-suppliers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ supplierId }),
      });

      if (!response.ok) {
        throw new Error('Failed to save supplier');
      }

      if (isDevelopment) {
        console.log('Supplier saved to favorites:', supplierId);
      }
    } catch (error) {
      console.error('Error saving supplier:', error);
      throw error;
    }
  }

  /**
   * Remove a supplier from customer's favorites via MongoDB API
   * @param {string} userId - User ID
   * @param {string} supplierId - Supplier ID
   */
  async unsaveSupplier(userId, supplierId) {
    try {
      const response = await fetch(
        `${this.apiBase}/customers/${userId}/saved-suppliers/${supplierId}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to unsave supplier');
      }

      if (isDevelopment) {
        console.log('Supplier removed from favorites:', supplierId);
      }
    } catch (error) {
      console.error('Error unsaving supplier:', error);
      throw error;
    }
  }

  /**
   * Clean up all polling intervals
   */
  cleanup() {
    this.pollingIntervals.forEach(interval => clearInterval(interval));
    this.pollingIntervals = [];
  }
}

// Create singleton instance
const customerManager = new CustomerManager();

export default customerManager;
