/**
 * Maintenance Routes
 * Public maintenance-mode message endpoint.
 *
 * Split out of routes/misc.js (Effort 3.1 — route structure cleanup).
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();

let dbUnified;

function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Maintenance routes: dependencies object is required');
  }
  if (deps.dbUnified === undefined) {
    throw new Error('Maintenance routes: missing required dependency: dbUnified');
  }
  dbUnified = deps.dbUnified;
}

router.get('/maintenance/message', async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const maintenance = settings.maintenance || {
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    };

    // Return public maintenance information
    res.json({
      enabled: maintenance.enabled,
      message: maintenance.message,
    });
  } catch (error) {
    logger.error('Error reading maintenance message:', error);
    // Return default message on error
    res.status(200).json({
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
