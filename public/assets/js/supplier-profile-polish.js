export * from './supplier-profile-polish-base.js';

const PROFILE_POLISH_STYLESHEET_ID = 'supplier-profile-polish-styles';
const PROFILE_POLISH_STYLESHEET_HREF = '/assets/css/supplier-profile-polish.css?v=19.4.1';
const PROFILE_THEME_STYLESHEET_ID = 'supplier-profile-theme-styles';
const PROFILE_THEME_STYLESHEET_HREF = '/assets/css/supplier-profile-theme.css?v=20.0.0';

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
  photography: 'photography',
  photographer: 'photography',
  catering: 'catering',
  caterer: 'catering',
  food: 'catering',
  music: 'music',
  dj: 'music',
  band: 'music',
  musicians: 'music',
  entertainment: 'entertainment',
  flowers: 'flowers',
  florist: 'flowers',
  floral: 'flowers',
  venue: 'venue',
  venues: 'venue',
  transport: 'transport',
  cars: 'transport',
  chauffeur: 'transport',
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
});

const DETAIL_ICONS = Object.freeze({
  category:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="8" cy="8" r="1.2"/></svg>',
  location:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5.5-8 11-8 11S4 15.5 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  rating:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>',
  'price range':
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
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
  ensureStylesheet(PROFILE_POLISH_STYLESHEET_ID, PROFILE_POLISH_STYLESHEET_HREF);
  ensureStylesheet(PROFILE_THEME_STYLESHEET_ID, PROFILE_THEME_STYLESHEET_HREF);
}

function normaliseHex(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : null;
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: value >> 16,
    g: (value >> 8) & 255,
    b: value & 255,
  };
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
    ] || null
  );
}

function resolveSupplierTheme(supplier = {}) {
  const chosen = normaliseHex(supplier.themeColor);
  if (chosen) {
    return { accent: chosen, source: 'themeColor' };
  }

  const preset = String(supplier.heroPreset || '')
    .trim()
    .toLowerCase();
  if (PRESET_ACCENTS[preset]) {
    return { accent: PRESET_ACCENTS[preset], source: 'heroPreset' };
  }

  const categoryKey = resolveCategoryKey(supplier.category);
  if (categoryKey && CATEGORY_ACCENTS[categoryKey]) {
    return { accent: CATEGORY_ACCENTS[categoryKey], source: 'category' };
  }

  return { accent: DEFAULT_ACCENT, source: 'default' };
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

function resolveHeroMode(supplier = {}) {
  if (supplier.bannerUrl || supplier.coverImage) {
    return 'image';
  }
  if (
    PRESET_ACCENTS[
      String(supplier.heroPreset || '')
        .trim()
        .toLowerCase()
    ]
  ) {
    return 'preset';
  }
  if (normaliseHex(supplier.themeColor)) {
    return 'theme';
  }
  if (resolveCategoryKey(supplier.category)) {
    return 'category';
  }
  return 'theme';
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

function applySupplierProfileTheme(supplier = window.__supplierData) {
  ensureCurrentProfileStylesheets();
  if (!supplier) {
    return null;
  }

  const theme = resolveSupplierTheme(supplier);
  const palette = createSupplierPalette(theme.accent);
  setThemeVariables(document.documentElement, palette);
  updateHeroThemeState(supplier, theme);
  polishSidebarDetails(supplier);
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
  resolveHeroMode,
  resolveSupplierTheme,
};
