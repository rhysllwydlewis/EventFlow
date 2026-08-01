'use strict';

const dbUnified = require('../db-unified');

const PLACEHOLDER_PROFILE_TEXT = new Set([
  'test',
  'testing',
  'sample',
  'placeholder',
  'coming soon',
  'tbc',
  'tbd',
  'n/a',
  'na',
  'none',
]);

const numberEnv = (name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const booleanEnv = (name, fallback = false) => {
  const raw = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const getConfig = () => {
  return {
    minDescriptionLength: numberEnv('PARTNER_REWARD_SUPPLIER_MIN_DESCRIPTION_LENGTH', 40, 0, 500),
    packageRequireCustomerInteraction: booleanEnv(
      'PARTNER_REWARD_PACKAGE_REQUIRE_CUSTOMER_INTERACTION',
      false
    ),
  };
};

const meaningful = value => {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return Boolean(text && !PLACEHOLDER_PROFILE_TEXT.has(text));
};

const hasSocialEvidence = profile => {
  if (!profile?.socials || typeof profile.socials !== 'object') return false;
  return Object.values(profile.socials).some(value =>
    /^https?:\/\//i.test(String(value || '').trim())
  );
};

const contactEvidence = (profile, user = {}) => {
  const candidates = [
    profile.website,
    profile.phone,
    profile.companyNumber,
    profile.companiesHouseNumber,
    profile.registrationNumber,
    profile.vatNumber,
    user.website,
    user.phone,
    user.companyNumber,
    user.vatNumber,
  ];
  return candidates.some(meaningful) || hasSocialEvidence(profile);
};

const supplierProfileEvidence = async supplierUserId => {
  const config = getConfig();
  const [user, profiles] = await Promise.all([
    dbUnified.findOne('users', { id: supplierUserId }),
    dbUnified.find('suppliers', { ownerUserId: supplierUserId }),
  ]);
  const approved = (profiles || []).filter(
    profile =>
      profile?.approved === true &&
      profile.suspended !== true &&
      String(profile.status || '').toLowerCase() !== 'suspended'
  );
  if (!approved.length) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };

  for (const profile of approved) {
    const name = profile.name || profile.businessName || profile.companyName || user?.company;
    const category = profile.category || profile.primaryCategoryKey;
    const description = String(profile.description || '').trim();
    const location = profile.location || profile.postcode || profile.postalCode;
    if (!meaningful(name)) continue;
    if (!meaningful(category)) continue;
    if (description.length < config.minDescriptionLength || !meaningful(description)) continue;
    if (!meaningful(location)) continue;
    if (!contactEvidence(profile, user || {})) continue;
    return {
      eligible: true,
      supplierId: profile.id,
      evidence: {
        hasBusinessName: true,
        hasCategory: true,
        descriptionLength: description.length,
        hasLocation: true,
        hasContactEvidence: true,
      },
    };
  }

  return {
    eligible: false,
    reason: 'SUPPLIER_PROFILE_EVIDENCE_INCOMPLETE',
    evidence: { requiredDescriptionLength: config.minDescriptionLength },
  };
};

const packageInteractionEvidence = async supplierUserId => {
  const config = getConfig();
  if (!config.packageRequireCustomerInteraction) return { eligible: true };

  const profiles = await dbUnified.find('suppliers', { ownerUserId: supplierUserId });
  const supplierIds = new Set((profiles || []).map(profile => profile.id).filter(Boolean));
  if (!supplierIds.size) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };

  const [threads, messages] = await Promise.all([
    dbUnified.read('threads'),
    dbUnified.read('messages'),
  ]);
  const threadIds = new Set(
    (threads || [])
      .filter(thread => supplierIds.has(thread.supplierId) && thread.customerId)
      .map(thread => thread.id)
  );
  const interaction = (messages || []).find(message => {
    if (!threadIds.has(message.threadId) || message.isDraft === true) return false;
    const senderId = message.senderId || message.fromUserId;
    return senderId && senderId !== supplierUserId;
  });
  return interaction
    ? { eligible: true, interactionMessageId: interaction.id || null }
    : { eligible: false, reason: 'PACKAGE_CUSTOMER_INTERACTION_MISSING' };
};

const methodRewardEvidence = async ({ supplierUserId, methodName }) => {
  const profile = await supplierProfileEvidence(supplierUserId);
  if (!profile.eligible) return profile;
  if (methodName === 'awardPackageBonus') {
    const interaction = await packageInteractionEvidence(supplierUserId);
    if (!interaction.eligible) return interaction;
  }
  return { eligible: true, supplierId: profile.supplierId };
};

module.exports = {
  getConfig,
  supplierProfileEvidence,
  packageInteractionEvidence,
  methodRewardEvidence,
  _test: { meaningful, contactEvidence, hasSocialEvidence, booleanEnv },
};
