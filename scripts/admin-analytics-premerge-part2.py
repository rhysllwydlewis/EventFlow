from pathlib import Path

def replace_once(path, old, new):
    file_path = Path(path)
    text = file_path.read_text()
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1))

replace_once(
    "public/assets/js/pages/admin-analytics-decision.js",
    """  function reportingDays() {
    return Number(document.getElementById('behaviourAnalyticsRange')?.value) || 30;
  }

  function buildSection() {""",
    """  function reportingDays() {
    return Number(document.getElementById('behaviourAnalyticsRange')?.value) || 30;
  }

  function formatDate(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : 'an unknown date';
  }

  function comparisonCoverage(previous, days) {
    const retentionDays = numeric(state.status?.status?.retentionDays);
    const earliestEventAt = state.status?.status?.earliestEventAt;
    const previousStart = previous?.window?.start;

    if (retentionDays > 0 && retentionDays < days * 2) {
      return {
        available: false,
        reason: `Analytics retention is ${retentionDays} days, but two complete ${days}-day windows require ${days * 2} days.`,
      };
    }

    const earliestTimestamp = Date.parse(earliestEventAt);
    const previousStartTimestamp = Date.parse(previousStart);
    if (!Number.isFinite(previousStartTimestamp)) {
      return {
        available: false,
        reason: 'The previous reporting window could not be verified.',
      };
    }
    if (!Number.isFinite(earliestTimestamp)) {
      return {
        available: false,
        reason: 'No retained analytics history is available for a complete previous-period comparison.',
      };
    }
    if (earliestTimestamp > previousStartTimestamp) {
      return {
        available: false,
        reason: `Stored analytics begins ${formatDate(earliestEventAt)}. A complete comparison requires history from ${formatDate(previousStart)}.`,
      };
    }

    return { available: true, reason: '' };
  }

  function buildSection() {""",
)
replace_once(
    "public/assets/js/pages/admin-analytics-decision.js",
    """    const retentionDays = numeric(state.status?.status?.retentionDays);
    const comparisonAvailable = retentionDays === 0 || retentionDays >= days * 2;
    const currentTotals = current.totals || {};""",
    """    const coverage = comparisonCoverage(previous, days);
    const comparisonAvailable = coverage.available;
    const currentTotals = current.totals || {};""",
)
replace_once(
    "public/assets/js/pages/admin-analytics-decision.js",
    """    const warning = comparisonAvailable
      ? ''
      : `<div class="analytics-decision-empty" style="grid-column:1/-1;border:1px solid #fde68a;border-radius:12px;background:#fffbeb;color:#92400e;text-align:left"><strong>Previous ${days}-day comparison unavailable.</strong> Analytics retention is ${retentionDays} days, but this comparison requires ${days * 2} days. Current figures remain valid.</div>`;""",
    """    const warning = comparisonAvailable
      ? ''
      : `<div class="analytics-decision-empty analytics-comparison-warning"><strong>Previous ${days}-day comparison unavailable.</strong> ${escapeHtml(coverage.reason)} Current figures remain valid.</div>`;""",
)
replace_once(
    "public/assets/js/pages/admin-analytics-decision.js",
    """      consent: 'Traffic coverage',
    };""",
    """      consent: 'Traffic coverage',
      marketplace: 'Marketplace rates',
    };""",
)
replace_once(
    "public/assets/js/pages/admin-analytics-decision.js",
    """    return type === 'supplier'
      ? `/supplier/${encodeURIComponent(id)}`
      : `/package/${encodeURIComponent(id)}`;""",
    """    return type === 'supplier'
      ? `/supplier?id=${encodeURIComponent(id)}`
      : `/package/${encodeURIComponent(id)}`;""",
)
replace_once(
    "public/assets/js/pages/admin-analytics-decision.js",
    """  function csvCell(value) {
    return `"${String(value === undefined || value === null ? '' : value).replace(/"/g, '""')}"`;
  }""",
    """  function csvCell(value) {
    let text = String(value === undefined || value === null ? '' : value);
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) {
      text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }""",
)

replace_once(
    "public/assets/css/admin-analytics-decision.css",
    """.analytics-decision-empty {
  padding: 1rem;""",
    """.analytics-comparison-warning {
  grid-column: 1 / -1;
  border: 1px solid #fde68a;
  border-radius: 12px;
  background: #fffbeb;
  color: #92400e;
  text-align: left;
}

.analytics-decision-empty {
  padding: 1rem;""",
)

replace_once(
    "public/assets/js/behaviour-analytics.js",
    """  function cleanIdentifier(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
  }

  function buildEvent(eventName, properties) {""",
    """  function cleanIdentifier(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
  }

  function decodeIdentifier(value) {
    try {
      return decodeURIComponent(value || '');
    } catch (_error) {
      return value || '';
    }
  }

  function currentEntityContext() {
    const type = pageType();
    const params = new URLSearchParams(window.location.search || '');
    if (type === 'supplier') {
      return { supplierId: cleanIdentifier(params.get('id') || '') };
    }
    if (type === 'package') {
      let packageId =
        params.get('id') || params.get('packageId') || params.get('slug') || '';
      if (!packageId && currentPath().startsWith('/package/')) {
        packageId = decodeIdentifier(currentPath().slice('/package/'.length).split('/')[0]);
      }
      return { packageId: cleanIdentifier(packageId) };
    }
    return {};
  }

  function elementEntityContext(element) {
    const current = currentEntityContext();
    const supplierNode =
      element && typeof element.closest === 'function'
        ? element.closest('[data-supplier-id]')
        : null;
    const packageNode =
      element && typeof element.closest === 'function'
        ? element.closest('[data-package-id]')
        : null;
    return {
      supplierId: cleanIdentifier(
        element?.dataset?.supplierId || supplierNode?.dataset?.supplierId || current.supplierId || ''
      ),
      packageId: cleanIdentifier(
        element?.dataset?.packageId || packageNode?.dataset?.packageId || current.packageId || ''
      ),
    };
  }

  function linkEntityContext(url, type) {
    if (type === 'supplier') {
      return {
        supplierId: cleanIdentifier(url.searchParams.get('id') || ''),
      };
    }
    let packageId =
      url.searchParams.get('id') ||
      url.searchParams.get('packageId') ||
      url.searchParams.get('slug') ||
      '';
    if (!packageId && url.pathname.startsWith('/package/')) {
      packageId = decodeIdentifier(url.pathname.slice('/package/'.length).split('/')[0]);
    }
    return { packageId: cleanIdentifier(packageId) };
  }

  function buildEvent(eventName, properties) {""",
)
replace_once(
    "public/assets/js/behaviour-analytics.js",
    """      const explicitEvent = cleanIdentifier(element.dataset && element.dataset.analyticsEvent);
      if (explicitEvent) {
        track(explicitEvent, {
          eventLabel: cleanIdentifier(element.dataset.analyticsLabel || ''),
          itemType: cleanIdentifier(element.dataset.analyticsItemType || ''),
          itemId: cleanIdentifier(element.dataset.analyticsItemId || ''),
          supplierId: cleanIdentifier(element.dataset.supplierId || ''),
          packageId: cleanIdentifier(element.dataset.packageId || ''),
          source: 'delegated_click',
        });
      }

      const text = String(element.textContent || element.value || '')""",
    """      const entityContext = elementEntityContext(element);
      const explicitEvent = cleanIdentifier(element.dataset && element.dataset.analyticsEvent);
      if (explicitEvent) {
        track(explicitEvent, {
          eventLabel: cleanIdentifier(element.dataset.analyticsLabel || ''),
          itemType: cleanIdentifier(element.dataset.analyticsItemType || ''),
          itemId: cleanIdentifier(element.dataset.analyticsItemId || ''),
          supplierId: entityContext.supplierId,
          packageId: entityContext.packageId,
          source: 'delegated_click',
        });
      }

      const text = String(element.textContent || element.value || '')""",
)
replace_once(
    "public/assets/js/behaviour-analytics.js",
    """        track('package_add_to_plan', {
          packageId: cleanIdentifier(element.dataset.packageId || ''),
          source: pageType(),
        });""",
    """        track('package_add_to_plan', {
          packageId: entityContext.packageId,
          supplierId: entityContext.supplierId,
          source: pageType(),
        });""",
)
replace_once(
    "public/assets/js/behaviour-analytics.js",
    """        track('shortlist_add', {
          itemType: pageType() === 'package' ? 'package' : 'supplier',
          itemId: cleanIdentifier(element.dataset.itemId || element.dataset.supplierId || ''),
          source: pageType(),
        });""",
    """        const itemType = pageType() === 'package' ? 'package' : 'supplier';
        track('shortlist_add', {
          itemType,
          itemId: cleanIdentifier(
            element.dataset.itemId ||
              (itemType === 'package' ? entityContext.packageId : entityContext.supplierId) ||
              ''
          ),
          supplierId: entityContext.supplierId,
          packageId: entityContext.packageId,
          source: pageType(),
        });""",
)
replace_once(
    "public/assets/js/behaviour-analytics.js",
    """      } else if (/request quote|send enquiry|contact supplier/.test(text)) {
        track('enquiry_started', { source: pageType() });""",
    """      } else if (/request quote|send enquiry|contact supplier/.test(text)) {
        track('enquiry_started', { ...entityContext, source: pageType() });""",
)
replace_once(
    "public/assets/js/behaviour-analytics.js",
    """        } else if (url.pathname.startsWith('/supplier')) {
          track('result_clicked', { resultType: 'supplier', source: pageType() });
        } else if (url.pathname.startsWith('/package')) {
          track('result_clicked', { resultType: 'package', source: pageType() });
        }""",
    """        } else if (url.pathname.startsWith('/supplier')) {
          const linkContext = linkEntityContext(url, 'supplier');
          track('result_clicked', {
            resultType: 'supplier',
            resultId: linkContext.supplierId,
            supplierId: linkContext.supplierId,
            source: pageType(),
          });
        } else if (url.pathname.startsWith('/package')) {
          const linkContext = linkEntityContext(url, 'package');
          track('result_clicked', {
            resultType: 'package',
            resultId: linkContext.packageId,
            packageId: linkContext.packageId,
            source: pageType(),
          });
        }""",
)
replace_once(
    "public/assets/js/behaviour-analytics.js",
    """  function trackInitialPageEvents() {
    track('page_view', {});
    if (pageType() === 'supplier') {
      track('supplier_profile_view', { source: referrerDomain() });
    } else if (pageType() === 'package') {
      track('package_view', { source: referrerDomain() });
    }
  }""",
    """  function trackInitialPageEvents() {
    const entityContext = currentEntityContext();
    track('page_view', {});
    if (pageType() === 'supplier') {
      track('supplier_profile_view', { ...entityContext, source: referrerDomain() });
    } else if (pageType() === 'package') {
      track('package_view', { ...entityContext, source: referrerDomain() });
    }
  }""",
)
