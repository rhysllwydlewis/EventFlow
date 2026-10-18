/**
 * Generates every file in `email-templates/`.
 *
 * All 24 emails share the same brand strip, header, hero, footer, dark-mode
 * styles and button, so they are built from one shell rather than copied by hand
 * and left to drift. That copying is how the footers ended up with three
 * different copyright lines, two different link sets and two different header
 * layouts. The generated files are committed (the runtime loader reads them from
 * disk); re-run this script after changing anything here and commit the result.
 *
 * Templates keep their `{{placeholder}}` tokens: `utils/postmark.js` fills them
 * in at send time, so nothing in this file knows about real recipients.
 *
 * Usage:
 *   node scripts/generate-email-templates.mjs          write email-templates/*.html
 *   node scripts/generate-email-templates.mjs --check  fail if committed files differ
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  EMAIL_ASSET_VERSION,
  COLORS: C,
  renderEmailButton,
  renderDetailRow,
} = require('../utils/emailComponents.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'email-templates');

const ASSET_BASE = '{{baseUrl}}/assets/email';
const asset = file => `${ASSET_BASE}/${file}?v=${EMAIL_ASSET_VERSION}`;

// ── Tones ───────────────────────────────────────────────────────────────────
// Light values are inlined on the element; the dark values are applied by the
// class rules in CSS below for clients that honour prefers-color-scheme.

const PANEL = {
  teal: {
    bg: '#EAF8F7',
    bd: '#C4E9E5',
    fg: '#00545F',
    dbg: '#0F3A40',
    dbd: '#1D5058',
    dfg: '#9FE9E1',
  },
  amber: {
    bg: '#FFF8E6',
    bd: '#F6E3A8',
    fg: '#7A4F00',
    dbg: '#2E2610',
    dbd: '#5A4A1A',
    dfg: '#F3D58A',
  },
  red: {
    bg: '#FEF1EF',
    bd: '#F7CFC9',
    fg: '#8A1C14',
    dbg: '#3A1816',
    dbd: '#6B2A25',
    dfg: '#FFB4AA',
  },
  grey: {
    bg: '#F6F9FA',
    bd: '#E1EAEC',
    fg: '#334155',
    dbg: '#12303A',
    dbd: '#1D3C46',
    dfg: '#B9CBD1',
  },
};

const PILL = {
  brand: { bg: '#D5F3F0', fg: '#00545F', dbg: '#123F43', dfg: '#8FE3DA' },
  success: { bg: '#D1FAE5', fg: '#065F46', dbg: '#0F3B2C', dfg: '#8DF0C4' },
  warn: { bg: '#FDEFC7', fg: '#7A4F00', dbg: '#3A2E10', dfg: '#F3D58A' },
  danger: { bg: '#FDE2DE', fg: '#A4261B', dbg: '#431B18', dfg: '#FFB4AA' },
  neutral: { bg: '#E8EEF1', fg: '#334155', dbg: '#1B3640', dfg: '#B9CBD1' },
};

const STRIP = `linear-gradient(90deg,${C.brandDark} 0%,${C.brandLight} 100%)`;

const toneCss = (map, cls, bgKey, fgKey, bdKey) =>
  Object.entries(map)
    .map(([name, t]) => {
      const rules = [`background-color:${t[bgKey]} !important`];
      if (bdKey) {
        rules.push(`border-color:${t[bdKey]} !important`);
      }
      return `    .${cls}-${name} { ${rules.join(';')}; }\n    .${cls}t-${name} { color:${t[fgKey]} !important; }`;
    })
    .join('\n');

const CSS = `
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    .logo-dark { display: none; max-height: 0; overflow: hidden; mso-hide: all; }
    .msg p { margin: 0 0 14px; }
    .msg ul, .msg ol { margin: 0 0 14px; padding-left: 22px; }
    .msg li { margin-bottom: 6px; }
    .msg a { color: ${C.brandDark}; font-weight: 600; }
    .msg h2, .msg h3 { margin: 18px 0 8px; color: ${C.ink}; line-height: 1.3; }

    @media only screen and (max-width: 600px) {
      .card { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
      .page-pad { padding: 0 0 24px !important; }
      .pad { padding-left: 24px !important; padding-right: 24px !important; }
      .hero-h1 { font-size: 26px !important; }
      .btn { width: 100% !important; }
    }

    @media (prefers-color-scheme: dark) {
      .page { background-color: #071A20 !important; }
      .card { background-color: #0E252D !important; border-color: #1B3A44 !important; }
      .hero { background: #0E252D !important; }
      .h1 { color: #F2F8F9 !important; }
      .txt { color: #B9CBD1 !important; }
      .muted { color: #8CA4AC !important; }
      .rule { border-color: #1B3A44 !important; }
      .soft { background-color: #12303A !important; border-color: #1D3C46 !important; }
      .refbox { background: #0F3A40 !important; border-color: #1D5058 !important; }
      .refcode { color: #8FE3DA !important; }
      .lnk, .msg a { color: #5FE0D4 !important; }
      .msg h2, .msg h3 { color: #F2F8F9 !important; }
      .logo-light { display: none !important; }
      .logo-dark { display: block !important; max-height: none !important; }
${toneCss(PANEL, 'pn', 'dbg', 'dfg', 'dbd')}
${toneCss(PILL, 'pl', 'dbg', 'dfg')}
    }
`;

// ── Components ──────────────────────────────────────────────────────────────

const para = (html, { mb = 16, size = 15, tone = 'txt', extra = '' } = {}) => {
  const color = tone === 'muted' ? C.muted : C.body;
  return `<p class="${tone}" style="margin:0 0 ${mb}px;font-size:${size}px;line-height:1.7;color:${color};${extra}">${html}</p>`;
};

const link = (href, label) =>
  `<a class="lnk" href="${href}" style="color:${C.brandDark};text-decoration:none;font-weight:600;">${label}</a>`;

const strong = html => `<strong class="h1" style="color:${C.ink};">${html}</strong>`;

const pill = (text, tone = 'brand') => {
  const t = PILL[tone];
  return `<span class="pl-${tone} plt-${tone}" style="display:inline-block;padding:6px 14px;background-color:${t.bg};color:${t.fg};border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1.4px;line-height:1.2;text-transform:uppercase;">${text}</span>`;
};

const button = (href, label, background) => renderEmailButton({ href, label, background });

const buttonBlock = (href, label, { mb = 24, background } = {}) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${mb}px;"><tr><td align="center">${button(href, label, background)}</td></tr></table>`;

const panel = (tone, html, { mb = 24 } = {}) => {
  const t = PANEL[tone];
  return `<table class="pn-${tone}" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${mb}px;background-color:${t.bg};border:1px solid ${t.bd};border-radius:12px;"><tr><td class="pnt-${tone}" style="padding:16px 20px;font-size:14px;line-height:1.6;color:${t.fg};">${html}</td></tr></table>`;
};

const label = text =>
  `<p class="muted" style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted};">${text}</p>`;

/** Key/value details card. `rows` is pre-rendered `<tr>` markup (may include a `{{token}}`). */
const detailsCard = (title, rows, { mb = 24 } = {}) =>
  `<table class="soft" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${mb}px;background-color:#F6F9FA;border:1px solid #E1EAEC;border-radius:12px;"><tr><td style="padding:18px 22px 10px;">${label(title)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`;

const rows = pairs => pairs.map(([k, v]) => (k === 'raw' ? v : renderDetailRow(k, v))).join('');

/** Numbered steps, separated by hairlines. */
const steps = items =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">${items
    .map(([title, text], i) => {
      const rule = i === items.length - 1 ? '' : `border-bottom:1px solid ${C.line};`;
      return `<tr><td class="rule" width="52" valign="top" style="padding:18px 0;${rule}"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="36" height="36" align="center" valign="middle" bgcolor="${C.brandDark}" style="width:36px;height:36px;border-radius:18px;background-color:${C.brandDark};background:linear-gradient(135deg,${C.brandDark},#00B7B0);color:#ffffff;font-size:15px;font-weight:800;">${i + 1}</td></tr></table></td><td class="rule" valign="top" style="padding:18px 0;${rule}"><p class="h1" style="margin:2px 0 3px;font-size:16px;font-weight:700;color:${C.ink};">${title}</p><p class="txt" style="margin:0;font-size:14px;line-height:1.6;color:${C.body};">${text}</p></td></tr>`;
    })
    .join('')}</table>`;

const checklist = (items, { mb = 28 } = {}) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${mb}px;">${items
    .map(
      text =>
        `<tr><td width="32" valign="top" style="padding:7px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="pl-brand plt-brand" width="20" height="20" align="center" valign="middle" style="width:20px;height:20px;border-radius:10px;background-color:${PILL.brand.bg};color:${PILL.brand.fg};font-size:12px;font-weight:800;line-height:20px;">&#10003;</td></tr></table></td><td class="txt" valign="top" style="padding:7px 0;font-size:14px;line-height:1.5;color:${C.body};">${text}</td></tr>`
    )
    .join('')}</table>`;

/** Labelled block quoting a reply or message. */
const quote = (title, html, { mb = 24 } = {}) =>
  `<table class="soft" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${mb}px;background-color:#F6F9FA;border:1px solid #E1EAEC;border-radius:12px;"><tr><td style="padding:18px 22px;">${title ? label(title) : ''}<div class="txt" style="font-size:15px;line-height:1.7;color:${C.body};">${html}</div></td></tr></table>`;

const subjectBlock = (title, valueHtml) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td class="rule" style="padding:0 0 16px;border-bottom:1px solid ${C.line};">${label(title)}<p class="h1" style="margin:0;font-size:17px;font-weight:700;line-height:1.4;color:${C.ink};">${valueHtml}</p></td></tr></table>`;

const fallbackLink = token =>
  `${para('Button not working? Copy and paste this link into your browser:', { mb: 8, size: 13, tone: 'muted' })}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="soft lnk" style="background-color:#F6F9FA;border:1px solid #E1EAEC;border-radius:10px;padding:12px 16px;font-size:12px;line-height:1.5;color:${C.brandDark};word-break:break-all;">${token}</td></tr></table>`;

const supportLine = html =>
  para(html, { mb: 0, size: 13, tone: 'muted', extra: 'text-align:center;' });

const FOOTER_LINKS = [
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
  ['Help centre', '/faq'],
  ['Contact', '/contact'],
];

const hero = ({ pill: pillSpec, h1, sub }) =>
  `<div style="padding:40px 0 0;">${pill(pillSpec[0], pillSpec[1])}</div>
          <h1 class="h1 hero-h1" style="margin:18px 0 ${sub ? 12 : 8}px;font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-0.6px;color:${C.ink};">${h1}</h1>${
            sub
              ? `
          <p class="txt" style="margin:0 auto 26px;max-width:460px;font-size:16px;line-height:1.6;color:${C.body};">${sub}</p>`
              : ''
          }`;

const footerNote = html =>
  `<p style="margin:0 0 18px;font-size:12px;line-height:1.7;color:#8FB6BB;">${html}</p>`;

const footerLink = (href, text, color = '#8FE3DA') =>
  `<a href="${href}" style="color:${color};text-decoration:none;">${text}</a>`;

function shell({ title, strip = STRIP, heroSpec, body, footerNotes = [], footerExtra = '' }) {
  const links = FOOTER_LINKS.map(([text, route]) => footerLink(`{{baseUrl}}${route}`, text)).join(
    '\n            <span style="color:#3E6A71;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>\n            '
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
  <style>${CSS}  </style>
</head>
<body style="margin:0;padding:0;background-color:#EEF4F5;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table class="page" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF4F5;">
    <tr>
      <td class="page-pad" align="center" style="padding:28px 12px 36px;">
        <table class="email-container card" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #DCE8EA;border-radius:20px;overflow:hidden;box-shadow:0 12px 40px rgba(0,80,95,0.10);">

          <!-- ── Brand strip ─────────────────────────────────── -->
          <tr>
            <td height="6" style="height:6px;line-height:6px;font-size:0;background-color:#00A3A8;background:${strip};">&nbsp;</td>
          </tr>

          <!-- ── Logo + hero ─────────────────────────────────── -->
          <tr>
            <td class="email-header hero pad" align="center" style="background-color:#F3FBFA;background:linear-gradient(180deg,#E6F7F6 0%,#FFFFFF 100%);padding:34px 40px 8px;">
              <a href="{{baseUrl}}" style="text-decoration:none;">
                <img class="logo-light" src="${asset('eventflow-wordmark.png')}" width="184" height="30" alt="EventFlow" style="display:block;margin:0 auto;width:184px;height:auto;font-size:24px;font-weight:800;line-height:30px;color:${C.brandDark};">
                <img class="logo-dark" src="${asset('eventflow-wordmark-white.png')}" width="184" height="30" alt="EventFlow" style="display:none;margin:0 auto;width:184px;height:auto;font-size:24px;font-weight:800;line-height:30px;color:#ffffff;">
              </a>
              ${hero(heroSpec)}
            </td>
          </tr>

          <!-- ── Body ────────────────────────────────────────── -->
          <tr>
            <td class="email-body pad" style="padding:8px 40px 40px;">
              ${body}
            </td>
          </tr>

          <!-- ── Footer ──────────────────────────────────────── -->
          <tr>
            <td class="email-footer pad" align="center" style="background-color:#062B33;padding:34px 40px 30px;">
              <img src="${asset('eventflow-mark-white.png')}" width="44" height="28" alt="EventFlow" style="display:block;margin:0 auto 14px;width:44px;height:auto;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#ffffff;letter-spacing:0.1px;">Plan brilliantly. Book confidently.</p>
              <p style="margin:0 0 20px;font-size:12px;color:#7FA3A8;">EventFlow &middot; Operated by VEXI</p>
              ${footerNotes.map(footerNote).join('\n              ')}
              <p style="margin:0 0 18px;font-size:13px;line-height:1.9;">
            ${links}
              </p>
              <p style="margin:0;font-size:12px;line-height:1.7;color:#6F9298;">&copy; 2025&ndash;{{year}} EventFlow. All rights reserved.<br>${footerLink('{{baseUrl}}', 'event-flow.co.uk', '#6F9298').replace('text-decoration:none', 'text-decoration:underline')}</p>${footerExtra}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

// ── Template definitions ────────────────────────────────────────────────────

const HELP_LINE = supportLine(
  `Need help? Visit our ${link('{{baseUrl}}/faq', 'help centre')} or email ${link('mailto:hello@event-flow.co.uk', 'hello@event-flow.co.uk')}`
);
const BILLING_HELP = supportLine(
  `Need help? ${link('{{baseUrl}}/contact', 'Contact support')} or email ${link('mailto:billing@event-flow.co.uk', 'billing@event-flow.co.uk')}`
);
const SUPPORT_NOTE = footerNote(
  `Need more help? Email ${footerLink('mailto:{{supportEmail}}', '{{supportEmail}}')}`
);

const NEWSLETTER_BENEFITS = [
  'New suppliers and venues joining the platform',
  'Event planning tips, guides and best practices',
  'Exclusive offers and early access to new features',
  'Platform updates and improvements',
];

const TIP = (html, tone = 'amber') => panel(tone, html, { mb: 24 });

const TEMPLATES = {
  verification: () =>
    shell({
      title: 'Verify Your Email - EventFlow',
      heroSpec: {
        pill: ['One quick step', 'brand'],
        h1: 'Verify your email address',
        sub: 'Hi {{name}}, thanks for creating your EventFlow account. Verify your email address to complete your registration and unlock all features.',
      },
      body: [
        buttonBlock('{{verificationLink}}', 'Verify email address', { mb: 28 }),
        panel(
          'teal',
          `<strong>Security note.</strong> This link expires in 24 hours. If you didn’t create an EventFlow account, you can safely ignore this email.`,
          { mb: 26 }
        ),
        fallbackLink('{{verificationLink}}'),
      ].join('\n              '),
    }),

  'password-reset': () =>
    shell({
      title: 'Reset Your Password - EventFlow',
      heroSpec: {
        pill: ['Account security', 'brand'],
        h1: 'Reset your password',
        sub: 'Hi {{name}}, we received a request to reset the password for your EventFlow account. Use the button below to choose a new one.',
      },
      body: [
        buttonBlock('{{resetLink}}', 'Reset password', { mb: 28 }),
        panel(
          'amber',
          `<strong>This link expires in 1 hour.</strong> If you didn’t request a password reset, ignore this email or ${link('mailto:support@event-flow.co.uk', 'contact support')} if you’re concerned.`,
          { mb: 26 }
        ),
        fallbackLink('{{resetLink}}'),
      ].join('\n              '),
    }),

  'password-reset-confirmation': () =>
    shell({
      title: 'Password Changed - EventFlow',
      heroSpec: {
        pill: ['Password updated', 'success'],
        h1: 'Password successfully changed',
        sub: 'Hi {{name}}, your EventFlow password was changed. You can now log in with your new password.',
      },
      body: [
        para('Changed at {{resetTime}}. If that wasn’t you, see the notice below.', {
          mb: 24,
          size: 13,
          tone: 'muted',
          extra: 'text-align:center;',
        }),
        buttonBlock('{{baseUrl}}/auth', 'Log in now', { mb: 28 }),
        panel(
          'amber',
          `<strong>Didn’t make this change?</strong> Contact our support team immediately at ${link('mailto:support@event-flow.co.uk', 'support@event-flow.co.uk')}. Your account security is our priority.`,
          { mb: 0 }
        ),
      ].join('\n              '),
    }),

  welcome: () =>
    shell({
      title: 'Welcome to EventFlow!',
      heroSpec: {
        pill: ['Welcome aboard', 'brand'],
        h1: 'Welcome to EventFlow',
        sub: 'Hi {{name}}, your account is ready. You’re all set to start planning your perfect event.',
      },
      body: [
        steps([
          [
            'Discover suppliers',
            'Browse verified venues, caterers, photographers and more, filtered by location, price and reviews.',
          ],
          [
            'Build your plan',
            'Create your event checklist, track tasks and manage your budget all in one place.',
          ],
          [
            'Message suppliers',
            'Request quotes, ask questions and manage conversations without leaving the platform.',
          ],
        ]),
        buttonBlock('{{baseUrl}}/start', 'Start planning', { mb: 28 }),
        HELP_LINE,
      ].join('\n              '),
    }),

  'welcome-customer': () =>
    shell({
      title: 'Welcome to EventFlow',
      heroSpec: {
        pill: ['Welcome aboard', 'brand'],
        h1: 'Let’s plan something great',
        sub: 'Hi {{name}}, your account is ready. Here are the quickest ways to go from ideas to booked suppliers.',
      },
      body: [
        steps([
          [
            'Discover suppliers',
            'Compare trusted venues, caterers, photographers and more, filtered by location, style and budget.',
          ],
          [
            'Build your plan',
            'Keep tasks, deadlines and spending in one clear timeline so your event stays on track.',
          ],
          [
            'Message suppliers',
            'Send one message to several shortlisted suppliers and keep every reply in your dashboard.',
          ],
        ]),
        buttonBlock('{{baseUrl}}/dashboard/customer', 'Start planning your event', { mb: 18 }),
        `<p style="margin:0 0 28px;text-align:center;font-size:14px;font-weight:600;">${link('{{baseUrl}}/suppliers', 'Browse suppliers &rarr;')}<span style="color:#B7C6CB;">&nbsp;&nbsp;&nbsp;</span>${link('{{baseUrl}}/plan', 'Open checklist &rarr;')}</p>`,
        TIP(
          '<strong>Pro tip.</strong> Add your event date and guest count first. You’ll get better supplier matches and more accurate quotes.'
        ),
        HELP_LINE,
      ].join('\n              '),
    }),

  'welcome-supplier': () =>
    shell({
      title: 'Welcome to EventFlow Supplier Hub',
      heroSpec: {
        pill: ['Supplier hub', 'brand'],
        h1: 'Welcome aboard, {{name}}',
        sub: 'Your supplier account is live. Complete these steps to start receiving high-intent event enquiries.',
      },
      body: [
        steps([
          [
            'Complete your profile',
            'Add services, pricing, portfolio and availability so customers can confidently shortlist your business.',
          ],
          [
            'Manage enquiries',
            'Respond quickly with saved answers and keep all conversations organised in your dashboard.',
          ],
          [
            'Grow your business',
            'Monitor profile performance and reviews to improve conversion and secure more bookings.',
          ],
        ]),
        buttonBlock('{{baseUrl}}/dashboard/supplier', 'Go to your dashboard', { mb: 28 }),
        TIP(
          '<strong>Pro tip.</strong> Suppliers with complete service descriptions and 6+ portfolio images typically receive more qualified enquiries.',
          'teal'
        ),
        supportLine(
          `Need support? Visit our ${link('{{baseUrl}}/faq', 'help centre')} or email ${link('mailto:support@event-flow.co.uk', 'support@event-flow.co.uk')}`
        ),
      ].join('\n              '),
    }),

  'partner-welcome': () =>
    shell({
      title: 'Welcome to the EventFlow Partner Programme',
      heroSpec: {
        pill: ['Partner programme', 'brand'],
        h1: 'Welcome to the Partner Programme, {{name}}',
        sub: 'You now have everything you need to start referring suppliers to EventFlow and earn rewards for each one who joins.',
      },
      body: [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td class="refbox" align="center" style="background-color:#EAF8F7;background:linear-gradient(135deg,#EAF8F7,#DDF3F1);border:1px solid #BFE7E1;border-radius:14px;padding:22px 28px;text-align:center;">${label('Your referral code')}<p class="refcode" style="margin:0 0 16px;font-size:28px;font-weight:800;color:${C.brandDark};letter-spacing:3px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">{{refCode}}</p>${label('Your unique referral link')}<p style="margin:0;font-size:13px;font-weight:600;word-break:break-all;"><a class="lnk" href="{{refLink}}" style="color:${C.brandDark};text-decoration:none;">{{refLink}}</a></p></td></tr></table>`,
        buttonBlock('{{dashboardLink}}', 'Open Partner Dashboard', { mb: 32 }),
        `<h2 class="h1" style="margin:0 0 4px;font-size:18px;font-weight:800;letter-spacing:-0.2px;color:${C.ink};">How the programme works</h2>`,
        steps([
          [
            'Share your referral link',
            'Share your personal referral link with any supplier you’d like to invite to EventFlow.',
          ],
          [
            'They sign up and join',
            'When they register using your code, they’re linked to your partner account automatically.',
          ],
          [
            'Track referrals and rewards',
            'View your referred suppliers and any earned rewards directly in your partner dashboard.',
          ],
        ]),
        supportLine(
          `Questions about the programme? Contact us at ${link('mailto:hello@event-flow.co.uk', 'hello@event-flow.co.uk')}`
        ),
      ].join('\n              '),
    }),

  'newsletter-confirm': () =>
    shell({
      title: 'Confirm Your Newsletter Subscription - EventFlow',
      heroSpec: {
        pill: ['Newsletter', 'brand'],
        h1: 'Confirm your subscription',
        sub: 'Thanks for subscribing to the EventFlow newsletter. Confirm below to stay up to date with:',
      },
      body: [
        checklist([
          'New suppliers and venues',
          'Event planning tips and guides',
          'Exclusive offers and early access',
          'Platform updates and new features',
        ]),
        buttonBlock('{{confirmLink}}', 'Confirm subscription', { mb: 28 }),
        panel(
          'teal',
          `<strong>Note.</strong> This confirmation link expires in 24 hours. If you didn’t subscribe to our newsletter, you can safely ignore this email.`,
          { mb: 0 }
        ),
      ].join('\n              '),
    }),

  'newsletter-welcome': () =>
    shell({
      title: 'Welcome to the EventFlow Newsletter!',
      heroSpec: {
        pill: ['You’re in', 'success'],
        h1: 'You’re subscribed',
        sub: 'You’re now part of the EventFlow community. Here’s what you’ll receive:',
      },
      body: [
        checklist(NEWSLETTER_BENEFITS),
        para('Ready to get started? Browse our verified suppliers and begin planning your event.', {
          mb: 24,
          extra: 'text-align:center;',
        }),
        buttonBlock('{{baseUrl}}/suppliers', 'Browse suppliers', { mb: 28 }),
        supportLine(
          `Changed your mind? ${link('{{unsubscribeLink}}', 'Unsubscribe')} at any time.`
        ),
      ].join('\n              '),
    }),

  marketing: () =>
    shell({
      title: '{{title}} — EventFlow',
      heroSpec: { pill: ['From EventFlow', 'brand'], h1: '{{title}}' },
      body: [
        para('Hi {{name}},', { mb: 16 }),
        `<div class="msg txt" style="margin:0 0 28px;font-size:15px;line-height:1.7;color:${C.body};">
                {{message}}
              </div>`,
        para(
          'You’re receiving this email because you opted in to marketing communications from EventFlow. We respect your inbox: emails are infrequent and relevant.',
          { mb: 0, size: 13, tone: 'muted' }
        ),
      ].join('\n              '),
      footerExtra: `
              <p style="margin:18px 0 0;font-size:12px;"><a href="{{unsubscribeLink}}" style="color:#8FB6BB;text-decoration:underline;">Unsubscribe from marketing emails</a></p>`,
    }),

  notification: () =>
    shell({
      title: '{{title}} - EventFlow',
      heroSpec: { pill: ['Account update', 'brand'], h1: '{{title}}' },
      body: [
        para('Hi {{name}},', { mb: 16 }),
        quote('', '{{message}}', { mb: 28 }),
        '<!-- CTA button: only rendered when ctaSection is provided by the backend -->\n              {{ctaSection}}',
        para(
          `You received this email because notifications are enabled for your account. Manage your preferences in ${link('{{baseUrl}}/settings', 'account settings')}.`,
          { mb: 0, size: 13, tone: 'muted' }
        ),
      ].join('\n              '),
    }),

  'new-message': () =>
    shell({
      title: 'New message on EventFlow',
      heroSpec: { pill: ['New message', 'brand'], h1: 'You have a new message' },
      body: [
        para(`${strong('{{senderName}}')} sent you a message{{contextSuffix}}:`, { mb: 18 }),
        quote('', '{{previewHtml}}', { mb: 28 }),
        buttonBlock('{{conversationUrl}}', 'Reply', { mb: 0 }),
      ].join('\n              '),
      footerNotes: [
        `Manage your notification preferences in ${footerLink('{{baseUrl}}/settings', 'account settings')}.`,
      ],
    }),

  'support-ticket-reply': () =>
    shell({
      title: 'We’ve replied to your support ticket — EventFlow',
      heroSpec: {
        pill: ['Support', 'brand'],
        h1: 'We’ve replied to your support ticket',
        sub: 'Hi {{name}}, a member of the EventFlow Support Team has replied to your ticket.',
      },
      body: [
        subjectBlock('Ticket subject', '{{ticketSubject}}'),
        quote('Reply from support', '{{replyMessageHtml}}', { mb: 28 }),
        buttonBlock('{{ticketUrl}}', 'View your ticket', { mb: 28 }),
        fallbackLink('{{ticketUrl}}'),
        para('The EventFlow Support Team', { mb: 0, size: 14, extra: 'margin-top:24px;' }),
      ].join('\n              '),
      footerNotes: [
        `Need more help? Email ${footerLink('mailto:{{supportEmail}}', '{{supportEmail}}')}`,
      ],
    }),

  'contact-enquiry-reply': () =>
    shell({
      title: 'We’ve replied to your enquiry — EventFlow',
      heroSpec: {
        pill: ['Enquiry reply', 'brand'],
        h1: 'We’ve replied to your enquiry',
        sub: 'Hi {{name}}, thank you for contacting EventFlow. A member of our team has replied to your enquiry.',
      },
      body: [
        subjectBlock('Your enquiry', '{{enquirySubject}}'),
        quote('Reply from EventFlow', '{{replyMessageHtml}}', { mb: 24 }),
        para('If you have any further questions, feel free to get in touch again.', {
          mb: 24,
          size: 14,
        }),
        buttonBlock('{{baseUrl}}/contact', 'Contact us again', { mb: 24 }),
        para('The EventFlow Team', { mb: 0, size: 14 }),
      ].join('\n              '),
      footerNotes: [
        `Need more help? Email ${footerLink('mailto:{{supportEmail}}', '{{supportEmail}}')}`,
      ],
    }),

  'review-request': () =>
    shell({
      title: 'Review request from {{supplierName}} — EventFlow',
      heroSpec: {
        pill: ['Review request', 'brand'],
        h1: 'How was your experience with {{supplierName}}?',
        sub: 'Hi {{name}}, {{supplierName}} has invited you to leave an honest review on EventFlow. Your feedback helps future customers choose with confidence.',
      },
      body: [
        buttonBlock('{{reviewLink}}', 'Leave a review', { mb: 28 }),
        panel(
          'teal',
          `This secure link expires in {{expiresInDays}} days and is intended for the email address that received it. You may be asked to sign in or create an EventFlow account before submitting your review.`,
          { mb: 20 }
        ),
        para(
          'Only leave a review if you have genuine experience with this supplier. EventFlow may moderate reviews to protect customers and suppliers.',
          { mb: 0, size: 13, tone: 'muted' }
        ),
      ].join('\n              '),
      footerNotes: [
        'This message was sent because {{supplierName}} entered your email address when requesting customer feedback. If you were not expecting it, you can ignore this email.',
      ],
    }),

  'action-prompts': () =>
    shell({
      title: 'Your EventFlow Profile — Action Required',
      heroSpec: {
        pill: ['Profile check', 'brand'],
        h1: 'Hi {{name}}',
        sub: 'We’ve done a quick check on your EventFlow supplier profile and put together a summary below. A few minutes spent on these items can noticeably improve how often customers discover and choose your business.',
      },
      body: [
        '<!-- RAG summary injected by the backend -->\n              {{actionsHtml}}',
        buttonBlock('{{loginUrl}}', 'Go to my dashboard &rarr;', { mb: 28 }),
        panel(
          'grey',
          `Control which emails you receive in your ${link('{{managePrefsUrl}}', 'account settings')}.{{unsubscribeSection}}`,
          { mb: 0 }
        ),
      ].join('\n              '),
    }),

  'supplier-verification-status': () =>
    shell({
      title: '{{statusTitle}} — EventFlow',
      strip: '{{headerGradient}}',
      heroSpec: { pill: ['Supplier verification', 'brand'], h1: '{{statusTitle}}' },
      body: [
        para('Hi {{name}},', { mb: 8 }),
        para('{{statusMessage}}', { mb: 24 }),
        '<!-- Optional notes from admin -->\n              {{notesSection}}',
        buttonBlock('{{dashboardUrl}}', '{{ctaText}}', { mb: 28, background: '{{ctaGradient}}' }),
        supportLine(
          `Questions? Contact our team at ${link('mailto:{{supportEmail}}', '{{supportEmail}}')}`
        ),
      ].join('\n              '),
    }),

  'subscription-activated': () =>
    shell({
      title: 'Subscription Activated - EventFlow',
      heroSpec: {
        pill: ['Subscription active', 'success'],
        h1: 'Subscription activated',
        sub: 'Hi {{name}}, your {{planName}} subscription is active. Thank you for choosing EventFlow.',
      },
      body: [
        detailsCard(
          'Subscription details',
          rows([
            ['Plan', '{{planName}}'],
            ['Status', '{{status}}'],
            ['raw', '{{trialRow}}'],
            ['Renews on', '{{renewalDate}}'],
            ['Amount', '£{{amount}}/{{billingCycle}}'],
          ])
        ),
        para('Your premium features are now active:', { mb: 8 }),
        `<ul class="txt" style="margin:0 0 28px;padding-left:20px;font-size:14px;line-height:1.9;color:${C.body};">{{features}}</ul>`,
        buttonBlock('{{baseUrl}}/dashboard/supplier', 'View your dashboard', { mb: 28 }),
        BILLING_HELP,
      ].join('\n              '),
    }),

  'subscription-cancelled': () =>
    shell({
      title: 'Subscription Cancelled - EventFlow',
      heroSpec: {
        pill: ['Subscription cancelled', 'warn'],
        h1: 'Your subscription has been cancelled',
        sub: 'Hi {{name}}, we’re sorry to see you go. Your {{planName}} subscription has been cancelled as requested.',
      },
      body: [
        panel(
          'amber',
          `<strong>You’ll retain access to premium features until {{endDate}}.</strong>`
        ),
        detailsCard(
          'What happens next',
          rows([
            ['Plan', '{{planName}}'],
            ['Access until', '{{endDate}}'],
            ['Next billing', 'None, cancelled'],
          ])
        ),
        para(
          'We’d love to have you back. You can reactivate your subscription at any time to continue without interruption.',
          { mb: 24 }
        ),
        buttonBlock('{{baseUrl}}/supplier/subscription', 'Reactivate subscription', { mb: 28 }),
        supportLine(
          `Want to share feedback? ${link('{{baseUrl}}/contact?subject=Subscription%20Feedback', 'Let us know')}`
        ),
      ].join('\n              '),
    }),

  'subscription-upgraded': () =>
    shell({
      title: 'Plan Upgraded - EventFlow',
      heroSpec: {
        pill: ['Plan upgraded', 'success'],
        h1: 'Your plan has been upgraded',
        sub: 'Hi {{name}}, your EventFlow subscription has been upgraded from {{previousPlan}} to {{newPlan}}. Your new features are now active.',
      },
      body: [
        detailsCard(
          'Upgrade details',
          rows([
            ['Previous plan', '{{previousPlan}}'],
            ['New plan', '{{newPlan}}'],
            ['Status', 'Active'],
            ['Effective date', '{{effectiveDate}}'],
            ['Amount', '£{{amount}}/{{billingCycle}}'],
          ])
        ),
        para('Your new features are now active:', { mb: 8 }),
        `<ul class="txt" style="margin:0 0 28px;padding-left:20px;font-size:14px;line-height:1.9;color:${C.body};">{{features}}</ul>`,
        buttonBlock('{{baseUrl}}/dashboard/supplier', 'View your dashboard', { mb: 28 }),
        BILLING_HELP,
      ].join('\n              '),
    }),

  'subscription-downgrade-scheduled': () =>
    shell({
      title: 'Plan Change Scheduled - EventFlow',
      heroSpec: {
        pill: ['Plan change scheduled', 'warn'],
        h1: 'Your plan change has been scheduled',
        sub: 'Hi {{name}}, your EventFlow plan will change from {{currentPlan}} to {{newPlan}} on {{effectiveDate}}.',
      },
      body: [
        panel(
          'amber',
          `<strong>You’ll retain full access to your {{currentPlan}} features until {{effectiveDate}}.</strong>`
        ),
        detailsCard(
          'Plan change details',
          rows([
            ['Current plan', '{{currentPlan}}'],
            ['New plan (from {{effectiveDate}})', '{{newPlan}}'],
            ['Access until', '{{effectiveDate}}'],
            ['Current billing', '£{{currentAmount}}/{{billingCycle}}'],
            ['New billing', '£{{newAmount}}/{{billingCycle}}'],
          ])
        ),
        para(
          'You can upgrade at any time before this date to keep your current features. If you change your mind, simply upgrade from your subscription page.',
          { mb: 24 }
        ),
        buttonBlock('{{baseUrl}}/supplier/subscription', 'Manage subscription', { mb: 28 }),
        BILLING_HELP,
      ].join('\n              '),
    }),

  'subscription-payment-failed': () =>
    shell({
      title: 'Payment Failed - EventFlow',
      heroSpec: {
        pill: ['Action required', 'danger'],
        h1: 'Payment failed',
        sub: 'Hi {{name}}, we couldn’t process your payment for your {{planName}} subscription, so your account has already reverted to Starter access.',
      },
      body: [
        panel(
          'red',
          `<strong>Update your payment method.</strong> Your premium features are paused right now. Update your card to restore {{planName}} straight away. We’ll also automatically retry the charge on {{nextRetryDate}}, so updating first means you won’t need to do anything else.`
        ),
        detailsCard(
          'Payment details',
          rows([
            ['Plan', '{{planName}}'],
            ['Amount', '£{{amount}}'],
            ['Attempted', '{{attemptDate}}'],
            ['Next automatic retry', '{{nextRetryDate}}'],
          ]),
          { mb: 28 }
        ),
        buttonBlock('{{baseUrl}}/supplier/subscription', 'Update payment method', { mb: 28 }),
        supportLine(
          `Having trouble? ${link('{{baseUrl}}/contact', 'Contact support')} or email ${link('mailto:billing@event-flow.co.uk', 'billing@event-flow.co.uk')}`
        ),
      ].join('\n              '),
    }),

  'subscription-renewal-reminder': () =>
    shell({
      title: 'Subscription Renewal Reminder - EventFlow',
      heroSpec: {
        pill: ['Renewal reminder', 'brand'],
        h1: 'Your subscription renews soon',
        sub: 'Hi {{name}}, this is a friendly reminder that your {{planName}} subscription will renew in {{daysUntilRenewalLabel}}.',
      },
      body: [
        detailsCard(
          'Renewal details',
          rows([
            ['Plan', '{{planName}}'],
            ['Renewal date', '{{renewalDate}}'],
            ['Amount', '£{{amount}}'],
            ['Auto-renew', '{{autoRenew}}'],
          ])
        ),
        para('{{renewalMessage}}', { mb: 24 }),
        buttonBlock('{{baseUrl}}/supplier/subscription', '{{ctaText}}', { mb: 0 }),
      ].join('\n              '),
    }),

  'subscription-trial-ending': () =>
    shell({
      title: 'Your Trial is Ending Soon - EventFlow',
      heroSpec: {
        pill: ['Trial ending', 'warn'],
        h1: 'Your trial is ending soon',
        sub: 'Hi {{name}}, your {{trialDays}}-day free trial of {{planName}} ends in {{daysLeftLabel}}, on {{trialEndDate}}.',
      },
      body: [
        panel(
          'teal',
          `<strong>After your trial ends, your paid subscription will begin automatically.</strong> No action is needed if you’d like to continue.`
        ),
        detailsCard(
          'Subscription details',
          rows([
            ['Plan', '{{planName}}'],
            ['Trial ends', '{{trialEndDate}}'],
            ['Next billing', '£{{amount}}/{{billingCycle}}'],
          ])
        ),
        para('Don’t want to continue? You can cancel before {{trialEndDate}} at no charge.', {
          mb: 24,
        }),
        buttonBlock('{{baseUrl}}/dashboard/supplier', 'View dashboard', { mb: 18 }),
        `<p style="margin:0;text-align:center;font-size:14px;font-weight:600;">${link('{{baseUrl}}/supplier/subscription', 'Manage subscription &rarr;')}</p>`,
      ].join('\n              '),
    }),
};

const names = Object.keys(TEMPLATES).sort();

async function drift() {
  const stale = [];
  for (const name of names) {
    const file = path.join(outDir, `${name}.html`);
    const current = await readFile(file, 'utf8').catch(() => null);
    if (current !== TEMPLATES[name]()) {
      stale.push(`email-templates/${name}.html`);
    }
  }
  return stale;
}

async function main() {
  if (process.argv.includes('--check')) {
    const stale = await drift();
    if (stale.length) {
      process.stderr.write(
        `The committed email templates differ from the generator:\n  ${stale.join('\n  ')}\n` +
          'Either re-run scripts/generate-email-templates.mjs and commit the result, or update the generator to match.\n'
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`All ${names.length} email templates match the generator\n`);
    return;
  }

  await Promise.all(
    names.map(name => writeFile(path.join(outDir, `${name}.html`), TEMPLATES[name](), 'utf8'))
  );
  process.stdout.write(`Generated ${names.length} email templates\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
