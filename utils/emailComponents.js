/**
 * Shared email markup and design tokens.
 *
 * `scripts/generate-email-templates.mjs` builds every file in `email-templates/`
 * from these, and the few places that inject HTML into a template at send time
 * (`sendNotificationEmail`'s CTA, `sendMarketingEmail`'s CTA, the Stripe trial
 * row) call the same helpers so a button looks identical wherever it appears.
 */

'use strict';

/** Bump when `public/assets/email/*.png` change; email clients cache by URL. */
const EMAIL_ASSET_VERSION = '1';

const COLORS = {
  brandDark: '#006D7F',
  brandMid: '#008C96',
  brandLight: '#00E1D0',
  ink: '#0B1F2A',
  body: '#4A5B67',
  muted: '#6B7C88',
  line: '#E6EEF0',
};

/** Solid brand colour, used as the `bgcolor` fallback for clients that drop gradients. */
const BUTTON_FALLBACK_BG = COLORS.brandDark;
const BUTTON_BACKGROUND = `linear-gradient(135deg,${COLORS.brandDark} 0%,${COLORS.brandMid} 100%)`;

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render a button without validating or escaping anything. Callers own the
 * safety of `href` and `label`; use `buildEmailButton` for runtime values.
 *
 * Padding sits on the table cell, not the link, because Outlook's Word engine
 * ignores padding on inline `<a>` elements.
 *
 * @param {Object} options
 * @param {string} options.href - Already-safe attribute value (may be a `{{token}}`).
 * @param {string} options.label - Already-safe HTML.
 * @param {string} [options.background] - CSS `background` value for the button.
 * @returns {string} Button markup, centred in its container.
 */
function renderEmailButton({ href, label, background = BUTTON_BACKGROUND }) {
  return `<table class="btn" role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td align="center" bgcolor="${BUTTON_FALLBACK_BG}" style="border-radius:12px;background-color:${BUTTON_FALLBACK_BG};background:${background};padding:16px 40px;"><a class="cta-button" href="${href}" style="display:block;font-size:16px;font-weight:700;letter-spacing:0.2px;line-height:1.25;color:#ffffff;text-decoration:none;">${label}</a></td></tr></table>`;
}

/**
 * Button for runtime values (admin campaign CTAs, notification actions).
 * Only http(s) URLs are accepted; anything else renders nothing so a bad URL
 * can never become a clickable `javascript:` link.
 *
 * @param {string} url
 * @param {string} text
 * @returns {string} Button markup, or an empty string when the URL is not http(s).
 */
function buildEmailButton(url, text) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || !text) {
    return '';
  }
  return renderEmailButton({
    href: escapeHtml(url),
    label: escapeHtml(text),
  });
}

/**
 * A `<tr>` for a label/value table inside a details card. Matches the rows the
 * templates render themselves, so rows injected at send time (`{{trialRow}}`)
 * sit flush with them.
 *
 * @param {string} label - Already-safe HTML.
 * @param {string} value - Already-safe HTML.
 * @returns {string} Table row markup.
 */
function renderDetailRow(label, value) {
  const cell = 'padding:9px 0;font-size:14px;border-bottom:1px solid #E6EEF0;';
  return `<tr><td class="rule muted" style="${cell}color:${COLORS.muted};">${label}</td><td class="rule h1" align="right" style="${cell}color:${COLORS.ink};font-weight:600;text-align:right;">${value}</td></tr>`;
}

module.exports = {
  EMAIL_ASSET_VERSION,
  COLORS,
  BUTTON_BACKGROUND,
  BUTTON_FALLBACK_BG,
  escapeHtml,
  renderEmailButton,
  buildEmailButton,
  renderDetailRow,
};
