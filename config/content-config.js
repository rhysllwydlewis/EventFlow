/**
 * Content Configuration
 * Centralized configuration for dates, company info, and content management
 */

'use strict';
const logger = require('../utils/logger.js');

/**
 * Get current year (for copyright and current date references)
 */
function getCurrentYear() {
  return new Date().getFullYear();
}

/**
 * Content configuration object
 * All placeholders used in HTML templates are defined here
 */
const contentConfig = {
  // Date Management
  dates: {
    currentYear: getCurrentYear(),
    copyrightYear: getCurrentYear(),
    // Legal document dates - update these when legal docs are revised
    legalLastUpdated: 'June 2026',
    legalEffectiveDate: 'January 2026',
    // Sitemap last modification date
    sitemapLastMod: new Date().toISOString().split('T')[0], // YYYY-MM-DD format

    // Automation fields for date management service
    autoUpdateEnabled: true, // Enable/disable automated monthly updates
    lastAutoCheck: null, // Last time automated check ran
    lastManualUpdate: null, // Last time admin manually updated dates
  },

  // Company Information
  // ─────────────────────────────────────────────────────────────────────────────
  // IMPORTANT: The fields below contain intentional defaults that MUST be replaced
  // before production launch. Set the corresponding environment variables, or
  // update the fallback strings directly. Leaving these defaults in production
  // will trigger a startup warning.
  // ─────────────────────────────────────────────────────────────────────────────
  company: {
    name: 'EventFlow Limited',
    nameLegal: 'EventFlow Limited',
    legalName: 'EventFlow Limited',

    // Company registration details
    // Set via environment variables in production
    registrationNumber: process.env.COMPANY_NUMBER || 'REPLACE_ME_COMPANY_NUMBER',
    companyNumber: process.env.COMPANY_NUMBER || 'REPLACE_ME_COMPANY_NUMBER',

    // Registered office address
    registeredOffice: process.env.REGISTERED_OFFICE || 'REPLACE_ME_REGISTERED_OFFICE',

    // VAT registration
    vatNumber: '[Not currently VAT registered]', // Update if/when VAT registered

    placeOfRegistration: 'England and Wales',
    tradingName: 'EventFlow',
  },

  // Contact Information
  // ─────────────────────────────────────────────────────────────────────────────
  // IMPORTANT: Phone number and address fields below are intentional defaults
  // that MUST be replaced before production launch via environment variables.
  // ─────────────────────────────────────────────────────────────────────────────
  contact: {
    supportEmail: 'support@event-flow.co.uk',
    adminEmail: 'admin@event-flow.co.uk',
    abuseEmail: 'abuse@event-flow.co.uk',
    salesEmail: 'sales@event-flow.co.uk',
    privacyEmail: 'privacy@event-flow.co.uk',
    securityEmail: 'security@event-flow.co.uk',

    // Business phone number
    phone: process.env.BUSINESS_PHONE || 'REPLACE_ME_BUSINESS_PHONE',

    // Business address (for legal/contact pages)
    address: {
      line1: process.env.BUSINESS_ADDRESS_LINE1 || 'REPLACE_ME_ADDRESS_LINE1',
      line2: process.env.BUSINESS_ADDRESS_LINE2 || '',
      city: process.env.BUSINESS_CITY || 'REPLACE_ME_CITY',
      postcode: process.env.BUSINESS_POSTCODE || 'REPLACE_ME_POSTCODE',
      country: 'United Kingdom',
    },
  },

  // Website URLs
  urls: {
    domain: 'event-flow.co.uk',
    websiteUrl: 'https://event-flow.co.uk',
    legalHub: 'https://event-flow.co.uk/legal.html',
    termsUrl: 'https://event-flow.co.uk/terms.html',
    privacyUrl: 'https://event-flow.co.uk/privacy.html',
  },

  // Feature Flags (for progressive rollout)
  features: {
    marketplaceEnabled: true,
    aiAssistantEnabled: false,
    videoCallsEnabled: false,
  },

  // Version Management
  version: {
    contentVersion: '1.0.0',
    lastContentUpdate: new Date().toISOString(),
  },
};

/**
 * Get all placeholder values as a flat object for template replacement
 * @returns {Object} Flat object with all placeholder key-value pairs
 */
function getPlaceholders() {
  return {
    // Date placeholders
    CURRENT_YEAR: contentConfig.dates.currentYear.toString(),
    COPYRIGHT_YEAR: contentConfig.dates.copyrightYear.toString(),
    LEGAL_LAST_UPDATED: contentConfig.dates.legalLastUpdated,
    LEGAL_EFFECTIVE_DATE: contentConfig.dates.legalEffectiveDate,
    SITEMAP_LAST_MOD: contentConfig.dates.sitemapLastMod,

    // Company placeholders
    COMPANY_NAME: contentConfig.company.name,
    COMPANY_NAME_LEGAL: contentConfig.company.nameLegal,
    COMPANY_LEGAL_NAME: contentConfig.company.legalName,
    COMPANY_REGISTRATION: contentConfig.company.registrationNumber,
    COMPANY_NUMBER: contentConfig.company.companyNumber,
    REGISTERED_OFFICE: contentConfig.company.registeredOffice,
    VAT_NUMBER: contentConfig.company.vatNumber,
    PLACE_OF_REGISTRATION: contentConfig.company.placeOfRegistration,
    TRADING_NAME: contentConfig.company.tradingName,

    // Contact placeholders
    SUPPORT_EMAIL: contentConfig.contact.supportEmail,
    ADMIN_EMAIL: contentConfig.contact.adminEmail,
    ABUSE_EMAIL: contentConfig.contact.abuseEmail,
    SALES_EMAIL: contentConfig.contact.salesEmail,
    PRIVACY_EMAIL: contentConfig.contact.privacyEmail,
    SECURITY_EMAIL: contentConfig.contact.securityEmail,
    BUSINESS_PHONE: contentConfig.contact.phone,
    COMPANY_ADDRESS_LINE1: contentConfig.contact.address.line1,
    COMPANY_ADDRESS_LINE2: contentConfig.contact.address.line2,
    COMPANY_ADDRESS_CITY: contentConfig.contact.address.city,
    COMPANY_ADDRESS_POSTCODE: contentConfig.contact.address.postcode,
    COMPANY_ADDRESS_COUNTRY: contentConfig.contact.address.country,

    // URL placeholders
    DOMAIN: contentConfig.urls.domain,
    WEBSITE_URL: contentConfig.urls.websiteUrl,
    LEGAL_HUB_URL: contentConfig.urls.legalHub,
    TERMS_URL: contentConfig.urls.termsUrl,
    PRIVACY_URL: contentConfig.urls.privacyUrl,
  };
}

/**
 * Update legal document dates
 * @param {string} lastUpdated - Last updated date (e.g., "January 2026")
 * @param {string} effectiveDate - Effective date (e.g., "January 2026")
 */
function updateLegalDates(lastUpdated, effectiveDate) {
  if (lastUpdated) {
    contentConfig.dates.legalLastUpdated = lastUpdated;
  }
  if (effectiveDate) {
    contentConfig.dates.legalEffectiveDate = effectiveDate;
  }
  contentConfig.version.lastContentUpdate = new Date().toISOString();
}

/**
 * Get content configuration
 * @returns {Object} Content configuration object
 */
function getConfig() {
  // Refresh current year on each call
  contentConfig.dates.currentYear = getCurrentYear();
  contentConfig.dates.copyrightYear = getCurrentYear();
  return contentConfig;
}

/**
 * Validate production configuration for placeholder values
 * Warns if production config contains placeholder values that need updating
 */
function validateProductionConfig() {
  // Only detect fields that are intentionally temporary placeholders needing replacement.
  // 'vatNumber' uses a permanent default ("[Not currently VAT registered]") that is NOT a
  // placeholder — it reflects the actual legal status and must not trigger a false warning.
  const placeholders = ['REPLACE_ME_'];

  const configStr = JSON.stringify(contentConfig);
  const foundPlaceholders = placeholders.filter(p => configStr.includes(p));

  if (foundPlaceholders.length > 0) {
    const strictValidation = process.env.CONTENT_CONFIG_STRICT === 'true';

    if (process.env.NODE_ENV === 'production' || strictValidation) {
      logger.warn('');
      logger.warn('⚠️  WARNING: Production config contains placeholder values!');
      logger.warn('⚠️  Update config/content-config.js or set environment variables before launch');
      logger.warn('⚠️  Found placeholders:', foundPlaceholders);
      logger.warn('');
      return;
    }

    logger.info(
      'ℹ️  Content config contains placeholder values that must be replaced before production launch.',
      { foundPlaceholders }
    );
  }
}

// Run validation on module load
validateProductionConfig();

module.exports = {
  getConfig,
  getPlaceholders,
  updateLegalDates,
  validateProductionConfig,
  contentConfig,
};
