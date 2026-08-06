/**
 * Policy Review and Content Date Service
 * Uses git history for review reminders and article diagnostics only.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const schedule = require('node-schedule');
const fs = require('fs');
const { POLICY_METADATA, getPublicPolicyMetadata } = require('../config/policyMetadata');
const { loadArticleMetadata, formatDate } = require('./articleMetadata.service');
const { notifyAdmins } = require('./notifyAdmins.service');
const reviewTasks = require('./contentReviewTask.service');

class DateManagementService {
  /**
   * @param {Object} dbUnified - Database unified instance
   * @param {Object} logger - Winston logger instance
   */
  constructor(dbUnified, logger) {
    this.dbUnified = dbUnified;
    this.logger = logger;
    this.scheduledJob = null;

    // Policy dates are reviewed metadata. Git is used only to flag source files
    // changed after their recorded review date; it never supplies public dates.
    this.legalPaths = [...new Set(Object.values(POLICY_METADATA).map(item => item.sourcePath))];

    // Paths to track for guides/articles
    this.guidePaths = ['public/guides', 'docs'];
  }

  /**
   * Get the last git commit date for a file or directory
   * @param {string} filePath - Path to file or directory
   * @returns {Date|null} Last commit date or null if not found
   */
  getLastCommitDate(filePath) {
    try {
      const repoRoot = path.resolve(__dirname, '..');
      const fullPath = path.resolve(repoRoot, filePath);

      // Check if path exists
      if (!fs.existsSync(fullPath)) {
        this.logger.warn(`Path does not exist: ${filePath}`);
        return null;
      }

      // Sanitize filePath to prevent command injection
      // Only allow alphanumeric, dash, underscore, slash, dot
      // This prevents shell metacharacters like ; | & $ ` \ etc.
      if (!/^[a-zA-Z0-9/_.-]+$/.test(filePath)) {
        this.logger.error(
          `Invalid file path format (contains potentially unsafe characters): ${filePath}`
        );
        return null;
      }

      // Get last commit date for this path
      // Using spawnSync with an args array to prevent shell injection —
      // no shell is invoked so special characters cannot be interpreted.
      // The '--' separator ensures filePath is treated as a file path, not a git option.
      const result = spawnSync('git', ['log', '-1', '--format=%cI', '--', filePath], {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      if (result.error) {
        throw result.error;
      }

      const output = (result.stdout || '').trim();

      if (!output) {
        this.logger.warn(`No git history found for: ${filePath}`);
        return null;
      }

      return new Date(output);
    } catch (error) {
      this.logger.error(`Error getting git commit date for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Get the most recent commit date from multiple paths
   * @param {Array<string>} paths - Array of paths to check
   * @returns {Date|null} Most recent commit date
   */
  getMostRecentCommitDate(paths) {
    const dates = paths.map(p => this.getLastCommitDate(p)).filter(d => d !== null);

    if (dates.length === 0) {
      return null;
    }

    return new Date(Math.max(...dates.map(d => d.getTime())));
  }

  /**
   * Format date as "Month YYYY" (e.g., "February 2026")
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  formatLegalDate(date) {
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  /**
   * Check if legal content has changed since its recorded review
   * @returns {Object} Change detection result
   */
  hasLegalContentChanged() {
    try {
      const bySourcePath = new Map();
      Object.entries(POLICY_METADATA).forEach(([policyId, metadata]) => {
        const entry = bySourcePath.get(metadata.sourcePath) || {
          sourcePath: metadata.sourcePath,
          policyIds: [],
          lastReviewed: metadata.lastReviewed,
        };
        entry.policyIds.push(policyId);
        if (metadata.lastReviewed < entry.lastReviewed) {
          entry.lastReviewed = metadata.lastReviewed;
        }
        bySourcePath.set(metadata.sourcePath, entry);
      });

      const files = [...bySourcePath.values()].map(entry => {
        const gitDate = this.getLastCommitDate(entry.sourcePath);
        const gitDateIso = gitDate ? gitDate.toISOString().slice(0, 10) : null;
        return {
          ...entry,
          gitDate: gitDateIso,
          gitDateFormatted: gitDate ? this.formatLegalDate(gitDate) : null,
          needsReview: Boolean(gitDateIso && gitDateIso > entry.lastReviewed),
        };
      });
      const available = files.filter(file => file.gitDate);
      const changedFiles = files.filter(file => file.needsReview);

      if (available.length === 0) {
        this.logger.warn('Could not determine git dates for policy files');
        return {
          changed: false,
          evidenceAvailable: false,
          reason:
            'Policy source history is unavailable in this deployment; review status is unknown',
          files,
        };
      }

      return {
        changed: changedFiles.length > 0,
        evidenceAvailable: true,
        reason:
          changedFiles.length > 0
            ? `${changedFiles.length} policy source file(s) changed after review`
            : 'No policy source files changed after their recorded review',
        files,
        changedFiles,
      };
    } catch (error) {
      this.logger.error('Error checking legal content changes:', error);
      return {
        changed: false,
        evidenceAvailable: false,
        reason: 'Error checking changes',
        error: error.message,
      };
    }
  }

  /**
   * Parse config date string (e.g., "February 2026") to Date
   * @param {string} dateStr - Date string from config
   * @returns {Date|null} Parsed date or null if invalid
   */
  parseConfigDate(dateStr) {
    try {
      const months = {
        january: 0,
        february: 1,
        march: 2,
        april: 3,
        may: 4,
        june: 5,
        july: 6,
        august: 7,
        september: 8,
        october: 9,
        november: 10,
        december: 11,
      };

      const parts = dateStr.toLowerCase().split(' ');
      if (parts.length !== 2) {
        return null;
      }

      const month = months[parts[0]];
      const year = parseInt(parts[1], 10);

      if (month === undefined || isNaN(year)) {
        return null;
      }

      // Use the 1st of the month
      return new Date(year, month, 1);
    } catch (error) {
      return null;
    }
  }

  /**
   * Runtime mutation is deliberately disabled. A policy date is changed in the
   * reviewed metadata file in the same commit as the policy wording.
   * @returns {Object} Refusal result
   */
  updateLegalDates() {
    this.logger.warn(
      'Blocked runtime policy-date update; edit config/policyMetadata.js in a reviewed change'
    );
    return {
      success: false,
      code: 'POLICY_METADATA_REVIEW_REQUIRED',
      error:
        'Policy dates are version-controlled review metadata and cannot be changed at runtime.',
    };
  }

  /**
   * Get reviewed article dates from the canonical article catalogue
   * @returns {Array} Articles with reviewed dates
   */
  getArticleDates() {
    try {
      return loadArticleMetadata()
        .map(article => ({
          path: `public/articles/${article.slug}.html`,
          name: article.title,
          lastModified: article.lastMaterialUpdate,
          lastModifiedFormatted: formatDate(article.lastMaterialUpdate),
        }))
        .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
    } catch (error) {
      this.logger.error('Error getting article dates:', error);
      return [];
    }
  }

  /**
   * Perform a monthly review check without changing public policy metadata.
   * @param {Object} [options] - Execution context
   * @param {'scheduler'|'manual'} [options.trigger='scheduler'] - Execution source
   * @param {string} [options.userId='system'] - Actor for manual audit attribution
   * @returns {Promise<Object>} Check result
   */
  async performMonthlyCheck({ trigger = 'scheduler', userId = 'system' } = {}) {
    try {
      this.logger.info('Starting monthly policy review check');

      // The legacy config key now controls review reminders only.
      delete require.cache[require.resolve('../config/content-config.js')];
      const { getConfig } = require('../config/content-config.js');
      const config = getConfig();
      const settings = await reviewTasks.getSettings();

      if (config.dates.autoUpdateEnabled === false || settings.enabled === false) {
        this.logger.info('Policy review reminders are disabled, skipping');
        return {
          performed: false,
          reason: 'Policy review reminders disabled',
        };
      }

      // Check if content has changed
      const changeCheck = await this.hasLegalContentChanged();

      if (changeCheck.evidenceAvailable === false) {
        return { performed: false, evidenceAvailable: false, ...changeCheck };
      }

      if (!changeCheck.changed) {
        this.logger.info('No legal content changes detected');
        return {
          performed: false,
          reason: 'No changes detected',
          ...changeCheck,
        };
      }

      await this.notifyAdmins({
        type: 'REVIEW_REQUIRED',
        trigger,
        requestedBy: trigger === 'manual' ? userId : 'system',
        changedFiles: changeCheck.changedFiles,
        timestamp: new Date().toISOString(),
      });

      this.logger.info('Policy review reminder sent; public dates were not changed');

      return {
        performed: true,
        notified: true,
        datesChanged: false,
        ...changeCheck,
      };
    } catch (error) {
      this.logger.error('Error performing monthly check:', error);
      return {
        performed: false,
        error: error.message,
      };
    }
  }

  /**
   * Schedule monthly review reminders
   * Runs on the 1st of each month at 2:00 AM
   */
  scheduleMonthlyUpdate() {
    try {
      // Cancel existing job if any
      if (this.scheduledJob) {
        this.scheduledJob.cancel();
      }

      // Schedule for 1st of month at 2:00 AM
      // Rule: '0 2 1 * *' = minute 0, hour 2, day 1, every month, any day of week
      this.scheduledJob = schedule.scheduleJob('0 2 1 * *', async () => {
        this.logger.info('Scheduled policy review check triggered');
        await this.performMonthlyCheck();
      });

      this.logger.info('Monthly policy review check scheduled for 1st of each month at 2:00 AM');

      return {
        scheduled: true,
        rule: '0 2 1 * *',
        nextRun: this.scheduledJob.nextInvocation(),
      };
    } catch (error) {
      this.logger.error('Error scheduling monthly policy review check:', error);
      return {
        scheduled: false,
        error: error.message,
      };
    }
  }

  /**
   * Cancel scheduled updates
   */
  cancelScheduledUpdate() {
    if (this.scheduledJob) {
      this.scheduledJob.cancel();
      this.scheduledJob = null;
      this.logger.info('Scheduled policy review checks cancelled');
      return { cancelled: true };
    }
    return { cancelled: false, reason: 'No scheduled job found' };
  }

  /**
   * Notify admins that a policy review is required
   * @param {Object} updateInfo - Update information
   */
  async notifyAdmins(updateInfo) {
    try {
      const changedCount = Array.isArray(updateInfo.changedFiles)
        ? updateInfo.changedFiles.length
        : 0;
      const message = `${changedCount} policy source file(s) changed after their recorded review date. Review the wording and update config/policyMetadata.js in the same version-controlled change if needed. Public dates have not been changed.`;

      await notifyAdmins({
        type: 'reminder',
        title: 'Legal Policy Review Required',
        message,
        actionUrl: '/admin-content?tab=legalDates',
        actionText: 'Review policies',
        priority: 'high',
        metadata: updateInfo,
      });

      this.logger.info('Admin notifications sent', {
        type: updateInfo.type,
      });
    } catch (error) {
      this.logger.error('Error notifying admins:', error);
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      scheduled: !!this.scheduledJob,
      nextRun: this.scheduledJob ? this.scheduledJob.nextInvocation() : null,
      legalPaths: this.legalPaths,
      guidePaths: this.guidePaths,
      policies: getPublicPolicyMetadata(),
    };
  }
}

module.exports = DateManagementService;
