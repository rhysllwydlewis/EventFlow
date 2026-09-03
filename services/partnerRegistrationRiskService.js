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
const DEVICE_COOKIE_NAME = 'ef_partner_device';
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
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
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
    overrideAuditRetentionDays: numberEnv(
      'PARTNER_ABUSE_OVERRIDE_AUDIT_RETENTION_DAYS',
      DEFAULT_APPEAL_RETENTION_DAYS,
      30,
      365
    ),
    deviceCookieDays: numberEnv('PARTNER_ABUSE_DEVICE_COOKIE_DAYS', 180, 7, 365),
    reviewScore: numberEnv('PARTNER_ABUSE_REVIEW_SCORE', DEFAULT_REVIEW_SCORE, 1, 100),
    blockScore: numberEnv('PARTNER_ABUSE_BLOCK_SCORE', DEFAULT_BLOCK_SCORE, 1, 100),
    ipWindowHours: numberEnv('PARTNER_ABUSE_IP_WINDOW_HOURS', 24, 1, 168),
    ipRegistrationMax: numberEnv('PARTNER_ABUSE_IP_REGISTRATION_MAX', 8, 2, 100),
    ipHardRegistrationMax: numberEnv('PARTNER_ABUSE_IP_HARD_REGISTRATION_MAX', 50, 10, 1000),
    subnetRegistrationMax: numberEnv('PARTNER_ABUSE_SUBNET_REGISTRATION_MAX', 20, 4, 500),
    browserRegistrationMax: numberEnv('PARTNER_ABUSE_BROWSER_REGISTRATION_MAX', 4, 2, 50),
    deviceNetworkRegistrationMax: numberEnv(
      'PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX',
      4,
      2,
      50
    ),
    hardVelocityMultiplier: numberEnv('PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER', 2, 2, 5),
    referralRegistrationMax: numberEnv('PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX', 12, 2, 200),
    referralHardRegistrationMax: numberEnv(
      'PARTNER_ABUSE_REFERRAL_HARD_REGISTRATION_MAX',
      100,
      20,
      5000
    ),
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
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PARTNER_ABUSE_HASH_SECRET (or JWT_SECRET/SESSION_SECRET fallback) is required in production'
    );
  }
  return 'eventflow-partner-abuse-development-only';
}

function hmac(kind, value) {
  if (!value) {
    return null;
  }
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
  if (at <= 0 || at === value.length - 1) {
    return { local: '', domain: '' };
  }
  return { local: value.slice(0, at), domain: value.slice(at + 1) };
}

function canonicalIdentityEmail(email) {
  let { local, domain } = splitEmail(email);
  if (!local || !domain) {
    return '';
  }
  if (domain === 'googlemail.com') {
    domain = 'gmail.com';
  }
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

function envDomainSet(name) {
  return new Set(
    String(process.env[name] || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function disposableDomains() {
  return new Set([
    ...DEFAULT_DISPOSABLE_DOMAINS,
    ...envDomainSet('PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS'),
  ]);
}

function isDisposableEmail(email) {
  const domain = emailDomain(email);
  return Boolean(domain && disposableDomains().has(domain));
}

function isSuspiciousEmail(email) {
  const domain = emailDomain(email);
  return Boolean(domain && envDomainSet('PARTNER_ABUSE_SUSPICIOUS_EMAIL_DOMAINS').has(domain));
}

function normaliseIp(value) {
  let ip = String(value || '')
    .split(',')[0]
    .trim();
  if (!ip) {
    return '';
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
  }
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex > -1) {
    ip = ip.slice(0, zoneIndex);
  }
  return net.isIP(ip) ? ip.toLowerCase() : '';
}

function expandIpv6(ip) {
  const clean = normaliseIp(ip);
  if (net.isIP(clean) !== 6) {
    return [];
  }
  const halves = clean.split('::');
  if (halves.length > 2) {
    return [];
  }
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return [];
  }
  return [...head, ...Array(missing).fill('0'), ...tail].map(part =>
    part.padStart(4, '0').toLowerCase()
  );
}

function subnetForIp(ip) {
  const clean = normaliseIp(ip);
  const version = net.isIP(clean);
  if (version === 4) {
    const parts = clean.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (version === 6) {
    const expanded = expandIpv6(clean);
    return expanded.length === 8 ? `${expanded.slice(0, 4).join(':')}::/64` : '';
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

function requestCookie(req, name) {
  if (req.cookies && typeof req.cookies[name] === 'string') {
    return req.cookies[name];
  }
  const raw = header(req, 'cookie');
  if (!raw) {
    return '';
  }
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) {
      continue;
    }
    const key = pair.slice(0, index).trim();
    if (key !== name) {
      continue;
    }
    try {
      return decodeURIComponent(pair.slice(index + 1).trim());
    } catch (_) {
      return pair.slice(index + 1).trim();
    }
  }
  return '';
}

function ensureDeviceToken(req, res) {
  if (req.partnerAbuseDeviceToken) {
    return req.partnerAbuseDeviceToken;
  }
  const existing = requestCookie(req, DEVICE_COOKIE_NAME);
  if (/^[A-Za-z0-9_-]{24,128}$/.test(existing)) {
    req.partnerAbuseDeviceToken = existing;
    return existing;
  }
  const token = crypto.randomBytes(24).toString('base64url');
  req.partnerAbuseDeviceToken = token;
  if (res && typeof res.cookie === 'function') {
    const config = getConfig();
    res.cookie(DEVICE_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: config.deviceCookieDays * 86400000,
    });
  }
  return token;
}

function normaliseBusinessText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalisePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('44') && digits.length >= 11) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    return `44${digits.slice(1)}`;
  }
  return digits.length >= 7 ? digits : '';
}

function normalisePostcode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function websiteHost(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
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
  const body = req.body || {};
  const company = normaliseBusinessText(body.company || body.companyName || body.businessName);
  const phone = normalisePhone(body.phone || body.phoneNumber || body.contactPhone);
  const postcode = normalisePostcode(body.postcode || body.postalCode);
  const address = normaliseBusinessText(
    body.address || body.addressLine1 || body.streetAddress || body.businessAddress
  );
  const website = websiteHost(body.website || body.websiteUrl);
  const companyNumber = normaliseBusinessText(
    body.companyNumber || body.companiesHouseNumber || body.registrationNumber
  );
  const vatNumber = normaliseBusinessText(body.vatNumber || body.vatRegistrationNumber);
  const deviceToken = req.partnerAbuseDeviceToken || requestCookie(req, DEVICE_COOKIE_NAME);

  return {
    ip,
    ipHash: hmac('ip', ip),
    subnetHash: hmac('subnet', subnet),
    browserHash: hmac('browser', signature),
    deviceNetworkHash: hmac('device-network', `${subnet}|${signature}`),
    deviceCookieHash: hmac('device-cookie', deviceToken),
    userAgentHash: hmac('ua', header(req, 'user-agent')),
    exactEmailHash: hmac('email-exact', exactEmail),
    canonicalEmailHash: hmac('email-canonical', canonicalEmail),
    emailDomainHash: hmac('email-domain', domain),
    referralCodeHash: hmac('referral-code', referralCode),
    companyHash: hmac('company', company),
    phoneHash: hmac('phone', phone),
    postcodeHash: hmac('postcode', postcode),
    addressHash: hmac('address', address),
    websiteHash: hmac('website', website),
    companyNumberHash: hmac('company-number', companyNumber),
    vatNumberHash: hmac('vat-number', vatNumber),
    companyPostcodeHash: hmac(
      'company-postcode',
      company && postcode ? `${company}|${postcode}` : ''
    ),
    companyAddressHash: hmac('company-address', company && address ? `${company}|${address}` : ''),
    isPublicEmailDomain: PUBLIC_EMAIL_DOMAINS.has(domain),
    isDisposableEmail: isDisposableEmail(email),
    isSuspiciousEmail: isSuspiciousEmail(email),
    headless: isHeadlessRequest(req),
  };
}

function addSignal(signals, code, score, message, evidence = {}, group = 'general') {
  signals.push({ code, score, message, evidence, group });
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

function dedupeRegistrationEvents(events) {
  const rank = { blocked: 3, created: 2, attempt: 1 };
  const selected = new Map();
  for (const event of events || []) {
    const key = event.assessmentId || event.id;
    if (!key) {
      continue;
    }
    const current = selected.get(key);
    if (!current || (rank[event.outcome] || 0) > (rank[current.outcome] || 0)) {
      selected.set(key, event);
    }
  }
  return [...selected.values()];
}

async function activeEmailOverride(canonicalEmailHash, nowIso = new Date().toISOString()) {
  if (!canonicalEmailHash) {
    return null;
  }
  let overrides;
  if (typeof dbUnified.findWithOptions === 'function') {
    overrides = await dbUnified.findWithOptions(
      'partner_abuse_overrides',
      { subjectHash: canonicalEmailHash, scope: 'registration' },
      { limit: 20, sort: { createdAt: -1 } }
    );
  } else {
    overrides = ((await dbUnified.read('partner_abuse_overrides')) || []).filter(
      item => item.subjectHash === canonicalEmailHash && item.scope === 'registration'
    );
  }
  const nowMs = Date.parse(nowIso);
  return (
    (overrides || []).find(item => {
      if (item.revokedAt) {
        return false;
      }
      const expiresAt = Date.parse(item.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > nowMs;
    }) || null
  );
}

function reputationProviderUrl(ip) {
  const template = String(process.env.PARTNER_ABUSE_IP_REPUTATION_URL || '').trim();
  if (!template || !ip) {
    return '';
  }
  return template.includes('{ip}') ? template.replaceAll('{ip}', encodeURIComponent(ip)) : '';
}

async function lookupIpReputation(ip, timeoutMs) {
  const url = reputationProviderUrl(ip);
  if (!url || typeof fetch !== 'function') {
    return { available: false };
  }
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
    if (!response.ok) {
      return { available: false, status: response.status };
    }
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
    logger.warn('[PARTNER-IDENTITY-RISK] IP reputation lookup failed', { error: error.message });
    return { available: false, error: 'lookup_failed' };
  }
}

async function loadRegistrationEvents({ now, config, canonicalEmailHash }) {
  const retentionCutoffIso = new Date(
    now.getTime() - config.retentionDays * 86400000
  ).toISOString();
  const primaryOutcomes = ['attempt', 'created', 'blocked'];

  if (typeof dbUnified.findWithOptions === 'function') {
    const primaryEvents = await dbUnified.findWithOptions(
      'partner_abuse_events',
      { outcome: { $in: primaryOutcomes }, createdAt: { $gte: retentionCutoffIso } },
      { limit: 10000, sort: { createdAt: -1 } }
    );
    const canonicalEvents = canonicalEmailHash
      ? await dbUnified.findWithOptions(
          'partner_abuse_events',
          { canonicalEmailHash, createdAt: { $gte: retentionCutoffIso } },
          { limit: 50, sort: { createdAt: -1 } }
        )
      : [];
    return {
      primaryEvents: dedupeRegistrationEvents(primaryEvents || []),
      canonicalEvents: canonicalEvents || [],
    };
  }

  const allEvents = (await dbUnified.read('partner_abuse_events')) || [];
  const cutoffMs = Date.parse(retentionCutoffIso);
  const retained = allEvents.filter(event => {
    const createdAt = Date.parse(event.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoffMs;
  });
  return {
    primaryEvents: dedupeRegistrationEvents(
      retained.filter(event => primaryOutcomes.includes(event.outcome))
    ),
    canonicalEvents: canonicalEmailHash
      ? retained.filter(event => event.canonicalEmailHash === canonicalEmailHash)
      : [],
  };
}

function scoreSignals(signals) {
  const caps = {
    network_reputation: 60,
    browser_network: 45,
    business_identity: 65,
    stable_device: signals.some(signal => signal.code === 'DEVICE_COOKIE_HARD_LIMIT') ? 80 : 65,
  };
  const grouped = new Map();
  let general = 0;
  for (const signal of signals) {
    if (signal.group === 'general') {
      general += signal.score;
      continue;
    }
    grouped.set(signal.group, (grouped.get(signal.group) || 0) + signal.score);
  }
  let total = general;
  for (const [group, score] of grouped.entries()) {
    total += Math.min(score, caps[group] ?? score);
  }
  return Math.min(100, total);
}

async function assessRegistration({ req, email, role, refCode = null, now = new Date() }) {
  const config = getConfig();
  const signals = extractRequestSignals(req, { email, refCode });
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const { primaryEvents, canonicalEvents } = await loadRegistrationEvents({
    now,
    config,
    canonicalEmailHash: signals.canonicalEmailHash,
  });
  const windowEvents = recentEvents(primaryEvents, config.ipWindowHours, nowMs);
  const matching = field =>
    signals[field] ? windowEvents.filter(event => event[field] === signals[field]) : [];
  const matchingIp = matching('ipHash');
  const matchingSubnet = matching('subnetHash');
  const matchingBrowser = matching('browserHash');
  const matchingDeviceNetwork = matching('deviceNetworkHash');
  const matchingDeviceCookie = matching('deviceCookieHash');
  const matchingReferral = matching('referralCodeHash');
  const matchingDomain = matching('emailDomainHash');
  const matchingCanonical = signals.canonicalEmailHash ? canonicalEvents : [];
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
  } else if (signals.isSuspiciousEmail) {
    addSignal(
      riskSignals,
      'SUSPICIOUS_EMAIL_DOMAIN',
      35,
      'Registration uses an email domain configured for additional review.'
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

  if (matchingIp.length >= config.ipHardRegistrationMax) {
    addSignal(
      riskSignals,
      'REGISTRATION_IP_HARD_LIMIT',
      80,
      'Registration volume from one network address exceeded the hard abuse limit.',
      { count: matchingIp.length, windowHours: config.ipWindowHours }
    );
  } else if (matchingIp.length >= config.ipRegistrationMax) {
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

  const browserAccounts = uniqueCount(matchingBrowser, 'exactEmailHash');
  if (browserAccounts >= config.browserRegistrationMax) {
    addSignal(
      riskSignals,
      'BROWSER_MULTI_ACCOUNT',
      30,
      'The same browser signature has been used for multiple account identities.',
      { accountCount: browserAccounts },
      'browser_network'
    );
  }

  const deviceNetworkAccounts = uniqueCount(matchingDeviceNetwork, 'exactEmailHash');
  if (deviceNetworkAccounts >= config.deviceNetworkRegistrationMax) {
    addSignal(
      riskSignals,
      'DEVICE_NETWORK_MULTI_ACCOUNT',
      35,
      'The same pseudonymous browser/network signature has created multiple accounts.',
      { accountCount: deviceNetworkAccounts },
      'browser_network'
    );
  }

  const deviceCookieAccounts = uniqueCount(matchingDeviceCookie, 'exactEmailHash');
  if (deviceCookieAccounts >= config.deviceNetworkRegistrationMax * config.hardVelocityMultiplier) {
    addSignal(
      riskSignals,
      'DEVICE_COOKIE_HARD_LIMIT',
      80,
      'One first-party device token exceeded the hard multi-account limit.',
      { accountCount: deviceCookieAccounts },
      'stable_device'
    );
  } else if (deviceCookieAccounts >= config.deviceNetworkRegistrationMax) {
    addSignal(
      riskSignals,
      'DEVICE_COOKIE_MULTI_ACCOUNT',
      60,
      'One first-party pseudonymous device token has created multiple account identities.',
      { accountCount: deviceCookieAccounts },
      'stable_device'
    );
  }

  if (matchingReferral.length >= config.referralHardRegistrationMax) {
    addSignal(
      riskSignals,
      'REFERRAL_CODE_HARD_LIMIT',
      80,
      'A referral code exceeded the hard registration-velocity limit.',
      { count: matchingReferral.length, windowHours: config.ipWindowHours }
    );
  } else if (matchingReferral.length >= config.referralRegistrationMax) {
    addSignal(
      riskSignals,
      'REFERRAL_CODE_VELOCITY',
      40,
      'A partner referral code is receiving registrations at an unusual rate.',
      { count: matchingReferral.length, windowHours: config.ipWindowHours }
    );
  }

  if (!signals.isPublicEmailDomain && matchingDomain.length >= config.domainRegistrationMax) {
    addSignal(
      riskSignals,
      'EMAIL_DOMAIN_VELOCITY',
      20,
      'A private email domain is creating registrations at an unusual rate.',
      { count: matchingDomain.length, windowHours: config.ipWindowHours }
    );
  }

  if (
    matchingDeviceCookie.some(
      event => event.role && event.role !== role && ['partner', 'supplier'].includes(event.role)
    )
  ) {
    addSignal(
      riskSignals,
      'PARTNER_SUPPLIER_DEVICE_COOKIE_OVERLAP',
      65,
      'Partner and supplier registrations share the same first-party pseudonymous device token.',
      {},
      'stable_device'
    );
  }

  if (
    matchingDeviceNetwork.some(
      event => event.role && event.role !== role && ['partner', 'supplier'].includes(event.role)
    )
  ) {
    addSignal(
      riskSignals,
      'PARTNER_SUPPLIER_DEVICE_OVERLAP',
      35,
      'Partner and supplier registrations share the same pseudonymous browser/network signature.',
      {},
      'browser_network'
    );
  }

  const businessFields = [
    ['phoneHash', 'phone'],
    ['websiteHash', 'website'],
    ['companyNumberHash', 'company_number'],
    ['vatNumberHash', 'vat_number'],
    ['companyPostcodeHash', 'company_postcode'],
    ['companyAddressHash', 'company_address'],
  ];
  const reusedBusinessFields = businessFields
    .filter(([field]) =>
      Boolean(
        signals[field] &&
        primaryEvents.some(
          event =>
            event[field] === signals[field] &&
            event.exactEmailHash &&
            event.exactEmailHash !== signals.exactEmailHash
        )
      )
    )
    .map(([, label]) => label);
  if (reusedBusinessFields.length) {
    addSignal(
      riskSignals,
      'BUSINESS_IDENTITY_REUSE',
      55,
      'Business identity evidence is already associated with another registration identity.',
      { matchedFields: reusedBusinessFields },
      'business_identity'
    );
  }

  const crossRoleBusiness = businessFields.some(([field]) =>
    Boolean(
      signals[field] &&
      primaryEvents.some(
        event =>
          event[field] === signals[field] &&
          event.role &&
          event.role !== role &&
          ['partner', 'supplier'].includes(event.role)
      )
    )
  );
  if (crossRoleBusiness) {
    addSignal(
      riskSignals,
      'PARTNER_SUPPLIER_BUSINESS_OVERLAP',
      65,
      'Partner and supplier registrations share strong pseudonymous business identity evidence.',
      {},
      'business_identity'
    );
  }

  if (signals.headless && process.env.NODE_ENV !== 'test') {
    addSignal(
      riskSignals,
      'AUTOMATION_BROWSER_SIGNAL',
      60,
      'Registration appears to originate from browser automation.'
    );
  }

  if (reputation.available) {
    if (reputation.tor) {
      addSignal(
        riskSignals,
        'TOR_EXIT_NETWORK',
        45,
        'Registration originated from a Tor exit.',
        {},
        'network_reputation'
      );
    }
    if (reputation.proxy || reputation.vpn) {
      addSignal(
        riskSignals,
        'VPN_OR_PROXY_NETWORK',
        25,
        'Registration originated from a VPN or proxy network.',
        {},
        'network_reputation'
      );
    }
    if (reputation.hosting) {
      addSignal(
        riskSignals,
        'DATACENTRE_NETWORK',
        30,
        'Registration originated from a hosting or datacentre network.',
        {},
        'network_reputation'
      );
    }
    if (reputation.riskScore >= 80) {
      addSignal(
        riskSignals,
        'HIGH_IP_REPUTATION_RISK',
        50,
        'The configured IP reputation provider reported high risk.',
        { riskScore: reputation.riskScore, provider: reputation.provider },
        'network_reputation'
      );
    }
  }

  const score = scoreSignals(riskSignals);
  let riskLevel =
    score >= config.blockScore ? 'high' : score >= config.reviewScore ? 'review' : 'low';
  let action = 'allow';
  if (!override && config.mode === 'enforce' && score >= config.blockScore) {
    action = 'block';
  } else if (score >= config.reviewScore) {
    action = 'review';
  }
  if (config.mode === 'off') {
    riskLevel = 'off';
    action = 'allow';
  }
  if (override) {
    action = 'allow';
  }

  return {
    id: uid('pra'),
    role,
    score,
    riskLevel,
    action,
    signalCodes: riskSignals.map(signal => signal.code),
    signals: riskSignals.map(({ group: _group, ...signal }) => signal),
    hashes: {
      ipHash: signals.ipHash,
      subnetHash: signals.subnetHash,
      browserHash: signals.browserHash,
      deviceNetworkHash: signals.deviceNetworkHash,
      deviceCookieHash: signals.deviceCookieHash,
      userAgentHash: signals.userAgentHash,
      exactEmailHash: signals.exactEmailHash,
      canonicalEmailHash: signals.canonicalEmailHash,
      emailDomainHash: signals.emailDomainHash,
      referralCodeHash: signals.referralCodeHash,
      companyHash: signals.companyHash,
      phoneHash: signals.phoneHash,
      postcodeHash: signals.postcodeHash,
      addressHash: signals.addressHash,
      websiteHash: signals.websiteHash,
      companyNumberHash: signals.companyNumberHash,
      vatNumberHash: signals.vatNumberHash,
      companyPostcodeHash: signals.companyPostcodeHash,
      companyAddressHash: signals.companyAddressHash,
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
  const expiresAt = eventExpiry(now, config.retentionDays);
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
    expiresAt,
    expiresAtDate: new Date(expiresAt),
  };
  const inserted = await dbUnified.insertOne('partner_abuse_events', event);
  if (!inserted) {
    throw new Error('Partner abuse event did not persist');
  }
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
  if (!updated) {
    throw new Error('Registration risk metadata did not persist');
  }
  return updated;
}

function registrationRiskGuard({ roleResolver } = {}) {
  return async (req, res, next) => {
    try {
      const resolvedRole = roleResolver ? roleResolver(req) : req.body?.role;
      if (!['partner', 'supplier'].includes(resolvedRole)) {
        return next();
      }
      ensureDeviceToken(req, res);
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

      res.once('finish', () => {
        if (req.partnerRegistrationRiskFinalized) {
          return;
        }
        req.partnerRegistrationRiskFinalized = true;
        const outcome = res.statusCode >= 400 ? 'failed' : 'completed_without_user';
        recordRegistrationEvent({ assessment, outcome }).catch(error =>
          logger.warn('[PARTNER-IDENTITY-RISK] Registration audit finalization failed', {
            error: error.message,
          })
        );
      });
      return next();
    } catch (error) {
      logger.error('[PARTNER-IDENTITY-RISK] Registration assessment failed', {
        error: error.message,
      });
      if (process.env.PARTNER_ABUSE_FAIL_OPEN === 'true') {
        return next();
      }
      return res.status(503).json({
        error: 'Registration is temporarily unavailable. Please try again shortly.',
        code: 'REGISTRATION_RISK_UNAVAILABLE',
      });
    }
  };
}

async function completeRegistrationRisk(req, userId) {
  const assessment = req.partnerRegistrationRisk;
  if (!assessment) {
    return null;
  }
  await persistUserRegistrationRisk(userId, assessment);
  const event = await recordRegistrationEvent({ assessment, outcome: 'created', userId });
  req.partnerRegistrationRiskFinalized = true;
  return event;
}

async function createRegistrationOverride({ email, reason, adminUserId, expiresInDays = 7 }) {
  const canonical = canonicalIdentityEmail(email);
  if (!canonical) {
    throw new Error('A valid email identity is required for an override');
  }
  const note = String(reason || '').trim();
  if (note.length < 20) {
    throw new Error('Override reason must be at least 20 characters');
  }
  const days = Math.min(30, Math.max(1, Number.parseInt(expiresInDays, 10) || 7));
  const config = getConfig();
  const now = new Date();
  const subjectHash = hmac('email-canonical', canonical);
  const expiresAt = eventExpiry(now, days);
  const retentionExpiresAt = eventExpiry(now, config.overrideAuditRetentionDays);
  const override = {
    id: uid('pao'),
    subjectHash,
    scope: 'registration',
    reason: note.slice(0, 1000),
    adminUserId,
    createdAt: now.toISOString(),
    expiresAt,
    retentionExpiresAt,
    retentionExpiresAtDate: new Date(retentionExpiresAt),
  };
  const inserted = await dbUnified.insertOne('partner_abuse_overrides', override);
  if (!inserted) {
    throw new Error('Registration override did not persist');
  }
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
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('A valid email is required');
  }
  if (cleanMessage.length < 20) {
    throw new Error('Appeal message must be at least 20 characters');
  }
  const config = getConfig();
  const now = new Date();
  const expiresAt = eventExpiry(now, config.appealRetentionDays);
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
    expiresAt,
    expiresAtDate: new Date(expiresAt),
  };
  const inserted = await dbUnified.insertOne('partner_abuse_appeals', appeal);
  if (!inserted) {
    throw new Error('Appeal did not persist');
  }
  return appeal;
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_APPEAL_RETENTION_DAYS,
  PUBLIC_EMAIL_DOMAINS,
  DEVICE_COOKIE_NAME,
  getConfig,
  canonicalIdentityEmail,
  emailDomain,
  isDisposableEmail,
  isSuspiciousEmail,
  normaliseIp,
  subnetForIp,
  ensureDeviceToken,
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
    requestCookie,
    requestIp,
    expandIpv6,
    activeEmailOverride,
    recentEvents,
    dedupeRegistrationEvents,
    normalisePhone,
    websiteHost,
    scoreSignals,
  },
};
