'use strict';

function isCriticalDeliveryFailure(result) {
  if (!result) return true;
  const provider = result.provider || result.emailProvider || null;
  const status = result.status || result.emailLogStatus || null;
  if (provider === 'outbox') return true;
  if (status === 'disabled') return true;
  return false;
}

function assertCriticalDelivery(result, label) {
  if (process.env.NODE_ENV !== 'production') return result;
  if (!isCriticalDeliveryFailure(result)) return result;
  const error = new Error(`${label || 'Critical email'} was not delivered by Postmark in production.`);
  error.code = 'CRITICAL_EMAIL_NOT_DELIVERED';
  throw error;
}

module.exports = {
  isCriticalDeliveryFailure,
  assertCriticalDelivery,
};
