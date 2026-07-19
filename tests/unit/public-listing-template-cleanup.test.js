'use strict';

const { renderSeoHtml } = require('../../services/publicListingSeo.service');

describe('public listing template cleanup', () => {
  test('removes the generic event JSON-LD placeholder before server metadata is injected', () => {
    const template = `<!doctype html><html><head>
      <title>Event details | EventFlow</title>
      <meta name="description" content="View public event details on EventFlow.">
      <link rel="canonical" href="https://event-flow.co.uk/events/">
      <script type="application/ld+json" id="event-jsonld">{"name":"EventFlow Public Event"}</script>
    </head><body><main id="event-panel"></main></body></html>`;
    const seo = {
      title: 'Cardiff Wedding Fair | EventFlow',
      description: 'Meet local wedding suppliers in Cardiff.',
      canonicalUrl: 'https://event-flow.co.uk/events/cardiff-wedding-fair-12345678',
      image: 'https://event-flow.co.uk/assets/images/eventflow-og-image.png?v=2',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Cardiff Wedding Fair',
      },
    };

    const rendered = renderSeoHtml(template, 'event', 'pce_12345678', seo, true);

    expect(rendered).not.toContain('id="event-jsonld"');
    expect(rendered).not.toContain('EventFlow Public Event');
    expect(rendered).toContain('id="event-structured-data"');
    expect(rendered).toContain('<main id="event-panel"></main>');
  });
});
