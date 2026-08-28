import './supplier-profile-theme-owner.js';
export * from './supplier-profile-polish-base.js';

const PROFILE_THEME_STYLESHEET_ID = 'supplier-profile-theme-styles';
const PROFILE_THEME_STYLESHEET_HREF = '/assets/css/supplier-profile-theme.css?v=20.1.0';

const DEFAULT_ACCENT = '#0b8073';
const INK = '#0b1220';
const WHITE = '#ffffff';

const PRESET_ACCENTS = Object.freeze({
  'ef-teal': '#0b8073',
  midnight: '#0f3460',
  'rose-gold': '#b76e79',
  forest: '#40916c',
  ocean: '#0077b6',
  sunset: '#d62828',
  purple: '#7e22ce',
  charcoal: '#374151',
  blush: '#c2185b',
  champagne: '#9c7c38',
});

const CATEGORY_PRESETS = Object.freeze({
  wedding: 'wedding',
  weddings: 'wedding',
  'wedding planner': 'wedding',
  'event planner': 'wedding',
  planning: 'wedding',
  'wedding fayre': 'wedding',
  stationery: 'wedding',
  celebrant: 'wedding',
  photography: 'photography',
  photographer: 'photography',
  videography: 'photography',
  videographer: 'photography',
  catering: 'catering',
  caterer: 'catering',
  food: 'catering',
  cake: 'catering',
  music: 'music',
  'music/dj': 'music',
  dj: 'music',
  band: 'music',
  musicians: 'music',
  entertainment: 'entertainment',
  flowers: 'flowers',
  florist: 'flowers',
  floral: 'flowers',
  decor: 'flowers',
  venue: 'venue',
  venues: 'venue',
  transport: 'transport',
  cars: 'transport',
  chauffeur: 'transport',
  beauty: 'beauty',
  'hair & makeup': 'beauty',
  bridalwear: 'beauty',
  jewellery: 'beauty',
  other: 'default',
});

const CATEGORY_ACCENTS = Object.freeze({
  wedding: '#b76e79',
  photography: '#1a3a5c',
  catering: '#7f5539',
  music: '#6a0dad',
  entertainment: '#c2185b',
  flowers: '#386641',
  venue: '#4a5568',
  transport: '#1a6b8a',
  beauty: '#9d174d',
  default: DEFAULT_ACCENT,
});

const DETAIL_ICONS = Object.freeze({
  category:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="8" cy="8" r="1.2"/></svg>',
  location:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5.5-8 11-8 11S4 15.5 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  rating:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
  'price range':
    '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="18" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="600" fill="currentColor">£</text></svg>',
  since:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  response:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
});

function ensureStylesheet(id, href) {
  let link = document.getElementById(id);
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.href = href;
  }
  return link;
}

function ensureCurrentProfileStylesheets() {
  // The polish stylesheet itself is owned by supplier-profile-polish-base.js's
  // loadProfilePolishStylesheet(), which this module re-exports and which
  // always runs first (ES module evaluation order: the static
  // `export * from './supplier-profile-polish-base.js'` above finishes
  // executing before this file's own top-level code does). A second,
  // independently-versioned href here previously fought that one and reset
  // the browser back onto the old cached stylesheet URL on every theme
  // apply — see the regression this replaced.
  ensureStylesheet(PROFILE_THEME_STYLESHEET_ID, PROFILE_THEME_STYLESHEET_HREF);
}

function normaliseHex(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : null;
}

function normaliseThemeMode(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return ['automatic', 'preset', 'custom'].includes(candidate) ? candidate : null;
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: value >> 16, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map(channel =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function mixHex(first, second, firstWeight) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  const weight = Math.max(0, Math.min(1, firstWeight));
  return rgbToHex({
    r: a.r * weight + b.r * (1 - weight),
    g: a.g * weight + b.g * (1 - weight),
    b: a.b * weight + b.b * (1 - weight),
  });
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function resolveCategoryKey(category) {
  return (
    CATEGORY_PRESETS[
      String(category || '')
        .trim()
        .toLowerCase()
    ] || 'default'
  );
}

function resolveAutomaticTheme(supplier = {}) {
  const categoryKey = resolveCategoryKey(supplier.category);
  if (categoryKey !== 'default' && CATEGORY_ACCENTS[categoryKey]) {
    return { accent: CATEGORY_ACCENTS[categoryKey], source: 'category' };
  }
  return { accent: DEFAULT_ACCENT, source: 'default' };
}

function resolveSupplierTheme(supplier = {}) {
  const mode = normaliseThemeMode(supplier.themeMode);
  const chosen = normaliseHex(supplier.themeColor);
  const preset = String(supplier.heroPreset || '')
    .trim()
    .toLowerCase();

  if (mode === 'custom') {
    return chosen ? { accent: chosen, source: 'themeColor' } : resolveAutomaticTheme(supplier);
  }
  if (mode === 'preset') {
    return PRESET_ACCENTS[preset]
      ? { accent: PRESET_ACCENTS[preset], source: 'heroPreset' }
      : resolveAutomaticTheme(supplier);
  }
  if (mode === 'automatic') {
    return resolveAutomaticTheme(supplier);
  }

  // Legacy profiles had no explicit themeMode. Preserve their previous priority.
  if (chosen) {
    return { accent: chosen, source: 'themeColor' };
  }
  if (PRESET_ACCENTS[preset]) {
    return { accent: PRESET_ACCENTS[preset], source: 'heroPreset' };
  }
  return resolveAutomaticTheme(supplier);
}

function createSupplierPalette(accent) {
  return {
    accent,
    strong: mixHex(accent, INK, 0.4),
    hover: mixHex(accent, INK, 0.32),
    light: mixHex(accent, WHITE, 0.76),
    soft: mixHex(accent, WHITE, 0.08),
    subtle: mixHex(accent, WHITE, 0.15),
    border: mixHex(accent, WHITE, 0.32),
    borderStrong: mixHex(accent, WHITE, 0.5),
    shadow: rgba(accent, 0.24),
  };
}

function setThemeVariables(root, palette) {
  const values = {
    '--sp-profile-accent': palette.accent,
    '--sp-profile-accent-strong': palette.strong,
    '--sp-profile-accent-hover': palette.hover,
    '--sp-profile-accent-light': palette.light,
    '--sp-profile-accent-soft': palette.soft,
    '--sp-profile-accent-subtle': palette.subtle,
    '--sp-profile-accent-border': palette.border,
    '--sp-profile-accent-border-strong': palette.borderStrong,
    '--sp-profile-accent-shadow': palette.shadow,
  };
  Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
}

function applyAvatarTheme(accent) {
  const avatar = document.getElementById('hero-avatar');
  if (!avatar || avatar.classList.contains('has-profile-photo')) {
    return;
  }
  avatar.style.background = `linear-gradient(135deg, ${accent} 0%, ${mixHex(accent, WHITE, 0.7)} 100%)`;
}

function resolveHeroMode(supplier = {}) {
  if (supplier.bannerUrl || supplier.coverImage) {
    return 'image';
  }
  const mode = normaliseThemeMode(supplier.themeMode);
  const preset = String(supplier.heroPreset || '')
    .trim()
    .toLowerCase();
  if (mode === 'preset') {
    return PRESET_ACCENTS[preset]
      ? 'preset'
      : resolveCategoryKey(supplier.category) !== 'default'
        ? 'category'
        : 'theme';
  }
  if (mode === 'custom') {
    return normaliseHex(supplier.themeColor)
      ? 'theme'
      : resolveCategoryKey(supplier.category) !== 'default'
        ? 'category'
        : 'theme';
  }
  if (mode === 'automatic') {
    return resolveCategoryKey(supplier.category) !== 'default' ? 'category' : 'theme';
  }
  if (PRESET_ACCENTS[preset]) {
    return 'preset';
  }
  if (normaliseHex(supplier.themeColor)) {
    return 'theme';
  }
  return resolveCategoryKey(supplier.category) !== 'default' ? 'category' : 'theme';
}

function updateHeroThemeState(supplier, theme) {
  const root = document.documentElement;
  const heroMedia = document.querySelector('#supplier-hero .hero-media');
  const heroMode = resolveHeroMode(supplier);
  root.dataset.spHeroMode = heroMode;
  root.dataset.spThemeSource = theme.source;
  heroMedia?.classList.toggle('sp-hero-use-accent', heroMode === 'theme');
}

function formatResponseMessage(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    return 'Send a message and the supplier will reply through EventFlow.';
  }
  if (hours < 1) {
    return 'Typically responds in under an hour.';
  }
  if (hours < 24) {
    return `Typically responds in around ${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}.`;
  }
  const days = Math.max(1, Math.round(hours / 24));
  return `Typically responds in around ${days} day${days === 1 ? '' : 's'}.`;
}

function polishSidebarDetails(supplier = {}) {
  const note = document.querySelector('.sp-cta-card__note');
  if (note) {
    note.textContent = formatResponseMessage(supplier.avgResponseTime);
  }

  document.querySelectorAll('.sp-detail-row').forEach(row => {
    const label = String(row.querySelector('.sp-detail-row__label')?.textContent || '')
      .trim()
      .toLowerCase();
    const icon = row.querySelector('.sp-detail-row__icon');
    if (icon && DETAIL_ICONS[label]) {
      icon.innerHTML = DETAIL_ICONS[label];
      icon.dataset.spIcon = label.replace(/\s+/g, '-');
    }
  });
}

const CONTACT_ICONS = Object.freeze({
  response:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  location:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5.5-8 11-8 11S4 15.5 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  price:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="18" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="600" fill="currentColor">£</text></svg>',
});

function moveHeroBadgesIntoIdentity() {
  const badges = document.getElementById('hero-badges');
  const identity = document.querySelector('.hero-identity');
  if (!badges || !identity) {
    return;
  }
  if (badges.parentElement !== identity) {
    identity.appendChild(badges);
  }
  badges.classList.add('hero-badges--identity');
}

function formatStartingPrice(supplier = {}) {
  const numeric = [
    supplier.startingPrice,
    supplier.priceFrom,
    supplier.minimumPrice,
    supplier.minPrice,
  ]
    .map(value => Number(value))
    .find(value => Number.isFinite(value) && value > 0);
  if (numeric) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    }).format(numeric);
  }
  return String(supplier.priceRange || '').trim() || null;
}

function createContactSummaryRow(label, value, iconName) {
  const row = document.createElement('div');
  row.className = 'sp-contact-summary__row';
  const icon = document.createElement('span');
  icon.className = 'sp-contact-summary__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = CONTACT_ICONS[iconName];
  const copy = document.createElement('span');
  const labelNode = document.createElement('span');
  labelNode.className = 'sp-contact-summary__label';
  labelNode.textContent = label;
  const valueNode = document.createElement('span');
  valueNode.className = 'sp-contact-summary__value';
  valueNode.textContent = value;
  copy.append(labelNode, valueNode);
  row.append(icon, copy);
  return row;
}

function polishContactHierarchy(supplier = {}) {
  document.body?.classList.add('sp-profile-page');
  moveHeroBadgesIntoIdentity();
  const card = document.querySelector('.sp-cta-card');
  if (!card) {
    return;
  }
  card.classList.add('sp-contact-card');
  const eyebrow = card.querySelector('.sp-cta-card__name');
  if (eyebrow) {
    eyebrow.textContent = 'Contact & availability';
  }
  const title = card.querySelector('.sp-cta-card__title');
  if (title) {
    title.textContent = supplier.name ? `Plan with ${supplier.name}` : 'Plan your enquiry';
  }
  let summary = card.querySelector('.sp-contact-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'sp-contact-summary';
    card.querySelector('.sp-cta-card__actions')?.before(summary);
  }
  summary.replaceChildren();
  summary.append(
    createContactSummaryRow('Response', formatResponseMessage(supplier.avgResponseTime), 'response')
  );
  if (supplier.location) {
    summary.append(createContactSummaryRow('Location', String(supplier.location), 'location'));
  }
  const startingPrice = formatStartingPrice(supplier);
  if (startingPrice) {
    summary.append(createContactSummaryRow('Starting from', startingPrice, 'price'));
  }
  const button = card.querySelector('#sidebar-btn-enquiry');
  if (button) {
    button.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Send a message</span>';
  }
  const note = card.querySelector('.sp-cta-card__note');
  if (note) {
    note.hidden = true;
  }
}

function applySupplierProfileTheme(supplier = window.__supplierData) {
  ensureCurrentProfileStylesheets();
  if (!supplier) {
    return null;
  }
  const theme = resolveSupplierTheme(supplier);
  const palette = createSupplierPalette(theme.accent);
  setThemeVariables(document.documentElement, palette);
  applyAvatarTheme(theme.accent);
  updateHeroThemeState(supplier, theme);
  polishSidebarDetails(supplier);
  polishContactHierarchy(supplier);
  document.documentElement.dataset.spThemeReady = 'true';
  return { ...theme, palette, heroMode: resolveHeroMode(supplier) };
}

function initSupplierProfileTheme() {
  ensureCurrentProfileStylesheets();
  applySupplierProfileTheme();
  window.addEventListener('sp:dataReady', event => {
    requestAnimationFrame(() => applySupplierProfileTheme(event.detail?.supplier));
  });
}

window.SupplierProfileTheme = {
  applySupplierProfileTheme,
  createSupplierPalette,
  formatResponseMessage,
  normaliseHex,
  normaliseThemeMode,
  resolveHeroMode,
  resolveSupplierTheme,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupplierProfileTheme, { once: true });
} else {
  initSupplierProfileTheme();
}

export {
  applySupplierProfileTheme,
  createSupplierPalette,
  formatResponseMessage,
  normaliseHex,
  normaliseThemeMode,
  resolveHeroMode,
  resolveSupplierTheme,
};
