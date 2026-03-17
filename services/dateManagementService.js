/**
 * Date Management Service
 * Automates legal document and guide date management using git history
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const schedule = require('node-schedule');
const fs = require('fs');
const crypto = require('crypto');

class DateManagementService {
  /**
   * @param {Object} dbUnified - Database unified instance
   * @param {Object} logger - Winston logger instance
   */
  constructor(dbUnified, logger) {
    this.dbUnified = dbUnified;
    this.logger = logger;
    this.scheduledJob = null;

    // Paths to track for legal document changes
    this.legalPaths = [
      'public/terms.html',
      'public/privacy.html',
      'public/legal.html',
      'public/cookies.html',
      'public/acceptable-use.html',
    ];

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
   * Check if legal content has changed since last config update
   * @returns {Promise<Object>} Change detection result
   */
  async hasLegalContentChanged() {
    try {
      // Get config module (fresh require to get latest values)
      delete require.cache[require.resolve('../config/content-config.js')];
      const { getConfig } = require('../config/content-config.js');
      const config = getConfig();

      // Get most recent commit date for legal files
      const gitDate = this.getMostRecentCommitDate(this.legalPaths);

      if (!gitDate) {
        this.logger.warn('Could not determine git date for legal files');
        return {
          changed: false,
          reason: 'No git history available',
        };
      }

      // Parse current config date
      const configDateStr = config.dates.legalLastUpdated;
      const configDate = this.parseConfigDate(configDateStr);

      if (!configDate) {
        this.logger.warn('Could not parse config date:', configDateStr);
        return {
          changed: true,
          reason: 'Config date invalid',
          gitDate: this.formatLegalDate(gitDate),
          configDate: configDateStr,
        };
      }

      // Check if git date is more recent than config date
      const changed = gitDate > configDate;

      return {
        changed,
        reason: changed ? 'Content modified since last update' : 'Content up to date',
        gitDate: this.formatLegalDate(gitDate),
        configDate: configDateStr,
        gitDateRaw: gitDate,
        configDateRaw: configDate,
      };
    } catch (error) {
      this.logger.error('Error checking legal content changes:', error);
      return {
        changed: false,
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
   * Update legal dates in config file
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Update result
   */
  async updateLegalDates(options = {}) {
    try {
      const { lastUpdated, effectiveDate, manual = false, userId = 'system' } = options;

      // Validate dates if provided (defense in depth)
      if (lastUpdated && typeof lastUpdated !== 'string') {
        throw new Error('lastUpdated must be a string (e.g., "February 2026")');
      }
      if (effectiveDate && typeof effectiveDate !== 'string') {
        throw new Error('effectiveDate must be a string (e.g., "February 2026")');
      }

      // Additional validation: ensure format is safe (defense in depth)
      // Even though routes validate, we validate again to prevent injection
      const datePattern =
        /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;
      if (lastUpdated && !datePattern.test(lastUpdated)) {
        throw new Error('Invalid date format for lastUpdated (must be "Month YYYY")');
      }
      if (effectiveDate && !datePattern.test(effectiveDate)) {
        throw new Error('Invalid date format for effectiveDate (must be "Month YYYY")');
      }

      // Read current config file
      const configPath = path.resolve(__dirname, '../config/content-config.js');
      let configContent = fs.readFileSync(configPath, 'utf8');

      // Update dates
      if (lastUpdated) {
        configContent = configContent.replace(
          /legalLastUpdated:\s*['"][^'"]*['"]/,
          `legalLastUpdated: '${lastUpdated}'`
        );
      }

      if (effectiveDate) {
        configContent = configContent.replace(
          /legalEffectiveDate:\s*['"][^'"]*['"]/,
          `legalEffectiveDate: '${effectiveDate}'`
        );
      }

      // Update last check timestamp
      const now = new Date().toISOString();
      const lastCheckPattern = /lastAutoCheck:\s*[^,]*/;
      if (configContent.match(lastCheckPattern)) {
        configContent = configContent.replace(lastCheckPattern, `lastAutoCheck: '${now}'`);
      }

      // Update manual update timestamp if manual
      if (manual) {
        const lastManualPattern = /lastManualUpdate:\s*[^,]*/;
        if (configContent.match(lastManualPattern)) {
          configContent = configContent.replace(lastManualPattern, `lastManualUpdate: '${now}'`);
        }
      }

      // Write updated config
      fs.writeFileSync(configPath, configContent, 'utf8');

      // Clear require cache
      delete require.cache[require.resolve('../config/content-config.js')];

      this.logger.info('Legal dates updated', {
        lastUpdated,
        effectiveDate,
        manual,
        userId,
      });

      // Create audit log entry
      if (this.dbUnified) {
        try {
          await this.dbUnified.insertOne('audit_logs', {
            id: `audit_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').substring(0, 11)}`,
            userId,
            action: manual ? 'MANUAL_DATE_UPDATE' : 'AUTO_DATE_UPDATE',
            details: {
              lastUpdated,
              effectiveDate,
            },
            timestamp: now,
            ipAddress: 'system',
          });
        } catch (auditError) {
          this.logger.error('Failed to create audit log:', auditError);
        }
      }

      return {
        success: true,
        lastUpdated,
        effectiveDate,
        manual,
        timestamp: now,
      };
    } catch (error) {
      this.logger.error('Error updating legal dates:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get article dates from git history
   * @returns {Promise<Array>} Array of articles with dates
   */
  async getArticleDates() {
    try {
      const articles = [];

      // Get all HTML files in guides directory
      const guidesDir = path.resolve(__dirname, '../public/guides');
      if (fs.existsSync(guidesDir)) {
        const files = fs.readdirSync(guidesDir);

        for (const file of files) {
          if (file.endsWith('.html')) {
            const filePath = path.join('public/guides', file);
            const date = this.getLastCommitDate(filePath);

            if (date) {
              articles.push({
                path: filePath,
                name: file.replace('.html', '').replace(/-/g, ' '),
                lastModified: date.toISOString(),
                lastModifiedFormatted: this.formatLegalDate(date),
              });
            }
          }
        }
      }

      // Sort by most recent first
      articles.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      return articles;
    } catch (error) {
      this.logger.error('Error getting article dates:', error);
      return [];
    }
  }

  /**
   * Perform monthly automated check and update if needed
   * @returns {Promise<Object>} Check result
   */
  async performMonthlyCheck() {
    try {
      this.logger.info('Starting monthly date check');

      // Check if auto-update is enabled
      delete require.cache[require.resolve('../config/content-config.js')];
      const { getConfig } = require('../config/content-config.js');
      const config = getConfig();

      if (config.dates.autoUpdateEnabled === false) {
        this.logger.info('Auto-update is disabled, skipping');
        return {
          performed: false,
          reason: 'Auto-update disabled',
        };
      }

      // Check if content has changed
      const changeCheck = await this.hasLegalContentChanged();

      if (!changeCheck.changed) {
        this.logger.info('No legal content changes detected');
        return {
          performed: false,
          reason: 'No changes detected',
          ...changeCheck,
        };
      }

      // Update dates
      const updateResult = await this.updateLegalDates({
        lastUpdated: changeCheck.gitDate,
        effectiveDate: changeCheck.gitDate,
        manual: false,
        userId: 'system',
      });

      if (updateResult.success) {
        // Notify admins
        await this.notifyAdmins({
          type: 'AUTO_UPDATE',
          previousDate: changeCheck.configDate,
          newDate: changeCheck.gitDate,
          timestamp: new Date().toISOString(),
        });

        this.logger.info('Monthly date update completed successfully');
      }

      return {
        performed: updateResult.success,
        ...changeCheck,
        ...updateResult,
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
   * Schedule monthly automated updates
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
        this.logger.info('Scheduled date check triggered');
        await this.performMonthlyCheck();
      });

      this.logger.info('Monthly date update scheduled for 1st of each month at 2:00 AM');

      return {
        scheduled: true,
        rule: '0 2 1 * *',
        nextRun: this.scheduledJob.nextInvocation(),
      };
    } catch (error) {
      this.logger.error('Error scheduling monthly update:', error);
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
      this.logger.info('Scheduled date updates cancelled');
      return { cancelled: true };
    }
    return { cancelled: false, reason: 'No scheduled job found' };
  }

  /**
   * Notify admins of date updates
   * @param {Object} updateInfo - Update information
   */
  async notifyAdmins(updateInfo) {
    try {
      // Create notification for all admins
      const users = await this.dbUnified.read('users');
      const admins = users.filter(u => u.role === 'admin');

      if (admins.length === 0) {
        this.logger.warn('No admin users found for notification');
        return;
      }

      const message =
        updateInfo.type === 'AUTO_UPDATE'
          ? `Legal document dates automatically updated from ${updateInfo.previousDate} to ${updateInfo.newDate}`
          : `Legal document dates manually updated`;

      await Promise.all(
        admins.map(admin =>
          this.dbUnified.insertOne('notifications', {
            id: `notif_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').substring(0, 11)}`,
            userId: admin.id,
            type: 'system',
            title: 'Legal Document Dates Updated',
            message,
            data: updateInfo,
            read: false,
            createdAt: new Date().toISOString(),
          })
        )
      );

      this.logger.info('Admin notifications sent', {
        count: admins.length,
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
    };
  }
}

module.exports = DateManagementService;
