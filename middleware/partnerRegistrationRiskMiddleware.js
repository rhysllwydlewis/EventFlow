'use strict';

const logger = require('../utils/logger');
const riskService = require('../services/partnerRegistrationRiskService');

function registrationTarget(req) {
  if (req.method !== 'POST') return null;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (/\/api\/(?:v1\/)?partner\/register\/?$/.test(path)) {
    return { role: 'partner', email: req.body?.email, refCode: null, preBlock: true };
  }
  if (/\/api\/(?:v1\/)?auth\/register\/?$/.test(path) && req.body?.role === 'supplier') {
    return {
      role: 'supplier',
      email: req.body?.email,
      refCode: req.body?.ref,
      preBlock: true,
    };
  }
  if (/\/api\/(?:v1\/)?auth\/google\/?$/.test(path) && req.body?.role === 'supplier') {
    return { role: 'supplier', email: null, refCode: req.body?.ref, preBlock: false };
  }
  return null;
}

function partnerRegistrationRiskMiddleware(req, res, next) {
  const target = registrationTarget(req);
  if (!target) return next();

  const originalJson = res.json.bind(res);
  let completed = false;
  res.json = body => {
    if (!completed && res.statusCode >= 200 && res.statusCode < 300 && body?.user?.id) {
      completed = true;
      const assessment = req.partnerRegistrationRisk;
      if (assessment) {
        riskService.completeRegistrationRisk(req, body.user.id).catch(error =>
          logger.error('[PARTNER-IDENTITY-RISK] Failed to finalise registration risk', {
            userId: body.user.id,
            error: error.message,
          })
        );
      } else if (target.role === 'supplier' && body.user.email) {
        // Google sign-up is already backed by an authoritative Google email. Assess it
        // after account creation so device/network signals are still captured without
        // trying to decode the Google credential in middleware.
        riskService
          .assessRegistration({
            req,
            email: body.user.email,
            role: 'supplier',
            refCode: target.refCode,
          })
          .then(googleAssessment => {
            req.partnerRegistrationRisk = googleAssessment;
            return riskService.completeRegistrationRisk(req, body.user.id);
          })
          .catch(error =>
            logger.warn('[PARTNER-IDENTITY-RISK] Google registration assessment failed', {
              userId: body.user.id,
              error: error.message,
            })
          );
      }
    }
    return originalJson(body);
  };

  if (!target.preBlock) return next();
  return riskService.registrationRiskGuard({ roleResolver: () => target.role })(req, res, next);
}

partnerRegistrationRiskMiddleware._private = { registrationTarget };

module.exports = partnerRegistrationRiskMiddleware;
