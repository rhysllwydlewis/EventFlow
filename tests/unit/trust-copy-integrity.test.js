'use strict';

/**
 * Regression guard for SEO-008 / SEO-014 ("Trust and inventory claims are
 * unsupported"). EventFlow's Terms explicitly state that approval only means
 * a listing passed moderation — EventFlow does not verify supplier identity,
 * insurance or capability. These tests exist purely for accuracy, user trust
 * and legal exposure reasons, not because "Verified" wording affects search
 * rankings (it does not — there is no evidence of a ranking effect either way).
 *
 * Two things are guarded here:
 *  1. Public marketing/article copy must never re-introduce the specific
 *     unsupported "hundreds/thousands of verified suppliers"-style claims
 *     this bundle removed, nor any equivalent claim of the same shape.
 *  2. The client-side badge/label code that decides when to show a trust
 *     claim must keep basing it on real evidence, never on the generic
 *     `approved` flag alone.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');

function walk(dir, extensions, exclude = []) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return out;
  }
  for (const entry of entries) {
    if (exclude.includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, extensions, exclude));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const publicHtmlFiles = walk(path.join(REPO_ROOT, 'public'), ['.html']);
const publicJsFiles = walk(path.join(REPO_ROOT, 'public/assets/js'), ['.js'], ['vendor']);
const modelFiles = walk(path.join(REPO_ROOT, 'models'), ['.js']);
const contentFiles = [...publicHtmlFiles, ...publicJsFiles, ...modelFiles];

function readAll(files) {
  return files.map(file => ({ file, content: fs.readFileSync(file, 'utf8') }));
}

const contents = readAll(contentFiles);

// Exact stock phrases removed by this bundle. Each must never silently return
// to tracked content — if one of these legitimately needs reinstating, the
// content (not this denylist) should be the thing that changes.
const REMOVED_PHRASE_DENYLIST = [
  'hundreds of verified suppliers',
  'browse hundreds of verified event suppliers',
  'hundreds of verified caterers',
  'thousands of verified venues',
  'find verified caterers',
  'browse verified photographers',
  'all suppliers are verified and vetted',
  'join over 500+ verified suppliers',
  'grow our verified supplier network',
  'searching for verified event suppliers',
  'connecting customers with verified event suppliers',
  'ask verified suppliers',
];

describe('trust and inventory copy — removed phrases stay removed', () => {
  test.each(REMOVED_PHRASE_DENYLIST)('%s does not reappear in tracked content', phrase => {
    const needle = phrase.toLowerCase();
    const offenders = contents
      .filter(({ content }) => content.toLowerCase().includes(needle))
      .map(({ file }) => path.relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });
});

describe('trust and inventory copy — no re-introduction of the same claim shape', () => {
  // Broad guard: any "hundreds/thousands of (verified) suppliers/vendors/venues/
  // caterers" style claim, worded however, is unsupported without a live count
  // integration and must not appear in tracked public content.
  const INFLATED_COUNT_RE =
    /\b(hundreds|thousands)\s+of\s+(?:verified\s+)?(suppliers?|vendors?|venues?|caterers?)\b/i;

  test('no tracked public file claims an inflated supplier/vendor/venue/caterer count', () => {
    const offenders = [];
    for (const { file, content } of contents) {
      const match = content.match(INFLATED_COUNT_RE);
      if (match) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: "${match[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Broad guard: "verified <supplier-ish noun>" as a bare marketing/trust claim.
  // Real, evidence-backed per-field verification badges (Email/Phone/Business
  // verified, with a verifications.<field>.verified flag) are unaffected — this
  // only catches the generic "verified suppliers/caterers/venues/vendors/
  // photographers" collocation used as an unqualified trust claim in copy.
  const GENERIC_VERIFIED_CLAIM_RE =
    /\bverified(?:[\s,-]+[a-z&-]+){0,3}[\s,-]+(suppliers?|vendors?|venues?|caterers?|photographers?|florists?|entertainers?|sellers?|companies|partners?)\b/i;

  test('no tracked public HTML/article file claims generic "verified suppliers"-style trust', () => {
    const offenders = [];
    for (const { file, content } of readAll(publicHtmlFiles)) {
      const match = content.match(GENERIC_VERIFIED_CLAIM_RE);
      if (match) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: "${match[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('supplier trust badges — approval alone never renders "Verified"', () => {
  const suppliersInitJs = fs.readFileSync(
    path.join(REPO_ROOT, 'public/assets/js/pages/suppliers-init.js'),
    'utf8'
  );
  const appJs = fs.readFileSync(path.join(REPO_ROOT, 'public/assets/js/app.js'), 'utf8');
  const supplierProfileJs = fs.readFileSync(
    path.join(REPO_ROOT, 'public/assets/js/supplier-profile.js'),
    'utf8'
  );
  const polishJs = fs.readFileSync(
    path.join(REPO_ROOT, 'public/assets/js/pages/supplier-profile-public-polish.js'),
    'utf8'
  );

  test('suppliers-init.js supplier-card badge never labels an approved-only supplier "Verified"', () => {
    expect(suppliersInitJs).not.toMatch(/badges\.push\(\s*['"`]<span[^>]*>Verified<\/span>['"`]/);
    expect(suppliersInitJs).toContain('Approved listing');
  });

  test('app.js legacy-field supplierCard fallback never labels an approved-only supplier "Verified"', () => {
    expect(appJs).not.toContain(
      'supplierBadges.push(\'<span class="badge badge-email-verified">Verified</span>\');'
    );
    expect(appJs).toContain('Approved listing');
  });

  test('supplier-profile.js hero/badges/sidebar never label an approved-only supplier "Verified" or "Email verified"', () => {
    expect(supplierProfileJs).not.toMatch(/aria-label="Verified">Verified<\/span>/);
    // `supplier.verified` (a legacy alias for listing approval elsewhere in
    // EventFlow) must never feed an "Email verified" / "Verified" claim.
    const liveCode = supplierProfileJs.replace(/\/\/.*$/gm, '');
    expect(liveCode).not.toContain('supplier.verified');
    expect(supplierProfileJs).toContain('Approved listing');
    expect(supplierProfileJs).toContain('Listing approved');
  });

  test('supplier-profile-public-polish.js corrects mislabeled badges to "Approved listing", never "Verified"', () => {
    expect(polishJs).toContain('Approved listing');
    expect(polishJs).not.toContain("badge.textContent = 'Verified'");
  });

  // Behavioural fixtures mirroring the exact production conditionals: an
  // approved-only supplier (no verifications object, no per-field evidence)
  // must resolve to the honest "Approved listing" claim, never "Verified".
  function suppliersInitBadgeFor(supplier) {
    const badges = [];
    if (supplier.approved) {
      badges.push('Approved listing');
    }
    if (supplier.verifications?.email?.verified) {
      badges.push('Email');
    }
    if (supplier.verifications?.phone?.verified) {
      badges.push('Phone');
    }
    if (supplier.verifications?.business?.verified) {
      badges.push('Business');
    }
    return badges;
  }

  test('an approved-only fixture never receives a bare "Verified" badge', () => {
    const approvedOnly = { id: 'sup_1', approved: true };
    const badges = suppliersInitBadgeFor(approvedOnly);
    expect(badges).toContain('Approved listing');
    expect(badges).not.toContain('Verified');
  });

  test('each evidence-backed verification badge requires its own explicit signal', () => {
    const emailOnly = {
      id: 'sup_2',
      approved: true,
      verifications: { email: { verified: true } },
    };
    const badges = suppliersInitBadgeFor(emailOnly);
    expect(badges).toEqual(['Approved listing', 'Email']);
    expect(badges).not.toContain('Phone');
    expect(badges).not.toContain('Business');
  });

  test('a fully unapproved, unverified fixture receives no trust badge at all', () => {
    const nothing = { id: 'sup_3' };
    expect(suppliersInitBadgeFor(nothing)).toEqual([]);
  });
});

describe('supplier reviewer badge — account type is not a verification claim', () => {
  const reviewsJs = fs.readFileSync(path.join(REPO_ROOT, 'public/assets/js/reviews.js'), 'utf8');

  test('a reviewer with a supplier account is labelled "Supplier", never "Verified Supplier"', () => {
    expect(reviewsJs).not.toContain('Verified Supplier');
    expect(reviewsJs).toContain('badge-supplier">Supplier</span>');
  });
});

describe('accessible names track the corrected visible wording', () => {
  const suppliersInitJs = fs.readFileSync(
    path.join(REPO_ROOT, 'public/assets/js/pages/suppliers-init.js'),
    'utf8'
  );
  const suppliersHtml = fs.readFileSync(path.join(REPO_ROOT, 'public/suppliers.html'), 'utf8');
  const authHtml = fs.readFileSync(path.join(REPO_ROOT, 'public/auth.html'), 'utf8');

  test('suppliers-init.js approved badge aria-label matches its visible text', () => {
    expect(suppliersInitJs).toMatch(/aria-label="Approved listing"[^>]*>Approved listing<\/span>/);
  });

  test('the "Approved only" filter checkbox has no stale "verified" aria-label', () => {
    expect(suppliersHtml).toContain('aria-label="Show approved suppliers only"');
    expect(suppliersHtml).not.toMatch(/aria-label="Show verified suppliers only"/i);
    expect(suppliersHtml).toContain('<span>Approved only</span>');
  });

  test('auth.html trust stat no longer claims supplier profiles are "Verified"', () => {
    expect(authHtml).not.toMatch(/<span class="auth-panel-stat-value">Verified<\/span>/);
    expect(authHtml).toContain('<span class="auth-panel-stat-value">Approved</span>');
  });
});

describe('copy must match the real eligibility gate it describes, not just avoid banned words', () => {
  const adminSettingsHtml = fs.readFileSync(
    path.join(REPO_ROOT, 'public/admin-settings.html'),
    'utf8'
  );
  const actionPromptServiceJs = fs.readFileSync(
    path.join(REPO_ROOT, 'services/actionPromptService.js'),
    'utf8'
  );

  test("the Email Automation section describes actionPromptService.js's real gate (verified email), not listing approval", () => {
    // getSupplierActionItems() gates on role==='supplier' and
    // verified/emailVerified — it never reads a supplier's `approved` flag.
    // A blanket "verified" -> "approved" copy pass once flipped this
    // sentence to claim the opposite of what the code does.
    expect(actionPromptServiceJs).not.toMatch(/supplier[.?]\s*approved/);
    expect(adminSettingsHtml).not.toMatch(/Only approved suppliers[^.]*receive these emails/);
    expect(adminSettingsHtml).toContain(
      'Only suppliers with a verified email address and the setting enabled will receive these emails.'
    );
  });
});

describe('supplier-card-showcase.html (unlinked, noindex, but publicly reachable) matches the site-wide badge fix', () => {
  const showcaseHtml = fs.readFileSync(
    path.join(REPO_ROOT, 'public/supplier-card-showcase.html'),
    'utf8'
  );

  test('no longer uses the removed sp-badge--verified class or bare "Verified" claim', () => {
    expect(showcaseHtml).not.toContain('sp-badge--verified');
    expect(showcaseHtml).not.toMatch(/>\s*✓\s*Verified\s*</);
    expect(showcaseHtml).toContain('sp-badge--approved');
  });
});
