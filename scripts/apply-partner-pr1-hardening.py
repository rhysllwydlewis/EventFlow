from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected PR1 hardening marker not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Stable first-party pseudonymous device identity + business identity clusters.
# ---------------------------------------------------------------------------
risk_path = 'services/partnerRegistrationRiskService.js'
replace_once(
    risk_path,
    "const ALLOWED_MODES = new Set(['off', 'monitor', 'enforce']);",
    """const ALLOWED_MODES = new Set(['off', 'monitor', 'enforce']);
const DEVICE_COOKIE_NAME = 'ef_partner_device';
const DEFAULT_DEVICE_COOKIE_DAYS = 180;""",
)
replace_once(
    risk_path,
    """    deviceNetworkRegistrationMax: numberEnv(
      'PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX',
      4,
      2,
      50
    ),
    referralRegistrationMax:""",
    """    deviceNetworkRegistrationMax: numberEnv(
      'PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX',
      4,
      2,
      50
    ),
    deviceCookieDays: numberEnv(
      'PARTNER_ABUSE_DEVICE_COOKIE_DAYS',
      DEFAULT_DEVICE_COOKIE_DAYS,
      30,
      365
    ),
    hardVelocityMultiplier: numberEnv('PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER', 2, 2, 5),
    referralRegistrationMax:""",
)
replace_once(
    risk_path,
    """function isDisposableEmail(email) {
  const domain = emailDomain(email);
  return Boolean(domain && disposableDomains().has(domain));
}

function normaliseIp(value) {""",
    """function isDisposableEmail(email) {
  const domain = emailDomain(email);
  return Boolean(domain && disposableDomains().has(domain));
}

function suspiciousEmailDomains() {
  return new Set(
    String(process.env.PARTNER_ABUSE_SUSPICIOUS_EMAIL_DOMAINS || '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isSuspiciousEmail(email) {
  const domain = emailDomain(email);
  return Boolean(domain && suspiciousEmailDomains().has(domain));
}

function normalisePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

function normaliseBusinessText(value) {
  return String(value || '')
    .slice(0, 500)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalisePostcode(value) {
  return String(value || '')
    .slice(0, 40)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normaliseBusinessIdentifier(value) {
  return String(value || '')
    .slice(0, 80)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function websiteHost(value) {
  const raw = String(value || '').trim().slice(0, 500);
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function normaliseIp(value) {""",
)
replace_once(
    risk_path,
    """function header(req, name) {
  const value = req.get ? req.get(name) : req.headers?.[String(name).toLowerCase()];
  return String(value || '')
    .trim()
    .slice(0, 512);
}

function browserSignature(req) {""",
    """function header(req, name) {
  const value = req.get ? req.get(name) : req.headers?.[String(name).toLowerCase()];
  return String(value || '')
    .trim()
    .slice(0, 512);
}

function requestCookie(req, name) {
  if (req.cookies && typeof req.cookies[name] === 'string') return req.cookies[name];
  const cookieHeader = String(req.headers?.cookie || '').slice(0, 8192);
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch (_) {
      return '';
    }
  }
  return '';
}

function validDeviceToken(value) {
  return /^[A-Za-z0-9_-]{24,128}$/.test(String(value || ''));
}

function ensureDeviceToken(req, res = req.res) {
  if (validDeviceToken(req.partnerAbuseDeviceToken)) return req.partnerAbuseDeviceToken;
  let token = requestCookie(req, DEVICE_COOKIE_NAME);
  if (!validDeviceToken(token)) {
    token = crypto.randomBytes(24).toString('base64url');
    const maxAge = getConfig().deviceCookieDays * 86400000;
    if (res && typeof res.cookie === 'function') {
      res.cookie(DEVICE_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge,
      });
    }
  }
  req.partnerAbuseDeviceToken = token;
  return token;
}

function browserSignature(req) {""",
)
replace_once(
    risk_path,
    """function extractRequestSignals(req, { email, refCode } = {}) {
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
}""",
    """function extractRequestSignals(req, { email, refCode } = {}) {
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
  const website = websiteHost(body.website || body.websiteUrl);
  const companyNumber = normaliseBusinessIdentifier(
    body.companyNumber || body.companiesHouseNumber || body.registrationNumber
  );
  const vatNumber = normaliseBusinessIdentifier(body.vatNumber || body.vatRegistrationNumber);
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
    websiteHash: hmac('website', website),
    companyNumberHash: hmac('company-number', companyNumber),
    vatNumberHash: hmac('vat-number', vatNumber),
    companyPostcodeHash: hmac('company-postcode', company && postcode ? `${company}|${postcode}` : ''),
    isPublicEmailDomain: PUBLIC_EMAIL_DOMAINS.has(domain),
    isDisposableEmail: isDisposableEmail(email),
    isSuspiciousEmail: isSuspiciousEmail(email),
    headless: isHeadlessRequest(req),
  };
}""",
)
replace_once(
    risk_path,
    """async function assessRegistration({ req, email, role, refCode = null, now = new Date() }) {
  const config = getConfig();
  const signals = extractRequestSignals(req, { email, refCode });""",
    """async function assessRegistration({ req, email, role, refCode = null, now = new Date() }) {
  const config = getConfig();
  ensureDeviceToken(req, req.res);
  const signals = extractRequestSignals(req, { email, refCode });""",
)
replace_once(
    risk_path,
    """  const matchingDeviceNetwork = signals.deviceNetworkHash
    ? windowEvents.filter(event => event.deviceNetworkHash === signals.deviceNetworkHash)
    : [];
  const matchingReferral =""",
    """  const matchingDeviceNetwork = signals.deviceNetworkHash
    ? windowEvents.filter(event => event.deviceNetworkHash === signals.deviceNetworkHash)
    : [];
  const matchingDeviceCookie = signals.deviceCookieHash
    ? windowEvents.filter(event => event.deviceCookieHash === signals.deviceCookieHash)
    : [];
  const matchingReferral =""",
)
replace_once(
    risk_path,
    """  if (signals.isDisposableEmail) {
    addSignal(
      riskSignals,
      'DISPOSABLE_EMAIL_DOMAIN',
      80,
      'Registration uses a known disposable email service.'
    );
  }
  const aliasReuse =""",
    """  if (signals.isDisposableEmail) {
    addSignal(
      riskSignals,
      'DISPOSABLE_EMAIL_DOMAIN',
      80,
      'Registration uses a known disposable email service.'
    );
  }
  if (signals.isSuspiciousEmail) {
    addSignal(
      riskSignals,
      'SUSPICIOUS_EMAIL_DOMAIN',
      45,
      'Registration uses an email domain configured for manual review.'
    );
  }
  const aliasReuse =""",
)
replace_once(
    risk_path,
    """  if (matchingIp.length >= config.ipRegistrationMax) {
    addSignal(
      riskSignals,
      'REGISTRATION_IP_VELOCITY',
      40,
      'Unusually many registrations originated from the same network address.',
      { count: matchingIp.length, windowHours: config.ipWindowHours }
    );
  }""",
    """  if (matchingIp.length >= config.ipRegistrationMax * config.hardVelocityMultiplier) {
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
  }""",
)
replace_once(
    risk_path,
    """  if (matchingReferral.length >= config.referralRegistrationMax) {
    addSignal(
      riskSignals,
      'REFERRAL_CODE_VELOCITY',
      40,
      'A partner referral code is receiving registrations at an unusual rate.',
      { count: matchingReferral.length, windowHours: config.ipWindowHours }
    );
  }""",
    """  if (matchingReferral.length >= config.referralRegistrationMax * config.hardVelocityMultiplier) {
    addSignal(
      riskSignals,
      'REFERRAL_CODE_HARD_LIMIT',
      80,
      'A partner referral code exceeded the hard registration abuse limit.',
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
  }""",
)
replace_once(
    risk_path,
    """  const crossRoleOnDevice = matchingDeviceNetwork.some(
    event => event.role && event.role !== role && ['partner', 'supplier'].includes(event.role)
  );""",
    """  const deviceCookieAccounts = uniqueCount(matchingDeviceCookie, 'exactEmailHash');
  if (deviceCookieAccounts >= config.deviceNetworkRegistrationMax * config.hardVelocityMultiplier) {
    addSignal(
      riskSignals,
      'DEVICE_COOKIE_HARD_LIMIT',
      80,
      'One first-party device token exceeded the hard multi-account limit.',
      { accountCount: deviceCookieAccounts }
    );
  } else if (deviceCookieAccounts >= config.deviceNetworkRegistrationMax) {
    addSignal(
      riskSignals,
      'DEVICE_COOKIE_MULTI_ACCOUNT',
      60,
      'One first-party pseudonymous device token has created multiple account identities.',
      { accountCount: deviceCookieAccounts }
    );
  }
  const crossRoleOnDeviceCookie = matchingDeviceCookie.some(
    event => event.role && event.role !== role && ['partner', 'supplier'].includes(event.role)
  );
  if (crossRoleOnDeviceCookie) {
    addSignal(
      riskSignals,
      'PARTNER_SUPPLIER_DEVICE_COOKIE_OVERLAP',
      65,
      'Partner and supplier registrations share the same first-party pseudonymous device token.'
    );
  }

  const businessFields = [
    ['phoneHash', 'phone'],
    ['websiteHash', 'website'],
    ['companyNumberHash', 'company_number'],
    ['vatNumberHash', 'vat_number'],
    ['companyPostcodeHash', 'company_postcode'],
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
      { matchedFields: reusedBusinessFields }
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
      70,
      'Partner and supplier registrations share strong pseudonymous business identity evidence.'
    );
  }

  const crossRoleOnDevice = matchingDeviceNetwork.some(
    event => event.role && event.role !== role && ['partner', 'supplier'].includes(event.role)
  );""",
)
replace_once(
    risk_path,
    """      browserHash: signals.browserHash,
      deviceNetworkHash: signals.deviceNetworkHash,
      userAgentHash: signals.userAgentHash,""",
    """      browserHash: signals.browserHash,
      deviceNetworkHash: signals.deviceNetworkHash,
      deviceCookieHash: signals.deviceCookieHash,
      userAgentHash: signals.userAgentHash,""",
)
replace_once(
    risk_path,
    """      emailDomainHash: signals.emailDomainHash,
      referralCodeHash: signals.referralCodeHash,
    },""",
    """      emailDomainHash: signals.emailDomainHash,
      referralCodeHash: signals.referralCodeHash,
      companyHash: signals.companyHash,
      phoneHash: signals.phoneHash,
      postcodeHash: signals.postcodeHash,
      websiteHash: signals.websiteHash,
      companyNumberHash: signals.companyNumberHash,
      vatNumberHash: signals.vatNumberHash,
      companyPostcodeHash: signals.companyPostcodeHash,
    },""",
)
replace_once(
    risk_path,
    """  isDisposableEmail,
  normaliseIp,""",
    """  isDisposableEmail,
  isSuspiciousEmail,
  normaliseIp,""",
)
replace_once(
    risk_path,
    """  subnetForIp,
  extractRequestSignals,""",
    """  subnetForIp,
  ensureDeviceToken,
  extractRequestSignals,""",
)
replace_once(
    risk_path,
    """    browserSignature,
    requestIp,""",
    """    browserSignature,
    requestCookie,
    requestIp,""",
)

# ---------------------------------------------------------------------------
# Partner registration CAPTCHA, dependency wiring and frontend UX.
# ---------------------------------------------------------------------------
secure_route = 'routes/partner-registration-secure.js'
replace_once(
    secure_route,
    "const router = express.Router();\n",
    """const router = express.Router();
let _verifyAltcha = null;

function initializeDependencies(deps = {}) {
  _verifyAltcha = typeof deps.verifyAltcha === 'function' ? deps.verifyAltcha : null;
}""",
)
replace_once(
    secure_route,
    """      const { firstName, lastName, email, password, location, company } = req.body || {};
      const cleanFirstName =""",
    """      const { firstName, lastName, email, password, location, company, captchaToken } = req.body || {};
      if (_verifyAltcha) {
        const captchaResult = await _verifyAltcha(captchaToken);
        if (!captchaResult.success) {
          return res.status(400).json({
            error: captchaResult.error || 'CAPTCHA verification failed',
            code: 'CAPTCHA_VERIFICATION_FAILED',
          });
        }
      }
      const cleanFirstName =""",
)
replace_once(
    secure_route,
    "module.exports = router;",
    """router.initializeDependencies = initializeDependencies;
module.exports = router;""",
)
replace_once(
    'routes/index.js',
    """  const securePartnerRegistrationRoutes = require('./partner-registration-secure');
  const partnerAbuseAppealRoutes = require('./partner-abuse-appeals');""",
    """  const securePartnerRegistrationRoutes = require('./partner-registration-secure');
  if (deps && securePartnerRegistrationRoutes.initializeDependencies) {
    securePartnerRegistrationRoutes.initializeDependencies(deps);
  }
  const partnerAbuseAppealRoutes = require('./partner-abuse-appeals');""",
)

replace_once(
    'public/partner/index.html',
    """                <div id="signup-status" class="partner-status" role="alert" aria-live="polite"></div>
                <button type="submit" class="ef-cta partner-submit-btn" id="signup-btn">""",
    """                <div class="partner-field" id="partner-altcha-container">
                  <altcha-widget
                    challengeurl="/api/v1/altcha/challenge"
                    id="partner-reg-altcha-widget"
                  ></altcha-widget>
                </div>
                <div id="signup-status" class="partner-status" role="alert" aria-live="polite"></div>
                <button type="submit" class="ef-cta partner-submit-btn" id="signup-btn">""",
)
replace_once(
    'public/partner/index.html',
    """    <script src="/assets/js/utils/auth-state.js" defer></script>
    <script src="/assets/js/cookie-consent.js?v=2.0.0" defer></script>""",
    """    <script src="/assets/js/utils/auth-state.js" defer></script>
    <script src="/assets/js/vendor/altcha.min.js" defer></script>
    <script src="/assets/js/cookie-consent.js?v=2.0.0" defer></script>""",
)
replace_once(
    'public/assets/js/pages/partner-init.js',
    """      const company = form.querySelector('#reg-company').value.trim();

      if (!firstName || !lastName) {""",
    """      const company = form.querySelector('#reg-company').value.trim();
      const altchaWidget = document.getElementById('partner-reg-altcha-widget');
      let captchaToken = null;
      if (altchaWidget) {
        try {
          const shadowInput =
            altchaWidget.shadowRoot && altchaWidget.shadowRoot.querySelector('input[name="altcha"]');
          if (shadowInput && shadowInput.value) captchaToken = shadowInput.value;
        } catch (_) {
          // Shadow DOM payload lookup is best-effort; .value is the fallback below.
        }
        if (!captchaToken) captchaToken = altchaWidget.value || null;
      }

      if (!firstName || !lastName) {""",
)
replace_once(
    'public/assets/js/pages/partner-init.js',
    """      if (!location) {
        showStatus(status, 'Location is required.', 'error');
        return;
      }

      setButtonLoading(btn, true);""",
    """      if (!location) {
        showStatus(status, 'Location is required.', 'error');
        return;
      }
      if (altchaWidget && !captchaToken) {
        showStatus(
          status,
          'Please complete the verification challenge before creating your account.',
          'error'
        );
        return;
      }

      setButtonLoading(btn, true);""",
)
replace_once(
    'public/assets/js/pages/partner-init.js',
    """          body: JSON.stringify({ firstName, lastName, email, password, location, company }),""",
    """          body: JSON.stringify({
            firstName,
            lastName,
            email,
            password,
            location,
            company,
            captchaToken,
          }),""",
)

# ---------------------------------------------------------------------------
# Defence in depth: the legacy partner router must never expose its old
# auto-verified registration implementation when mounted directly.
# ---------------------------------------------------------------------------
partner_path = Path('routes/partner.js')
partner_source = partner_path.read_text()
start_marker = '// ─── Registration ─────────────────────────────────────────────────────────────\n\n'
end_marker = '// ─── Dashboard core ───────────────────────────────────────────────────────────\n'
start = partner_source.find(start_marker)
end = partner_source.find(end_marker)
if start < 0 or end < 0 or end <= start:
    if 'PARTNER_REGISTRATION_SECURE_ROUTE_REQUIRED' not in partner_source:
        raise SystemExit('Could not locate legacy partner registration block')
else:
    replacement = """// ─── Registration ─────────────────────────────────────────────────────────────

// Authoritative registration lives in partner-registration-secure.js. Keep this
// defensive endpoint so direct mounting of the legacy router cannot recreate the
// old auto-verified partner-account path.
router.post('/register', (_req, res) =>
  res.status(410).json({
    error: 'Partner registration must use the secure registration route.',
    code: 'PARTNER_REGISTRATION_SECURE_ROUTE_REQUIRED',
  })
);

"""
    partner_path.write_text(partner_source[:start] + replacement + partner_source[end:])

# Replace the two legacy registration tests with an explicit defence-in-depth
# assertion. Secure registration validation lives in partner-registration-secure.test.js.
test_path = Path('tests/unit/partner-routes-integration.test.js')
test_source = test_path.read_text()
old_test_start = "  it('registers a partner and returns the generated referral identity', async () => {"
next_test_marker = "\n\n  it('returns the live programme configuration and profile summary'"
if old_test_start in test_source:
    start = test_source.index(old_test_start)
    end = test_source.index(next_test_marker, start)
    replacement = """  it('refuses registration when the legacy partner router is mounted directly', async () => {
    const response = await request(app).post('/api/partner/register').send({
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      password: 'Password123',
      location: 'Cardiff',
    });

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('PARTNER_REGISTRATION_SECURE_ROUTE_REQUIRED');
    expect(mockDb.insertOne).not.toHaveBeenCalled();
    expect(mockSetAuthCookie).not.toHaveBeenCalled();
  });"""
    test_path.write_text(test_source[:start] + replacement + test_source[end:])
elif 'PARTNER_REGISTRATION_SECURE_ROUTE_REQUIRED' not in test_source:
    raise SystemExit('Expected legacy partner route registration test not found')

replace_once(
    'db-init.js',
    """      { keys: { deviceNetworkHash: 1, createdAt: -1 }, options: {} },
      { keys: { canonicalEmailHash: 1, createdAt: -1 }, options: {} },""",
    """      { keys: { deviceNetworkHash: 1, createdAt: -1 }, options: {} },
      { keys: { deviceCookieHash: 1, createdAt: -1 }, options: {} },
      { keys: { canonicalEmailHash: 1, createdAt: -1 }, options: {} },
      { keys: { phoneHash: 1, createdAt: -1 }, options: {} },
      { keys: { websiteHash: 1, createdAt: -1 }, options: {} },
      { keys: { companyNumberHash: 1, createdAt: -1 }, options: {} },
      { keys: { vatNumberHash: 1, createdAt: -1 }, options: {} },
      { keys: { companyPostcodeHash: 1, createdAt: -1 }, options: {} },""",
)

replace_once(
    'public/privacy.html',
    """        <li><strong>Pseudonymous Browser Signals:</strong> Browser type, language and standard browser client hints combined into a protected signature. This is a risk signal and is not treated as proof that two people are the same person.</li>""",
    """        <li><strong>Pseudonymous Browser Signals:</strong> Browser type, language and standard browser client hints combined into a protected signature. This is a risk signal and is not treated as proof that two people are the same person.</li>
        <li><strong>First-Party Anti-Abuse Device Token:</strong> A random, HTTP-only first-party cookie may be used to recognise repeated registration activity from the same browser. EventFlow stores a protected HMAC representation in anti-abuse event records rather than the raw token.</li>""",
)
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """- Multiple identities sharing the same browser signature.
- Multiple identities sharing a combined browser/network signature.""",
    """- Multiple identities sharing the same browser signature.
- Multiple identities sharing a random first-party, HTTP-only pseudonymous device token.
- Multiple identities sharing a combined browser/network signature.""",
)
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """- `PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX` — combined browser/network threshold, default 4.
- `PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX` — referral-code threshold, default 12.""",
    """- `PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX` — combined browser/network and first-party device-token threshold, default 4.
- `PARTNER_ABUSE_DEVICE_COOKIE_DAYS` — first-party anti-abuse device token lifetime, default 180 days.
- `PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER` — multiplier that turns sustained IP/referral/device velocity into a hard abuse limit, default 2.
- `PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX` — referral-code threshold, default 12.""",
)
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """- `PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS` — comma-separated additions to the built-in disposable-domain list.""",
    """- `PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS` — comma-separated additions to the built-in disposable-domain list.
- `PARTNER_ABUSE_SUSPICIOUS_EMAIL_DOMAINS` — comma-separated domains that should trigger manual review without being automatically treated as disposable.""",
)
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """The browser signature uses the user-agent, language and browser client-hint headers. It is a fraud signal, not a claim that EventFlow can uniquely identify a physical device. Browser/device evidence must be combined with other evidence before adverse manual action is taken.""",
    """The browser signature uses the user-agent, language and browser client-hint headers. In addition, registration may set an HTTP-only, SameSite=Lax first-party random device token (`ef_partner_device`) which is HMAC-protected before it enters the anti-abuse event ledger. Neither signal is a claim that EventFlow can uniquely identify a physical device, and technical evidence must be combined with other evidence before adverse manual action is taken.""",
)

import json
package_path = Path('package.json')
package = json.loads(package_path.read_text())
smoke = package['scripts']['test:smoke']
for test in [
    'tests/unit/partner-registration-risk-advanced.test.js',
    'tests/unit/partner-registration-captcha.test.js',
]:
    if test not in smoke:
        smoke += f' {test}'
package['scripts']['test:smoke'] = smoke
package_path.write_text(json.dumps(package, indent=2) + '\n')
