/**
 * EventFlow Admin — User Detail
 * Drives /admin-user-detail — the single source of truth for a user account.
 * Uses /api/admin/users/:id/detail for the safe enriched projection.
 */
(function () {
  'use strict';

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

  const userId = new URLSearchParams(window.location.search).get('id');
  if (!userId) {
    document.getElementById('userDetailsContainer').innerHTML =
      '<div class="card"><p class="small">No user ID specified. <a href="/admin-users">Back to Users Centre</a></p></div>';
  }

  async function loadUserDetails() {
    try {
      const { user } = await AdminShared.api(
        `/api/admin/users/${encodeURIComponent(userId)}/detail`
      );
      renderUserDetails(user);
    } catch (err) {
      document.getElementById('userDetailsContainer').innerHTML =
        `<div class="card"><p class="small">Failed to load user: ${esc(err.message)}. <a href="/admin-users">Back to Users Centre</a></p></div>`;
    }
  }

  function roleBadge(role) {
    const map = {
      customer: 'badge-customer',
      supplier: 'badge-supplier-account',
      admin: 'badge-admin',
      owner: 'badge-admin',
    };
    return `<span class="badge ${map[role] || ''}">${esc(role || 'unknown')}</span>`;
  }

  function verifBadge(method) {
    const labels = {
      google: ['badge-google', 'Google verified'],
      email_link: ['badge-yes', 'Email link verified'],
      admin: ['badge-admin-created', 'Admin verified'],
      legacy: ['', 'Verified (legacy)'],
      pending: ['badge-no', 'Pending verification'],
      unknown: ['badge-warning', 'Unknown verification source'],
    };
    const [cls, label] = labels[method] || ['badge-warning', method];
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function signupLabel(method) {
    const map = {
      google: 'Google sign-in',
      email_password: 'Email / password',
      admin_created: 'Created by admin',
      owner: 'Owner / system account',
      unknown: 'Unknown',
    };
    return map[method] || method || '—';
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
            ${user.supplierProfile ? `<a href="${esc(user.supplierProfile.profileUrl)}" class="btn btn-secondary btn-sm">Supplier Profile →</a>` : ''}
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

      <!-- ── Supplier linkage ─────────────────────────────────── -->
      <div class="card ud-card">
        <h3 class="ud-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          Supplier profile
        </h3>
        ${
          user.supplierProfile
            ? `
        <div class="ud-info-grid">
          <div class="ud-info-item"><div class="ud-info-label">Profile name</div><div class="ud-info-value">${esc(user.supplierProfile.name || '—')}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Approval status</div><div class="ud-info-value">${esc(user.supplierProfile.approvalStatus)}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Profile complete</div><div class="ud-info-value">${user.supplierProfile.profileComplete ? 'Yes' : 'Incomplete'}</div></div>
          <div class="ud-info-item"><div class="ud-info-label">Packages / listings</div><div class="ud-info-value">${user.supplierProfile.packageCount}</div></div>
        </div>
        <div class="ud-card-footer">
          <a href="${esc(user.supplierProfile.profileUrl)}" class="btn btn-secondary btn-sm">Open Supplier Detail →</a>
        </div>
        `
            : `
        <p class="small">No supplier profile linked to this account.</p>
        ${user.role === 'supplier' ? '<p class="small" style="color:#dc2626;"><strong>Warning:</strong> This account has the supplier role but no supplier profile exists.</p>' : ''}
        `
        }
      </div>

      <!-- ── Edit user ────────────────────────────────────────── -->
      <div class="card ud-card">
        <h3 class="ud-section-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit account
        </h3>
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
            <label for="userRole">Role</label>
            <select id="userRole">
              <option value="customer" ${user.role === 'customer' ? 'selected' : ''}>Customer</option>
              <option value="supplier" ${user.role === 'supplier' ? 'selected' : ''}>Supplier</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
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
            <button type="submit" class="btn btn-primary">Save changes</button>
            <button type="button" class="btn btn-secondary" id="resetPasswordBtn">Reset password</button>
            ${!user.verified && user.signupMethod === 'email_password' ? '<button type="button" class="btn btn-secondary" id="resendVerificationBtn">Resend verification email</button>' : ''}
            <button type="button" class="btn btn-warning" id="suspendUserBtn">${user.suspended ? 'Unsuspend' : 'Suspend'} account</button>
            <button type="button" class="btn btn-danger" id="deleteUserBtn">Delete account</button>
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
    document
      .getElementById('deleteUserBtn')
      .addEventListener('click', () => deleteUser(userId, user.name));
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function saveUserChanges(id) {
    const data = {
      name: document.getElementById('userName').value.trim(),
      email: document.getElementById('userEmail').value.trim(),
      role: document.getElementById('userRole').value,
      verified: document.getElementById('userVerified').checked,
      marketingOptIn: document.getElementById('userMarketingOptIn').checked,
    };
    try {
      await AdminShared.api(`/api/admin/users/${id}`, 'PUT', data);
      AdminShared.showToast('User updated.', 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed to update: ${err.message}`, 'error');
    }
  }

  async function resetPassword(id) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Send password reset?',
      confirmText: 'Send',
      type: 'warning',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${id}/reset-password`, 'POST');
      AdminShared.showToast('Password reset email sent.', 'success');
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function resendVerification(id) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Resend verification email?',
      confirmText: 'Send',
      type: 'info',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${id}/resend-verification`, 'POST');
      AdminShared.showToast('Verification email sent.', 'success');
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
      await AdminShared.api(`/api/admin/users/${id}/${action}`, 'POST');
      AdminShared.showToast(`Account ${action}ed.`, 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  async function deleteUser(id, name) {
    const ok = await AdminShared.showConfirmModal({
      title: 'Delete account permanently?',
      message: `This will permanently delete the account for "${name || id}". This cannot be undone.`,
      confirmText: 'Delete permanently',
      type: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await AdminShared.api(`/api/admin/users/${id}`, 'DELETE');
      AdminShared.showToast('Account deleted.', 'success');
      setTimeout(() => {
        window.location.href = '/admin-users';
      }, 1200);
    } catch (err) {
      AdminShared.showToast(`Failed: ${err.message}`, 'error');
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (userId) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadUserDetails);
    } else {
      loadUserDetails();
    }
  }
})();
