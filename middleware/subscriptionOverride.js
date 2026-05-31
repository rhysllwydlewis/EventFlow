'use strict';

function subscriptionOverrideMiddleware() {
  return async (req, res, next) => next();
}

module.exports = { subscriptionOverrideMiddleware };
