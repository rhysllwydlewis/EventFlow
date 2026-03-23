/**
 * Mop-up audit tests — reconciles PRs #758, #759, #761
 *
 * Prevents regressions in:
 *  1. POST /api/packages/bulk requires authentication (PR #758 alignment)
 *  2. Budget "retry on next visit" is actually implemented (PR #758)
 *  3. No stale/mismatched category names in JS component defaults
 *  4. VALID_CATEGORIES is the single source of truth (services + routes import from model)
 *  5. Admin debug status route is always mounted (PR #759)
 *  6. Supplier category dropdowns in HTML match VALID_CATEGORIES
 *  7. Public calendar page category options match VALID_CATEGORIES (PR #761)
 *  8. No native confirm() in public-facing pages (quality / accessibility)
 *  9. Client-side publisher category list matches server-side PUBLISHER_CATEGORIES
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------
const suppliersSrc = fs.readFileSync(path.join(__dirname, '../../routes/suppliers.js'), 'utf8');
const customerInitSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/dashboard-customer-init.js'),
  'utf8'
);
const globalSearchSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/components/global-search.js'),
  'utf8'
);
const supplierServiceSrc = fs.readFileSync(
  path.join(__dirname, '../../services/supplier.service.js'),
  'utf8'
);
const catalogRouteSrc = fs.readFileSync(path.join(__dirname, '../../routes/catalog.js'), 'utf8');
const routesIndexSrc = fs.readFileSync(path.join(__dirname, '../../routes/index.js'), 'utf8');
const dashboardSupplierHtml = fs.readFileSync(
  path.join(__dirname, '../../public/dashboard-supplier.html'),
  'utf8'
);
const adminSuppliersHtml = fs.readFileSync(
  path.join(__dirname, '../../public/admin-suppliers.html'),
  'utf8'
);
const publicCalendarHtml = fs.readFileSync(
  path.join(__dirname, '../../public/public-calendar.html'),
  'utf8'
);
const publicCalendarInitSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/public-calendar-init.js'),
  'utf8'
);

const { VALID_CATEGORIES, PUBLISHER_CATEGORIES } = require('../../models/Supplier');

// ---------------------------------------------------------------------------
// 1. POST /api/packages/bulk — must require authentication
// ---------------------------------------------------------------------------
describe('routes/suppliers.js — POST /api/packages/bulk auth enforcement', () => {
  it('bulk route is defined', () => {
    expect(suppliersSrc).toContain("router.post('/packages/bulk'");
  });

  it('bulk route middleware chain includes auth before the handler', () => {
    // The route must include applyAuthRequired (or authRequired) before the async handler.
    // This aligns the implementation with the JSDoc comment that says
    // "Requires authentication so that only logged-in customers can resolve packages".
    const bulkStart = suppliersSrc.indexOf("router.post('/packages/bulk'");
    expect(bulkStart).not.toBe(-1);

    // Everything between the route declaration and the first "async (req, res)"
    const handlerStart = suppliersSrc.indexOf('async (req, res)', bulkStart);
    const middlewareSection = suppliersSrc.substring(bulkStart, handlerStart);

    expect(middlewareSection).toMatch(/applyAuthRequired|authRequired/);
  });
});

// ---------------------------------------------------------------------------
// 2. Budget retry on next visit — implementation must exist
// ---------------------------------------------------------------------------
describe('dashboard-customer-init.js — budget retry on next visit', () => {
  // Extract the setupEventHandlers function body for targeted assertions
  const setupStart = customerInitSrc.indexOf('function setupEventHandlers(');
  // Find the next top-level function declaration after setupEventHandlers
  const setupEnd = customerInitSrc.indexOf('\nfunction ', setupStart + 1);
  const setupBody =
    setupStart !== -1
      ? customerInitSrc.substring(setupStart, setupEnd === -1 ? customerInitSrc.length : setupEnd)
      : '';

  it('setupEventHandlers function is defined', () => {
    expect(setupStart).not.toBe(-1);
  });

  it('setupEventHandlers attempts a PATCH when server plan has no budget but localStorage does', () => {
    // The retry should only fire when the server plan is missing a budget
    // (i.e. when budgetFromPlan is falsy) but localStorage has one.
    expect(setupBody).toMatch(/!budgetFromPlan/);
    expect(setupBody).toMatch(/localStorage.*budget|lsBudgetForRetry/);
  });

  it('retry sends a PATCH request to the plans endpoint', () => {
    expect(setupBody).toContain("method: 'PATCH'");
    expect(setupBody).toContain('/api/me/plans/');
  });

  it('retry includes CSRF token', () => {
    expect(setupBody).toContain('getCsrfToken()');
  });

  it('retry is fire-and-forget (wrapped in immediately-invoked async arrow)', () => {
    // The retry must not block the synchronous setup — wrapped in (async () => { ... })()
    expect(setupBody).toMatch(/\(async\s*\(\)\s*=>/);
  });

  it('retry message in UI copy (warning text) matches the implementation', () => {
    // The "will be retried on next visit" copy must be present
    expect(customerInitSrc).toContain('retried on next visit');
  });
});

// ---------------------------------------------------------------------------
// 3. Category name consistency — no stale/non-canonical names in JS defaults
// ---------------------------------------------------------------------------
describe('global-search.js — category name consistency', () => {
  it('does not use stale "Florists" (plural) — canonical name is "Florist"', () => {
    // "Florists" was the old name before the category list was canonicalized.
    // Using it in any dropdown default causes mismatched filtering.
    expect(globalSearchSrc).not.toContain("'Florists'");
    expect(globalSearchSrc).not.toContain('"Florists"');
  });

  it('any category names used in the default list are canonical VALID_CATEGORIES entries', () => {
    // Extract the default categories array from the source
    const match = globalSearchSrc.match(
      /categories:\s*options\.categories\s*\|\|\s*\[([\s\S]*?)\]/
    );
    if (!match) {
      // If no hardcoded default exists the component is fine
      return;
    }
    const arrayBody = match[1];
    // Pull out each quoted string
    const entries = [...arrayBody.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    // Every entry except "All" (UI-only) must be in VALID_CATEGORIES
    const invalid = entries.filter(e => e !== 'All' && !VALID_CATEGORIES.includes(e));
    expect(invalid).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. VALID_CATEGORIES — single source of truth
// ---------------------------------------------------------------------------
describe('VALID_CATEGORIES single source of truth', () => {
  it('supplier.service.js imports VALID_CATEGORIES from models/Supplier', () => {
    expect(supplierServiceSrc).toMatch(/require.*models\/Supplier/);
    expect(supplierServiceSrc).toMatch(/VALID_CATEGORIES/);
  });

  it('routes/catalog.js imports VALID_CATEGORIES from models/Supplier', () => {
    expect(catalogRouteSrc).toMatch(/require.*models\/Supplier/);
    expect(catalogRouteSrc).toMatch(/VALID_CATEGORIES/);
  });

  it('VALID_CATEGORIES contains at least 20 entries', () => {
    expect(VALID_CATEGORIES.length).toBeGreaterThanOrEqual(20);
  });

  it('VALID_CATEGORIES has no duplicates', () => {
    const unique = new Set(VALID_CATEGORIES);
    expect(unique.size).toBe(VALID_CATEGORIES.length);
  });

  it('VALID_CATEGORIES includes all required expanded types', () => {
    const required = [
      'Entertainment',
      'Music/DJ',
      'Beauty',
      'Florist',
      'Decor',
      'Cake',
      'Stationery',
      'Transport',
      'Bridalwear',
      'Jewellery',
      'Celebrant',
      'Videography',
      'Event Planner',
      'Wedding Fayre',
    ];
    for (const cat of required) {
      expect(VALID_CATEGORIES).toContain(cat);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Admin debug status route — always mounted (PR #759)
// ---------------------------------------------------------------------------
describe('routes/index.js — admin-debug-status always mounted', () => {
  it('requires admin-debug-status.js', () => {
    expect(routesIndexSrc).toMatch(/require.*admin-debug-status/);
  });

  it('mounts the status router on /api/admin/debug', () => {
    expect(routesIndexSrc).toMatch(/app\.use\(['"]\/api.*admin.*debug/);
  });

  it('calls setDebugRoutesStatus() to record enabled/disabled state', () => {
    expect(routesIndexSrc).toContain('setDebugRoutesStatus(');
  });
});

// ---------------------------------------------------------------------------
// 6. Supplier category HTML dropdowns — match VALID_CATEGORIES
// ---------------------------------------------------------------------------
describe('dashboard-supplier.html category dropdown', () => {
  it('contains all VALID_CATEGORIES as <option> elements', () => {
    for (const cat of VALID_CATEGORIES) {
      // Match both plain and HTML-entity-escaped versions
      const escaped = cat.replace(/&/g, '&amp;');
      const present =
        dashboardSupplierHtml.includes(`<option>${cat}</option>`) ||
        dashboardSupplierHtml.includes(`<option>${escaped}</option>`);
      expect(present).toBe(true);
    }
  });

  it('does not contain stale slugged options (e.g. "flowers", "hair-makeup")', () => {
    expect(dashboardSupplierHtml).not.toContain('<option>flowers</option>');
    expect(dashboardSupplierHtml).not.toContain('<option>hair-makeup</option>');
    expect(dashboardSupplierHtml).not.toContain('<option>extras</option>');
  });
});

describe('admin-suppliers.html category filter', () => {
  it('contains all VALID_CATEGORIES as <option> elements', () => {
    for (const cat of VALID_CATEGORIES) {
      const escaped = cat.replace(/&/g, '&amp;');
      const present =
        adminSuppliersHtml.includes(`<option>${cat}</option>`) ||
        adminSuppliersHtml.includes(`<option>${escaped}</option>`);
      expect(present).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. public-calendar.html — filter + modal category selects match VALID_CATEGORIES
// ---------------------------------------------------------------------------
describe('public-calendar.html filter category select', () => {
  it('contains all VALID_CATEGORIES as <option> elements', () => {
    for (const cat of VALID_CATEGORIES) {
      const escaped = cat.replace(/&/g, '&amp;');
      const present =
        publicCalendarHtml.includes(`<option>${cat}</option>`) ||
        publicCalendarHtml.includes(`<option>${escaped}</option>`);
      expect(present).toBe(true);
    }
  });
});

describe('public-calendar.html form modal category select', () => {
  it('contains all VALID_CATEGORIES as <option> elements in the event form', () => {
    // The modal form (#pc-form-category) must also reflect all categories.
    // Extract the form block to assert on it independently.
    const formStart = publicCalendarHtml.indexOf('id="pc-event-form"');
    const formEnd = publicCalendarHtml.indexOf('</form>', formStart);
    const formBlock =
      formStart !== -1 ? publicCalendarHtml.substring(formStart, formEnd) : publicCalendarHtml;

    for (const cat of VALID_CATEGORIES) {
      const escaped = cat.replace(/&/g, '&amp;');
      const present =
        formBlock.includes(`<option>${cat}</option>`) ||
        formBlock.includes(`<option>${escaped}</option>`);
      expect(present).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. public-calendar-init.js — no native confirm() calls
// ---------------------------------------------------------------------------
describe('public-calendar-init.js — no native dialog calls', () => {
  it('does not use window.confirm() (delete should use inline confirmation)', () => {
    // Native confirm() is blocked by some browsers, not accessible, and visually
    // inconsistent. The delete flow should use inline button state instead.
    const lines = publicCalendarInitSrc.split('\n');
    const violations = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
          return false;
        }
        return /\bconfirm\s*\(/.test(line);
      });
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. Client-side publisherCategories matches server-side PUBLISHER_CATEGORIES
// ---------------------------------------------------------------------------
describe('public-calendar-init.js — publisher categories match server model', () => {
  it('hardcoded publisherCategories array contains all server PUBLISHER_CATEGORIES values', () => {
    // The client side has a local copy of publisher categories to decide whether to show
    // the publisher banner. This must stay in sync with PUBLISHER_CATEGORIES in models/Supplier.js.
    for (const cat of PUBLISHER_CATEGORIES) {
      expect(publicCalendarInitSrc).toContain(`'${cat}'`);
    }
  });
});
