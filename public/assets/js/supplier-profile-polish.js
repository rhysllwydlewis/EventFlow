export * from './supplier-profile-polish-base.js';

const PROFILE_POLISH_STYLESHEET_ID = 'supplier-profile-polish-styles';
const PROFILE_POLISH_STYLESHEET_HREF = '/assets/css/supplier-profile-polish.css?v=19.4.1';
const PROFILE_THEME_STYLESHEET_ID = 'supplier-profile-theme-styles';
const PROFILE_THEME_STYLESHEET_HREF = '/assets/css/supplier-profile-theme.css?v=19.5.0';

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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureCurrentProfileStylesheets, {
    once: true,
  });
} else {
  ensureCurrentProfileStylesheets();
}
