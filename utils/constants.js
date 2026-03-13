/**
 * Shared Application Constants
 * Single source of truth for values used across multiple modules
 */

'use strict';

/**
 * Canonical placeholder image shown when a package has no uploaded photo.
 * All server-side resolvers and client-side fallbacks should reference this path.
 */
const PLACEHOLDER_PACKAGE_IMAGE = '/assets/images/placeholders/package-event.svg';

module.exports = {
  PLACEHOLDER_PACKAGE_IMAGE,
};
