(function () {
  const recentUsersByEmail = new Map();
  const originalFetch = window.fetch;

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value === null || value === undefined ? '' : String(value);
    return div.innerHTML;
  }

  function humanize(value) {
    return String(value || 'unknown')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  function normaliseEmail(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function verificationMethod(user) {
    if (user.verificationMethod) {
      return user.verificationMethod;
    }
    if (user.authProvider === 'google' || user.googleSub || user.hasGoogleLink) {
      return 'google';
    }
    return user.verified ? 'unknown' : 'pending';
  }

  function signupMethod(user) {
    if (user.signupMethod) {
      return user.signupMethod;
    }
    if (user.authProvider === 'google' || user.googleSub || user.hasGoogleLink) {
      return 'google';
    }
    return 'unknown';
  }

  function emailStatus(user) {
    if (user.emailDeliveryStatus) {
      return user.emailDeliveryStatus;
    }
    return signupMethod(user) === 'google' ? 'not_required' : 'unknown';
  }

  function badge(method) {
    const labelMap = {
      google: 'Google',
      google_verified_email: 'Google',
      email_link: 'Email link',
      eventflow_email: 'Email link',
      admin: 'Admin',
      admin_created: 'Admin',
      manual_admin: 'Admin',
      owner_account: 'Owner',
      legacy: 'Legacy',
      pending: 'Pending',
      unknown: 'Unknown',
    };
    const colourMap = {
      google: '#dcfce7;color:#166534;border:1px solid #86efac;',
      google_verified_email: '#dcfce7;color:#166534;border:1px solid #86efac;',
      email_link: '#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;',
      eventflow_email: '#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;',
      admin: '#ede9fe;color:#6d28d9;border:1px solid #c4b5fd;',
      admin_created: '#ede9fe;color:#6d28d9;border:1px solid #c4b5fd;',
      manual_admin: '#ede9fe;color:#6d28d9;border:1px solid #c4b5fd;',
      owner_account: '#ffe4e6;color:#9f1239;border:1px solid #fda4af;',
      legacy: '#fef3c7;color:#92400e;border:1px solid #fcd34d;',
      pending: '#fef3c7;color:#92400e;border:1px solid #fcd34d;',
      unknown: '#f3f4f6;color:#4b5563;border:1px solid #d1d5db;',
    };
    const label = labelMap[method] || humanize(method);
    const colours = colourMap[method] || colourMap.unknown;
    return `<span class="badge" title="${escapeHtml(humanize(method))}" style="${colours}font-weight:600;">${escapeHtml(label)}</span>`;
  }

  function deliveryLabel(status) {
    const labelMap = {
      not_required: 'No Postmark needed',
      sent: 'Postmark sent',
      delivered: 'Delivered',
      pending: 'Pending',
      failed: 'Failed',
      bounced: 'Bounced',
      outbox: 'Outbox',
      unknown: 'Unknown',
    };
    return labelMap[status] || humanize(status);
  }

  function ensureHeader(table) {
    const header = table.querySelector('tr');
    if (!header || header.dataset.verificationSourceEnhanced === 'true') {
      return;
    }

    const cells = Array.from(header.children);
    const verifiedIndex = cells.findIndex(cell => /verified/i.test(cell.textContent || ''));
    if (verifiedIndex < 0) {
      return;
    }

    const signup = document.createElement('th');
    signup.textContent = 'Signup';
    const email = document.createElement('th');
    email.textContent = 'Email status';
    header.insertBefore(email, cells[verifiedIndex + 1] || null);
    header.insertBefore(signup, email);
    header.dataset.verificationSourceEnhanced = 'true';
  }

  function enhanceRows() {
    const table = document.getElementById('users');
    if (!table || !recentUsersByEmail.size) {
      return;
    }

    ensureHeader(table);
    const rows = Array.from(table.querySelectorAll('tr')).slice(1);
    rows.forEach(row => {
      const cells = Array.from(row.children);
      const email = normaliseEmail(cells[1] && cells[1].textContent);
      const user = recentUsersByEmail.get(email);
      if (!user || row.dataset.verificationSourceEnhanced === 'true') {
        return;
      }

      const verifiedCell = cells[3];
      if (!verifiedCell) {
        return;
      }

      const method = verificationMethod(user);
      verifiedCell.innerHTML = user.verified
        ? badge(method)
        : `<span class="badge badge-no">No</span><div style="margin-top:4px;">${badge(method)}</div>`;

      const signupCell = document.createElement('td');
      signupCell.innerHTML = badge(signupMethod(user));
      const emailStatusCell = document.createElement('td');
      const status = emailStatus(user);
      emailStatusCell.innerHTML = `<span class="small" title="${escapeHtml(humanize(status))}">${escapeHtml(deliveryLabel(status))}</span>`;

      row.insertBefore(emailStatusCell, cells[4] || null);
      row.insertBefore(signupCell, emailStatusCell);
      row.dataset.verificationSourceEnhanced = 'true';
    });
  }

  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(input) {
      return originalFetch.apply(this, arguments).then(response => {
        try {
          const url = typeof input === 'string' ? input : input && input.url;
          if (url && url.includes('/api/admin/users/list')) {
            response
              .clone()
              .json()
              .then(data => {
                recentUsersByEmail.clear();
                (data.items || []).forEach(user => {
                  const email = normaliseEmail(user.email);
                  if (email) {
                    recentUsersByEmail.set(email, user);
                  }
                });
                enhanceRows();
              })
              .catch(() => {});
          }
        } catch (_) {
          // Leave the dashboard table in its original form if enhancement data is unavailable.
        }
        return response;
      });
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('users');
    if (!table) {
      return;
    }
    const observer = new MutationObserver(enhanceRows);
    observer.observe(table, { childList: true, subtree: true });
    enhanceRows();
  });
})();
