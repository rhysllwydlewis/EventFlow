'use strict';

const { removeLegacyEventJsonLd } = require('../../routes/public-listing-seo');

describe('public listing template cleanup', () => {
  test('removes the generic event JSON-LD placeholder before server metadata is injected', () => {
    const template = `<!doctype html><html><head>
      <script type="application/ld+json" id="event-jsonld">{"name":"EventFlow Public Event"}</script>
    </head><body><main id="event-panel"></main></body></html>`;

    const cleaned = removeLegacyEventJsonLd(template);

    expect(cleaned).not.toContain('id="event-jsonld"');
    expect(cleaned).not.toContain('EventFlow Public Event');
    expect(cleaned).toContain('<main id="event-panel"></main>');
  });
});
