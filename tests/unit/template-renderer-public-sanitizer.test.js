'use strict';

const { sanitizeAnonymousPublicHtml } = require('../../utils/template-renderer');

const anonymousReq = { user: null };
const signedInReq = { user: { id: 'u1', role: 'admin' } };

describe('anonymous public template sanitiser', () => {
  test('leaves authenticated renders unchanged', () => {
    const html = '<div id="pc-publisher-banner">Add Event</div>';
    expect(sanitizeAnonymousPublicHtml(html, '/public-calendar.html', signedInReq)).toBe(html);
  });

  test('removes homepage zero/stat and fabricated trust copy from anonymous render', () => {
    const html = `
      <section id="stats-section"><div>Loading…</div><div>Verified Suppliers</div></section>
      <h3 class="ef-card__title">Verified Suppliers</h3><p class="ef-card__text">All suppliers are verified and vetted</p>
      <section>What Our Customers Say Sarah &amp; Tom James Wilson Emma Davies</section>
    `;
    const cleaned = sanitizeAnonymousPublicHtml(html, '/index.html', anonymousReq);
    expect(cleaned).not.toMatch(/stats-section|Loading…|All suppliers are verified and vetted/i);
    expect(cleaned).not.toMatch(
      /What Our Customers Say|Sarah\s*&(?:amp;)?\s*Tom|James Wilson|Emma Davies/i
    );
    expect(cleaned).toContain('Suppliers opening in stages');
  });

  test('keeps the planner preload readable before hydration', () => {
    const html =
      '<div class="wizard-card wizard-preload-card" id="wizard-preload" aria-hidden="true"><h2>Plan your event in minutes</h2></div>';
    const cleaned = sanitizeAnonymousPublicHtml(html, '/start.html', anonymousReq);
    expect(cleaned).toContain('Plan your event in minutes');
    expect(cleaned).not.toContain('aria-hidden="true"');
  });

  test('removes role-gated public calendar management text for anonymous users', () => {
    const html = `
      <div id="pc-publisher-banner" class="pc-publisher-banner"><span>Shared Events Calendar publishing enabled.</span><button>Add Event</button></div>
      <div id="pc-permission-notice"></div>
      <section id="pc-admin-requests-panel"><h2>Calendar publishing requests</h2><p>Approve suitable suppliers or reject with a reason. Approval grants the existing admin override.</p></section>
      <!-- Add / Edit Event Modal --><div id="pc-modal-overlay"><h2>Add Event</h2><button>Publish Event</button></div><footer class="footer"
    `;
    const cleaned = sanitizeAnonymousPublicHtml(html, '/public-calendar.html', anonymousReq);
    expect(cleaned).not.toMatch(
      /Shared Events Calendar publishing enabled|Calendar publishing requests|Approve suitable suppliers|admin override|Add Event|Publish Event/i
    );
    expect(cleaned).toContain('pc-modal-overlay');
    expect(cleaned).toContain('<footer class="footer"');
  });

  test('removes contradictory guides loading and empty states from anonymous source', () => {
    const html = `
      <div class="skeleton-grid" id="guides-loading" aria-label="Loading guides" role="status"><div class="skeleton-card"></div></div>
      <ul class="guides-nojs-list"><li><a href="/articles/example">Example guide</a></li></ul>
      <div class="guides-empty" id="guides-empty"><h3>No guides found</h3><p id="guides-empty-msg">Try adjusting your search.</p><button>Reset filters</button></div>
      Discover vetted photographers, caterers, venues, and more near you.
    `;
    const cleaned = sanitizeAnonymousPublicHtml(html, '/guides.html', anonymousReq);
    expect(cleaned).not.toMatch(/Loading guides|No guides found|Try adjusting your search/i);
    expect(cleaned).toContain('guides-nojs-list');
    expect(cleaned).toContain('Discover photographers, caterers, venues and more near you.');
  });
});
