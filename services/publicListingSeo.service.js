'use strict';

const crypto = require('crypto');

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
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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

function stableToken(value, length = 8) {
  const input = String(value || '').trim();
  return input ? crypto.createHash('sha256').update(input).digest('hex').slice(0, length) : '';
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
  if (!raw) return '';
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
    `${safeBaseUrl(baseUrl)}/assets/images/eventflow-og-image.png?v=2`
  );
}

function truncate(value, maxLength) {
  const clean = stripMarkup(value);
  if (clean.length <= maxLength) return clean;
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

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_error) {
    return '';
  }
}

function buildCampaignQuery(input = {}) {
  const output = new URLSearchParams();
  for (const key of CAMPAIGN_QUERY_KEYS) {
    const values = Array.isArray(input[key]) ? input[key] : [input[key]];
    for (const rawValue of values) {
      const value = cleanCampaignValue(rawValue);
      if (value) output.append(key, value);
    }
  }
  return output.toString();
}

function packageTitle(pkg) {
  return stripMarkup(pkg?.title || pkg?.name || '');
}

function buildPublicPackageSlug(pkg) {
  const storedSlug = slugify(pkg?.slug);
  if (storedSlug) return storedSlug;
  const id = String(pkg?.id || pkg?.packageId || '').trim();
  return slugify(id);
}

function getPackageLookupValues(pkg) {
  return [
    pkg?.id,
    pkg?.packageId,
    pkg?.slug,
    buildPublicPackageSlug(pkg),
    packageTitle(pkg) && slugify(packageTitle(pkg)),
  ]
    .filter(Boolean)
    .map(value => String(value));
}

function isPublicPackage(pkg, publicSupplierIds) {
  return Boolean(
    pkg &&
    pkg.approved === true &&
    !pkg.deleted &&
    !pkg.deletedAt &&
    pkg.id &&
    packageTitle(pkg) &&
    publicSupplierIds instanceof Set &&
    publicSupplierIds.has(pkg.supplierId)
  );
}

function resolvePublicPackage(packages, value, publicSupplierIds) {
  const raw = safeDecodeURIComponent(value).trim();
  const normalized = slugify(raw);
  return (
    (packages || []).find(pkg => {
      if (!isPublicPackage(pkg, publicSupplierIds)) return false;
      return getPackageLookupValues(pkg).some(
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
  if (!isPublicEventVisible(event)) return false;
  const end = eventEndDate(event);
  return Boolean(end && end.getTime() >= now.getTime() - PAST_EVENT_GRACE_MS);
}

function buildPublicEventSlug(event) {
  const storedSlug = slugify(event?.slug);
  if (storedSlug) return storedSlug;
  const id = String(event?.id || '').trim();
  if (!id) return '';
  const title = slugify(event?.title || 'event') || 'event';
  return `${title}-${String(id).replace(/^pce_/, '').slice(-8) || stableToken(id)}`;
}

function resolvePublicEvent(events, value) {
  const raw = safeDecodeURIComponent(value).trim();
  const normalized = slugify(raw);
  return (
    (events || []).find(event => {
      if (!isPublicEventVisible(event)) return false;
      return [event.id, event.slug, buildPublicEventSlug(event)]
        .filter(Boolean)
        .some(candidate => String(candidate) === raw || slugify(candidate) === normalized);
    }) || null
  );
}

function supplierDisplayName(supplier) {
  return stripMarkup(supplier?.name || supplier?.businessName || supplier?.company || '');
}

function isPublicSupplier(supplier, validOwnerIds) {
  if (!supplier || supplier.approved !== true || !supplier.id || !supplierDisplayName(supplier)) {
    return false;
  }
  return (
    !supplier.ownerUserId ||
    (validOwnerIds instanceof Set && validOwnerIds.has(supplier.ownerUserId))
  );
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
  const galleryImage = gallery.find(Boolean);
  const galleryUrl =
    typeof galleryImage === 'string'
      ? galleryImage
      : galleryImage?.url || galleryImage?.src || galleryImage?.path || '';
  return safeImageUrl(
    pkg?.openGraphImage || pkg?.image || pkg?.imageUrl || pkg?.coverImage || galleryUrl,
    baseUrl
  );
}

function numericPrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value || '')
    .replace(/,/g, '')
    .match(/\d+(?:\.\d{1,2})?/);
  if (!normalized) return null;
  const number = Number(normalized[0]);
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
    provider: {
      '@type': 'ProfessionalService',
      name: supplierName,
    },
  };
  if (category) structuredData.serviceType = category;
  if (location) structuredData.areaServed = { '@type': 'Place', name: location };
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
    organizer: {
      '@type': 'Organization',
      name: organizerName,
    },
  };
  if (endDate) structuredData.endDate = endDate;
  if (event?.featuredImageUrl || event?.imageUrl) structuredData.image = [image];
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
  if (event?.priceType === 'free') {
    structuredData.offers = {
      '@type': 'Offer',
      url: safeHttpUrl(event?.externalBookingUrl, baseUrl) || canonicalUrl,
      price: 0,
      priceCurrency: 'GBP',
      availability: 'https://schema.org/InStock',
    };
  } else if (ticketPrice !== null) {
    structuredData.offers = {
      '@type': 'Offer',
      url: safeHttpUrl(event?.externalBookingUrl, baseUrl) || canonicalUrl,
      price: ticketPrice,
      priceCurrency: 'GBP',
      availability:
        status === 'cancelled' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    };
  }

  return { slug, canonicalUrl, title, description, image, structuredData };
}

function removeSeoTags(html, marker) {
  return String(html || '')
    .replace(new RegExp(`\\s*<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->`, 'i'), '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\b[^>]*(?:name=["']description["']|id=["']meta-description["'])[^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*name=["']robots["'][^>]*>\s*/gi, '')
    .replace(
      /<meta\b[^>]*name=["']ef-(?:server-seo|canonical-url|public-package-id|public-event-id)["'][^>]*>\s*/gi,
      ''
    )
    .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(
      /<meta\b[^>]*(?:property=["']og:(?:title|description|image|url|type)["'])[^>]*>\s*/gi,
      ''
    )
    .replace(
      /<meta\b[^>]*(?:name=["']twitter:(?:card|url|title|description|image)["'])[^>]*>\s*/gi,
      ''
    )
    .replace(
      /<script\b[^>]*id=["'](?:package|event)-structured-data["'][^>]*>[\s\S]*?<\/script>\s*/gi,
      ''
    );
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
  if (!/<\/head>/i.test(cleanTemplate)) {
    throw new Error(`${kind} template is missing a closing head tag`);
  }
  return cleanTemplate.replace(/<\/head>/i, `${buildHeadBlock(kind, id, seo, indexable)}\n</head>`);
}

module.exports = {
  buildCampaignQuery,
  buildEventSeoModel,
  buildPackageSeoModel,
  buildPublicEventSlug,
  buildPublicPackageSlug,
  buildHeadBlock,
  eventEndDate,
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
