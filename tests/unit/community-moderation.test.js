/**
 * Unit tests for the EventFlow Community moderation and anti-spam engine.
 *
 * These are the rules that keep the community usable, so they are tested
 * directly rather than only through the API.
 */

'use strict';

const moderation = require('../../services/communityModeration.service');
const { TRUST_TIERS, CONTENT_STATES, LIMITS } = require('../../models/CommunityContent');

describe('community moderation — links', () => {
  it('extracts every http and https URL from a body', () => {
    const urls = moderation.extractUrls(
      'See https://example.com/guide and http://other.example.co.uk/page for details.'
    );
    expect(urls).toEqual(['https://example.com/guide', 'http://other.example.co.uk/page']);
  });

  it('rejects unsafe URL schemes', () => {
    expect(moderation.isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(moderation.isSafeUrl('data:text/html;base64,AAAA')).toBe(false);
    expect(moderation.isSafeUrl('vbscript:msgbox')).toBe(false);
    expect(moderation.isSafeUrl('https://example.com')).toBe(true);
  });

  it('treats EventFlow hosts as internal', () => {
    expect(moderation.isInternalDomain('event-flow.co.uk')).toBe(true);
    expect(moderation.isInternalDomain('www2.event-flow.co.uk')).toBe(true);
    expect(moderation.isInternalDomain('example.com')).toBe(false);
  });

  it('blocks built-in high-risk domains and operator blocklist entries', () => {
    expect(moderation.isBlockedDomain('bigcasino777.com')).toBe(true);
    expect(moderation.isBlockedDomain('mega-casino.net')).toBe(true);
    expect(moderation.isBlockedDomain('cracked-software.net')).toBe(true);
    expect(
      moderation.isBlockedDomain('spammer.example', { blockedDomains: ['spammer.example'] })
    ).toBe(true);
    expect(
      moderation.isBlockedDomain('sub.spammer.example', { blockedDomains: ['spammer.example'] })
    ).toBe(true);
  });

  it('does not block legitimate supplier domains that merely contain a risky substring', () => {
    // `bet` in betterevents, `crack` in crackerbarrel, `slot` in slotting: the
    // boundary-anchored patterns exist precisely so these stay linkable.
    expect(moderation.isBlockedDomain('betterevents.co.uk')).toBe(false);
    expect(moderation.isBlockedDomain('crackerbarrelcatering.com')).toBe(false);
    expect(moderation.isBlockedDomain('slottingsolutions.com')).toBe(false);
  });

  it('lets the allow list override a block', () => {
    const settings = { blockedDomains: ['partner.example'], allowedDomains: ['partner.example'] };
    expect(moderation.isBlockedDomain('partner.example', settings)).toBe(false);
  });

  it('adds ugc, nofollow, noopener and noreferrer to external links', () => {
    const html = moderation.applyLinkPolicy('<a href="https://example.com">Example</a>', {
      clickable: true,
    });
    expect(html).toContain('rel="ugc nofollow noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('does not add nofollow to internal EventFlow links', () => {
    const html = moderation.applyLinkPolicy(
      '<a href="https://event-flow.co.uk/suppliers">Suppliers</a>',
      { clickable: true }
    );
    expect(html).not.toContain('nofollow');
  });

  it('downgrades external links to plain text for accounts without link privileges', () => {
    const html = moderation.applyLinkPolicy('<a href="https://example.com">Example</a>', {
      clickable: false,
    });
    expect(html).not.toContain('<a ');
    expect(html).toContain('Example');
    expect(html).toContain('https://example.com');
  });

  it('strips links to blocked domains entirely', () => {
    const html = moderation.applyLinkPolicy('<a href="https://mega-casino.com">Win big</a>', {
      clickable: true,
    });
    expect(html).not.toContain('mega-casino.com');
  });

  it('removes javascript: anchors', () => {
    const html = moderation.applyLinkPolicy('<a href="javascript:alert(1)">Click</a>', {
      clickable: true,
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Click');
  });
});

describe('community moderation — body preparation', () => {
  it('strips script tags and produces a plain-text copy', () => {
    const prepared = moderation.prepareBody(
      '<p>Hello <strong>there</strong></p><script>alert(1)</script>'
    );
    expect(prepared.html).not.toContain('script');
    expect(prepared.text).toBe('Hello there');
  });

  it('removes event-handler attributes', () => {
    const prepared = moderation.prepareBody('<p onclick="steal()">Hi there everyone</p>');
    expect(prepared.html).not.toContain('onclick');
  });

  it('leaves a realistic long post untouched by the raw-input ceiling', () => {
    const long = `<p>${'A detailed, first-hand account of the day. '.repeat(300)}</p>`;
    const prepared = moderation.prepareBody(long);
    // Within a character or two of the source text length — the ceiling only
    // bites on content far larger than any legitimate post.
    expect(prepared.text.length).toBeGreaterThan(long.length - 10);
  });

  // sanitizeContent's underlying HTML parser is not linear on adversarial
  // markup (many small, alternating tags) — measured independently at ~900ms
  // for content at exactly LIMITS.BODY_MAX and 11+ seconds at 8x that length.
  // Every route validates length only *after* prepareBody has already run
  // sanitizeContent, so nothing else stood between an oversized raw payload
  // and an expensive parse. prepareBody now bounds the raw input itself.
  it('bounds a hostile discussion body to a fixed time regardless of its size', () => {
    const hostile = '<script>a</script><style>b</style><b>c</b>'.repeat(50000);
    const started = Date.now();
    moderation.prepareBody(hostile, { clickable: true, settings: {} });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('bounds a hostile reply body to a tighter fixed time, matching its shorter limit', () => {
    const hostile = '<script>a</script><style>b</style><b>c</b>'.repeat(50000);
    const started = Date.now();
    moderation.prepareBody(hostile, { clickable: true, settings: {}, isReply: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('community moderation — duplicate detection', () => {
  it('scores identical text as fully similar', () => {
    const text = 'Looking for a marquee supplier in Kent for a September wedding';
    expect(moderation.similarity(text, text)).toBe(1);
  });

  it('scores unrelated text as dissimilar', () => {
    expect(
      moderation.similarity(
        'Looking for a marquee supplier in Kent',
        'Best playlist for a corporate awards dinner'
      )
    ).toBeLessThan(0.2);
  });

  it('produces a stable fingerprint that ignores punctuation and case', () => {
    expect(moderation.fingerprint('Hello, World!')).toBe(moderation.fingerprint('hello world'));
    expect(moderation.fingerprint('Hello world')).not.toBe(moderation.fingerprint('Goodbye world'));
  });
});

describe('community moderation — trust tiers', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  it('treats unverified accounts as restricted', () => {
    expect(moderation.computeTrustTier({ user: { verified: false }, now })).toBe(
      TRUST_TIERS.RESTRICTED
    );
  });

  it('treats an account with an active restriction as restricted', () => {
    expect(
      moderation.computeTrustTier({
        user: { verified: true, createdAt: '2020-01-01' },
        restriction: { active: true },
        now,
      })
    ).toBe(TRUST_TIERS.RESTRICTED);
  });

  it('holds back accounts with repeated upheld reports', () => {
    expect(
      moderation.computeTrustTier({
        user: { verified: true, createdAt: '2020-01-01' },
        stats: { discussions: 200, replies: 400, helpfulAnswers: 50, upheldReports: 2 },
        now,
      })
    ).toBe(TRUST_TIERS.RESTRICTED);
  });

  it('classes a brand new verified account as new', () => {
    expect(
      moderation.computeTrustTier({
        user: { verified: true, createdAt: '2026-07-30T00:00:00.000Z' },
        now,
      })
    ).toBe(TRUST_TIERS.NEW);
  });

  it('promotes an established account after activity and time', () => {
    expect(
      moderation.computeTrustTier({
        user: { verified: true, createdAt: '2026-06-01T00:00:00.000Z' },
        stats: { discussions: 3, replies: 6 },
        now,
      })
    ).toBe(TRUST_TIERS.ESTABLISHED);
  });

  it('requires helpful answers as well as volume for the trusted tier', () => {
    const base = { user: { verified: true, createdAt: '2025-01-01T00:00:00.000Z' }, now };
    expect(
      moderation.computeTrustTier({
        ...base,
        stats: { discussions: 50, replies: 100, helpfulAnswers: 0 },
      })
    ).toBe(TRUST_TIERS.ESTABLISHED);
    expect(
      moderation.computeTrustTier({
        ...base,
        stats: { discussions: 50, replies: 100, helpfulAnswers: 10 },
      })
    ).toBe(TRUST_TIERS.TRUSTED);
  });

  it('always treats staff as staff', () => {
    expect(moderation.computeTrustTier({ user: { verified: false }, isStaff: true })).toBe(
      TRUST_TIERS.STAFF
    );
  });

  it('gives restricted accounts no link allowance', () => {
    expect(moderation.policyFor(TRUST_TIERS.RESTRICTED).maxLinks).toBe(0);
    expect(moderation.policyFor(TRUST_TIERS.NEW).linksClickable).toBe(false);
    expect(moderation.policyFor(TRUST_TIERS.ESTABLISHED).linksClickable).toBe(true);
  });
});

describe('community moderation — thread freshness', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  it('marks a discussion started over a year ago as old', () => {
    const verdict = moderation.assessFreshness(
      { createdAt: '2023-01-01T00:00:00.000Z', lastActivityAt: '2026-07-30T00:00:00.000Z' },
      now
    );
    expect(verdict.isOld).toBe(true);
    expect(verdict.isDormant).toBe(false);
    expect(verdict.freshness).toBe('recent');
  });

  it('marks a discussion quiet for six months as dormant', () => {
    const verdict = moderation.assessFreshness(
      { createdAt: '2024-01-01T00:00:00.000Z', lastActivityAt: '2025-01-01T00:00:00.000Z' },
      now
    );
    expect(verdict.isDormant).toBe(true);
    expect(verdict.freshness).toBe('archive');
  });

  it('treats a brand new discussion as current and recent', () => {
    const verdict = moderation.assessFreshness(
      { createdAt: '2026-07-28T00:00:00.000Z', lastActivityAt: '2026-07-31T00:00:00.000Z' },
      now
    );
    expect(verdict.isOld).toBe(false);
    expect(verdict.freshness).toBe('recent');
  });
});

describe('community moderation — domain summary', () => {
  it('counts bare domains typed without a scheme', () => {
    const summary = moderation.summariseDomains('Try cheap-marquees.example for prices');
    expect(summary.domains).toContain('cheap-marquees.example');
  });

  it('ignores file names that look like hostnames', () => {
    const summary = moderation.summariseDomains('The file is called invoice.pdf');
    expect(summary.domains).toEqual([]);
  });

  it('does not count EventFlow links against the allowance', () => {
    const summary = moderation.summariseDomains('See https://event-flow.co.uk/guides for more');
    expect(summary.domains).toEqual([]);
  });

  it('finds bare domains wherever punctuation surrounds them', () => {
    const summary = moderation.summariseDomains(
      '(marquees.example), "tents.example"; and www.chairs.example.'
    );
    expect(summary.domains).toEqual(
      expect.arrayContaining(['marquees.example', 'tents.example', 'chairs.example'])
    );
  });

  it('rejects tokens that are not hostnames', () => {
    expect(moderation.extractBareDomains('e.g. the price is 3.5 or 10.00')).toEqual([]);
    expect(moderation.extractBareDomains('double..dots.example')).toEqual([]);
    expect(moderation.extractBareDomains(`${'a'.repeat(64)}.example`)).toEqual([]);
  });

  it('trims leading and trailing dots and hyphens from a token', () => {
    expect(moderation.extractBareDomains('--marquees.example--')).toEqual(['marquees.example']);
    expect(moderation.extractBareDomains('..marquees.example..')).toEqual(['marquees.example']);
  });

  // CodeQL flags the trim as a possible polynomial regex on strings with many
  // repetitions of '-'; measured directly it is linear in this runtime, but
  // it was rewritten to a character scan regardless. This pins the timing.
  it('trims a huge run of hyphens promptly', () => {
    const started = Date.now();
    expect(moderation.extractBareDomains('-'.repeat(500000))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  // A body is attacker-controlled and can reach the length limit, so domain
  // detection must not be quadratic in the number of dot-separated labels.
  it('scans a hostile chain of labels in linear time', () => {
    const hostile = `${'a.'.repeat(5000)}!`;
    const started = Date.now();
    expect(moderation.summariseDomains(hostile).domains).toEqual([]);
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('community moderation — hostile input cannot stall the event loop', () => {
  // LIMITS.BODY_MAX, not bodyMax: the lower-case spelling silently fell through
  // to the literal, so these sizes stopped tracking the real limit.
  const LIMIT = LIMITS.BODY_MAX;

  // Every one of these was measured against the expression it targets before
  // the fix: the WhatsApp phrase ran for 20 seconds on 4,000 spaces, and the
  // anchor rewriter took over 100ms on a body of unterminated "<a " and
  // quadrupled each time the input doubled. Both ran on every submission.
  const bodies = {
    'promotional phrase followed by whitespace': `whatsapp${' '.repeat(LIMIT)}`,
    'unterminated anchor openings': '<a '.repeat(Math.floor(LIMIT / 3)),
    'anchors that are never closed': '<a x>'.repeat(Math.floor(LIMIT / 5)),
    'a long chain of hostname labels': `${'a.'.repeat(LIMIT / 2)}!`,
    'a run of dots': '.'.repeat(LIMIT),
    'a run of hyphens': '-'.repeat(LIMIT),
    'a run of whitespace': ' '.repeat(LIMIT),
    'a run of digits': `0${'1 '.repeat(LIMIT / 2)}`,
    'one enormous mention': `@${'a'.repeat(LIMIT)}`,
    'a phone-like digit run': `contact us on 1${'1 '.repeat(LIMIT / 2)}`,
    'an unterminated href': '<a href="'.repeat(Math.floor(LIMIT / 9)),
    'a slash run inside an anchor': `whatsapp <a href="${'/'.repeat(LIMIT / 2)}">x`,
  };

  Object.entries(bodies).forEach(([description, body]) => {
    it(`assesses ${description} promptly`, () => {
      const started = Date.now();
      const verdict = moderation.assessContent({
        title: 'Hostile input',
        body,
        trustTier: TRUST_TIERS.NEW,
        settings: {},
        now: new Date(),
      });
      expect(verdict).toBeTruthy();
      // Generous next to the ~2ms this actually takes, but far below the
      // seconds a backtracking regression would cost.
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });
});

describe('community moderation — promotional phrases still match', () => {
  it('recognises a WhatsApp number handover in its usual forms', () => {
    [
      'whatsapp me on +44 7700 900123',
      'whatsapp us at 07700900123',
      'whatsapp +447700900123',
      'WhatsApp me 07700900123',
      'whatsapp  me  on  +44123',
    ].forEach(text => {
      expect(moderation.detectPromotionalLanguage(text).length).toBeGreaterThan(0);
    });
  });

  it('leaves ordinary mentions of WhatsApp alone', () => {
    ['we used whatsapp to chat', 'is there a whatsapp group?', 'whatsapp me for a quote'].forEach(
      text => {
        expect(moderation.detectPromotionalLanguage(text)).toEqual([]);
      }
    );
  });
});

describe('community moderation — content assessment', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const settings = { quarantineLowTrustLinks: true };

  it('publishes ordinary advice from an established member', () => {
    const verdict = moderation.assessContent({
      text: 'We used a local florist and they were brilliant. Book early for a summer date.',
      title: 'Florist recommendations for a July wedding',
      trustTier: TRUST_TIERS.ESTABLISHED,
      settings,
      now,
    });
    expect(verdict.decision).toBe('publish');
    expect(verdict.state).toBe(CONTENT_STATES.PUBLISHED);
  });

  it('rejects content linking to a blocked domain', () => {
    const verdict = moderation.assessContent({
      text: 'Play now at https://super-casino.com and win',
      trustTier: TRUST_TIERS.TRUSTED,
      settings,
      now,
    });
    expect(verdict.decision).toBe('reject');
    expect(verdict.signals.join(' ')).toContain('blocked_domain');
  });

  it('holds a low-trust reply that adds a link to a dormant thread', () => {
    const verdict = moderation.assessContent({
      text: 'Great thread! We offer the same service, see https://promo.example for prices.',
      trustTier: TRUST_TIERS.NEW,
      settings,
      thread: {
        createdAt: '2019-05-01T00:00:00.000Z',
        lastActivityAt: '2019-06-01T00:00:00.000Z',
      },
      now,
    });
    expect(verdict.decision).toBe('review');
    expect(verdict.signals).toContain('dormant_thread_link_from_low_trust');
  });

  it('still publishes a link-free reply to a dormant thread', () => {
    const verdict = moderation.assessContent({
      text: 'Just to update this old thread: the venue has changed hands and is open again.',
      trustTier: TRUST_TIERS.NEW,
      settings,
      thread: {
        createdAt: '2019-05-01T00:00:00.000Z',
        lastActivityAt: '2019-06-01T00:00:00.000Z',
      },
      now,
    });
    expect(verdict.decision).toBe('publish');
  });

  it('lets a trusted member link on a dormant thread', () => {
    const verdict = moderation.assessContent({
      text: 'The current guidance is on https://example.com/guide now.',
      trustTier: TRUST_TIERS.TRUSTED,
      settings,
      thread: {
        createdAt: '2019-05-01T00:00:00.000Z',
        lastActivityAt: '2019-06-01T00:00:00.000Z',
      },
      now,
    });
    expect(verdict.decision).toBe('publish');
  });

  it('holds near-duplicate posts from the same account', () => {
    const text = 'Book your event photography with us today, best price guaranteed in the region';
    const verdict = moderation.assessContent({
      text,
      trustTier: TRUST_TIERS.ESTABLISHED,
      settings,
      recentPosts: [{ text, createdAt: now.toISOString() }],
      now,
    });
    expect(verdict.signals).toContain('duplicate_content');
    expect(verdict.decision).toBe('review');
  });

  it('holds everything from a restricted account', () => {
    const verdict = moderation.assessContent({
      text: 'A perfectly ordinary reply about seating plans.',
      trustTier: TRUST_TIERS.RESTRICTED,
      settings,
      now,
    });
    expect(verdict.decision).toBe('review');
  });

  it('flags promotional language', () => {
    const verdict = moderation.assessContent({
      text: 'CLICK HERE to buy now, limited time offer, whatsapp me on +447700900000',
      trustTier: TRUST_TIERS.ESTABLISHED,
      settings,
      now,
    });
    expect(verdict.signals.join(' ')).toContain('promotional_language');
    expect(verdict.decision).toBe('review');
  });

  it('never exposes a decision without its reasons', () => {
    const verdict = moderation.assessContent({
      text: 'Something ordinary about cake tasting appointments.',
      trustTier: TRUST_TIERS.ESTABLISHED,
      settings,
      now,
    });
    expect(Array.isArray(verdict.signals)).toBe(true);
    expect(typeof verdict.score).toBe('number');
  });
});

describe('community moderation — validation and privacy', () => {
  it('rejects a title that is too short', () => {
    const result = moderation.validateLength({ title: 'Help', text: 'x'.repeat(50) });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Title');
  });

  it('rejects a body that is too short', () => {
    const result = moderation.validateLength({ title: 'A perfectly fine title', text: 'short' });
    expect(result.valid).toBe(false);
  });

  it('accepts content within the limits', () => {
    const result = moderation.validateLength({
      title: 'Recommendations for a marquee in Kent',
      text: 'We are planning a September wedding and need a marquee for about 120 guests.',
    });
    expect(result.valid).toBe(true);
  });

  it('applies the shorter reply limits', () => {
    expect(moderation.validateLength({ text: 'Yes', isReply: true }).valid).toBe(true);
    expect(moderation.validateLength({ text: 'Yes' }).valid).toBe(false);
  });

  it('detects personal information a member may not have meant to publish', () => {
    const found = moderation.detectPersonalInformation(
      'Call me on 07700 900000 or email me at someone@example.com, I am at SW1A 1AA'
    );
    expect(found).toEqual(expect.arrayContaining(['phone_number', 'email_address', 'postcode']));
  });

  it('does not flag ordinary prose as personal information', () => {
    expect(moderation.detectPersonalInformation('We booked a band for the evening.')).toEqual([]);
  });
});
