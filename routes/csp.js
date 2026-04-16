/**
 * CSP Reporting Route
 * Receives `application/csp-report` violation reports from the browser.
 *
 * Split out of routes/misc.js (Effort 3.1 — route structure cleanup).
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();

router.post('/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  logger.warn('CSP Violation:', req.body);
  res.status(204).end();
});

module.exports = router;
// No dependencies — exported as a no-op for API symmetry with sibling route modules
module.exports.initializeDependencies = function initializeDependencies() {};
