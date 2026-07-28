from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected PR1 safety marker not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


path = 'services/partnerRegistrationRiskService.js'

# Keep soft velocity thresholds useful for review, but make single-signal network
# blocks sufficiently extreme that a busy office/venue or popular campaign is not
# rejected merely for being successful.
replace_once(
    path,
    """    hardVelocityMultiplier: numberEnv('PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER', 2, 2, 5),
    referralRegistrationMax:""",
    """    hardVelocityMultiplier: numberEnv('PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER', 2, 2, 5),
    ipHardRegistrationMax: numberEnv('PARTNER_ABUSE_IP_HARD_REGISTRATION_MAX', 50, 10, 1000),
    referralHardRegistrationMax: numberEnv(
      'PARTNER_ABUSE_REFERRAL_HARD_REGISTRATION_MAX',
      100,
      20,
      5000
    ),
    referralRegistrationMax:""",
)
replace_once(
    path,
    "if (matchingIp.length >= config.ipRegistrationMax * config.hardVelocityMultiplier) {",
    "if (matchingIp.length >= config.ipHardRegistrationMax) {",
)
replace_once(
    path,
    "if (matchingReferral.length >= config.referralRegistrationMax * config.hardVelocityMultiplier) {",
    "if (matchingReferral.length >= config.referralHardRegistrationMax) {",
)
replace_once(
    path,
    "      'AUTOMATION_BROWSER_SIGNAL',\n      70,",
    "      'AUTOMATION_BROWSER_SIGNAL',\n      60,",
)
replace_once(
    path,
    "      addSignal(riskSignals, 'TOR_EXIT_NETWORK', 70, 'Registration originated from a Tor exit.');",
    "      addSignal(riskSignals, 'TOR_EXIT_NETWORK', 45, 'Registration originated from a Tor exit.');",
)
replace_once(
    path,
    "      'PARTNER_SUPPLIER_BUSINESS_OVERLAP',\n      70,",
    "      'PARTNER_SUPPLIER_BUSINESS_OVERLAP',\n      65,",
)

# Future-proof address correlation where a registration flow supplies an address,
# without storing the raw value. Company + address is stronger than address alone.
replace_once(
    path,
    """  const postcode = normalisePostcode(body.postcode || body.postalCode);
  const website = websiteHost(body.website || body.websiteUrl);""",
    """  const postcode = normalisePostcode(body.postcode || body.postalCode);
  const address = normaliseBusinessText(
    body.address || body.addressLine1 || body.streetAddress || body.businessAddress
  );
  const website = websiteHost(body.website || body.websiteUrl);""",
)
replace_once(
    path,
    """    postcodeHash: hmac('postcode', postcode),
    websiteHash: hmac('website', website),""",
    """    postcodeHash: hmac('postcode', postcode),
    addressHash: hmac('address', address),
    websiteHash: hmac('website', website),""",
)
replace_once(
    path,
    """    companyPostcodeHash: hmac('company-postcode', company && postcode ? `${company}|${postcode}` : ''),""",
    """    companyPostcodeHash: hmac('company-postcode', company && postcode ? `${company}|${postcode}` : ''),
    companyAddressHash: hmac('company-address', company && address ? `${company}|${address}` : ''),""",
)
replace_once(
    path,
    """    ['companyPostcodeHash', 'company_postcode'],
  ];""",
    """    ['companyPostcodeHash', 'company_postcode'],
    ['companyAddressHash', 'company_address'],
  ];""",
)
replace_once(
    path,
    """      postcodeHash: signals.postcodeHash,
      websiteHash: signals.websiteHash,""",
    """      postcodeHash: signals.postcodeHash,
      addressHash: signals.addressHash,
      websiteHash: signals.websiteHash,""",
)
replace_once(
    path,
    """      companyPostcodeHash: signals.companyPostcodeHash,
    },""",
    """      companyPostcodeHash: signals.companyPostcodeHash,
      companyAddressHash: signals.companyAddressHash,
    },""",
)

replace_once(
    'db-init.js',
    """      { keys: { companyPostcodeHash: 1, createdAt: -1 }, options: {} },
      { keys: { referralCodeHash: 1, createdAt: -1 }, options: {} },""",
    """      { keys: { companyPostcodeHash: 1, createdAt: -1 }, options: {} },
      { keys: { companyAddressHash: 1, createdAt: -1 }, options: {} },
      { keys: { referralCodeHash: 1, createdAt: -1 }, options: {} },""",
)

# Operational docs should distinguish review thresholds from truly extreme hard limits.
replace_once(
    'docs/PARTNER_ANTI_ABUSE_PR1.md',
    """- `PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER` — multiplier that turns sustained IP/referral/device velocity into a hard abuse limit, default 2.
- `PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX` — referral-code threshold, default 12.""",
    """- `PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER` — multiplier used for stable-device multi-account hard limits, default 2.
- `PARTNER_ABUSE_IP_HARD_REGISTRATION_MAX` — extreme same-IP registration threshold before a single IP signal can block, default 50 per velocity window.
- `PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX` — referral-code review threshold, default 12.
- `PARTNER_ABUSE_REFERRAL_HARD_REGISTRATION_MAX` — extreme referral-code threshold before velocity alone can block, default 100 per velocity window.""",
)
