export * from './supplier-profile-polish-base.js';

const PROFILE_POLISH_STYLESHEET_ID = 'supplier-profile-polish-styles';
const PROFILE_POLISH_STYLESHEET_HREF = '/assets/css/supplier-profile-polish.css?v=19.5.0';

function ensureCurrentProfilePolishStylesheet() {
  let link = document.getElementById(PROFILE_POLISH_STYLESHEET_ID);
  if (!link) {
    link = document.createElement('link');
    link.id = PROFILE_POLISH_STYLESHEET_ID;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== PROFILE_POLISH_STYLESHEET_HREF) {
    link.href = PROFILE_POLISH_STYLESHEET_HREF;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureCurrentProfilePolishStylesheet, {
    once: true,
  });
} else {
  ensureCurrentProfilePolishStylesheet();
}
