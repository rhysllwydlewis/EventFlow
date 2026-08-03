/**
 * Unit tests for the EventFlow Community moderation and anti-spam engine.
 *
 * These are the rules that keep the community usable, so they are tested
 * directly rather than only through the API.
 */

'use strict';

const moderation = require('../../services/communityModeration.service');
const { TRUST_TIERS, CONTENT_STATES } = require('../../models/CommunityContent');

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
