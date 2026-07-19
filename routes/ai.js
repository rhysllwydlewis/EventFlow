'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimits');

const router = express.Router();

const RETIRED_RESPONSE = Object.freeze({
  error: 'The legacy EventFlow AI planner has been retired.',
  code: 'AI_PLANNER_RETIRED',
  assistant: 'JadeAssist',
  message: 'Use the supported Jade assistant in the EventFlow interface.',
});

function retiredPlanner(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json(RETIRED_RESPONSE);
}

// Preserve the established authentication and rate-limit boundary while making
// the retirement explicit to any undiscovered legacy callers.
router.post('/suggestions', aiLimiter, authRequired, retiredPlanner);
router.post('/plan', aiLimiter, authRequired, retiredPlanner);

// server.js still calls this hook for backwards compatibility with the former
// OpenAI-backed implementation. Keeping a no-op hook avoids a deployment-order
// change while ensuring this module has no hidden runtime dependency on OpenAI.
function initializeDependencies() {}

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
module.exports.RETIRED_RESPONSE = RETIRED_RESPONSE;
