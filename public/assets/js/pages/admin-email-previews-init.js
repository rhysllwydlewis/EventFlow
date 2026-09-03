'use strict';
(function () {
  let templates = [];
  let activeTemplate = null;
  let defaultTestEmail = '';

  function escapeHtml(value) {
    return String(value || '').replace(
      /[&<>"']/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch]
    );
  }

  function setStatus(message, type) {
    const el = document.getElementById('emailPreviewStatus');
    if (!el) {
      return;
    }
    el.textContent = message || '';
    el.className = `campaigns-status${type ? ` campaigns-status--${type}` : ''}`;
  }

  function writeFrame(frame, html) {
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html || '<p>Preview unavailable.</p>');
    doc.close();
  }

  function renderCategories() {
    const select = document.getElementById('emailPreviewCategory');
    const seen = new Map();
    templates.forEach(t => seen.set(t.category, t.categoryLabel));
    select.innerHTML = `<option value="">All categories</option>${Array.from(seen.entries())
      .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
      .join('')}`;
  }

  function filteredTemplates() {
    const query = (document.getElementById('emailPreviewSearch').value || '').toLowerCase();
    const category = document.getElementById('emailPreviewCategory').value;
    return templates.filter(t => {
      const haystack = `${t.name} ${t.categoryLabel} ${t.purpose}`.toLowerCase();
      return (!category || t.category === category) && (!query || haystack.includes(query));
    });
  }

  function renderGrid() {
    const grid = document.getElementById('emailPreviewGrid');
    const visible = filteredTemplates();
    grid.innerHTML = visible
      .map(
        t => `
      <article class="email-preview-card" data-template="${escapeHtml(t.name)}">
        <div class="email-preview-card-head">
          <h3>${escapeHtml(t.name)}</h3>
          <p>${escapeHtml(t.purpose)}</p>
          <div class="email-preview-meta"><span class="email-preview-pill">${escapeHtml(t.categoryLabel)}</span><span class="email-preview-pill">Preheader</span><span class="email-preview-pill">Text fallback</span></div>
          <div class="email-preview-path">${escapeHtml(t.filePath)}</div>
          <div class="email-preview-vars"><strong>Variables:</strong> ${escapeHtml((t.variables || []).join(', ') || 'none')}</div>
        </div>
        <div class="email-preview-frame-wrap"><iframe class="email-preview-frame" title="${escapeHtml(t.name)} email preview" sandbox="allow-same-origin"></iframe></div>
        <div class="email-preview-actions">
          <button class="btn btn-primary" type="button" data-action="open">Large preview</button>
          <button class="btn btn-secondary" type="button" data-action="copy">Copy HTML</button>
          <div class="email-preview-test">
            <input type="email" value="${escapeHtml(defaultTestEmail)}" placeholder="admin@example.com" aria-label="Test recipient for ${escapeHtml(t.name)}">
            <button class="btn btn-secondary" type="button" data-action="test">Send test</button>
          </div>
        </div>
      </article>`
      )
      .join('');

    grid.querySelectorAll('.email-preview-card').forEach(card => {
      const name = card.getAttribute('data-template');
      const template = templates.find(t => t.name === name);
      writeFrame(card.querySelector('iframe'), template && template.html);
      card.addEventListener('click', event => {
        const action = event.target && event.target.getAttribute('data-action');
        if (!action) {
          return;
        }
        if (action === 'open') {
          openDialog(template);
        }
        if (action === 'copy') {
          copyHtml(template);
        }
        if (action === 'test') {
          sendTest(template, card.querySelector('input'));
        }
      });
    });
  }

  function openDialog(template) {
    activeTemplate = template;
    document.getElementById('emailPreviewDialogTitle').textContent = template.name;
    document.getElementById('emailPreviewDialogMeta').textContent =
      `${template.categoryLabel} · ${template.filePath}`;
    writeFrame(document.getElementById('emailPreviewDialogFrame'), template.html);
    document.getElementById('emailPreviewDialog').showModal();
  }

  async function copyHtml(template) {
    await navigator.clipboard.writeText(template.html || '');
    setStatus(`Copied ${template.name} HTML to clipboard.`, 'success');
  }

  function downloadHtml() {
    if (!activeTemplate) {
      return;
    }
    const blob = new Blob([activeTemplate.html || ''], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${activeTemplate.name}-preview.html`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function openWindow() {
    if (!activeTemplate) {
      return;
    }
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (win) {
      win.document.write(activeTemplate.html || '');
      win.document.close();
    }
  }

  async function sendTest(template, input) {
    const to = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setStatus('Enter one valid test email address.', 'error');
      return;
    }
    setStatus(`Sending ${template.name} test…`, '');
    try {
      await AdminShared.api(
        `/api/admin/email-previews/${encodeURIComponent(template.name)}/test-send`,
        'POST',
        { to }
      );
      setStatus(`Test email sent to ${to}.`, 'success');
    } catch (err) {
      setStatus(err && err.message ? err.message : 'Test send failed.', 'error');
    }
  }

  async function loadPreviews() {
    setStatus('Loading email previews…', '');
    const data = await AdminShared.api('/api/admin/email-previews', 'GET');
    defaultTestEmail = data.defaultTestEmail || '';
    templates = data.templates || [];
    renderCategories();
    renderGrid();
    setStatus(`${templates.length} templates rendered with sample data.`, 'success');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('emailPreviewSearch').addEventListener('input', renderGrid);
    document.getElementById('emailPreviewCategory').addEventListener('change', renderGrid);
    document.getElementById('emailPreviewRefresh').addEventListener('click', loadPreviews);
    document
      .getElementById('emailPreviewDialogClose')
      .addEventListener('click', () => document.getElementById('emailPreviewDialog').close());
    document.getElementById('emailPreviewDownload').addEventListener('click', downloadHtml);
    document.getElementById('emailPreviewOpenWindow').addEventListener('click', openWindow);
    AdminShared.fetchCSRFToken().then(loadPreviews).catch(loadPreviews);
  });
})();
