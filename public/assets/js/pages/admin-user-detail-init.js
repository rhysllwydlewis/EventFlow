(async function () {
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get('id');

  if (!userId) {
    document.getElementById('userDetailsContainer').innerHTML =
      '<div class="card"><p style="color:#ef4444;">No user ID provided.</p></div>';
    return;
  }

  async function loadUserDetails() {
    try {
      const user = await AdminShared.api(`/api/admin/users/${userId}`);
      renderUserDetails(user);
    } catch (err) {
      console.error('Failed to load user:', err);
      document.getElementById('userDetailsContainer').innerHTML =
        `<div class="card"><p style="color:#ef4444;">Failed to load user: ${AdminShared.escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderUserDetails(user) {
    const container = document.getElementById('userDetailsContainer');

    const html = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:1.5rem;">
          <div>
            <h2 class="h2-mb">${AdminShared.escapeHtml(user.name || 'Unnamed User')}</h2>
            <div class="flex-gap" style="flex-wrap:wrap;">
              <span class="badge badge-${user.role}">${AdminShared.escapeHtml(user.role || 'customer')}</span>
              <span class="badge badge-${user.verified ? 'yes' : 'no'}">${user.verified ? '✓ Verified' : '✗ Unverified'}</span>
              ${user.suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}
            </div>
          </div>
        </div>
        
        <div class="user-info-grid">
          <div class="info-item">
            <div class="info-label">Email</div>
            <div class="info-value">${AdminShared.escapeHtml(user.email || 'N/A')}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Joined</div>
            <div class="info-value">${AdminShared.formatDate(user.createdAt)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Login</div>
            <div class="info-value">${AdminShared.formatDate(user.lastLoginAt)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Marketing Opt-in</div>
            <div class="info-value">${user.marketingOptIn ? 'Yes' : 'No'}</div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <h3>Edit User</h3>
        <form id="editUserForm">
          <div class="form-row">
            <label for="userName">Name</label>
            <input type="text" id="userName" value="${AdminShared.escapeHtml(user.name || '')}" required>
          </div>
          
          <div class="form-row">
            <label for="userEmail">Email</label>
            <input type="email" id="userEmail" value="${AdminShared.escapeHtml(user.email || '')}" required>
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
              Marketing Opt-in
            </label>
          </div>
          
          <div class="action-buttons">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <button type="button" class="btn btn-secondary" id="resetPasswordBtn">Reset Password</button>
            ${!user.verified ? '<button type="button" class="btn btn-secondary" id="resendVerificationBtn">Resend Verification Email</button>' : ''}
            <button type="button" class="btn btn-danger" id="suspendUserBtn">${user.suspended ? 'Unsuspend' : 'Suspend'} User</button>
            <button type="button" class="btn btn-danger" id="deleteUserBtn">Delete User</button>
          </div>
        </form>
      </div>
      
      <div class="card">
        <h3>Activity Timeline</h3>
        <p class="small">Recent activity for this user will be displayed here.</p>
        <div id="activityTimeline" class="mt-1">
          <p class="small" style="color:#9ca3af;">No recent activity recorded.</p>
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Setup form handlers
    document.getElementById('editUserForm').addEventListener('submit', async e => {
      e.preventDefault();
      await saveUserChanges();
    });

    document.getElementById('resetPasswordBtn').addEventListener('click', resetPassword);

    // Add resend verification handler if button exists
    const resendVerificationBtn = document.getElementById('resendVerificationBtn');
    if (resendVerificationBtn) {
      resendVerificationBtn.addEventListener('click', resendVerification);
    }

    document
      .getElementById('suspendUserBtn')
      .addEventListener('click', () => toggleSuspend(user.suspended));
    document.getElementById('deleteUserBtn').addEventListener('click', deleteUser);
  }

  async function saveUserChanges() {
    try {
      const data = {
        name: document.getElementById('userName').value,
        email: document.getElementById('userEmail').value,
        role: document.getElementById('userRole').value,
        verified: document.getElementById('userVerified').checked,
        marketingOptIn: document.getElementById('userMarketingOptIn').checked,
      };

      await AdminShared.api(`/api/admin/users/${userId}`, 'PUT', data);
      AdminShared.showToast('User updated successfully', 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed to update user: ${err.message}`, 'error');
    }
  }

  async function resetPassword() {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Reset Password',
        message: 'Send a password reset email to this user?',
        confirmText: 'Send',
      }))
    ) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/users/${userId}/reset-password`, 'POST');
      AdminShared.showToast('Password reset email sent', 'success');
    } catch (err) {
      AdminShared.showToast(`Failed to send reset email: ${err.message}`, 'error');
    }
  }

  async function resendVerification() {
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Resend Verification',
        message: 'Send a new verification email to this user?',
        confirmText: 'Send',
      }))
    ) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/users/${userId}/resend-verification`, 'POST');
      AdminShared.showToast('Verification email sent successfully', 'success');
    } catch (err) {
      AdminShared.showToast(`Failed to send verification email: ${err.message}`, 'error');
    }
  }

  async function toggleSuspend(currentlySuspended) {
    const action = currentlySuspended ? 'unsuspend' : 'suspend';
    if (
      !(await AdminShared.showConfirmModal({
        title: 'Confirm Action',
        message: `Are you sure you want to ${action} this user?`,
        confirmText: 'Confirm',
      }))
    ) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/users/${userId}/${action}`, 'POST');
      AdminShared.showToast(`User ${action}ed successfully`, 'success');
      await loadUserDetails();
    } catch (err) {
      AdminShared.showToast(`Failed to ${action} user: ${err.message}`, 'error');
    }
  }

  async function deleteUser() {
    const confirmResult = await AdminShared.showInputModal({
      title: 'Delete User - DANGER',
      message: 'This action is IRREVERSIBLE. All user data will be permanently deleted.',
      label: 'Type "YES" to confirm deletion',
      placeholder: 'YES',
      required: true,
      validateFn: value => {
        if (value !== 'YES') {
          return 'You must type YES (all caps) to confirm deletion';
        }
        return true;
      },
    });

    if (!confirmResult.confirmed) {
      return;
    }

    try {
      await AdminShared.api(`/api/admin/users/${userId}`, 'DELETE');
      AdminShared.showToast('User deleted successfully', 'success');
      setTimeout(() => {
        location.href = '/admin-users';
      }, 1500);
    } catch (err) {
      AdminShared.showToast(`Failed to delete user: ${err.message}`, 'error');
    }
  }

  await loadUserDetails();
})();
