from pathlib import Path
import json


def replace_once(path, old, new):
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Expected PR1 integration marker not found in {path}: {old[:100]!r}")
    file_path.write_text(text.replace(old, new, 1))


# Registration-risk persistence: count only primary attempts for velocity, store
# proper Mongo TTL Date fields, and audit failed allowed registrations.
replace_once(
    "services/partnerRegistrationRiskService.js",
    "  const allEvents = (await dbUnified.read('partner_abuse_events')) || [];\n  const windowEvents = recentEvents(allEvents, config.ipWindowHours, nowMs);",
    "  const allEvents = (await dbUnified.read('partner_abuse_events')) || [];\n  const primaryEvents = allEvents.filter(event => ['attempt', 'blocked'].includes(event.outcome));\n  const windowEvents = recentEvents(primaryEvents, config.ipWindowHours, nowMs);",
)
replace_once(
    "services/partnerRegistrationRiskService.js",
    "    expiresAt: eventExpiry(now, config.retentionDays),\n  };",
    "    expiresAt: eventExpiry(now, config.retentionDays),\n    expiresAtDate: new Date(eventExpiry(now, config.retentionDays)),\n  };",
)
replace_once(
    "services/partnerRegistrationRiskService.js",
    "        registrationRiskReviewRequired: assessment.action === 'review',",
    "        registrationRiskReviewRequired: assessment.action !== 'allow',",
)
replace_once(
    "services/partnerRegistrationRiskService.js",
    "    expiresAt: eventExpiry(now, days),\n  };",
    "    expiresAt: eventExpiry(now, days),\n    expiresAtDate: new Date(eventExpiry(now, days)),\n  };",
)
replace_once(
    "services/partnerRegistrationRiskService.js",
    "    expiresAt: eventExpiry(now, config.appealRetentionDays),\n  };",
    "    expiresAt: eventExpiry(now, config.appealRetentionDays),\n    expiresAtDate: new Date(eventExpiry(now, config.appealRetentionDays)),\n  };",
)

old_guard = """function registrationRiskGuard({ roleResolver } = {}) {
  return async (req, res, next) => {
    try {
      const resolvedRole = roleResolver ? roleResolver(req) : req.body?.role;
      if (!['partner', 'supplier'].includes(resolvedRole)) return next();
      const assessment = await assessRegistration({
        req,
        email: req.body?.email,
        role: resolvedRole,
        refCode: req.body?.ref,
      });
      req.partnerRegistrationRisk = assessment;
      if (assessment.action === 'block') {
        await recordRegistrationEvent({ assessment, outcome: 'blocked' });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(403).json({
          error: 'We could not complete this registration automatically.',
          code: 'REGISTRATION_RISK_BLOCKED',
          message:
            'Please contact Partner Programme support if you believe this registration was blocked in error.',
          appealPath: '/api/partner/abuse-appeals',
        });
      }
      await recordRegistrationEvent({ assessment, outcome: 'attempt' });
      return next();
    } catch (error) {
      logger.error('[PARTNER-IDENTITY-RISK] Registration assessment failed', {
        error: error.message,
      });
      if (process.env.PARTNER_ABUSE_FAIL_OPEN === 'true') return next();
      return res.status(503).json({
        error: 'Registration is temporarily unavailable. Please try again shortly.',
        code: 'REGISTRATION_RISK_UNAVAILABLE',
      });
    }
  };
}

async function completeRegistrationRisk(req, userId) {
  const assessment = req.partnerRegistrationRisk;
  if (!assessment) return null;
  await persistUserRegistrationRisk(userId, assessment);
  return recordRegistrationEvent({ assessment, outcome: 'created', userId });
}
"""
new_guard = """function registrationRiskGuard({ roleResolver } = {}) {
  return async (req, res, next) => {
    try {
      const resolvedRole = roleResolver ? roleResolver(req) : req.body?.role;
      if (!['partner', 'supplier'].includes(resolvedRole)) return next();
      const assessment = await assessRegistration({
        req,
        email: req.body?.email,
        role: resolvedRole,
        refCode: req.body?.ref,
      });
      req.partnerRegistrationRisk = assessment;
      req.partnerRegistrationRiskFinalized = false;
      if (assessment.action === 'block') {
        req.partnerRegistrationRiskFinalized = true;
        await recordRegistrationEvent({ assessment, outcome: 'blocked' });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(403).json({
          error: 'We could not complete this registration automatically.',
          code: 'REGISTRATION_RISK_BLOCKED',
          message:
            'Please contact Partner Programme support if you believe this registration was blocked in error.',
          appealPath: '/api/partner/abuse-appeals',
        });
      }
      await recordRegistrationEvent({ assessment, outcome: 'attempt' });
      res.once('finish', () => {
        if (req.partnerRegistrationRiskFinalized || res.statusCode < 400) return;
        req.partnerRegistrationRiskFinalized = true;
        recordRegistrationEvent({ assessment, outcome: 'failed' }).catch(error =>
          logger.warn('[PARTNER-IDENTITY-RISK] Failed registration audit did not persist', {
            error: error.message,
          })
        );
      });
      return next();
    } catch (error) {
      logger.error('[PARTNER-IDENTITY-RISK] Registration assessment failed', {
        error: error.message,
      });
      if (process.env.PARTNER_ABUSE_FAIL_OPEN === 'true') return next();
      return res.status(503).json({
        error: 'Registration is temporarily unavailable. Please try again shortly.',
        code: 'REGISTRATION_RISK_UNAVAILABLE',
      });
    }
  };
}

async function completeRegistrationRisk(req, userId) {
  const assessment = req.partnerRegistrationRisk;
  if (!assessment) return null;
  await persistUserRegistrationRisk(userId, assessment);
  const event = await recordRegistrationEvent({ assessment, outcome: 'created', userId });
  req.partnerRegistrationRiskFinalized = true;
  return event;
}
"""
replace_once("services/partnerRegistrationRiskService.js", old_guard, new_guard)

# Secure partner registration must shadow the older auto-verified handler.
replace_once(
    "routes/index.js",
    "  const partnerRoutes = require('./partner');\n  app.use('/api/v1/partner', partnerRoutes);\n  app.use('/api/partner', partnerRoutes); // Backward compatibility",
    "  const securePartnerRegistrationRoutes = require('./partner-registration-secure');\n  const partnerAbuseAppealRoutes = require('./partner-abuse-appeals');\n  const partnerRoutes = require('./partner');\n  app.use('/api/v1/partner', securePartnerRegistrationRoutes);\n  app.use('/api/partner', securePartnerRegistrationRoutes);\n  app.use('/api/v1/partner', partnerAbuseAppealRoutes);\n  app.use('/api/partner', partnerAbuseAppealRoutes);\n  app.use('/api/v1/partner', partnerRoutes);\n  app.use('/api/partner', partnerRoutes); // Backward compatibility",
)
replace_once(
    "routes/index.js",
    "  app.use('/api/admin/partners', adminPartnerRoutes); // Backward compatibility\n",
    "  app.use('/api/admin/partners', adminPartnerRoutes); // Backward compatibility\n\n  // Partner identity/network risk review, overrides and appeals.\n  const adminPartnerAbuseRoutes = require('./admin-partner-abuse');\n  app.use('/api/v1/admin/partner-abuse', adminPartnerAbuseRoutes);\n  app.use('/api/admin/partner-abuse', adminPartnerAbuseRoutes);\n",
)

# Supplier email/password registration: assess after normal CSRF/rate limiting and
# before bcrypt/email work, then persist the assessment before supplier provisioning.
replace_once(
    "routes/auth.js",
    "const userProvenance = require('../services/userProvenance.service');\n",
    "const userProvenance = require('../services/userProvenance.service');\nconst partnerRegistrationRisk = require('../services/partnerRegistrationRiskService');\n",
)
replace_once(
    "routes/auth.js",
    "const router = express.Router();\n",
    "const router = express.Router();\nconst supplierRegistrationRiskGuard = partnerRegistrationRisk.registrationRiskGuard({\n  roleResolver: req => (req.body?.role === 'supplier' ? 'supplier' : null),\n});\n",
)
replace_once(
    "routes/auth.js",
    "  registrationLimiter, // Tighter than authLimiter: each attempt triggers bcrypt + email send\n  async (req, res) => {",
    "  registrationLimiter, // Tighter than authLimiter: each attempt triggers bcrypt + email send\n  supplierRegistrationRiskGuard,\n  async (req, res) => {",
)
replace_once(
    "routes/auth.js",
    "    if (user.role === 'supplier') {\n      try {\n        await ensureSupplierProfileForUser(user);",
    "    if (user.role === 'supplier' && req.partnerRegistrationRisk) {\n      try {\n        await partnerRegistrationRisk.completeRegistrationRisk(req, user.id);\n      } catch (riskError) {\n        logger.error('[REGISTER] supplier registration risk metadata failed; rolling back user', {\n          userId: user.id,\n          error: riskError.message,\n        });\n        await dbUnified.deleteOne('users', { id: user.id });\n        return res.status(503).json({\n          error: 'Registration could not be completed safely. Please try again.',\n          code: 'REGISTRATION_RISK_UNAVAILABLE',\n        });\n      }\n    }\n\n    if (user.role === 'supplier') {\n      try {\n        await ensureSupplierProfileForUser(user);",
)

# Google supplier registration has an authoritative email after credential validation;
# assess it before insertion and then persist the result after a successful insert.
replace_once(
    "routes/auth.js",
    "      user = buildGoogleUser({\n        googleProfile,",
    "      if (roleFinal === 'supplier') {\n        try {\n          const googleRisk = await partnerRegistrationRisk.assessRegistration({\n            req,\n            email,\n            role: 'supplier',\n            refCode,\n          });\n          req.partnerRegistrationRisk = googleRisk;\n          req.partnerRegistrationRiskFinalized = false;\n          if (googleRisk.action === 'block') {\n            req.partnerRegistrationRiskFinalized = true;\n            await partnerRegistrationRisk.recordRegistrationEvent({ assessment: googleRisk, outcome: 'blocked' });\n            return res.status(403).json({\n              error: 'We could not complete this registration automatically.',\n              code: 'REGISTRATION_RISK_BLOCKED',\n              appealPath: '/api/partner/abuse-appeals',\n            });\n          }\n          await partnerRegistrationRisk.recordRegistrationEvent({ assessment: googleRisk, outcome: 'attempt' });\n        } catch (riskError) {\n          logger.error('[GOOGLE-AUTH] registration risk assessment failed', { error: riskError.message });\n          if (process.env.PARTNER_ABUSE_FAIL_OPEN !== 'true') {\n            return res.status(503).json({\n              error: 'Registration is temporarily unavailable. Please try again shortly.',\n              code: 'REGISTRATION_RISK_UNAVAILABLE',\n            });\n          }\n        }\n      }\n\n      user = buildGoogleUser({\n        googleProfile,",
)
replace_once(
    "routes/auth.js",
    "      if (roleFinal === 'supplier') {\n        await recordSupplierPartnerReferral(refCode, user);\n      }",
    "      if (roleFinal === 'supplier') {\n        try {\n          if (req.partnerRegistrationRisk) {\n            await partnerRegistrationRisk.completeRegistrationRisk(req, user.id);\n          }\n        } catch (riskError) {\n          logger.error('[GOOGLE-AUTH] risk metadata failed; rolling back new user', {\n            userId: user.id,\n            error: riskError.message,\n          });\n          await dbUnified.deleteOne('users', { id: user.id });\n          return res.status(503).json({\n            error: 'Registration could not be completed safely. Please try again.',\n            code: 'REGISTRATION_RISK_UNAVAILABLE',\n          });\n        }\n        await recordSupplierPartnerReferral(refCode, user);\n      }",
)

# Mongo collections and TTL indexes for pseudonymous evidence, overrides and appeals.
additional = """  {
    name: 'partner_abuse_events',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { createdAt: -1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
      { keys: { ipHash: 1, createdAt: -1 }, options: {} },
      { keys: { subnetHash: 1, createdAt: -1 }, options: {} },
      { keys: { browserHash: 1, createdAt: -1 }, options: {} },
      { keys: { deviceNetworkHash: 1, createdAt: -1 }, options: {} },
      { keys: { canonicalEmailHash: 1, createdAt: -1 }, options: {} },
      { keys: { referralCodeHash: 1, createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_abuse_overrides',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { subjectHash: 1, scope: 1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
      { keys: { createdAt: -1 }, options: {} },
    ],
  },
  {
    name: 'partner_abuse_appeals',
    indexes: [
      { keys: { id: 1 }, options: { unique: true } },
      { keys: { status: 1, createdAt: -1 }, options: {} },
      { keys: { emailIdentityHash: 1 }, options: {} },
      { keys: { expiresAtDate: 1 }, options: { expireAfterSeconds: 0 } },
    ],
  },
"""
replace_once(
    "db-init.js",
    "  {\n    name: 'partner_fraud_assessments',",
    additional + "  {\n    name: 'partner_fraud_assessments',",
)
replace_once(
    "db-init.js",
    "      'partner_fraud_assessments',\n",
    "      'partner_fraud_assessments',\n      'partner_abuse_events',\n      'partner_abuse_overrides',\n      'partner_abuse_appeals',\n",
)

# Stronger business identity comparison for reward and cashout review.
identity_helpers = r'''
function normalisePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

function normalisePostcode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function websiteHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function trigrams(value) {
  const clean = `  ${normalise(value)}  `;
  if (clean.length < 5) return new Set([clean]);
  const result = new Set();
  for (let index = 0; index <= clean.length - 3; index += 1) result.add(clean.slice(index, index + 3));
  return result;
}

function companySimilarity(left, right) {
  if (!left || !right) return 0;
  const a = trigrams(left);
  const b = trigrams(right);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function identityOverlap(left = {}, right = {}) {
  const leftCompany = left.company || left.companyName || left.businessName;
  const rightCompany = right.company || right.companyName || right.businessName;
  const exactCompany = Boolean(normalise(leftCompany) && normalise(leftCompany) === normalise(rightCompany));
  const fuzzyCompany = normalise(leftCompany).length >= 6 && normalise(rightCompany).length >= 6 && companySimilarity(leftCompany, rightCompany) >= 0.88;
  const leftPhone = normalisePhone(left.phone || left.phoneNumber || left.contactPhone);
  const rightPhone = normalisePhone(right.phone || right.phoneNumber || right.contactPhone);
  const samePhone = Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
  const leftWebsite = websiteHost(left.website || left.websiteUrl || left.domain);
  const rightWebsite = websiteHost(right.website || right.websiteUrl || right.domain);
  const sameWebsite = Boolean(leftWebsite && rightWebsite && leftWebsite === rightWebsite);
  const samePostcode = Boolean(normalisePostcode(left.postcode || left.postalCode) && normalisePostcode(left.postcode || left.postalCode) === normalisePostcode(right.postcode || right.postalCode));
  const leftCompanyNumber = normalise(left.companyNumber || left.companiesHouseNumber || left.registrationNumber);
  const rightCompanyNumber = normalise(right.companyNumber || right.companiesHouseNumber || right.registrationNumber);
  const sameCompanyNumber = Boolean(leftCompanyNumber && rightCompanyNumber && leftCompanyNumber === rightCompanyNumber);
  const leftVat = normalise(left.vatNumber || left.vatRegistrationNumber);
  const rightVat = normalise(right.vatNumber || right.vatRegistrationNumber);
  const sameVatNumber = Boolean(leftVat && rightVat && leftVat === rightVat);
  return {
    strongMatch: Boolean(exactCompany || samePhone || sameWebsite || sameCompanyNumber || sameVatNumber || (fuzzyCompany && samePostcode)),
    exactCompany,
    fuzzyCompany,
    samePhone,
    sameWebsite,
    samePostcode,
    sameCompanyNumber,
    sameVatNumber,
  };
}
'''
replace_once(
    "services/partnerAntiAbuseService.js",
    "function hoursBetween(earlier, later) {",
    identity_helpers + "\nfunction hoursBetween(earlier, later) {",
)
replace_once(
    "services/partnerAntiAbuseService.js",
    "    if (partnerUser.verified !== true) {\n      addSignal(signals, 'PARTNER_EMAIL_UNVERIFIED', 50, 'Partner email is not verified.');\n    }",
    "    if (partnerUser.verified !== true) {\n      addSignal(signals, 'PARTNER_EMAIL_UNVERIFIED', 50, 'Partner email is not verified.');\n    }\n    if (['review', 'high'].includes(partnerUser.registrationRiskLevel)) {\n      addSignal(signals, 'PARTNER_REGISTRATION_RISK', partnerUser.registrationRiskLevel === 'high' ? 35 : 20, 'Partner registration history contains unresolved identity or network risk.', { riskLevel: partnerUser.registrationRiskLevel, signalCodes: partnerUser.registrationRiskSignalCodes || [] });\n    }",
)
replace_once(
    "services/partnerAntiAbuseService.js",
    "  let weakReviewRewards = 0;\n",
    "  let weakReviewRewards = 0;\n  let riskyRegistrationSuppliers = 0;\n  let riskyUnverifiedPhones = 0;\n",
)
old_identity = """    const supplierDomain = emailDomain(supplierUser?.email);
    if (supplierDomain) {
      supplierDomains.set(supplierDomain, (supplierDomains.get(supplierDomain) || 0) + 1);
    }
    const supplierCompany = normalise(supplierUser?.company);
    if (
      (partnerDomain &&
        supplierDomain &&
        partnerDomain === supplierDomain &&
        !PUBLIC_EMAIL_DOMAINS.has(partnerDomain)) ||
      (partnerCompany && supplierCompany && partnerCompany === supplierCompany)
    ) {
      identityMatches += 1;
    }
"""
new_identity = """    const supplierDomain = emailDomain(supplierUser?.email);
    if (supplierDomain) {
      supplierDomains.set(supplierDomain, (supplierDomains.get(supplierDomain) || 0) + 1);
    }
    const supplierIdentity = identityOverlap(partnerUser || {}, {
      ...(supplierUser || {}),
      ...(approvedProfiles[0] || {}),
    });
    if (
      (partnerDomain &&
        supplierDomain &&
        partnerDomain === supplierDomain &&
        !PUBLIC_EMAIL_DOMAINS.has(partnerDomain)) ||
      supplierIdentity.strongMatch ||
      (supplierUser?.registrationRiskSignalCodes || []).includes('PARTNER_SUPPLIER_DEVICE_OVERLAP')
    ) {
      identityMatches += 1;
    }
    if (['review', 'high'].includes(supplierUser?.registrationRiskLevel)) {
      riskyRegistrationSuppliers += 1;
      if ((supplierUser?.phone || supplierUser?.phoneNumber) && supplierUser?.phoneVerified !== true) {
        riskyUnverifiedPhones += 1;
      }
    }
"""
replace_once("services/partnerAntiAbuseService.js", old_identity, new_identity)
replace_once(
    "services/partnerAntiAbuseService.js",
    "  if (identityMatches > 0) {",
    "  if (riskyRegistrationSuppliers > 0) {\n    addSignal(signals, 'RISKY_SUPPLIER_REGISTRATION_HISTORY', 25, 'Rewarded suppliers include registrations with unresolved identity or network risk.', { count: riskyRegistrationSuppliers });\n  }\n  if (riskyUnverifiedPhones > 0) {\n    addSignal(signals, 'RISKY_SUPPLIER_PHONE_UNVERIFIED', 10, 'Risk-flagged supplier accounts include unverified supplied phone numbers.', { count: riskyUnverifiedPhones });\n  }\n  if (identityMatches > 0) {",
)
replace_once(
    "services/partnerAntiAbuseService.js",
    "      weakReviewRewardCount: weakReviewRewards,\n",
    "      weakReviewRewardCount: weakReviewRewards,\n      riskyRegistrationSupplierCount: riskyRegistrationSuppliers,\n      riskyUnverifiedPhoneCount: riskyUnverifiedPhones,\n",
)
replace_once(
    "services/partnerAntiAbuseService.js",
    "  isIndependentVerifiedReview,\n};",
    "  isIndependentVerifiedReview,\n  identityOverlap,\n  companySimilarity,\n  websiteHost,\n};",
)
needle = """  if (!approvedProfiles.length) {
    return {
      eligible: false,
      reason: 'SUPPLIER_PROFILE_NOT_APPROVED',
      supplier,
      referral,
      partner,
    };
  }

  if (methodName === 'awardPackageBonus') {"""
replacement = """  if (!approvedProfiles.length) {
    return {
      eligible: false,
      reason: 'SUPPLIER_PROFILE_NOT_APPROVED',
      supplier,
      referral,
      partner,
    };
  }

  const businessIdentity = identityOverlap(partnerUser, { ...supplier, ...approvedProfiles[0] });
  if (businessIdentity.strongMatch) {
    return {
      eligible: false,
      reason: 'POSSIBLE_SELF_REFERRAL',
      supplier,
      referral,
      partner,
      evidence: businessIdentity,
    };
  }

  if (methodName === 'awardPackageBonus') {"""
replace_once("services/partnerAntiAbuseService.js", needle, replacement)

# Privacy notice.
privacy_insert = """      <h3 class=\"h5\">2.6 Fraud and Abuse Prevention Data</h3>
      <p>For Partner Programme and supplier registration security, we may process technical signals to detect fake accounts, self-referrals, automated registrations and coordinated abuse.</p>
      <ul>
        <li><strong>Pseudonymous Network Signals:</strong> HMAC-protected representations of IP addresses and network ranges used for short-term correlation and registration velocity checks.</li>
        <li><strong>Pseudonymous Browser Signals:</strong> Browser type, language and standard browser client hints combined into a protected signature. This is a risk signal and is not treated as proof that two people are the same person.</li>
        <li><strong>Email Integrity Signals:</strong> Protected email identity and domain representations used to detect known disposable email services and common alias-reuse patterns.</li>
        <li><strong>Optional Network Reputation:</strong> Where configured, a specialist provider may assess an IP address for proxy, VPN, Tor, hosting/datacentre or abuse-reputation indicators. Shared networks or ordinary VPN use are not, by themselves, treated as proof of fraud.</li>
        <li><strong>Decision Evidence:</strong> Risk scores, reason codes, administrative review notes and temporary overrides used to explain and audit anti-abuse decisions.</li>
      </ul>
      <p>Partner anti-abuse technical event evidence is normally retained for up to 90 days (unless a different documented operational period is configured). Appeals are normally retained for up to 180 days so that we can investigate and respond. We provide a review/appeal route where automated controls block a registration.</p>

      <h3 class=\"h5\">2.7 Marketplace Data</h3>"""
replace_once(
    "public/privacy.html",
    '      <h3 class="h5">2.6 Marketplace Data</h3>',
    privacy_insert,
)
replace_once(
    "public/privacy.html",
    "        <li>Detecting and preventing fraud, abuse, and security threats</li>",
    "        <li>Detecting and preventing fraud, abuse, and security threats</li>\n        <li>Using proportionate pseudonymous device, network and identity signals to protect the Partner Programme from coordinated or automated abuse</li>",
)

# Permanent focused smoke coverage.
package_path = Path("package.json")
package = json.loads(package_path.read_text())
smoke = package["scripts"]["test:smoke"]
for test in [
    "tests/unit/partner-registration-risk.test.js",
    "tests/unit/partner-registration-secure.test.js",
]:
    if test not in smoke:
        smoke += f" {test}"
package["scripts"]["test:smoke"] = smoke
package_path.write_text(json.dumps(package, indent=2) + "\n")

# The abandoned global middleware prototype is intentionally not part of PR1.
Path("middleware/partnerRegistrationRiskMiddleware.js").unlink(missing_ok=True)
