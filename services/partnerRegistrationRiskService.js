'use strict';

const crypto = require('crypto');
const net = require('net');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const logger = require('../utils/logger');

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_APPEAL_RETENTION_DAYS = 180;
const DEFAULT_REVIEW_SCORE = 35;
const DEFAULT_BLOCK_SCORE = 70;
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);
const ALIAS_NORMALISED_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
]);
const DEFAULT_DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'dispostable.com',
  'emailondeck.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);
const HEADLESS_PATTERNS = [
  /headlesschrome/i,
  /phantomjs/i,
  /selenium/i,
  /playwright/i,
  /puppeteer/i,
  /webdriver/i,
];
const ALLOWED_MODES = new Set(['off', 'monitor', 'enforce']);

function numberEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getConfig() {
  const configuredMode = String(process.env.PARTNER_ABUSE_ENFORCEMENT_MODE || 'enforce')
    .trim()
    .toLowerCase();
  return {
    mode: ALLOWED_MODES.has(configuredMode) ? configuredMode : 'enforce',
    retentionDays: numberEnv('PARTNER_ABUSE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS, 7, 365),
    appealRetentionDays: numberEnv(
      'PARTNER_ABUSE_APPEAL_RETENTION_DAYS',
      DEFAULT_APPEAL_RETENTION_DAYS,
      30,
      365
    ),
    reviewScore: numberEnv('PARTNER_ABUSE_REVIEW_SCORE', DEFAULT_REVIEW_SCORE, 1, 100),
    blockScore: numberEnv('PARTNER_ABUSE_BLOCK_SCORE', DEFAULT_BLOCK_SCORE, 1, 100),
    ipWindowHours: numberEnv('PARTNER_ABUSE_IP_WINDOW_HOURS', 24, 1, 168),
    ipRegistrationMax: numberEnv('PARTNER_ABUSE_IP_REGISTRATION_MAX', 8, 2, 100),
    subnetRegistrationMax: numberEnv('PARTNER_ABUSE_SUBNET_REGISTRATION_MAX', 20, 4, 500),
    browserRegistrationMax: numberEnv('PARTNER_ABUSE_BROWSER_REGISTRATION_MAX', 4, 2, 50),
    deviceNetworkRegistrationMax: numberEnv(
      'PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX',
      4,
      2,
      50
    ),
    referralRegistrationMax: numberEnv('PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX', 12, 2, 200),
    domainRegistrationMax: numberEnv('PARTNER_ABUSE_DOMAIN_REGISTRATION_MAX', 20, 4, 500),
    externalReputationTimeoutMs: numberEnv(
      'PARTNER_ABUSE_IP_REPUTATION_TIMEOUT_MS',
      1500,
      250,
      5000
    ),
  };
}

function getHashSecret() {
  const configured =
    process.env.PARTNER_ABUSE_HASH_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PARTNER_ABUSE_HASH_SECRET (or JWT_SECRET/SESSION_SECRET fallback) is required in production'
    );
  }
  return 'eventflow-partner-abuse-development-only';
}

function hmac(kind, value) {
  if (!value) return null;
  return crypto
    .createHmac('sha256', getHashSecret())
    .update(`v1:${kind}:${String(value)}`)
    .digest('hex');
}

function normaliseEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function splitEmail(email) {
  const value = normaliseEmail(email);
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return { local: '', domain: '' };
  return { local: value.slice(0, at), domain: value.slice(at + 1) };
}

function canonicalIdentityEmail(email) {
  let { local, domain } = splitEmail(email);
  if (!local || !domain) return '';
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (ALIAS_NORMALISED_DOMAINS.has(domain)) {
    local = local.split('+')[0];
  }
  if (domain === 'gmail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

function emailDomain(email) {
  return splitEmail(email).domain;
}

function disposableDomains() {
  const extra = String(process.env.PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_DISPOSABLE_DOMAINS, ...extra]);
}

function isDisposableEmail(email) {
  const domain = emailDomain(email);
  return Boolean(domain && disposableDomains().has(domain));
}

function normaliseIp(value) {
  let ip = String(value || '')
    .split(',')[0]
    .trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex > -1) ip = ip.slice(0, zoneIndex);
  return net.isIP(ip) ? ip.toLowerCase() : '';
}

function subnetForIp(ip) {
  const clean = normaliseIp(ip);
  const version = net.isIP(clean);
  if (version === 4) {
    const parts = clean.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (version === 6) {
    const head = clean.split(':').slice(0, 4).join(':');
    return `${head}::/64`;
  }
  return '';
}

function requestIp(req) {
  return normaliseIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '');
}

function header(req, name) {
  const value = req.get ? req.get(name) : req.headers?.[String(name).toLowerCase()];
  return String(value || '')
    .trim()
    .slice(0, 512);
}

function browserSignature(req) {
  return [
    header(req, 'user-agent'),
    header(req, 'accept-language'),
    header(req, 'sec-ch-ua'),
    header(req, 'sec-ch-ua-platform'),
    header(req, 'sec-ch-ua-mobile'),
  ].join('|');
}

function isHeadlessRequest(req) {
  const userAgent = header(req, 'user-agent');
  return HEADLESS_PATTERNS.some(pattern => pattern.test(userAgent));
}

function extractRequestSignals(req, { email, refCode } = {}) {
  const ip = requestIp(req);
  const subnet = subnetForIp(ip);
  const signature = browserSignature(req);
  const exactEmail = normaliseEmail(email);
  const canonicalEmail = canonicalIdentityEmail(email);
  const domain = emailDomain(email);
  const referralCode = String(refCode || '')
    .trim()
    .toUpperCase();
  return {
    ip,
    ipHash: hmac('ip', ip),
    subnetHash: hmac('subnet', subnet),
    browserHash: hmac('browser', signature),
    deviceNetworkHash: hmac('device-network', `${subnet}|${signature}`),
    userAgentHash: hmac('ua', header(req, 'user-agent')),
    exactEmailHash: hmac('email-exact', exactEmail),
    canonicalEmailHash: hmac('email-canonical', canonicalEmail),
    emailDomainHash: hmac('email-domain', domain),
    referralCodeHash: hmac('referral-code', referralCode),
    isPublicEmailDomain: PUBLIC_EMAIL_DOMAINS.has(domain),
    isDisposableEmail: isDisposableEmail(email),
    headless: isHeadlessRequest(req),
  };
}

function addSignal(signals, code, score, message, evidence = {}) {
  signals.push({ code, score, message, evidence });
}

function uniqueCount(events, field) {
  return new Set(events.map(event => event[field]).filter(Boolean)).size;
}

function recentEvents(events, windowHours, nowMs) {
  const cutoff = nowMs - windowHours * 3600000;
  return (events || []).filter(event => {
    const at = Date.parse(event.createdAt);
    return Number.isFinite(at) && at >= cutoff;
  });
}

async function activeEmailOverride(canonicalEmailHash, nowIso = new Date().toISOString()) {
  if (!canonicalEmailHash) return null;
  const overrides = (await dbUnified.read('partner_abuse_overrides')) || [];
  const nowMs = Date.parse(nowIso);
  return (
    overrides.find(item => {
      if (item.scope !== 'registration' || item.subjectHash !== canonicalEmailHash) return false;
      if (item.revokedAt) return false;
      const expiresAt = Date.parse(item.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    }) || null
  );
}

function reputationProviderUrl(ip) {
  const template = String(process.env.PARTNER_ABUSE_IP_REPUTATION_URL || '').trim();
  if (!template || !ip) return '';
  const encodedIp = encodeURIComponent(ip);
  return template.includes('{ip}') ? template.replaceAll('{ip}', encodedIp) : '';
}

async function lookupIpReputation(ip, timeoutMs) {
  const url = reputationProviderUrl(ip);
  if (!url || typeof fetch !== 'function') return { available: false };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      throw new Error('IP reputation provider must use HTTPS');
    }
    const headers = { Accept: 'application/json' };
    if (process.env.PARTNER_ABUSE_IP_REPUTATION_TOKEN) {
      headers.Authorization = `Bearer ${process.env.PARTNER_ABUSE_IP_REPUTATION_TOKEN}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(parsed, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return { available: false, status: response.status };
    const data = await response.json();
    return {
      available: true,
      riskScore: Number(data.riskScore ?? data.risk_score ?? data.score ?? 0) || 0,
      vpn: data.vpn === true,
      proxy: data.proxy === true,
      tor: data.tor === true,
      hosting: data.hosting === true || data.datacenter === true || data.dataCenter === true,
      provider: String(data.provider || 'configured-provider').slice(0, 60),
    };
  } catch (error) {
    logger.warn('[PARTNER-IDENTITY-RISK] IP reputation lookup failed', {
      error: error.message,
    });
    return { available: false, error: 'lookup_failed' };
  }
}

async function assessRegistration({ req, email, role, refCode = null, now = new Date() }) {
  const config = getConfig();
  const signals = extractRequestSignals(req, { email, refCode });
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const allEvents = (await dbUnified.read('partner_abuse_events')) || [];
  const primaryEvents = allEvents.filter(event => ['attempt', 'blocked'].includes(event.outcome));
  const windowEvents = recentEvents(primaryEvents, config.ipWindowHours, nowMs);
  const matchingIp = signals.ipHash
    ? windowEvents.filter(event => event.ipHash === signals.ipHash)
    : [];
  const matchingSubnet = signals.subnetHash
    ? windowEvents.filter(event => event.subnetHash === signals.subnetHash)
    : [];
  const matchingBrowser = signals.browserHash
    ? windowEvents.filter(event => event.browserHash === signals.browserHash)
    : [];
  const matchingDeviceNetwork = signals.deviceNetworkHash
    ? windowEvents.filter(event => event.deviceNetworkHash === signals.deviceNetworkHash)
    : [];
  const matchingReferral = signals.referralCodeHash
    ? windowEvents.filter(event => event.referralCodeHash === signals.referralCodeHash)
    : [];
  const matchingDomain = signals.emailDomainHash
    ? windowEvents.filter(event => event.emailDomainHash === signals.emailDomainHash)
    : [];
  const matchingCanonical = signals.canonicalEmailHash
    ? allEvents.filter(event => event.canonicalEmailHash === signals.canonicalEmailHash)
    : [];
  const override = await activeEmailOverride(signals.canonicalEmailHash, nowIso);
  const reputation = await lookupIpReputation(signals.ip, config.externalReputationTimeoutMs);
  const riskSignals = [];

  if (signals.isDisposableEmail) {
    addSignal(
      riskSignals,
      'DISPOSABLE_EMAIL_DOMAIN',
      80,
      'Registration uses a known disposable email service.'
    );
  }
  const aliasReuse = matchingCanonical.some(
    event => event.exactEmailHash && event.exactEmailHash !== signals.exactEmailHash
  );
  if (aliasReuse) {
    addSignal(
      riskSignals,
      'EMAIL_ALIAS_REUSE',
      50,
      'An email alias maps to an identity already seen in registration activity.'
    );
  }
  if (matchingIp.length >= config.ipRegistrationMax) {
    addSignal(
      riskSignals,
      'REGISTRATION_IP_VELOCITY',
      40,
      'Unusually many registrations originated from the same network address.',
      { count: matchingIp.length, windowHours: config.ipWindowHours }
    );
  }
  if (matchingSubnet.length >= config.subnetRegistrationMax) {
    addSignal(
      riskSignals,
      'REGISTRATION_SUBNET_VELOCITY',
      20,
      'Unusually many registrations originated from the same network range.',
      { count: matchingSubnet.length, windowHours: config.ipWindowHours }
    );
  }
  if (
    matchingBrowser.length >= config.browserRegistrationMax &&
    uniqueCount(matchingBrowser, 'exactEmailHash') >= config.browserRegistrationMax
  ) {
    addSignal(
      riskSignals,
      'BROWSER_MULTI_ACCOUNT',
      40,
      'The same browser signature has been used for multiple account identities.',
      { accountCount: uniqueCount(matchingBrowser, 'exactEmailHash') }
    );
  }
  if (
    matchingDeviceNetwork.length >= config.deviceNetworkRegistrationMax &&
    uniqueCount(matchingDeviceNetwork, 'exactEmailHash') >= config.deviceNetworkRegistrationMax
  ) {
    addSignal(
      riskSignals,
      'DEVICE_NETWORK_MULTI_ACCOUNT',
      55,
      'The same pseudonymous device/network signature has created multiple accounts.',
      { accountCount: uniqueCount(matchingDeviceNetwork, 'exactEmailHash') }
    );
  }
  if (matchingReferral.length >= config.referralRegistrationMax) {
    addSignal(
      riskSignals,
      'REFERRAL_CODE_VELOCITY',
      40,
      'A partner referral code is receiving registrations at an unusual rate.',
      { count: matchingReferral.length, windowHours: config.ipWindowHours }
    );
  }
  if (matchingDomain.length >= config.domainRegistrationMax) {
    addSignal(
      riskSignals,
      'EMAIL_DOMAIN_VELOCITY',
      20,
      'A single email domain is creating registrations at an unusual rate.',
      { count: matchingDomain.length, windowHours: config.ipWindowHours }
    );
  }
  const crossRoleOnDevice = matchingDeviceNetwork.some(
    event => event.role && event.role !== role && ['partner', 'supplier'].includes(event.role)
  );
  if (crossRoleOnDevice) {
    addSignal(
      riskSignals,
      'PARTNER_SUPPLIER_DEVICE_OVERLAP',
      55,
      'Partner and supplier registrations share the same pseudonymous device/network signature.'
    );
  }
  if (signals.headless && process.env.NODE_ENV !== 'test') {
    addSignal(
      riskSignals,
      'AUTOMATION_BROWSER_SIGNAL',
      70,
      'Registration appears to originate from browser automation.'
    );
  }
  if (reputation.available) {
    if (reputation.tor) {
      addSignal(riskSignals, 'TOR_EXIT_NETWORK', 70, 'Registration originated from a Tor exit.');
    }
    if (reputation.proxy || reputation.vpn) {
      addSignal(
        riskSignals,
        'VPN_OR_PROXY_NETWORK',
        25,
        'Registration originated from a VPN or proxy network.'
      );
    }
    if (reputation.hosting) {
      addSignal(
        riskSignals,
        'DATACENTRE_NETWORK',
        30,
        'Registration originated from a hosting or datacentre network.'
      );
    }
    if (reputation.riskScore >= 80) {
      addSignal(
        riskSignals,
        'HIGH_IP_REPUTATION_RISK',
        50,
        'The configured IP reputation provider reported high risk.',
        { riskScore: reputation.riskScore, provider: reputation.provider }
      );
    }
  }

  const score = Math.min(
    100,
    riskSignals.reduce((total, signal) => total + signal.score, 0)
  );
  let riskLevel =
    score >= config.blockScore ? 'high' : score >= config.reviewScore ? 'review' : 'low';
  let action = 'allow';
  if (!override && config.mode === 'enforce' && score >= config.blockScore) action = 'block';
  else if (score >= config.reviewScore) action = 'review';
  if (config.mode === 'off') {
    riskLevel = 'off';
    action = 'allow';
  }
  if (override) action = 'allow';

  return {
    id: uid('pra'),
    role,
    score,
    riskLevel,
    action,
    signalCodes: riskSignals.map(signal => signal.code),
    signals: riskSignals,
    hashes: {
      ipHash: signals.ipHash,
      subnetHash: signals.subnetHash,
      browserHash: signals.browserHash,
      deviceNetworkHash: signals.deviceNetworkHash,
      userAgentHash: signals.userAgentHash,
      exactEmailHash: signals.exactEmailHash,
      canonicalEmailHash: signals.canonicalEmailHash,
      emailDomainHash: signals.emailDomainHash,
      referralCodeHash: signals.referralCodeHash,
    },
    overrideApplied: override
      ? { id: override.id, expiresAt: override.expiresAt, scope: override.scope }
      : null,
    reputation: reputation.available
      ? {
          riskScore: reputation.riskScore,
          vpn: reputation.vpn,
          proxy: reputation.proxy,
          tor: reputation.tor,
          hosting: reputation.hosting,
          provider: reputation.provider,
        }
      : { available: false },
    mode: config.mode,
    assessedAt: nowIso,
  };
}

function eventExpiry(now, retentionDays) {
  return new Date(now.getTime() + retentionDays * 86400000).toISOString();
}

async function recordRegistrationEvent({ assessment, outcome, userId = null, requestId = null }) {
  const config = getConfig();
  const now = new Date();
  const event = {
    id: uid('pae'),
    assessmentId: assessment.id,
    requestId: requestId || null,
    userId,
    role: assessment.role,
    eventType: 'registration',
    outcome,
    score: assessment.score,
    riskLevel: assessment.riskLevel,
    action: assessment.action,
    signalCodes: assessment.signalCodes,
    signals: assessment.signals.map(signal => ({
      code: signal.code,
      score: signal.score,
      evidence: signal.evidence || {},
    })),
    ...assessment.hashes,
    overrideApplied: assessment.overrideApplied,
    createdAt: now.toISOString(),
    expiresAt: eventExpiry(now, config.retentionDays),
    expiresAtDate: new Date(eventExpiry(now, config.retentionDays)),
  };
  const inserted = await dbUnified.insertOne('partner_abuse_events', event);
  if (!inserted) throw new Error('Partner abuse event did not persist');
  return event;
}

async function persistUserRegistrationRisk(userId, assessment) {
  const updated = await dbUnified.updateOne(
    'users',
    { id: userId },
    {
      $set: {
        registrationRiskScore: assessment.score,
        registrationRiskLevel: assessment.riskLevel,
        registrationRiskSignalCodes: assessment.signalCodes,
        registrationRiskAssessedAt: assessment.assessedAt,
        registrationRiskReviewRequired: assessment.action !== 'allow',
      },
    }
  );
  if (!updated) throw new Error('Registration risk metadata did not persist');
  return updated;
}

function registrationRiskGuard({ roleResolver } = {}) {
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

async function createRegistrationOverride({ email, reason, adminUserId, expiresInDays = 7 }) {
  const canonical = canonicalIdentityEmail(email);
  if (!canonical) throw new Error('A valid email identity is required for an override');
  const note = String(reason || '').trim();
  if (note.length < 20) throw new Error('Override reason must be at least 20 characters');
  const days = Math.min(30, Math.max(1, Number.parseInt(expiresInDays, 10) || 7));
  const now = new Date();
  const subjectHash = hmac('email-canonical', canonical);
  const override = {
    id: uid('pao'),
    subjectHash,
    scope: 'registration',
    reason: note.slice(0, 1000),
    adminUserId,
    createdAt: now.toISOString(),
    expiresAt: eventExpiry(now, days),
    expiresAtDate: new Date(eventExpiry(now, days)),
  };
  const inserted = await dbUnified.insertOne('partner_abuse_overrides', override);
  if (!inserted) throw new Error('Registration override did not persist');
  return override;
}

async function createAppeal({ email, name, message, source = 'partner_registration' }) {
  const cleanEmail = normaliseEmail(email);
  const cleanName = String(name || '')
    .trim()
    .slice(0, 120);
  const cleanMessage = String(message || '')
    .trim()
    .slice(0, 3000);
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('A valid email is required');
  if (cleanMessage.length < 20) throw new Error('Appeal message must be at least 20 characters');
  const config = getConfig();
  const now = new Date();
  const appeal = {
    id: uid('paa'),
    email: cleanEmail,
    emailIdentityHash: hmac('email-canonical', canonicalIdentityEmail(cleanEmail)),
    name: cleanName || null,
    message: cleanMessage,
    source,
    status: 'open',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: eventExpiry(now, config.appealRetentionDays),
    expiresAtDate: new Date(eventExpiry(now, config.appealRetentionDays)),
  };
  const inserted = await dbUnified.insertOne('partner_abuse_appeals', appeal);
  if (!inserted) throw new Error('Appeal did not persist');
  return appeal;
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_APPEAL_RETENTION_DAYS,
  PUBLIC_EMAIL_DOMAINS,
  getConfig,
  canonicalIdentityEmail,
  emailDomain,
  isDisposableEmail,
  normaliseIp,
  subnetForIp,
  extractRequestSignals,
  lookupIpReputation,
  assessRegistration,
  recordRegistrationEvent,
  persistUserRegistrationRisk,
  registrationRiskGuard,
  completeRegistrationRisk,
  createRegistrationOverride,
  createAppeal,
  _private: {
    hmac,
    getHashSecret,
    browserSignature,
    requestIp,
    activeEmailOverride,
    recentEvents,
  },
};
