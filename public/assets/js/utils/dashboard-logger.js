/**
 * Dashboard Logging Utility
 * Provides centralized logging for dashboard messaging with debug capabilities
 */

// Initialize debug logging array on window for troubleshooting
if (!window.dashboardLogs) {
  window.dashboardLogs = [];
}

/**
 * Log a message state with timestamp and store for debugging
 * @param {string} state - The state/event being logged
 * @param {object} data - Additional data to log
 */
export function logMessageState(state, data) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, state, data };

  // Only emit to console when debug mode is active
  if (window.__EF_DEBUG__) {
    console.log(`[${timestamp}] [Dashboard Messaging] ${state}:`, data); // eslint-disable-line no-console
  }

  // Store in window.dashboardLogs for debugging (keep last 100 entries)
  window.dashboardLogs.push(logEntry);
  if (window.dashboardLogs.length > 100) {
    window.dashboardLogs.shift();
  }
}

/**
 * Get all dashboard logs
 * @returns {Array} Array of log entries
 */
export function getDashboardLogs() {
  return window.dashboardLogs || [];
}

/**
 * Clear dashboard logs
 */
export function clearDashboardLogs() {
  window.dashboardLogs = [];
}
