'use strict';
(function () {
  let queued = false;
  let planLookupPromise = null;

  const THEMES = [
    {
      id: 'classic',
      label: 'Classic Mint',
      template: 'classic',
      accent: '#0B8073',
      description: 'Clean EventFlow mint and navy.',
    },
    {
      id: 'romantic',
      label: 'Romantic Blush',
      template: 'romantic',
      accent: '#f5897c',
      description: 'Warm, soft and wedding-led.',
    },
    {
      id: 'modern',
      label: 'Modern Blue',
      template: 'modern',
      accent: '#24436f',
      description: 'Crisp navy with a premium feel.',
    },
    {
      id: 'sage',
      label: 'Sage Garden',
      template: 'classic',
      accent: '#6FAF8F',
      description: 'Natural green for relaxed venues.',
    },
    {
      id: 'gold',
      label: 'Soft Gold',
      template: 'classic',
      accent: '#b9ab2e',
      description: 'Subtle celebratory gold accent.',
    },
  ];

  const esc = value =>
    String(value || '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );

  function getCsrfToken() {
    return (
      document.querySelector('meta[name="csrf-token"]')?.content ||
      decodeURIComponent((document.cookie.match(/(?:^|; )csrfToken=([^;]+)/) || [])[1] || '')
    );
  }

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD' && !headers['X-CSRF-Token']) {
      const token = getCsrfToken();
      if (token) {
        headers['X-CSRF-Token'] = token;
      }
    }
    const res = await fetch(path, { credentials: 'same-origin', ...opts, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || json.message || 'Request failed');
    }
    return json;
  }

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `ww-toast ww-toast--${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    window.setTimeout(() => el.classList.add('show'), 10);
    window.setTimeout(() => {
      el.classList.remove('show');
      window.setTimeout(() => el.remove(), 240);
    }, 2400);
  }

  function normalizeSlug(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
  }

  function isWeddingPlan(plan) {
    const type = String(plan?.eventType || '').toLowerCase();
    const name = String(plan?.name || plan?.eventName || '').toLowerCase();
    return type === 'wedding' || name.includes('wedding') || Boolean(plan?.weddingWebsite);
  }

  function planIdFromDialog(dialog) {
    const csv = dialog.querySelector('a[href*="/guests/export.csv"]')?.getAttribute('href') || '';
    const match = csv.match(/\/api\/me\/plans\/([^/]+)\/guests\/export\.csv/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function resolvePlanId(dialog) {
    const fromDom = planIdFromDialog(dialog);
    if (fromDom) {
      return fromDom;
    }
    if (!planLookupPromise) {
      planLookupPromise = api('/api/me/plans')
        .then(data => data.plans || [])
        .catch(() => []);
    }
    const plans = await planLookupPromise;
    const slug = normalizeSlug(currentShareUrl(dialog).split('/').pop());
    const matchingSlug = plans.find(plan => plan?.weddingWebsite?.slug === slug);
    const plan = matchingSlug || plans.find(isWeddingPlan);
    return plan?.id || '';
  }

  function currentShareUrl(root) {
    const input = root.querySelector('.ww-share-card input[readonly]');
    const slugInput = root.querySelector('#ww-custom-slug');
    const slug = normalizeSlug(slugInput?.value || '');
    if (slug) {
      return `${window.location.origin}/wedding/${slug}`;
    }
    return input?.value || root.querySelector('.ww-link-preview')?.textContent?.trim() || '';
  }

  function syncLink(root, slug) {
    const safeSlug = normalizeSlug(slug);
    if (!safeSlug) {
      return;
    }
    const url = `${window.location.origin}/wedding/${safeSlug}`;
    const input = root.querySelector('.ww-share-card input[readonly]');
    const slugInput = root.querySelector('#ww-custom-slug');
    const slugPreview = root.querySelector('#ww-slug-preview');
    if (input) {
      input.value = url;
    }
    if (slugInput) {
      slugInput.value = safeSlug;
    }
    if (slugPreview) {
      slugPreview.textContent = safeSlug;
    }
    root.querySelectorAll('a[href*="/wedding/"]').forEach(link => {
      if (!/^mailto:|https:\/\/wa\.me\//i.test(link.getAttribute('href') || '')) {
        link.href = url;
      }
    });
    root.querySelectorAll('a[href^="https://wa.me/"]').forEach(link => {
      link.href = `https://wa.me/?text=${encodeURIComponent(url)}`;
    });
    root.querySelectorAll('a[href^="mailto:"]').forEach(link => {
      link.href = `mailto:?subject=Wedding%20details&body=${encodeURIComponent(url)}`;
    });
    root.querySelectorAll('#ww-qr-target, .ww-qr-card img').forEach(qr => {
      qr.src = `/api/tools/qr.png?url=${encodeURIComponent(url)}`;
    });
    const download = root.querySelector('#ww-download-qr');
    if (download) {
      download.dataset.qrUrl = `/api/tools/qr.png?url=${encodeURIComponent(url)}`;
    }
  }

  function injectStyles() {
    if (document.getElementById('ww-link-theme-upgrade-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'ww-link-theme-upgrade-styles';
    style.textContent = `
      .ww-builder details > summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        cursor: pointer;
        list-style: none;
      }
      .ww-builder details > summary.ww-has-expand-indicator {
        justify-content: flex-start;
      }
      .ww-builder details > summary.ww-has-expand-indicator::after,
      .ww-app-dialog.ww-ux-polished .ww-product-workspace summary.ww-has-expand-indicator::after {
        content: none !important;
        display: none !important;
      }
      .ww-app-dialog.ww-ux-polished .ww-product-workspace details,
      .ww-app-dialog.ww-ux-polished .ww-product-workspace details.ww-advanced-panel {
        margin: 0 !important;
      }
      .ww-builder details > summary::-webkit-details-marker { display: none; }
      .ww-expand-indicator {
        display: inline-grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        flex: 0 0 auto;
        margin-left: auto;
        border: 1px solid rgba(80, 192, 176, 0.2);
        border-radius: 999px;
        color: #0f766e;
        background: rgba(255, 255, 255, 0.74);
        box-shadow: 0 8px 20px rgba(36, 67, 111, 0.06);
        animation: ww-arrow-throb 1.7s ease-in-out infinite;
        transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
      }
      .ww-builder details[open] > summary .ww-expand-indicator { transform: rotate(180deg); }
      .ww-builder details > summary:hover .ww-expand-indicator {
        background: rgba(235, 251, 248, 0.95);
        box-shadow: 0 0 0 6px rgba(80, 192, 176, 0.08), 0 10px 22px rgba(36, 67, 111, 0.1);
      }
      .ww-expand-indicator svg { width: 1rem; height: 1rem; stroke-width: 3; }
      @keyframes ww-arrow-throb {
        0%, 100% { box-shadow: 0 0 0 0 rgba(80, 192, 176, 0.22), 0 8px 20px rgba(36, 67, 111, 0.06); }
        50% { box-shadow: 0 0 0 6px rgba(80, 192, 176, 0), 0 8px 20px rgba(36, 67, 111, 0.08); }
      }
      .ww-theme-lab,
      .ww-secure-link-panel {
        border: 1px solid rgba(80, 192, 176, 0.14);
        border-radius: 16px;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(245, 253, 251, 0.58));
        padding: 0.85rem;
        margin: 0.75rem 0;
      }
      .ww-theme-lab h4,
      .ww-secure-link-panel h4 { margin: 0.1rem 0 0.35rem; color: var(--ww-ink, #172033); }
      .ww-theme-lab p,
      .ww-secure-link-panel p { margin: 0 0 0.7rem; color: var(--ww-muted, #63708a); }
      .ww-theme-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
        gap: 0.55rem;
      }
      .ww-theme-card {
        display: grid;
        gap: 0.35rem;
        padding: 0.7rem;
        border: 1px solid rgba(80, 192, 176, 0.16);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.72);
        color: inherit;
        text-align: left;
        cursor: pointer;
        transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
      }
      .ww-theme-card:hover,
      .ww-theme-card:focus-visible {
        transform: translateY(-1px);
        border-color: rgba(80, 192, 176, 0.42);
        box-shadow: 0 10px 22px rgba(36, 67, 111, 0.08);
      }
      .ww-theme-card[aria-pressed='true'] {
        border-color: rgba(80, 192, 176, 0.5);
        box-shadow: inset 0 0 0 1px rgba(80, 192, 176, 0.2);
      }
      .ww-theme-swatch {
        display: flex;
        gap: 0.25rem;
      }
      .ww-theme-swatch span {
        display: block;
        width: 1.15rem;
        height: 1.15rem;
        border-radius: 999px;
        border: 2px solid rgba(255,255,255,0.86);
      }
      .ww-custom-colour-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.55rem;
        margin-top: 0.7rem;
      }
      .ww-secure-link-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; }
      .ww-private-link-note {
        margin-top: 0.55rem !important;
        border-radius: 12px;
        background: rgba(254, 243, 199, 0.66);
        color: #92400e !important;
        padding: 0.55rem;
        font-weight: 800;
      }
      @media (prefers-reduced-motion: reduce) {
        .ww-expand-indicator,
        .ww-theme-card { animation: none; transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function addExpandIndicators(dialog) {
    dialog.querySelectorAll('.ww-builder details > summary').forEach(summary => {
      summary.classList.add('ww-has-expand-indicator');
      if (summary.querySelector('.ww-expand-indicator')) {
        return;
      }
      const indicator = document.createElement('span');
      indicator.className = 'ww-expand-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      summary.appendChild(indicator);
    });
  }

  function enhanceThemeLab(dialog) {
    const form = dialog.querySelector('#ww-builder');
    if (!form || form.querySelector('.ww-theme-lab')) {
      return;
    }
    const extraDetails =
      form.querySelector('#ww-extra-details') ||
      Array.from(form.querySelectorAll('details')).find(details =>
        /guest information/i.test(details.textContent)
      );
    if (!extraDetails) {
      return;
    }
    const currentTemplate = form.querySelector('[name="template"]')?.value || 'classic';
    const currentAccent = form.querySelector('[name="accentColor"]')?.value || '#0B8073';
    const lab = document.createElement('section');
    lab.className = 'ww-theme-lab';
    lab.innerHTML = `
      <span class="ww-product-kicker">Theme studio</span>
      <h4>Choose a guest-site style</h4>
      <p>Pick a polished preset, then fine-tune the template and colour before saving.</p>
      <div class="ww-theme-grid">
        ${THEMES.map(theme => `<button type="button" class="ww-theme-card" data-template="${esc(theme.template)}" data-accent="${esc(theme.accent)}" aria-pressed="${theme.template === currentTemplate && theme.accent.toLowerCase() === currentAccent.toLowerCase()}"><span class="ww-theme-swatch"><span style="background:${esc(theme.accent)}"></span><span style="background:#24436f"></span><span style="background:#ffffff"></span></span><strong>${esc(theme.label)}</strong><small>${esc(theme.description)}</small></button>`).join('')}
      </div>
      <div class="ww-custom-colour-row">
        <label>Template<select name="template" data-theme-control="template"><option value="classic">Classic</option><option value="modern">Modern</option><option value="romantic">Romantic</option></select></label>
        <label>Accent colour<input type="color" name="accentColor" data-theme-control="accent" value="${esc(currentAccent)}"></label>
      </div>
      <p class="small" id="ww-theme-status" role="status" aria-live="polite">Theme changes apply when you press Save.</p>`;
    extraDetails.insertBefore(lab, extraDetails.firstElementChild?.nextSibling || null);
    const originalTemplate = form.querySelector('[name="template"]:not([data-theme-control])');
    const originalAccent = form.querySelector('[name="accentColor"]:not([data-theme-control])');
    const template = lab.querySelector('[data-theme-control="template"]');
    const accent = lab.querySelector('[data-theme-control="accent"]');
    if (originalTemplate) {
      template.removeAttribute('name');
    }
    if (originalAccent) {
      accent.removeAttribute('name');
    }
    template.value = currentTemplate;
    accent.value = currentAccent;
    const syncOriginals = () => {
      if (originalTemplate) {
        originalTemplate.value = template.value;
      }
      if (originalAccent) {
        originalAccent.value = accent.value;
      }
      lab.querySelector('#ww-theme-status').textContent =
        'Theme selected — press Save to apply it to your guest website.';
      lab.querySelectorAll('.ww-theme-card').forEach(card => {
        card.setAttribute(
          'aria-pressed',
          String(
            card.dataset.template === template.value &&
              card.dataset.accent.toLowerCase() === accent.value.toLowerCase()
          )
        );
      });
    };
    lab.querySelectorAll('.ww-theme-card').forEach(card => {
      card.addEventListener('click', () => {
        template.value = card.dataset.template;
        accent.value = card.dataset.accent;
        syncOriginals();
      });
    });
    template.addEventListener('change', syncOriginals);
    accent.addEventListener('input', syncOriginals);
  }

  function enhanceSecureLink(dialog) {
    const sharePane = dialog.querySelector('[data-pane="share"]');
    const admin = sharePane?.querySelector('#ww-share-admin');
    if (!sharePane || !admin || admin.querySelector('.ww-secure-link-panel')) {
      return;
    }
    const slugInput = admin.querySelector('#ww-custom-slug');
    const panel = document.createElement('section');
    panel.className = 'ww-secure-link-panel';
    panel.innerHTML = `<h4>Secure guest link</h4><p>Private link only means anyone with the exact link can view it. Use a unique code or password protection for extra reassurance.</p><div class="ww-secure-link-actions"><button type="button" class="cta secondary small" id="ww-generate-secure-link">Generate new secure link</button><span class="small" id="ww-secure-link-status" role="status" aria-live="polite"></span></div><p class="ww-private-link-note">New secure links are saved immediately. If you manually edit the link, press Save share settings before sharing.</p>`;
    admin.insertBefore(panel, admin.querySelector('.ww-actions') || admin.firstChild);
    panel.querySelector('#ww-generate-secure-link').addEventListener('click', async event => {
      const button = event.currentTarget;
      const status = panel.querySelector('#ww-secure-link-status');
      button.disabled = true;
      button.textContent = 'Generating…';
      status.textContent = '';
      try {
        const planId = await resolvePlanId(dialog);
        if (!planId) {
          throw new Error('Unable to find this wedding plan. Reopen the widget and try again.');
        }
        const data = await api(
          `/api/me/plans/${encodeURIComponent(planId)}/wedding-website/regenerate-slug`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seed:
                dialog.querySelector('[name="coupleNames"]')?.value ||
                slugInput?.value ||
                'our-wedding',
            }),
          }
        );
        const slug = data.website?.slug;
        if (slug) {
          syncLink(sharePane, slug);
          status.textContent = 'New secure link generated and saved.';
          toast('New secure wedding link generated');
          planLookupPromise = null;
        }
      } catch (err) {
        status.textContent = err.message || 'Unable to generate link.';
        toast(status.textContent, 'warn');
      } finally {
        button.disabled = false;
        button.textContent = 'Generate new secure link';
      }
    });
  }

  function enhanceDialog(dialog) {
    addExpandIndicators(dialog);
    enhanceThemeLab(dialog);
    enhanceSecureLink(dialog);
  }

  function run() {
    document.querySelectorAll('.ww-app-dialog').forEach(enhanceDialog);
  }

  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      run();
    });
  }

  const observer = new MutationObserver(mutations => {
    if (
      mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(
          node =>
            node instanceof Element &&
            (node.matches('.ww-app-dialog,#ww-builder,#ww-share-admin') ||
              node.querySelector?.('.ww-app-dialog,#ww-builder,#ww-share-admin'))
        )
      )
    ) {
      schedule();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener(
    'click',
    event => {
      if (
        event.target instanceof Element &&
        event.target.closest('.ww-app-tabs button,[data-tab],summary')
      ) {
        [0, 250, 900].forEach(delay => window.setTimeout(schedule, delay));
      }
    },
    true
  );
  injectStyles();
  schedule();
})();
