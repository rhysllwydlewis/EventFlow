'use strict';

const seoEligibility = require('./seoEligibility.service');

const DEFAULT_BASE_URL = 'https://event-flow.co.uk';
const SEO_BLOCK_MARKERS = {
  package: 'eventflow-package-seo',
  event: 'eventflow-event-seo',
};
const CAMPAIGN_QUERY_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
];
const INDEXABLE_EVENT_STATUSES = new Set(['published', 'cancelled']);
const PAST_EVENT_GRACE_MS = 24 * 60 * 60 * 1000;

function stripMarkup(value) {
  const input = String(value || '');
  let output = '';
  let insideTag = false;
  for (const character of input) {
    if (character === '<') {
      insideTag = true;
      output += ' ';
    } else if (character === '>') {
      insideTag = false;
      output += ' ';
    } else if (!insideTag) {
      output += character;
    }
  }
  return output.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeJsonLd(value) {
  const json = JSON.stringify(value);
  let output = '';
  for (const character of json) {
    if (character === '<') {
      output += '\\u003c';
    } else if (character === '>') {
      output += '\\u003e';
    } else if (character === '&') {
      output += '\\u0026';
    } else if (character === '\u2028') {
      output += '\\u2028';
    } else if (character === '\u2029') {
      output += '\\u2029';
    } else {
      output += character;
    }
  }
  return output;
}

function slugify(value) {
  return stripMarkup(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Keep legacy event fallback slugs exactly aligned with routes/public-calendar.js.
function eventTitleSlug(value) {
  return (
    stripMarkup(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'event'
  );
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_error) {
    return '';
  }
}

function safeBaseUrl(value) {
  try {
    const parsed = new URL(value || DEFAULT_BASE_URL);
    if (
      parsed.protocol !== 'https:' ||
      !['event-flow.co.uk', 'www.event-flow.co.uk'].includes(parsed.hostname)
    ) {
      return DEFAULT_BASE_URL;
    }
    return parsed.hostname === 'www.event-flow.co.uk' ? DEFAULT_BASE_URL : parsed.origin;
  } catch (_error) {
    return DEFAULT_BASE_URL;
  }
}

function safeHttpUrl(value, baseUrl = DEFAULT_BASE_URL) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw, safeBaseUrl(baseUrl));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_error) {
    return '';
  }
}

function safeImageUrl(value, baseUrl = DEFAULT_BASE_URL) {
  return (
    safeHttpUrl(value, baseUrl) ||
    `${safeBaseUrl(baseUrl)}/assets/images/eventflow-og-image.png?v=3`
  );
}

function truncate(value, maxLength) {
  const clean = stripMarkup(value);
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function validLastModified(value) {
  const date = validDate(value);
  return date ? date.toISOString() : '';
}

function cleanCampaignValue(value) {
  return Array.from(String(value || ''))
    .filter(character => {
      const codePoint = character.codePointAt(0);
      return codePoint >= 32 && codePoint !== 127;
    })
    .join('')
    .trim()
    .slice(0, 200);
}

function buildCampaignQuery(input = {}) {
  const output = new URLSearchParams();
  for (const key of CAMPAIGN_QUERY_KEYS) {
    const values = Array.isArray(input[key]) ? input[key] : [input[key]];
    for (const rawValue of values) {
      const value = cleanCampaignValue(rawValue);
      if (value) {
        output.append(key, value);
      }
    }
  }
  return output.toString();
}

function packageTitle(pkg) {
  return stripMarkup(pkg?.title || pkg?.name || '');
}

function buildPublicPackageSlug(pkg) {
  const storedSlug = slugify(pkg?.slug);
  if (storedSlug) {
    return storedSlug;
  }
  return slugify(pkg?.id || pkg?.packageId || '');
}

function packageLookupValues(pkg) {
  return [
    pkg?.id,
    pkg?.packageId,
    pkg?.slug,
    buildPublicPackageSlug(pkg),
    packageTitle(pkg) && slugify(packageTitle(pkg)),
  ]
    .filter(Boolean)
    .map(String);
}

/**
 * Whether a package's page should render publicly at all (200 rather than a
 * hard 404).
 *
 * Delegates to services/seoEligibility.service.js's canBeViewedPublicly — the
 * shared policy that also backs the directory search and the sitemap — via a
 * synthetic "does this package's supplier count as public" check built from
 * `publicSupplierIds` (already the eligible-supplier-id set the caller
 * computed with publicSupplierIds() below, so this does not re-derive
 * eligibility a second, possibly divergent, way).
 * @param {Object} pkg Package record.
 * @param {Set<string>} publicSupplierIds IDs of suppliers that are themselves public.
 * @returns {boolean} True when the package should be served.
 */
function isPublicPackage(pkg, publicSupplierIds) {
  if (!pkg) {
    return false;
  }
  const supplierIsPublic =
    publicSupplierIds instanceof Set && publicSupplierIds.has(pkg.supplierId);
  // The package's own supplier record is not available here — only the set
  // of ids that already passed supplier eligibility — so a placeholder
  // marked either public or not is enough for seoEligibility's own supplier
  // sub-check to agree or disagree with it.
  const context = {
    type: 'package',
    supplier: supplierIsPublic ? { id: pkg.supplierId, approved: true, name: 'supplier' } : null,
  };
  return seoEligibility.canBeViewedPublicly(pkg, context).eligible;
}

/**
 * The stricter, separate decision of whether a viewable package's page
 * should be indexed, given its actual supplier record (needed for the
 * supplier-viewability sub-check that canBeIndexed builds on).
 * @param {Object} pkg Package record.
 * @param {Object} supplier The package's supplier record.
 * @param {Set<string>} [validOwnerIds] IDs of users that still exist. When
 *   omitted, the supplier's own ownerUserId (if any) is trusted — callers
 *   that already resolved `supplier` via publicSupplierIds()/isPublicSupplier
 *   have implicitly validated it already.
 * @returns {{eligible: boolean, reasons: string[]}} Decision with reason codes.
 */
function getPackageIndexEligibility(pkg, supplier, validOwnerIds) {
  const owners =
    validOwnerIds instanceof Set
      ? validOwnerIds
      : supplier && supplier.ownerUserId
        ? new Set([String(supplier.ownerUserId)])
        : undefined;
  return seoEligibility.canBeIndexed(pkg, { type: 'package', supplier, validOwnerIds: owners });
}

function resolvePublicPackage(packages, value, publicSupplierIds) {
  const raw = safeDecodeURIComponent(value).trim();
  const normalized = slugify(raw);
  return (
    (packages || []).find(pkg => {
      if (!isPublicPackage(pkg, publicSupplierIds)) {
        return false;
      }
      return packageLookupValues(pkg).some(
        candidate => candidate === raw || slugify(candidate) === normalized
      );
    }) || null
  );
}

function eventStatus(event) {
  return String(event?.status || 'published')
    .trim()
    .toLowerCase();
}

function isPublicEventVisible(event) {
  const visibility = String(event?.visibility || '').toLowerCase();
  return Boolean(
    event &&
    !event.deleted &&
    !event.isDeleted &&
    !event.deletedAt &&
    event.id &&
    stripMarkup(event.title) &&
    validDate(event.startDate) &&
    INDEXABLE_EVENT_STATUSES.has(eventStatus(event)) &&
    event.isPrivate !== true &&
    visibility !== 'private'
  );
}

function eventEndDate(event) {
  return validDate(event?.endDate) || validDate(event?.startDate);
}

function isIndexablePublicEvent(event, now = new Date()) {
  if (!isPublicEventVisible(event)) {
    return false;
  }
  const end = eventEndDate(event);
  return Boolean(end && end.getTime() >= now.getTime() - PAST_EVENT_GRACE_MS);
}

function buildPublicEventSlug(event) {
  const storedSlug = String(event?.slug || '').trim();
  if (/^[a-zA-Z0-9_-]+$/.test(storedSlug)) {
    return storedSlug;
  }
  const id = String(event?.id || '').trim();
  if (!id) {
    return '';
  }
  return `${eventTitleSlug(event?.title)}-${id.replace(/^pce_/, '').slice(-8)}`;
}

function resolvePublicEvent(events, value) {
  const raw = safeDecodeURIComponent(value).trim();
  return (
    (events || []).find(event => {
      if (!isPublicEventVisible(event)) {
        return false;
      }
      return [event.id, event.slug, buildPublicEventSlug(event)]
        .filter(Boolean)
        .some(candidate => String(candidate) === raw);
    }) || null
  );
}

function supplierDisplayName(supplier) {
  return stripMarkup(supplier?.name || supplier?.businessName || supplier?.company || '');
}

// This used to be its own copy of the same approved/named/owned check that
// lives in publicSupplierSeo.service.js — the exact kind of drift SEO-002
// flagged (a supplier could be public by one module's rule and not the
// other's). Both now delegate to the one shared policy.
function isPublicSupplier(supplier, validOwnerIds) {
  return seoEligibility.canBeViewedPublicly(supplier, { validOwnerIds }).eligible;
}

function publicSupplierIds(suppliers, users) {
  const validOwnerIds = new Set((users || []).map(user => user?.id).filter(Boolean));
  return new Set(
    (suppliers || [])
      .filter(supplier => isPublicSupplier(supplier, validOwnerIds))
      .map(supplier => supplier.id)
  );
}

function packageImage(pkg, baseUrl) {
  const gallery = Array.isArray(pkg?.resolvedGallery)
    ? pkg.resolvedGallery
    : Array.isArray(pkg?.gallery)
      ? pkg.gallery
      : [];
  const item = gallery.find(Boolean);
  const galleryUrl = typeof item === 'string' ? item : item?.url || item?.src || item?.path || '';
  return safeImageUrl(
    pkg?.openGraphImage || pkg?.image || pkg?.imageUrl || pkg?.coverImage || galleryUrl,
    baseUrl
  );
}

function numericPrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/\d+(?:\.\d{1,2})?/);
  const number = match ? Number(match[0]) : NaN;
  return Number.isFinite(number) ? number : null;
}

function buildPackageSeoModel(pkg, supplier, options = {}) {
  const baseUrl = safeBaseUrl(options.baseUrl);
  const slug = buildPublicPackageSlug(pkg);
  const canonicalUrl = `${baseUrl}/package/${slug}`;
  const name = packageTitle(pkg) || 'Event package';
  const supplierName = supplierDisplayName(supplier) || 'EventFlow supplier';
  const category = stripMarkup(pkg?.primaryCategoryKey || pkg?.category || '');
  const location = stripMarkup(
    pkg?.location || supplier?.location || supplier?.town || supplier?.city || ''
  );
  const description = truncate(
    pkg?.metaDescription ||
      pkg?.description_short ||
      pkg?.descriptionShort ||
      pkg?.description ||
      `${name} from ${supplierName} on EventFlow.`,
    160
  );
  const image = packageImage(pkg, baseUrl);
  const price = numericPrice(pkg?.price ?? pkg?.price_display ?? pkg?.priceFrom);
  const title = truncate([name, supplierName, 'EventFlow'].filter(Boolean).join(' | '), 70);
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${canonicalUrl}#service`,
    name,
    description,
    url: canonicalUrl,
    image,
    provider: { '@type': 'ProfessionalService', name: supplierName },
  };
  if (category) {
    structuredData.serviceType = category;
  }
  if (location) {
    structuredData.areaServed = { '@type': 'Place', name: location };
  }
  if (price !== null) {
    structuredData.offers = {
      '@type': 'Offer',
      url: canonicalUrl,
      price,
      priceCurrency: String(pkg?.currency || 'GBP').toUpperCase(),
      availability: 'https://schema.org/InStock',
    };
  }
  return { slug, canonicalUrl, title, description, image, structuredData };
}

function eventLocationSummary(event) {
  const parts = [
    event?.venueName,
    event?.addressLine1,
    event?.addressLine2,
    event?.townCity,
    event?.county,
    event?.postcode,
  ].filter(Boolean);
  return stripMarkup(
    event?.location || (parts.length ? parts.join(', ') : event?.isOnline ? 'Online event' : '')
  );
}

function buildEventSeoModel(event, options = {}) {
  const baseUrl = safeBaseUrl(options.baseUrl);
  const slug = buildPublicEventSlug(event);
  const canonicalUrl = `${baseUrl}/events/${slug}`;
  const name = stripMarkup(event?.title) || 'Public event';
  const description = truncate(event?.description || `View ${name} on EventFlow.`, 160);
  const image = safeImageUrl(event?.featuredImageUrl || event?.imageUrl, baseUrl);
  const startDate = validDate(event?.startDate)?.toISOString();
  const endDate = validDate(event?.endDate)?.toISOString();
  const locationName = eventLocationSummary(event);
  const organizerName = stripMarkup(event?.organiserName || 'EventFlow supplier');
  const status = eventStatus(event);
  const title = truncate(`${name} | EventFlow`, 70);
  const ticketPrice = numericPrice(event?.ticketPrice);
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${canonicalUrl}#event`,
    name,
    description,
    url: canonicalUrl,
    startDate,
    eventStatus:
      status === 'cancelled'
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
    eventAttendanceMode: event?.isOnline
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    organizer: { '@type': 'Organization', name: organizerName },
  };
  if (endDate) {
    structuredData.endDate = endDate;
  }
  if (event?.featuredImageUrl || event?.imageUrl) {
    structuredData.image = [image];
  }
  if (event?.isOnline) {
    structuredData.location = {
      '@type': 'VirtualLocation',
      url: safeHttpUrl(event?.onlineUrl || event?.externalBookingUrl, baseUrl) || canonicalUrl,
    };
  } else if (locationName) {
    structuredData.location = {
      '@type': 'Place',
      name: stripMarkup(event?.venueName || locationName),
      address: {
        '@type': 'PostalAddress',
        streetAddress:
          stripMarkup([event?.addressLine1, event?.addressLine2].filter(Boolean).join(', ')) ||
          undefined,
        addressLocality: stripMarkup(event?.townCity) || undefined,
        addressRegion: stripMarkup(event?.county) || undefined,
        postalCode: stripMarkup(event?.postcode) || undefined,
        addressCountry: 'GB',
      },
    };
  }
  if (event?.priceType === 'free' || ticketPrice !== null) {
    structuredData.offers = {
      '@type': 'Offer',
      url: safeHttpUrl(event?.externalBookingUrl, baseUrl) || canonicalUrl,
      price: event?.priceType === 'free' ? 0 : ticketPrice,
      priceCurrency: 'GBP',
      availability:
        status === 'cancelled' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    };
  }
  return { slug, canonicalUrl, title, description, image, structuredData };
}

function parseTagAttributes(openingTag) {
  const attributes = new Map();
  let index = openingTag.indexOf(' ');
  if (index < 0) {
    return attributes;
  }
  while (index < openingTag.length) {
    while (/\s/.test(openingTag[index] || '')) {
      index += 1;
    }
    if (openingTag[index] === '>' || openingTag[index] === '/') {
      break;
    }
    const nameStart = index;
    while (/[^\s=/>]/.test(openingTag[index] || '')) {
      index += 1;
    }
    const name = openingTag.slice(nameStart, index).toLowerCase();
    while (/\s/.test(openingTag[index] || '')) {
      index += 1;
    }
    if (openingTag[index] !== '=') {
      if (name) {
        attributes.set(name, '');
      }
      continue;
    }
    index += 1;
    while (/\s/.test(openingTag[index] || '')) {
      index += 1;
    }
    const quote = openingTag[index];
    let value = '';
    if (quote === '"' || quote === "'") {
      index += 1;
      const valueStart = index;
      while (index < openingTag.length && openingTag[index] !== quote) {
        index += 1;
      }
      value = openingTag.slice(valueStart, index);
      index += 1;
    } else {
      const valueStart = index;
      while (/[^\s>]/.test(openingTag[index] || '')) {
        index += 1;
      }
      value = openingTag.slice(valueStart, index);
    }
    if (name) {
      attributes.set(name, value);
    }
  }
  return attributes;
}

function removeElements(html, tagName, shouldRemove, paired = false) {
  const source = String(html || '');
  const lower = source.toLowerCase();
  const openToken = `<${tagName.toLowerCase()}`;
  const closeToken = `</${tagName.toLowerCase()}>`;
  let cursor = 0;
  let output = '';
  while (cursor < source.length) {
    const start = lower.indexOf(openToken, cursor);
    if (start < 0) {
      output += source.slice(cursor);
      break;
    }
    const boundary = lower[start + openToken.length];
    if (boundary && !/[\s/>]/.test(boundary)) {
      output += source.slice(cursor, start + openToken.length);
      cursor = start + openToken.length;
      continue;
    }
    const openEnd = source.indexOf('>', start);
    if (openEnd < 0) {
      output += source.slice(cursor);
      break;
    }
    const openingTag = source.slice(start, openEnd + 1);
    if (!shouldRemove(parseTagAttributes(openingTag))) {
      output += source.slice(cursor, openEnd + 1);
      cursor = openEnd + 1;
      continue;
    }
    let removeEnd = openEnd + 1;
    if (paired) {
      const closeStart = lower.indexOf(closeToken, removeEnd);
      if (closeStart >= 0) {
        removeEnd = closeStart + closeToken.length;
      }
    }
    output += source.slice(cursor, start);
    cursor = removeEnd;
  }
  return output;
}

function removeMarkedBlock(html, marker) {
  const startToken = `<!-- ${marker}:start -->`;
  const endToken = `<!-- ${marker}:end -->`;
  const source = String(html || '');
  const start = source.indexOf(startToken);
  if (start < 0) {
    return source;
  }
  const end = source.indexOf(endToken, start + startToken.length);
  return end < 0 ? source : source.slice(0, start) + source.slice(end + endToken.length);
}

function removeSeoTags(html, marker) {
  let output = removeMarkedBlock(html, marker);
  output = removeElements(output, 'title', () => true, true);
  output = removeElements(output, 'meta', attributes => {
    const name = String(attributes.get('name') || '').toLowerCase();
    const id = String(attributes.get('id') || '').toLowerCase();
    const property = String(attributes.get('property') || '').toLowerCase();
    return (
      name === 'description' ||
      name === 'robots' ||
      name.startsWith('ef-') ||
      name.startsWith('twitter:') ||
      id === 'meta-description' ||
      property.startsWith('og:')
    );
  });
  output = removeElements(
    output,
    'link',
    attributes => String(attributes.get('rel') || '').toLowerCase() === 'canonical'
  );
  output = removeElements(
    output,
    'script',
    attributes =>
      ['package-structured-data', 'event-structured-data', 'event-jsonld'].includes(
        String(attributes.get('id') || '').toLowerCase()
      ),
    true
  );
  return output;
}

function buildHeadBlock(kind, id, seo, indexable = true) {
  const marker = SEO_BLOCK_MARKERS[kind];
  const robots = indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow';
  const structuredData = indexable
    ? `  <script type="application/ld+json" id="${kind}-structured-data">${serializeJsonLd(
        seo.structuredData
      )}</script>`
    : '';
  return [
    `  <!-- ${marker}:start -->`,
    `  <title>${escapeHtml(seo.title)}</title>`,
    `  <meta name="description" content="${escapeHtml(seo.description)}">`,
    `  <meta name="robots" content="${robots}">`,
    `  <meta name="ef-server-seo" content="${kind}">`,
    `  <meta name="ef-canonical-url" content="${escapeHtml(seo.canonicalUrl)}">`,
    `  <meta name="ef-public-${kind}-id" content="${escapeHtml(id)}">`,
    `  <link rel="canonical" href="${escapeHtml(seo.canonicalUrl)}">`,
    `  <meta property="og:title" content="${escapeHtml(seo.title)}">`,
    `  <meta property="og:description" content="${escapeHtml(seo.description)}">`,
    `  <meta property="og:image" content="${escapeHtml(seo.image)}">`,
    `  <meta property="og:url" content="${escapeHtml(seo.canonicalUrl)}">`,
    '  <meta property="og:type" content="website">',
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:url" content="${escapeHtml(seo.canonicalUrl)}">`,
    `  <meta name="twitter:title" content="${escapeHtml(seo.title)}">`,
    `  <meta name="twitter:description" content="${escapeHtml(seo.description)}">`,
    `  <meta name="twitter:image" content="${escapeHtml(seo.image)}">`,
    structuredData,
    `  <!-- ${marker}:end -->`,
  ]
    .filter(Boolean)
    .join('\n');
}

function renderSeoHtml(templateHtml, kind, id, seo, indexable = true) {
  const cleanTemplate = removeSeoTags(templateHtml, SEO_BLOCK_MARKERS[kind]);
  const closingHead = cleanTemplate.toLowerCase().indexOf('</head>');
  if (closingHead < 0) {
    throw new Error(`${kind} template is missing a closing head tag`);
  }
  return `${cleanTemplate.slice(
    0,
    closingHead
  )}${buildHeadBlock(kind, id, seo, indexable)}\n${cleanTemplate.slice(closingHead)}`;
}

module.exports = {
  buildCampaignQuery,
  buildEventSeoModel,
  buildPackageSeoModel,
  buildPublicEventSlug,
  buildPublicPackageSlug,
  buildHeadBlock,
  eventEndDate,
  eventTitleSlug,
  getPackageIndexEligibility,
  isIndexablePublicEvent,
  isPublicEventVisible,
  isPublicPackage,
  publicSupplierIds,
  renderSeoHtml,
  resolvePublicEvent,
  resolvePublicPackage,
  safeBaseUrl,
  slugify,
  validLastModified,
};
