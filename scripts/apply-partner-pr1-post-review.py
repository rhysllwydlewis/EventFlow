from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected PR1 post-review marker not found in {path}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1))


# Canonicalise UK telephone numbers so +44 7... and 07... correlate consistently.
phone_old = """function normalisePhone(value) {
  const digits = String(value || '').replace(/\\D/g, '');
  return digits.length >= 7 ? digits : '';
}"""
phone_new = """function normalisePhone(value) {
  let digits = String(value || '').replace(/\\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('44') && digits.length >= 11) return digits;
  if (digits.startsWith('0') && digits.length >= 10) return `44${digits.slice(1)}`;
  return digits.length >= 7 ? digits : '';
}"""
replace_once('services/partnerRegistrationRiskService.js', phone_old, phone_new)
replace_once('services/partnerAntiAbuseService.js', phone_old, phone_new)

# Historical versions of PR1 briefly wrote attempt + created as separate events with the same
# assessmentId. Deduplicate those records so velocity is never inflated while they age out.
replace_once(
    'services/partnerRegistrationRiskService.js',
    """async function loadRegistrationEvents({ now, config, canonicalEmailHash }) {
  const retentionCutoffIso = new Date(now.getTime() - config.retentionDays * 86400000).toISOString();""",
    """function dedupeRegistrationEvents(events) {
  const rank = { blocked: 3, created: 2, attempt: 1 };
  const selected = new Map();
  for (const event of events || []) {
    const key = event.assessmentId || event.id;
    if (!key) continue;
    const current = selected.get(key);
    if (!current || (rank[event.outcome] || 0) > (rank[current.outcome] || 0)) {
      selected.set(key, event);
    }
  }
  return [...selected.values()];
}

async function loadRegistrationEvents({ now, config, canonicalEmailHash }) {
  const retentionCutoffIso = new Date(now.getTime() - config.retentionDays * 86400000).toISOString();""",
)
replace_once(
    'services/partnerRegistrationRiskService.js',
    """    return { primaryEvents: primaryEvents || [], canonicalEvents: canonicalEvents || [] };
  }

  const allEvents =""",
    """    return {
      primaryEvents: dedupeRegistrationEvents(primaryEvents || []),
      canonicalEvents: canonicalEvents || [],
    };
  }

  const allEvents =""",
)
replace_once(
    'services/partnerRegistrationRiskService.js',
    """  return {
    primaryEvents: retained.filter(event => primaryOutcomes.includes(event.outcome)),
    canonicalEvents: canonicalEmailHash""",
    """  return {
    primaryEvents: dedupeRegistrationEvents(
      retained.filter(event => primaryOutcomes.includes(event.outcome))
    ),
    canonicalEvents: canonicalEmailHash""",
)
replace_once(
    'services/partnerRegistrationRiskService.js',
    """    recentEvents,
  },
};""",
    """    recentEvents,
    dedupeRegistrationEvents,
    normalisePhone,
  },
};""",
)

# Production must never silently bypass proof-of-work verification if dependency injection breaks.
replace_once(
    'routes/partner-registration-secure.js',
    """      const { firstName, lastName, email, password, location, company, captchaToken } = req.body || {};
      if (_verifyAltcha) {""",
    """      const { firstName, lastName, email, password, location, company, captchaToken } = req.body || {};
      if (!_verifyAltcha && process.env.NODE_ENV === 'production') {
        logger.error('[PARTNER-REGISTER] CAPTCHA verifier is unavailable in production');
        return res.status(503).json({
          error: 'Registration verification is temporarily unavailable. Please try again later.',
          code: 'CAPTCHA_VERIFIER_UNAVAILABLE',
        });
      }
      if (_verifyAltcha) {""",
)

# Make the first-party anti-abuse cookie retention transparent in the public notice.
replace_once(
    'public/privacy.html',
    """<strong>First-Party Anti-Abuse Device Token:</strong> A random, HTTP-only first-party cookie may be used to recognise repeated registration activity from the same browser. EventFlow stores a protected HMAC representation in anti-abuse event records rather than the raw token.""",
    """<strong>First-Party Anti-Abuse Device Token:</strong> A random, HTTP-only first-party cookie may be used to recognise repeated registration activity from the same browser. The token may remain in the browser for the configured anti-abuse device period (180 days by default), while EventFlow stores only a protected HMAC representation in anti-abuse event records rather than the raw token.""",
)

# Focused regressions for historical event dedupe, phone canonicalisation and CAPTCHA fail-closed.
final_test = Path('tests/unit/partner-registration-final-review.test.js')
text = final_test.read_text()
if "deduplicates historical attempt and created records" not in text:
    text += """

test('deduplicates historical attempt and created records for the same assessment', () => {
  const dedupe = service._private.dedupeRegistrationEvents;
  const events = [
    { id: 'a1', assessmentId: 'assessment_1', outcome: 'attempt' },
    { id: 'a2', assessmentId: 'assessment_1', outcome: 'created' },
    { id: 'b1', assessmentId: 'assessment_2', outcome: 'blocked' },
  ];
  expect(dedupe(events)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ assessmentId: 'assessment_1', outcome: 'created' }),
      expect.objectContaining({ assessmentId: 'assessment_2', outcome: 'blocked' }),
    ])
  );
  expect(dedupe(events)).toHaveLength(2);
});

test('canonicalises UK national and +44 phone formats to the same protected identity', () => {
  const national = service._private.normalisePhone('07700 900123');
  const international = service._private.normalisePhone('+44 7700 900123');
  expect(national).toBe('447700900123');
  expect(international).toBe(national);
});
"""
    final_test.write_text(text)

identity_test = Path('tests/unit/partner-anti-abuse-identity.test.js')
identity_text = identity_test.read_text()
if "matches equivalent UK phone formats" not in identity_text:
    identity_text += """

test('matches equivalent UK phone formats as the same business identity', () => {
  expect(
    antiAbuse.identityOverlap(
      { phone: '+44 7700 900123' },
      { phoneNumber: '07700 900123' }
    )
  ).toEqual(expect.objectContaining({ samePhone: true, strongMatch: true }));
});
"""
    identity_test.write_text(identity_text)

captcha_test = Path('tests/unit/partner-registration-captcha.test.js')
captcha_text = captcha_test.read_text()
if "fails closed when the CAPTCHA verifier is unavailable in production" not in captcha_text:
    captcha_text += """

test('fails closed when the CAPTCHA verifier is unavailable in production', async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  router.initializeDependencies({});
  try {
    const response = await request(buildApp()).post('/api/partner/register').send(validPayload());
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CAPTCHA_VERIFIER_UNAVAILABLE');
    expect(mockDb.insertOne).not.toHaveBeenCalledWith('users', expect.anything());
  } finally {
    process.env.NODE_ENV = previousEnv;
  }
});
"""
    captcha_test.write_text(captcha_text)
