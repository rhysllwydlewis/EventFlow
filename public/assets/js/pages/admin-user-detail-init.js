(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get('id');
  const encodedUserId = encodeURIComponent(userId || '');

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  }
  function fmtDate(dt) {
    if (!dt) {
      return '—';
    }
    try {
      return new Date(dt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  if (!userId) {
    document.getElementById('userDetailsContainer').innerHTML =
      '<div class="card"><p class="small">No user ID specified. <a href="/admin-users">Back to Users Centre</a></p></div>';
  }

  async function loadUserDetails() {
    try {
      const user = await AdminShared.api(`/api/admin/users/${encodedUserId}`);
      renderUserDetails(user);
    } catch (err) {
      document.getElementById('userDetailsContainer').innerHTML =
        `<div class="card"><p class="small">Failed to load user: ${esc(err.message)}. <a href="/admin-users">Back to Users Centre</a></p></div>`;
    }
  }

  function humanize(value) {
    return String(value || 'unknown')
      .replace(/_/g, ' ')
      .replace(/(^|\s)([a-z])/g, (_m, prefix, c) => prefix + c.toUpperCase());
  }

  function canResendVerification(user) {
    if (!user || user.verified) {
      return false;
    }
    if (
      ['google_verified_email', 'admin_created', 'owner_account'].includes(user.verificationMethod)
    ) {
      return false;
    }
    if (['google', 'admin_created', 'owner_seed'].includes(user.signupMethod)) {
      return false;
    }
    return true;
  }

  function provenancePanel(user) {
    const verifiedBy = user.verifiedBy
      ? [user.verifiedBy.type, user.verifiedBy.provider, user.verifiedBy.reason]
          .filter(Boolean)
          .join(' — ')
      : 'N/A';
    const logLink = user.lastVerificationEmailLogId
      ? `<a href="/admin-emails?logId=${encodeURIComponent(user.lastVerificationEmailLogId)}">${AdminShared.escapeHtml(user.lastVerificationEmailLogId)}</a>`
      : 'N/A';
    return `
      <div class="card">
        <h3>Account Provenance</h3>
        <div class="user-info-grid">
          <div class="info-item"><div class="info-label">Signup method</div><div class="info-value">${AdminShared.escapeHtml(humanize(user.signupMethod))}</div></div>
          <div class="info-item"><div class="info-label">Auth provider</div><div class="info-value">${AdminShared.escapeHtml(humanize(user.authProvider))}</div></div>
          <div class="info-item"><div class="info-label">Verified</div><div class="info-value">${user.verified ? 'Yes' : 'No'}</div></div>
          <div class="info-item"><div class="info-label">Verification method</div><div class="info-value">${AdminShared.escapeHtml(humanize(user.verificationMethod))}</div></div>
          <div class="info-item"><div class="info-label">Verified at</div><div class="info-value">${AdminShared.escapeHtml(AdminShared.formatDate(user.verifiedAt))}</div></div>
          <div class="info-item"><div class="info-label">Verified by</div><div class="info-value">${AdminShared.escapeHtml(verifiedBy)}</div></div>
          <div class="info-item"><div class="info-label">Google linked</div><div class="info-value">${user.hasGoogleLink ? 'Yes' : 'No'}</div></div>
          <div class="info-item"><div class="info-label">Google linked at</div><div class="info-value">${AdminShared.escapeHtml(AdminShared.formatDate(user.googleLinkedAt))}</div></div>
          <div class="info-item"><div class="info-label">Verification email sent at</div><div class="info-value">${AdminShared.escapeHtml(AdminShared.formatDate(user.verificationEmailSentAt))}</div></div>
          <div class="info-item"><div class="info-label">Last verification email status</div><div class="info-value">${AdminShared.escapeHtml(humanize(user.emailDeliveryStatus))}</div></div>
          <div class="info-item"><div class="info-label">Postmark MessageID</div><div class="info-value">${AdminShared.escapeHtml(user.lastVerificationEmailPostmarkMessageId || 'N/A')}</div></div>
          <div class="info-item"><div class="info-label">Email Centre log</div><div class="info-value">${logLink}</div></div>
        </div>
      </div>`;
  }

  function getRoleBadge(role) {
    return AdminShared.getRoleBadge
      ? AdminShared.getRoleBadge(role)
      : role === 'admin'
        ? '<span class="badge badge-admin">🛡️ Admin</span>'
        : role === 'supplier'
          ? '<span class="badge badge-supplier-account">🏪 Supplier</span>'
          : role === 'partner'
            ? '<span class="badge badge-partner">🤝 Partner</span>'
            : '<span class="badge badge-customer">🎉 Customer</span>';
  }

  // Alias so template literals in renderUserDetails can call roleBadge() directly
  function roleBadge(role) {
    return getRoleBadge(role);
  }

  function badge(label, type) {
    return `<span class="badge badge-${type || 'secondary'}">${esc(label)}</span>`;
  }

  function verifBadge(method) {
    const map = {
      google: badge('Google verified', 'google'),
      google_verified_email: badge('Google verified', 'google'),
      email_link: badge('Email link', 'yes'),
      eventflow_email: badge('EventFlow email', 'yes'),
      admin: badge('Admin verified', 'admin-created'),
      admin_created: badge('Admin-created', 'admin-created'),
      owner_account: badge('Owner account', 'admin'),
      legacy: badge('Legacy verified', 'secondary'),
      pending: badge('Pending', 'no'),
      unknown: badge('Unknown', 'warning'),
    };
    return map[method] || badge(humanize(method || 'unknown'), 'warning');
  }

  function signupLabel(method) {
    const map = {
      google: 'Google',
      email_password: 'Email / password',
      admin_created: 'Admin-created',
      owner: 'Owner',
      unknown: 'Unknown',
    };
    return map[method] || humanize(method || 'unknown');
  }

  function renderUserDetails(user) {
    const container = document.getElementById('userDetailsContainer');
    const issues = user.accountIssues || [];

    container.innerHTML = `
      <!-- ── Account summary ──────────────────────────────────── -->
      <div class="card ud-card">
        <div class="ud-card-header">
          <div>
            <h2 class="ud-name">${esc(user.name || '(no name)')}</h2>
            <div class="ud-badges">
              ${roleBadge(user.role)}
              ${verifBadge(user.verificationMethod)}
              ${user.suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}
              ${issues.includes('unknown_verification_source') ? '<span class="badge badge-warning">⚠ Unknown source</span>' : ''}
            </div>
          </div>
          <div class="ud-card-actions">
            <a href="/admin-users" class="btn btn-secondary btn-sm">← Users Centre</a>
            ${
              user.supplierProfile
                ? `<a href="${esc(user.supplierProfile.profileUrl)}" class="btn btn-secondary btn-sm">Supplier Profile →</a>`
                : user.role === 'supplier'
                  ? `<button id="provisionProfileBtn" class="btn btn-warning btn-sm" title="Create missing supplier profile for this user">⚠️ Provision Profile</button>`
                  : ''
            }
          </div>
        </div>
        <div class="ud-info-grid">
          <div class="ud-info-item"><div class="ud-info-label">Email</div><div class="ud-info-value">${esc(user.email || '—')}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Role</div><div class="ud-info-value">${esc(user.role || '—')}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Joined</div><div class="ud-info-value">${fmtDate(user.createdAt)}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Last login</div><div class="ud-info-value">${fmtDate(user.lastLoginAt)}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Marketing opt-in</div><div class="ud-info-value">${user.marketingOptIn ? 'Yes' : 'No'}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Subscription</div><div class="ud-info-value">${esc((user.subscription && user.subscription.tier) || 'free')} / ${esc((user.subscription && user.subscription.status) || 'active')}</div></div>
        </div>
        ${
          issues.length
            ? `<div class="ud-issues">
          <strong class="ud-issues-label">Account issues:</strong>
          ${issues.map(i => `<span class="uc-issue-badge uc-issue-badge--warn">${esc(i.replace(/_/g, ' '))}</span>`).join(' ')}
        </div>`
            : ''
        }
      </div>

      <!-- ── Account provenance ───────────────────────────────── -->
      <div class="card ud-card">
        <h3 class="ud-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Account provenance
        </h3>
        <div class="ud-info-grid">
          <div class="ud-info-item"><div class="ud-info-label">Sign-up method</div><div class="ud-info-value">${esc(signupLabel(user.signupMethod))}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Verification method</div><div class="ud-info-value">${verifBadge(user.verificationMethod)}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Verified</div><div class="ud-info-value">${user.verified ? '<span class="badge badge-yes">Yes</span>' : '<span class="badge badge-no">No</span>'}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Verified at</div><div class="ud-info-value">${fmtDate(user.verifiedAt)}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Google linked</div><div class="ud-info-value">${user.hasGoogleLink ? '<span class="badge badge-google">Yes — Google</span>' : '—'}</div></div>
        </div>
        <div class="ud-provenance-note">
          <p class="small">No raw tokens, reset links, password hashes or Google subject IDs are shown here for security. Use the <a href="/admin-emails">Email Centre</a> for delivery logs.</p>
        </div>
      </div>
      ${provenancePanel(user)}
      <div class="card">
        <h3>Edit User</h3>
        <form id="editUserForm">
          <div class="form-row">
            <label for="userName">Name</label>
            <input type="text" id="userName" value="${esc(user.name || '')}" required maxlength="80">
          </div>
          <div class="form-row">
            <label for="userEmail">Email</label>
            <input type="email" id="userEmail" value="${esc(user.email || '')}" required>
          </div>
          <div class="form-row">
            <label>Account Type</label>
            <div style="display:flex;align-items:center;gap:0.75rem;">
              ${roleBadge(user.role)}
              ${
                user.role === 'admin'
                  ? ''
                  : '<button type="button" class="ef-cta btn btn-secondary btn-sm" id="changeAccountTypeBtn">Change Account Type…</button>'
              }
            </div>
          </div>
          <div class="form-row">
            <label>
              <input type="checkbox" id="userVerified" ${user.verified ? 'checked' : ''}>
              Verified
            </label>
          </div>
          <div class="form-row">
            <label>
              <input type="checkbox" id="userMarketingOptIn" ${user.marketingOptIn ? 'checked' : ''}>
              Marketing opt-in
            </label>
          </div>
          <div class="action-buttons">
            <button type="submit" class="ef-cta btn btn-primary">Save Changes</button>
            <button type="button" class="ef-cta btn btn-secondary" id="resetPasswordBtn">Reset Password</button>
            ${canResendVerification(user) ? '<button type="button" class="ef-cta btn btn-secondary" id="resendVerificationBtn">Resend Verification Email</button>' : ''}
            <button type="button" class="ef-cta btn btn-danger" id="suspendUserBtn">${user.suspended ? 'Unsuspend' : 'Suspend'} User</button>
            <button type="button" class="ef-cta btn btn-danger" id="deleteUserBtn">Delete User</button>
          </div>
        </form>
      </div>

      <!-- ── Activity placeholder ─────────────────────────────── -->
      <div class="card ud-card">
        <h3 class="ud-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Activity
        </h3>
        <div id="activityTimeline">
          <div class="ud-activity-row"><span class="ud-activity-label">Account created</span><span class="ud-activity-date">${fmtDate(user.createdAt)}</span></div>
          ${user.lastLoginAt ? `<div class="ud-activity-row"><span class="ud-activity-label">Last login</span><span class="ud-activity-date">${fmtDate(user.lastLoginAt)}</span></div>` : ''}
          ${user.verifiedAt ? `<div class="ud-activity-row"><span class="ud-activity-label">Email verified</span><span class="ud-activity-date">${fmtDate(user.verifiedAt)}</span></div>` : ''}
          <p class="small" style="margin-top:12px;color:#9ca3af;">For email delivery history, open the <a href="/admin-emails">Email Centre</a> and filter by this address.</p>
        </div>
      </div>
    `;

    // Wire form handlers
    document.getElementById('editUserForm').addEventListener('submit', async e => {
      e.preventDefault();
      await saveUserChanges(userId);
    });

    document
      .getElementById('resetPasswordBtn')
      .addEventListener('click', () => resetPassword(userId));

    const resendBtn = document.getElementById('resendVerificationBtn');
    if (resendBtn) {
      resendBtn.addEventListener('click', () => resendVerification(userId));
    }

    document
      .getElementById('suspendUserBtn')
      .addEventListener('click', () => toggleSuspend(userId, user.suspended));
    document.getElementById('deleteUserBtn').addEventListener('click', () => deleteUser(user));

    const changeAccountTypeBtn = document.getElementById('changeAccountTypeBtn');
    if (changeAccountTypeBtn) {
      changeAccountTypeBtn.addEventListener('click', () => openAccountTypeModal(user));
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function saveUserChanges(_id) {
    try {
      const data = {
        name: document.getElementById('userName').value.trim(),
        email: document.getElementById('userEmail').value.trim(),
        verified: document.getElementById('userVerified').checked,
        marketingOptIn: document.getElementById('userMarketingOptIn').checked,
      };

      await AdminShared.api(`/api/admin/users/${encodedUserId}`, 'PUT', data);
      AdminShared.showToast('User updated successfully', 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function resetPassword(_id) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Send password reset?',
      confirmText: 'Send',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${encodedUserId}/reset-password`, 'POST');
      AdminShared.showToast('Password reset email sent', 'success');
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function resendVerification(_id) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Resend verification email?',
      confirmText: 'Send',
      type: 'info',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${encodedUserId}/resend-verification`, 'POST');
      AdminShared.showToast('Verification email sent successfully', 'success');
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function toggleSuspend(id, currentlySuspended) {
    const action = currentlySuspended ? 'unsuspend' : 'suspend';
    const ok = await AdminShared.showConfirmModal({
      title: `${currentlySuspended ? 'Unsuspend' : 'Suspend'} this account?`,
      confirmText: currentlySuspended ? 'Unsuspend' : 'Suspend',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${encodedUserId}/${action}`, 'POST');
      AdminShared.showToast(`User ${action}ed successfully`, 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function deleteUser(user) {
    const id = user && user.id ? user.id : userId;
    const name = user && user.name ? user.name : id;
    const supplierWarning =
      user && user.role === 'supplier'
        ? ' This will delete the user, supplier profile, packages and public listing data.'
        : '';
    const ok = await AdminShared.showConfirmModal({
      title: 'Delete account permanently?',
      message: `This will permanently delete the account for "${name || id}".${supplierWarning} This cannot be undone.`,
      confirmText: 'Delete permanently',
      type: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${encodedUserId}`, 'DELETE');
      AdminShared.showToast('User deleted successfully', 'success');
      setTimeout(() => {
        window.location.href = '/admin-users';
      }, 1200);
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  // Change Account Type modal — uses the Modal class (components.js), the only
  // option on this page with real <select> support (AdminShared.showInputModal
  // only renders text/textarea). Calls the shared accountTypeConversion
  // service via POST /api/admin/users/:id/account-type, not the generic
  // PUT /:id (which no longer accepts a role field at all).
  //
  // Only the "other" role is offered — role is binary once admin is excluded
  // (this whole action is unavailable for admin accounts), so a picker
  // listing both roles would let an admin "convert" a user to the role they
  // already have, which the service correctly rejects (ALREADY_TARGET_ROLE)
  // but is a confusing no-op to offer in the first place.
  function openAccountTypeModal(user) {
    if (typeof Modal === 'undefined') {
      AdminShared.showToast('Unable to open the account type dialog (Modal unavailable)', 'error');
      return;
    }

    const targetRole = user.role === 'supplier' ? 'customer' : 'supplier';
    const content = document.createElement('div');
    content.innerHTML = `
      <p>Convert this account from <strong>${esc(user.role)}</strong> to <strong>${esc(targetRole)}</strong>?</p>
      ${
        targetRole === 'supplier'
          ? `<div style="margin-top:1rem;">
               <label style="display:block;margin-bottom:4px;font-weight:600;">Company / business name</label>
               <input type="text" id="account-type-company" value="${esc(user.company || '')}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">
             </div>`
          : `<p style="margin-top:0.75rem;color:#ef4444;font-weight:600;">This will suspend the user's supplier profile, packages and public listing — they can switch back later to reactivate it.</p>`
      }
    `;

    const modal = new Modal({
      title: 'Change Account Type',
      content,
      confirmText: 'Continue',
      cancelText: 'Cancel',
      onConfirm: async () => {
        const company = content.querySelector('#account-type-company')?.value.trim();
        try {
          await AdminShared.api(`/api/admin/users/${encodedUserId}/account-type`, 'POST', {
            targetRole,
            supplierInfo: targetRole === 'supplier' ? { company } : undefined,
          });
          AdminShared.showToast(`Account type changed to ${targetRole}`, 'success');
          await loadUserDetails();
        } catch (err) {
          AdminShared.showToast(`Failed to change account type: ${err.message}`, 'error');
        }
      },
    });
    modal.show();
  }

  async function provisionSupplierProfile(targetUserId) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Provision supplier profile?',
      message:
        'This will create a blank supplier profile for this user. They can then customise it from their dashboard.',
      confirmText: 'Create profile',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(
        `/api/admin/users/${encodeURIComponent(targetUserId)}/provision-supplier-profile`,
        'POST'
      );
      AdminShared.showToast('Supplier profile created successfully', 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed to provision profile: ${err.message}`, 'error');
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (userId) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadUserDetails);
    } else {
      loadUserDetails();
    }
    document.addEventListener('click', e => {
      if (e.target && e.target.id === 'provisionProfileBtn') {
        provisionSupplierProfile(userId);
      }
    });
  }
})();
