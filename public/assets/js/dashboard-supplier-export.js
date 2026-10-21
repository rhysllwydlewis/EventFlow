/**
 * Supplier dashboard: export conversations and enquiries to CSV.
 *
 * The file comes from GET /api/supplier/enquiries/export: this supplier's conversations with
 * customers (no customer email or phone), quote requests and contact-form enquiries, built on the
 * server with formula protection. When there is nothing to export the server still answers 200
 * with just the header row and X-Export-Row-Count: 0; this script reads that header (not the body)
 * and says so instead of saving an empty file.
 */
(function () {
  const LABEL = 'Export conversations and enquiries (CSV)';
  const DEFAULT_NAME = 'enquiries-and-conversations.csv';

  /** Tells the supplier something through the page's single toast. */
  function say(message, type) {
    const home = window.SupplierDashboardHome;
    if (home && typeof home.toast === 'function') {
      home.toast(message, type);
    }
  }

  /** The file name the server chose (Content-Disposition), or a sensible default. */
  function fileNameFrom(response) {
    const header = response.headers.get('content-disposition') || '';
    const match = header.match(/filename="?([^";]+)"?/i);
    return match ? match[1] : DEFAULT_NAME;
  }

  /** Saves a blob under a name through a temporary link. */
  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', name);
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /** What to tell the supplier when the server refuses or fails. */
  async function failureMessage(response) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 403 && body.code === 'SUPPLIER_NOT_APPROVED') {
      return 'You can export once your profile has been approved.';
    }
    return 'Could not export your conversations and enquiries. Please try again.';
  }

  /** Asks the server for the file, then saves it, or says there is nothing to export. */
  async function exportAll(button) {
    const label = button.querySelector('.sd-export-label');
    button.disabled = true;
    if (label) {
      label.textContent = 'Exporting…';
    }
    try {
      const response = await fetch('/api/supplier/enquiries/export', { credentials: 'include' });
      if (!response.ok) {
        say(await failureMessage(response), 'error');
        return;
      }
      const rows = Number(response.headers.get('x-export-row-count'));
      if (rows === 0) {
        say(
          'Nothing to export yet: you have no conversations, quote requests or enquiries.',
          'info'
        );
        return;
      }
      save(await response.blob(), fileNameFrom(response));
      say(
        Number.isFinite(rows) && rows > 0
          ? `Exported ${rows} row${rows === 1 ? '' : 's'}.`
          : 'Export ready.',
        'success'
      );
    } catch (error) {
      console.error('Error exporting enquiries:', error);
      say('Could not export your conversations and enquiries. Please try again.', 'error');
    } finally {
      button.disabled = false;
      if (label) {
        label.textContent = LABEL;
      }
    }
  }

  /** Wires the export button once the page is parsed. */
  function init() {
    const button = document.getElementById('export-enquiries-btn');
    if (button) {
      button.addEventListener('click', () => exportAll(button));
    }
  }

  window.SupplierDashboardExport = { fileNameFrom, failureMessage, exportAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
