'use strict';

(function () {
  if (!window.AdminShared) {
    return;
  }

  let suppliersById = new Map();
  let observer = null;

  function asText(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function canonicalDescription(supplier) {
    return (
      asText(supplier?.description_long) ||
      asText(supplier?.description_short) ||
      asText(supplier?.description) ||
      asText(supplier?.blurb)
    );
  }

  function canonicalPrice(supplier) {
    return (
      asText(supplier?.priceRange) ||
      asText(supplier?.price_display) ||
      asText(supplier?.priceDisplay)
    );
  }

  function canonicalPhotoCount(supplier) {
    const canonical = Array.isArray(supplier?.photosGallery) ? supplier.photosGallery.length : 0;
    const legacy = Array.isArray(supplier?.images) ? supplier.images.length : 0;
    const recorded = Math.max(0, finiteNumber(supplier?.photoCount));
    // Mixed-schema records can contain photosGallery: [] alongside populated legacy
    // images. Use the strongest available signal rather than first-array-wins.
    return Math.max(canonical, legacy, recorded);
  }

  function calculateScore(supplier) {
    const profileValues = [
      asText(supplier?.name),
      canonicalDescription(supplier),
      asText(supplier?.location),
      asText(supplier?.category),
      canonicalPrice(supplier),
    ];
    const profileScore = (profileValues.filter(Boolean).length / profileValues.length) * 30;

    const responseRate = Math.max(0, Math.min(1, finiteNumber(supplier?.responseRate)));
    const responseScore = responseRate * 25;

    const rating = Math.max(
      0,
      Math.min(5, finiteNumber(supplier?.averageRating ?? supplier?.rating))
    );
    const ratingScore = (rating / 5) * 20;

    const bookingCount = Math.max(
      0,
      finiteNumber(supplier?.bookingCount ?? supplier?.bookings?.length)
    );
    const bookingScore = Math.min(bookingCount / 10, 1) * 15;

    const photoScore = Math.min(canonicalPhotoCount(supplier) / 10, 1) * 10;

    return Math.round(profileScore + responseScore + ratingScore + bookingScore + photoScore);
  }

  function scoreTone(score) {
    if (score >= 80) {
      return { color: '#10b981', background: '#d1fae5', label: 'Excellent' };
    }
    if (score >= 60) {
      return { color: '#f59e0b', background: '#fef3c7', label: 'Good' };
    }
    if (score >= 40) {
      return { color: '#f97316', background: '#fed7aa', label: 'Fair' };
    }
    return { color: '#ef4444', background: '#fee2e2', label: 'Poor' };
  }

  function extractSupplierId(row) {
    const link = row.querySelector('a[href^="/admin-supplier-detail?id="]');
    if (!link) {
      return '';
    }
    try {
      return new URL(link.href, window.location.origin).searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function renderScoreCell(cell, score) {
    const tone = scoreTone(score);
    const signature = String(score);
    if (cell.dataset.canonicalHealthScore === signature) {
      return;
    }
    cell.dataset.canonicalHealthScore = signature;
    cell.innerHTML = `
      <span
        class="health-score-badge"
        title="Quality Score: ${score}% (${tone.label}). Blends profile completeness with response rate, reviews, bookings and photos — not the supplier's own Profile Health completeness score."
        style="display:inline-block;"
      >
        <span style="display:inline-block;padding:4px 12px;border-radius:12px;font-weight:600;font-size:14px;color:${tone.color};background:${tone.background};">
          ${score}%
        </span>
      </span>
    `;
  }

  function syncRows() {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody || suppliersById.size === 0) {
      return;
    }

    tbody.querySelectorAll('tr').forEach(row => {
      const supplierId = extractSupplierId(row);
      const supplier = suppliersById.get(supplierId);
      if (!supplier) {
        return;
      }
      const cells = row.querySelectorAll('td');
      const healthCell = cells[6];
      if (healthCell) {
        renderScoreCell(healthCell, calculateScore(supplier));
      }
    });
  }

  function syncAverage() {
    const avgElement = document.getElementById('avgScore');
    if (!avgElement) {
      return;
    }
    if (suppliersById.size === 0) {
      avgElement.textContent = '0.0%';
      return;
    }
    const scores = Array.from(suppliersById.values(), calculateScore);
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    avgElement.textContent = `${average.toFixed(1)}%`;
  }

  function installApprovalCopyFix() {
    if (AdminShared.__supplierApprovalCopyFixed) {
      return;
    }
    const originalShowConfirmModal = AdminShared.showConfirmModal;
    if (typeof originalShowConfirmModal !== 'function') {
      return;
    }

    // Preserve the original approval action (including its in-place table refresh)
    // and only correct the outdated permission promise at the modal boundary.
    AdminShared.showConfirmModal = function showConfirmModalWithSupplierPermissionCopy(
      options = {}
    ) {
      const next = { ...options };
      if (
        next.title === 'Approve Supplier' &&
        /publish calendar events/i.test(String(next.message || ''))
      ) {
        next.message =
          'Approve this supplier? They will be able to create packages, send messages and appear in search. Public calendar publishing still depends on the supplier category or an explicit admin override.';
      }
      return originalShowConfirmModal.call(AdminShared, next);
    };
    AdminShared.__supplierApprovalCopyFixed = true;
  }

  async function loadCanonicalScores() {
    installApprovalCopyFix();
    try {
      const response = await AdminShared.api('/api/admin/suppliers');
      const suppliers = response.items || response.suppliers || [];
      suppliersById = new Map(
        suppliers
          .map(supplier => [String(supplier.id || supplier._id || ''), supplier])
          .filter(([id]) => id)
      );
      syncRows();
      syncAverage();

      const tbody = document.getElementById('suppliersTableBody');
      if (tbody && !observer) {
        observer = new MutationObserver(() => {
          syncRows();
          syncAverage();
        });
        observer.observe(tbody, { childList: true });
      }
    } catch (error) {
      console.warn('[AdminSuppliersHealth] Unable to align supplier health scores:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCanonicalScores, { once: true });
  } else {
    loadCanonicalScores();
  }
})();
