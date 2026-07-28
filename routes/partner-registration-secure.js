'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');

const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { csrfProtection } = require('../middleware/csrf');
const { registrationLimiter } = require('../middleware/rateLimits');
const { passwordOk } = require('../middleware/validation');
const partnerService = require('../services/partnerService');
const postmark = require('../utils/postmark');
const tokenUtils = require('../utils/token');
const userProvenance = require('../services/userProvenance.service');
const { notifyAdmins } = require('../services/notifyAdmins.service');
const registrationRisk = require('../services/partnerRegistrationRiskService');

const router = express.Router();

function getBaseUrl(req) {
  return process.env.BASE_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

const partnerRegistrationRiskGuard = registrationRisk.registrationRiskGuard({
  roleResolver: () => 'partner',
});

router.post(
  '/register',
  registrationLimiter,
  csrfProtection,
  partnerRegistrationRiskGuard,
  async (req, res) => {
    try {
      const { firstName, lastName, email, password, location, company } = req.body || {};
      const cleanFirstName = String(firstName || '')
        .trim()
        .slice(0, 40);
      const cleanLastName = String(lastName || '')
        .trim()
        .slice(0, 40);
      const cleanEmail = String(email || '')
        .trim()
        .toLowerCase();
      const cleanLocation = String(location || '')
        .trim()
        .slice(0, 100);
      const cleanCompany = String(company || '')
        .trim()
        .slice(0, 100);

      if (!cleanFirstName || !cleanLastName) {
        return res.status(400).json({ error: 'First name and last name are required' });
      }
      if (!validator.isEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Valid email address is required' });
      }
      if (!password || !passwordOk(password)) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters and include letters and numbers',
        });
      }
      if (!cleanLocation) return res.status(400).json({ error: 'Location is required' });

      if (await dbUnified.findOne('users', { email: cleanEmail })) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const now = new Date().toISOString();
      const user = {
        id: uid('usr'),
        firstName: cleanFirstName,
        lastName: cleanLastName,
        name: `${cleanFirstName} ${cleanLastName}`,
        email: cleanEmail,
        role: 'partner',
        passwordHash: await bcrypt.hash(password, 10),
        location: cleanLocation,
        company: cleanCompany || undefined,
        verified: false,
        emailVerified: false,
        notify_account: true,
        createdAt: now,
        updatedAt: now,
        ...userProvenance.emailPasswordPendingProvenance(),
      };

      const verificationToken = tokenUtils.generateVerificationToken(user, { expiresInHours: 24 });
      user.verificationToken = verificationToken;
      user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      try {
        const sendResult = await postmark.sendVerificationEmail(user, verificationToken);
        Object.assign(user, userProvenance.metadataFromSendResult(sendResult));
      } catch (emailError) {
        logger.error('[PARTNER-REGISTER] Verification email failed', { error: emailError.message });
        return res.status(500).json({
          error: 'Failed to send verification email. Please try again later.',
        });
      }

      const inserted = await dbUnified.insertOne('users', user);
      if (!inserted) {
        return res
          .status(500)
          .json({ error: 'Failed to create partner account. Please try again.' });
      }

      try {
        await registrationRisk.completeRegistrationRisk(req, user.id);
      } catch (riskError) {
        logger.error('[PARTNER-REGISTER] Risk metadata failed; rolling back user', {
          userId: user.id,
          error: riskError.message,
        });
        await dbUnified.deleteOne('users', { id: user.id });
        return res
          .status(503)
          .json({ error: 'Registration could not be completed safely. Please retry.' });
      }

      let partner;
      try {
        partner = await partnerService.createPartner(user.id);
      } catch (partnerError) {
        logger.error('[PARTNER-REGISTER] Partner record creation failed; rolling back user', {
          userId: user.id,
          error: partnerError.message,
        });
        await dbUnified.deleteOne('users', { id: user.id });
        throw partnerError;
      }

      const baseUrl = getBaseUrl(req);
      const refLink = `${baseUrl}/auth?ref=${partner.refCode}&role=supplier`;

      postmark
        .sendMail({
          to: user.email,
          subject: 'Welcome to the EventFlow Partner Programme',
          template: 'partner-welcome',
          templateData: {
            name: user.firstName,
            refCode: partner.refCode,
            refLink,
            dashboardLink: `${baseUrl}/partner/dashboard`,
          },
          from: postmark.FROM_HELLO,
          tags: ['partner-welcome', 'transactional'],
          messageStream: 'outbound',
        })
        .catch(error => logger.warn('Partner welcome email failed:', error.message));

      notifyAdmins({
        type: 'system',
        title: 'New Partner Registration — verification pending',
        message: `${user.name} joined the Partner Programme and must verify their email before rewards can qualify (code: ${partner.refCode})`,
        actionUrl: `/admin-user-detail?id=${user.id}`,
        actionText: 'View Partner',
        priority: 'normal',
        metadata: { partnerId: partner.id, userId: user.id, refCode: partner.refCode },
      }).catch(() => {});

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.status(201).json({
        ok: true,
        requiresVerification: true,
        message: 'Check your email to verify your address before signing in.',
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        partner: { refCode: partner.refCode },
      });
    } catch (error) {
      logger.error('Error registering partner securely:', error);
      return res.status(500).json({ error: 'Failed to create partner account. Please try again.' });
    }
  }
);

module.exports = router;
