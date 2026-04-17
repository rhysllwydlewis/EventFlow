/**
 * Local ESLint plugin entry-point.
 * Exposes custom in-repo rules under the `eventflow-local/*` namespace.
 */
'use strict';

module.exports = {
  rules: {
    'no-direct-notifications': require('./no-direct-notifications'),
  },
};
