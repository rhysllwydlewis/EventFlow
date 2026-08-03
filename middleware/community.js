/**
 * EventFlow Community — request middleware
 *
 * Availability, viewer context, age declaration and posting-rights gates shared
 * by every community router.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const community = require('../services/community.service');

/**
 * Reject every request when the community is switched off.
 * @param {Object} req Express request.
 * @param {Object} res Express response.
 * @param {Function} next Express next.
 * @returns {Promise<void>} Resolves once handled.
 */
async function requireCommunityEnabled(req, res, next) {
  try {
    if (!(await community.isCommunityEnabled())) {
      return res
        .status(404)
        .json({ error: 'Not found', message: 'The community is not available.' });
    }
    return next();
  } catch (error) {
    logger.error('Community availability check failed:', error);
    return res.status(503).json({ error: 'Service unavailable' });
  }
}

/**
 * Load the caller's posting context once per request.
 * @param {Object} req Express request.
 * @param {Object} res Express response.
 * @param {Function} next Express next.
 * @returns {Promise<void>} Resolves once handled.
 */
async function attachViewer(req, res, next) {
  const anonymous = { user: null, role: 'member', trustTier: 'restricted', restriction: null };
  try {
    if (!req.user || !req.user.id) {
      req.viewer = anonymous;
      return next();
    }
    const dbUser = await dbUnified.findOne('users', { id: req.user.id });
    if (!dbUser) {
      req.viewer = anonymous;
      return next();
    }
    req.viewer = await community.getPostingContext(dbUser);
    req.dbUser = dbUser;
    return next();
  } catch (error) {
    logger.error('Could not load community viewer context:', error);
    req.viewer = anonymous;
    return next();
  }
}

/**
 * Gate requiring the caller to have declared they are an adult, matching the
 * platform's published 18+ policy. This is a proportionate self-declaration,
 * not formal age verification — see docs/compliance/community-child-access-assessment.md.
 * @param {Object} req Express request.
 * @param {Object} res Express response.
 * @param {Function} next Express next.
 * @returns {Promise<void>} Resolves once handled.
 */
async function requireAdultDeclaration(req, res, next) {
  try {
    const settings = await community.getSettings();
    if (settings.requireAdultDeclaration === false) {
      return next();
    }
    const user = req.dbUser || (await dbUnified.findOne('users', { id: req.user.id }));
    const declared = Boolean(
      user &&
      (user.adultDeclaration === true ||
        user.isAdult === true ||
        user.ageConfirmed === true ||
        user.communityAdultDeclaredAt)
    );
    if (!declared) {
      return res.status(403).json({
        error: 'Adult declaration required',
        code: 'ADULT_DECLARATION_REQUIRED',
        message:
          'EventFlow is an 18+ service. Confirm you are 18 or over before posting in the community.',
        confirmUrl: '/api/v1/community/me/adult-declaration',
      });
    }
    return next();
  } catch (error) {
    logger.error('Adult declaration check failed:', error);
    return res.status(503).json({ error: 'Service unavailable' });
  }
}

/**
 * Block members whose community access is suspended or read-only. The response
 * says plainly what has happened and how to appeal: EventFlow does not use
 * silent shadow bans.
 * @param {Object} req Express request.
 * @param {Object} res Express response.
 * @param {Function} next Express next.
 * @returns {void} Nothing.
 */
function requirePostingRights(req, res, next) {
  const restriction = req.viewer && req.viewer.restriction;
  if (!restriction) {
    return next();
  }
  if (restriction.type === 'suspended' || restriction.type === 'read_only') {
    return res.status(403).json({
      error: 'Community access restricted',
      code: 'COMMUNITY_RESTRICTED',
      message:
        restriction.publicReason ||
        'Your ability to post in the community is currently restricted. You can appeal this decision.',
      appealUrl: '/community/help#appeals',
      expiresAt: restriction.expiresAt || null,
    });
  }
  return next();
}

/**
 * Require moderator rights for the current request.
 * @param {Object} req Express request.
 * @param {Object} res Express response.
 * @param {Function} next Express next.
 * @returns {void} Nothing.
 */
function requireModerator(req, res, next) {
  if (!req.viewer || !req.viewer.user || !community.isModerator(req.viewer.user)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Moderator access required.' });
  }
  return next();
}

/**
 * Require senior-moderator rights for the current request.
 * @param {Object} req Express request.
 * @param {Object} res Express response.
 * @param {Function} next Express next.
 * @returns {void} Nothing.
 */
function requireSeniorModerator(req, res, next) {
  if (!req.viewer || !req.viewer.user || !community.isSeniorModerator(req.viewer.user)) {
    return res
      .status(403)
      .json({ error: 'Forbidden', message: 'Senior moderator access required.' });
  }
  return next();
}

module.exports = {
  requireCommunityEnabled,
  attachViewer,
  requireAdultDeclaration,
  requirePostingRights,
  requireModerator,
  requireSeniorModerator,
};
