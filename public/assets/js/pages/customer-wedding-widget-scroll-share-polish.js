'use strict';
(function () {
  let queued = false;

  const normalizeSlug = value =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);

  function injectStyles() {
    if (document.getElementById('ww-scroll-share-polish-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'ww-scroll-share-polish-styles';
    style.textContent = `
      .ww-app-dialog {
        width: min(940px, calc(100vw - 24px)) !important;
        max-width: 940px !important;
        height: min(820px, calc(100dvh - 24px)) !important;
        max-height: calc(100dvh - 24px) !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      .ww-app-shell {
        display: grid !important;
        grid-template-rows: auto auto minmax(0, 1fr) !important;
        height: 100% !important;
        max-height: calc(100dvh - 24px) !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
      .ww-app-header { flex: 0 0 auto; }
      .ww-app-tabs {
        flex: 0 0 auto;
        overflow-x: auto !important;
        overflow-y: visible !important;
        overscroll-behavior-x: contain;
        padding: 0.72rem 1.2rem 0.86rem !important;
        scrollbar-width: thin;
      }
      .ww-app-tabs button { flex: 0 0 auto; margin-bottom: 0 !important; }
      .ww-app-body {
        min-height: 0 !important;
        height: auto !important;
        max-height: none !important;
        overflow-x: hidden !important;
        overflow-y: scroll !important;
        overscroll-behavior: contain;
        padding-bottom: 1.35rem !important;
        scrollbar-gutter: stable;
        scrollbar-width: thin !important;
        scrollbar-color: rgba(80, 192, 176, 0.62) rgba(255, 255, 255, 0.36) !important;
        -ms-overflow-style: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      .ww-app-body::-webkit-scrollbar {
        display: block !important;
        width: 10px !important;
        height: 10px !important;
      }
      .ww-app-body::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.42) !important;
        border-radius: 999px !important;
      }
      .ww-app-body::-webkit-scrollbar-thumb {
        border: 2px solid rgba(255, 255, 255, 0.72) !important;
        border-radius: 999px !important;
        background: rgba(80, 192, 176, 0.62) !important;
      }
      .ww-app-pane { min-height: 0; }
      .ww-app-pane[hidden] { display: none !important; }
      .ww-sticky-actions,
      .ww-builder-actions {
        position: sticky !important;
        top: 0 !important;
        z-index: 9 !important;
        display: flex !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        gap: 0.5rem !important;
        width: 100% !important;
        box-sizing: border-box !important;
        margin: 0 0 0.75rem !important;
        padding: 0.55rem !important;
        overflow: visible !important;
        border-radius: 14px !important;
        background: linear-gradient(135deg, rgba(248, 254, 252, 0.94), rgba(255, 255, 255, 0.86)) !important;
        box-shadow: 0 8px 22px rgba(36, 67, 111, 0.055) !important;
      }
      .ww-sticky-actions > *,
      .ww-builder-actions > * { flex: 0 0 auto; min-height: 2.25rem; }
      .ww-save-state { white-space: nowrap; }
      .ww-app-dialog.ww-simplified-surfaces .ww-product-next,
      .ww-app-dialog.ww-simplified-surfaces .ww-product-progress,
      .ww-app-dialog.ww-simplified-surfaces .ww-product-empty,
      .ww-app-dialog.ww-simplified-surfaces .ww-product-tip,
      .ww-app-dialog.ww-simplified-surfaces .ww-share-publishing-centre,
      .ww-app-dialog.ww-simplified-surfaces .ww-advanced-panel,
      .ww-app-dialog.ww-simplified-surfaces .ww-seat-toolbox,
      .ww-app-dialog.ww-simplified-surfaces .ww-share-card,
      .ww-app-dialog.ww-simplified-surfaces .ww-qr-card {
        border-radius: 14px !important;
        background: rgba(255, 255, 255, 0.58) !important;
        box-shadow: none !important;
      }
      .ww-app-dialog.ww-simplified-surfaces .ww-overview-grid article::after,
      .ww-app-dialog.ww-simplified-surfaces .ww-tiles > div::after { display: none !important; }
      .ww-app-dialog.ww-simplified-surfaces .ww-advanced-panel {
        border-color: rgba(80, 192, 176, 0.12) !important;
      }
      .ww-share-admin--clean {
        display: grid;
        gap: 0.85rem;
      }
      .ww-share-admin--clean .ww-advanced-panel__head {
        border-bottom: 1px solid rgba(80, 192, 176, 0.12);
        padding-bottom: 0.7rem;
      }
      .ww-share-admin--clean .ww-qr-card {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.72rem;
        border: 1px solid rgba(80, 192, 176, 0.12);
      }
      .ww-share-admin--clean .ww-qr-card img {
        width: 132px;
        height: 132px;
        border: 8px solid #fff;
        border-radius: 14px;
        background: #fff;
      }
      .ww-share-admin--clean .ww-link-preview { overflow-wrap: anywhere; }
      .ww-share-admin--clean .ww-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
      @media (max-width: 720px) {
        .ww-app-dialog {
          width: calc(100vw - 12px) !important;
          height: calc(100dvh - 12px) !important;
          max-height: calc(100dvh - 12px) !important;
        }
        .ww-app-shell { max-height: calc(100dvh - 12px) !important; }
        .ww-app-tabs { padding-inline: 0.78rem !important; }
        .ww-sticky-actions,
        .ww-builder-actions { top: 0 !important; }
        .ww-save-state { white-space: normal; }
        .ww-share-admin--clean .ww-qr-card { align-items: flex-start; flex-direction: column; }
      }
    `;
    document.head.appendChild(style);
  }

  function currentShareUrl(root) {
    const input = root.querySelector('.ww-share-card input[readonly]');
    const preview = root.querySelector('.ww-link-preview');
    const slug = normalizeSlug(root.querySelector('#ww-custom-slug')?.value || '');
    if (slug) {
      return `${window.location.origin}/wedding/${slug}`;
    }
    return input?.value || preview?.textContent?.trim() || '';
  }

  function qrUrlFor(url) {
    return `/api/tools/qr.png?url=${encodeURIComponent(url)}`;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_err) {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      input.remove();
      return ok;
    }
  }

  function syncShareLinks(root) {
    const url = currentShareUrl(root);
    if (!url) {
      return;
    }
    const input = root.querySelector('.ww-share-card input[readonly]');
    if (input) {
      input.value = url;
    }
    root.querySelectorAll('a[href*="/wedding/"]').forEach(link => {
      if (!/wa\.me|mailto:/i.test(link.href)) {
        link.href = url;
      }
    });
    const preview = root.querySelector('.ww-link-preview');
    const slugPreview = root.querySelector('#ww-slug-preview');
    const slug = normalizeSlug(
      root.querySelector('#ww-custom-slug')?.value || url.split('/').pop()
    );
    if (preview && slugPreview) {
      slugPreview.textContent = slug;
    }
    root.querySelectorAll('a[href^="https://wa.me/"]').forEach(link => {
      link.href = `https://wa.me/?text=${encodeURIComponent(url)}`;
    });
    root.querySelectorAll('a[href^="mailto:"]').forEach(link => {
      link.href = `mailto:?subject=Wedding%20details&body=${encodeURIComponent(url)}`;
    });
    const qr = root.querySelector('#ww-qr-target, .ww-qr-card img');
    if (qr) {
      if (qr.tagName === 'IMG') {
        qr.src = qrUrlFor(url);
      } else {
        const img = document.createElement('img');
        img.id = 'ww-qr-target';
        img.alt = 'QR code for your wedding website link';
        img.src = qrUrlFor(url);
        qr.replaceWith(img);
      }
    }
    const download = root.querySelector('#ww-download-qr');
    if (download) {
      download.dataset.qrUrl = qrUrlFor(url);
    }
  }

  function enhanceShare(root) {
    const admin = root.querySelector('#ww-share-admin');
    if (!admin || admin.dataset.wwScrollSharePolished === 'true') {
      return;
    }
    admin.dataset.wwScrollSharePolished = 'true';
    admin.classList.add('ww-share-admin--clean');
    syncShareLinks(root);

    const slugInput = admin.querySelector('#ww-custom-slug');
    slugInput?.addEventListener('input', () => syncShareLinks(root));

    root.querySelectorAll('#ww-copy-link, #ww-copy-overview').forEach(button => {
      if (button.dataset.wwReliableCopy === 'true') {
        return;
      }
      button.dataset.wwReliableCopy = 'true';
      button.addEventListener(
        'click',
        async event => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const ok = await copyText(currentShareUrl(root));
          button.textContent = ok ? 'Copied' : 'Copy manually';
          window.setTimeout(() => {
            if (button.isConnected) {
              button.textContent =
                button.id === 'ww-copy-link' ? 'Copy wedding website link' : 'Copy link';
            }
          }, 1400);
        },
        true
      );
    });

    const save = admin.querySelector('#ww-save-share');
    const status = admin.querySelector('#ww-share-status');
    if (save && save.dataset.wwStatusPolished !== 'true') {
      save.dataset.wwStatusPolished = 'true';
      save.addEventListener(
        'click',
        () => {
          window.setTimeout(() => {
            syncShareLinks(root);
            if (status && /reopen the app/i.test(status.textContent || '')) {
              status.textContent = 'Saved — your share links have been updated.';
            }
          }, 650);
        },
        true
      );
    }

    const download = admin.querySelector('#ww-download-qr');
    if (download && download.dataset.wwReliableDownload !== 'true') {
      download.dataset.wwReliableDownload = 'true';
      download.addEventListener(
        'click',
        event => {
          const url = currentShareUrl(root);
          const qr = qrUrlFor(url);
          const a = document.createElement('a');
          a.href = qr;
          a.download = `${normalizeSlug(url.split('/').pop()) || 'wedding'}-qr.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        true
      );
    }
  }

  function enhanceDialog(dialog) {
    dialog.classList.add('ww-simplified-surfaces');
    dialog.querySelectorAll('[data-pane="share"], .ww-app-pane').forEach(enhanceShare);
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
            (node.matches('.ww-app-dialog,#ww-share-admin') ||
              node.querySelector?.('.ww-app-dialog,#ww-share-admin'))
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
        event.target.closest('.ww-app-tabs button,[data-tab]')
      ) {
        [0, 250, 900].forEach(delay => window.setTimeout(schedule, delay));
      }
    },
    true
  );
  injectStyles();
  schedule();
})();
