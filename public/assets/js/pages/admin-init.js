(function () {
  // Owner email used as a secondary admin check alongside the role check below.
  // Server-side admin enforcement is the primary security control; this is a convenience guard only.
  const OWNER_EMAIL = 'admin@event-flow.co.uk';

  // Helper to check if email is owner (case-insensitive)
  function isOwnerEmail(email) {
    if (!email || !OWNER_EMAIL) {
      return false;
    }
    return email.toLowerCase() === OWNER_EMAIL.toLowerCase();
  }

  // Defensive error logging wrapper
  function safeExecute(fn, context) {
    try {
      return fn.call(context);
    } catch (err) {
      console.error('Admin page error:', err);
      return null;
    }
  }

  // HTML sanitization helper to prevent XSS
  function escapeHtml(unsafe) {
    if (!unsafe) {
      return '';
    }
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function _adminToast(msg, type) {
    if (window.AdminShared && window.AdminShared.showToast) {
      window.AdminShared.showToast(msg, type || 'info');
    }
  }

  async function _adminConfirm(msg) {
    if (window.AdminShared && window.AdminShared.showConfirmModal) {
      return window.AdminShared.showConfirmModal({
        title: 'Confirm',
        message: msg,
        confirmText: 'OK',
      });
    }
    // AdminShared not available — refuse the action to prevent silent destructive operations
    console.warn('[Admin] AdminShared not available, action blocked:', msg);
    return false;
  }

  function api(url, method, body) {
    const opts = {
      method: method || 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    };

    // Add CSRF token for state-changing requests
    if (method && ['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
      if (window.__CSRF_TOKEN__) {
        opts.headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
      }
    }

    if (body) {
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts)
      .then(r => {
        // Check content type before parsing
        const contentType = r.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');

        if (isJson) {
          return r.json().then(data => {
            if (!r.ok) {
              const err = data && data.error ? data.error : `Request failed with ${r.status}`;
              // Provide more specific error messages for common HTTP codes
              if (r.status === 404) {
                throw new Error(`Resource not found (404): ${url}`);
              } else if (r.status === 401) {
                throw new Error('Authentication required. Please log in again.');
              } else if (r.status === 403) {
                throw new Error('Access denied. Insufficient permissions.');
              } else if (r.status === 500) {
                throw new Error('Server error. Please try again later.');
              }
              throw new Error(err);
            }
            return data;
          });
        } else {
          // Handle non-JSON responses (like plain text errors)
          return r.text().then(text => {
            if (!r.ok) {
              if (r.status === 404) {
                throw new Error(`Resource not found (404): ${url}`);
              }
              throw new Error(text || `Request failed with ${r.status}`);
            }
            // Try to parse as JSON anyway for successful responses
            try {
              return JSON.parse(text);
            } catch (e) {
              return { message: text };
            }
          });
        }
      })
      .catch(err => {
        // Enhanced error logging with more context
        console.error(`API error [${opts.method || 'GET'}] ${url}:`, err.message || err);
        throw err;
      });
  }
  let allUsers = [];
  let allSuppliers = [];
  let allPackages = [];

  function renderUsersTable(list) {
    const el = document.getElementById('users');
    if (!el) {
      return;
    }

    let rows =
      '<tr><th>Name</th><th>Email</th><th>Role</th><th>Verified</th><th>Joined</th><th>Last login</th><th>Actions</th></tr>';

    (list || []).forEach(u => {
      const joined = u.createdAt ? new Date(u.createdAt).toLocaleString() : '—';
      const last = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—';
      const verifiedBadge = u.verified
        ? '<span class="badge badge-yes">Yes</span>'
        : '<span class="badge badge-no">No</span>';

      const isOwner = isOwnerEmail(u.email) || u.isOwner;
      const isAdmin = u.role === 'admin';

      let actions = '<div style="display:flex;gap:4px;flex-wrap:wrap;">';

      // Owner accounts have special protection
      if (isOwner) {
        actions += `<button disabled style="opacity:0.5;cursor:not-allowed;" title="Owner account is protected">Edit</button>`;
        actions += `<span style="color:#888;font-size:0.9em;padding:4px;">Protected Account</span>`;
      } else {
        actions += `<button data-action="editUser" data-id="${u.id}">Edit</button>`;

        // Manual verification button for unverified users
        if (!u.verified) {
          actions += `<button data-action="verifyUser" data-id="${u.id}">Verify Email</button>`;
        }

        // Admin privilege toggle (only for non-owner accounts)
        if (isAdmin) {
          actions += `<button data-action="revokeAdmin" data-id="${u.id}">Revoke Admin</button>`;
        } else {
          actions += `<button data-action="grantAdmin" data-id="${u.id}">Grant Admin</button>`;
        }

        // Delete button
        actions += `<button data-action="deleteUser" data-id="${u.id}">Delete</button>`;
      }

      actions += '</div>';

      // Enhanced role display with owner badge
      let roleDisplay = u.role || '';
      if (isOwner) {
        roleDisplay +=
          ' <span class="badge" style="background:#9f1239;color:#fff;font-weight:600;" title="Protected account - cannot be deleted or demoted">👑 OWNER</span>';
      }

      rows +=
        `<tr ${isOwner ? 'style="background-color:#fef2f2;"' : ''}>` +
        `<td>${escapeHtml(u.name || '')}</td>` +
        `<td>${escapeHtml(u.email || '')}</td>` +
        `<td>${roleDisplay}</td>` +
        `<td>${verifiedBadge}</td>` +
        `<td>${joined}</td>` +
        `<td>${last}</td>` +
        `<td>${actions}</td>` +
        `</tr>`;
    });

    el.innerHTML = rows;
  }

  function applyUserFilters() {
    const searchEl = document.getElementById('userSearch');
    const filterEl = document.getElementById('userDateFilter');
    let list = Array.isArray(allUsers) ? allUsers.slice() : [];

    const term = ((searchEl && searchEl.value) || '').toLowerCase();
    if (term) {
      list = list.filter(u => {
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.indexOf(term) !== -1 || email.indexOf(term) !== -1;
      });
    }

    const rangeVal = filterEl ? filterEl.value : 'all';
    if (rangeVal !== 'all') {
      const days = parseInt(rangeVal, 10);
      const now = Date.now();
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      list = list.filter(u => {
        if (!u.createdAt) {
          return false;
        }
        const t = Date.parse(u.createdAt);
        if (!t || isNaN(t)) {
          return false;
        }
        return t >= cutoff;
      });
    }

    renderUsersTable(list);
  }

  function renderAnalytics(metrics) {
    const el = document.getElementById('analytics');
    if (!el) {
      return;
    }

    const counts = (metrics && metrics.counts) || {};
    const byRole = counts.usersByRole || {};
    const roleParts =
      Object.keys(byRole)
        .map(r => {
          return `${escapeHtml(r)}: ${Number(byRole[r]) || 0}`;
        })
        .join(', ') || '—';

    const usersList = Array.isArray(allUsers) && allUsers.length ? allUsers : [];
    function countSince(days) {
      const now = Date.now();
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      return usersList.filter(u => {
        if (!u.createdAt) {
          return false;
        }
        const t = Date.parse(u.createdAt);
        if (!t || isNaN(t)) {
          return false;
        }
        return t >= cutoff;
      }).length;
    }

    const last7 = countSince(7);
    const last30 = countSince(30);

    function bar(n) {
      let c = n;
      if (c > 20) {
        c = 20;
      }
      let out = '';
      for (let i = 0; i < c; i++) {
        out += '▮';
      }
      return out;
    }

    // Update stat cards with animated counters
    const totalUsersEl = document.getElementById('totalUsersCount');
    if (totalUsersEl && window.AdminShared && window.AdminShared.animateCounter) {
      window.AdminShared.animateCounter(totalUsersEl, counts.usersTotal || 0);
    } else if (totalUsersEl) {
      totalUsersEl.textContent = counts.usersTotal || 0;
    }

    const totalPackagesEl = document.getElementById('totalPackagesCount');
    if (totalPackagesEl && window.AdminShared && window.AdminShared.animateCounter) {
      window.AdminShared.animateCounter(totalPackagesEl, counts.packagesTotal || 0);
    } else if (totalPackagesEl) {
      totalPackagesEl.textContent = counts.packagesTotal || 0;
    }

    const totalSuppliersEl = document.getElementById('totalSuppliersCount');
    if (totalSuppliersEl && window.AdminShared && window.AdminShared.animateCounter) {
      window.AdminShared.animateCounter(totalSuppliersEl, counts.suppliersTotal || 0);
    } else if (totalSuppliersEl) {
      totalSuppliersEl.textContent = counts.suppliersTotal || 0;
    }

    // Update management card stats
    const totalSuppliersCardEl = document.getElementById('totalSuppliersCountCard');
    if (totalSuppliersCardEl) {
      totalSuppliersCardEl.textContent = counts.suppliersTotal || 0;
    }

    const totalPackagesCardEl = document.getElementById('totalPackagesCountCard');
    if (totalPackagesCardEl) {
      totalPackagesCardEl.textContent = counts.packagesTotal || 0;
    }

    const pendingSuppliersEl = document.getElementById('pendingSuppliersCount');
    if (pendingSuppliersEl) {
      pendingSuppliersEl.textContent = counts.pendingSuppliers || 0;
    }

    const proSuppliersEl = document.getElementById('proSuppliersCount');
    if (proSuppliersEl) {
      proSuppliersEl.textContent = counts.proSuppliers || 0;
    }

    const pendingPackagesEl = document.getElementById('pendingPackagesCount');
    if (pendingPackagesEl) {
      pendingPackagesEl.textContent = counts.pendingPackages || 0;
    }

    const featuredPackagesEl = document.getElementById('featuredPackagesCount');
    if (featuredPackagesEl) {
      featuredPackagesEl.textContent = counts.featuredPackages || 0;
    }

    // Revenue: no revenue endpoint yet — show N/A
    const totalRevenueEl = document.getElementById('totalRevenueCount');
    if (totalRevenueEl) {
      totalRevenueEl.textContent = 'N/A';
    }

    // Change indicators — cleared until real trend data is available
    [
      'totalUsersChange',
      'totalPackagesChange',
      'totalSuppliersChange',
      'totalRevenueChange',
    ].forEach(id => {
      const el2 = document.getElementById(id);
      if (el2) {
        el2.textContent = '—';
      }
    });

    el.innerHTML =
      `<div class="card">` +
      `<p><b>Total Users:</b> ${counts.usersTotal || 0}</p>` +
      `<p><b>Users by role:</b> ${roleParts}</p>` +
      `<p><b>Total Suppliers:</b> ${counts.suppliersTotal || 0}</p>` +
      `<p><b>Total Packages:</b> ${counts.packagesTotal || 0}</p>` +
      `<p><b>Signups last 7 days:</b> ${last7} <span class="small">${bar(last7)}</span></p>` +
      `<p><b>Signups last 30 days:</b> ${last30} <span class="small">${bar(last30)}</span></p>` +
      `<p class="small">Plans: ${counts.plansTotal || 0} · Threads: ${
        counts.threadsTotal || 0
      } · Messages: ${counts.messagesTotal || 0}</p>` +
      `</div>`;
  }

  function loadAll() {
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.innerText = 'Checking admin…';
    }

    api('/api/v1/auth/me')
      .then(me => {
        // Handle both wrapped ({ user: {...} }) and unwrapped formats for backward compatibility
        const user = me.user || me;

        // Check if user is admin - either by role or by owner email
        const isOwner = user.email === OWNER_EMAIL;
        const isAdmin = user.role === 'admin' || isOwner;

        if (!isAdmin) {
          if (statusEl) {
            statusEl.innerText = 'Not admin / not logged in.';
          }
          return;
        }

        if (statusEl) {
          statusEl.innerText = 'Loading data…';
        }

        return Promise.all([
          api('/api/admin/users').catch(err => {
            console.warn('Failed to load users:', err.message);
            return { items: [] };
          }),
          api('/api/admin/metrics').catch(err => {
            console.warn('Failed to load metrics:', err.message);
            return { counts: {} };
          }),
          api('/api/admin/photos/pending').catch(err => {
            console.warn('Failed to load pending photos:', err.message);
            return { photos: [] };
          }),
          api('/api/admin/reviews/pending').catch(err => {
            console.warn('Failed to load pending reviews:', err.message);
            return { reviews: [] };
          }),
        ]).then(results => {
          const usersResp = results[0] || {};
          const metricsResp = results[1] || {};
          const photosResp = results[2] || {};
          const reviewsResp = results[3] || {};

          allUsers = usersResp.items || [];
          // Reset supplier/package caches so edits refetch fresh data after a reload
          allSuppliers = [];
          allPackages = [];
          applyUserFilters();
          renderAnalytics(metricsResp);

          // Update moderation queue counts
          const pendingPhotos = (photosResp.photos || []).filter(p => !p.approved && !p.rejected);
          const pendingReviews = (reviewsResp.reviews || []).filter(
            r => !r.approved && !r.rejected
          );

          const photosEl = document.getElementById('pendingPhotosCount');
          const reviewsEl = document.getElementById('pendingReviewsCount');
          const reportsEl = document.getElementById('pendingReportsCount');
          const suppliersVerificationEl = document.getElementById(
            'pendingSupplierVerificationCount'
          );

          if (photosEl) {
            photosEl.innerText = pendingPhotos.length;
          }
          if (reviewsEl) {
            reviewsEl.innerText = pendingReviews.length;
          }

          // Fetch pending reports count
          api('/api/admin/reports/pending', 'GET')
            .then(reportsResp => {
              if (reportsEl) {
                reportsEl.innerText = reportsResp.count || 0;
              }
            })
            .catch(err => {
              console.warn('Failed to load pending reports:', err.message);
              if (reportsEl) {
                reportsEl.innerText = '0';
              }
            });

          // Fetch pending supplier verifications
          api('/api/admin/suppliers/pending-verification', 'GET')
            .then(suppliersResp => {
              if (suppliersVerificationEl) {
                suppliersVerificationEl.innerText = suppliersResp.count || 0;
              }
            })
            .catch(err => {
              console.warn('Failed to load pending supplier verifications:', err.message);
              if (suppliersVerificationEl) {
                suppliersVerificationEl.innerText = '0';
              }
            });

          if (statusEl) {
            statusEl.innerText = `Loaded ${allUsers.length} users.`;
          }
        });
      })
      .catch(err => {
        console.error('Error loading admin', err);
        // Only show error message if it's not an auth error
        if (
          statusEl &&
          err &&
          err.message &&
          typeof err.message === 'string' &&
          !err.message.includes('Authentication required')
        ) {
          statusEl.innerText = 'Error loading data. Some features may be unavailable.';
        }
      });
  }

  window.approveSup = function (id) {
    return safeExecute(() => {
      if (typeof Modal !== 'undefined') {
        const modal = new Modal({
          title: 'Approve Supplier',
          content: '<p>Are you sure you want to approve this supplier?</p>',
          confirmText: 'Approve',
          cancelText: 'Cancel',
          onConfirm: function () {
            api(`/api/admin/suppliers/${id}/approve`, 'POST', { approved: true })
              .then(() => {
                if (typeof Toast !== 'undefined') {
                  Toast.success('Supplier approved.');
                } else {
                  _adminToast('Supplier approved.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('approveSup failed', err);
                if (typeof Toast !== 'undefined') {
                  Toast.error(`Failed to approve supplier: ${err.message}`);
                } else {
                  _adminToast(`Failed to approve supplier: ${err.message}`, 'error');
                }
              });
          },
        });
        modal.show();
      } else {
        // Fallback to confirm dialog
        api(`/api/admin/suppliers/${id}/approve`, 'POST', { approved: true })
          .then(() => {
            _adminToast('Supplier approved.', 'success');
            loadAll();
          })
          .catch(err => {
            console.error('approveSup failed', err);
            _adminToast(`Failed to approve supplier: ${err.message}`, 'error');
          });
      }
    });
  };

  window.rejectSup = function (id) {
    return safeExecute(() => {
      if (typeof Modal !== 'undefined') {
        const modal = new Modal({
          title: 'Reject Supplier',
          content: '<p>Are you sure you want to reject this supplier?</p>',
          confirmText: 'Reject',
          cancelText: 'Cancel',
          onConfirm: function () {
            api(`/api/admin/suppliers/${id}/approve`, 'POST', { approved: false })
              .then(() => {
                if (typeof Toast !== 'undefined') {
                  Toast.success('Supplier rejected.');
                } else {
                  _adminToast('Supplier rejected.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('rejectSup failed', err);
                if (typeof Toast !== 'undefined') {
                  Toast.error(`Failed to reject supplier: ${err.message}`);
                } else {
                  _adminToast(`Failed to reject supplier: ${err.message}`, 'error');
                }
              });
          },
        });
        modal.show();
      } else {
        // Fallback to confirm dialog
        api(`/api/admin/suppliers/${id}/approve`, 'POST', { approved: false })
          .then(() => {
            _adminToast('Supplier rejected.', 'success');
            loadAll();
          })
          .catch(err => {
            console.error('rejectSup failed', err);
            _adminToast(`Failed to reject supplier: ${err.message}`, 'error');
          });
      }
    });
  };

  window.setProPlan = async function (id, mode) {
    if (mode === 'grant') {
      const tierSel = document.getElementById(`pro-tier-${id}`);
      const durationSel = document.getElementById(`pro-duration-${id}`);
      if (!tierSel || !durationSel || !durationSel.value) {
        if (typeof Toast !== 'undefined') {
          Toast.warning('Choose a tier and duration first.');
        } else {
          _adminToast('Choose a tier and duration first.', 'error');
        }
        return;
      }
      const tier = tierSel.value;
      const days = parseInt(durationSel.value, 10);
      const tierName = tier === 'pro_plus' ? 'Pro+' : 'Pro';

      api(`/api/admin/suppliers/${id}/subscription`, 'POST', {
        tier,
        days,
      })
        .then(() => {
          if (typeof Toast !== 'undefined') {
            Toast.success(`${tierName} subscription granted for ${days} days.`);
          } else {
            _adminToast(`${tierName} subscription granted for ${days} days.`, 'success');
          }
          loadAll();
        })
        .catch(err => {
          console.error('setProPlan (grant) failed', err);
          if (typeof Toast !== 'undefined') {
            Toast.error(`Failed to grant subscription: ${err.message}`);
          } else {
            _adminToast(`Failed to grant subscription: ${err.message}`, 'error');
          }
        });
    } else if (mode === 'cancel') {
      if (typeof Modal !== 'undefined') {
        const modal = new Modal({
          title: 'Remove Subscription',
          content:
            '<p>Remove subscription for this supplier? They will lose Pro/Pro+ features immediately.</p>',
          confirmText: 'Remove',
          cancelText: 'Keep',
          onConfirm: function () {
            api(`/api/admin/suppliers/${id}/subscription`, 'DELETE')
              .then(() => {
                if (typeof Toast !== 'undefined') {
                  Toast.success('Subscription removed.');
                } else {
                  _adminToast('Subscription removed.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('setProPlan (cancel) failed', err);
                if (typeof Toast !== 'undefined') {
                  Toast.error(`Failed to remove subscription: ${err.message}`);
                } else {
                  _adminToast(`Failed to remove subscription: ${err.message}`, 'error');
                }
              });
          },
        });
        modal.show();
      } else {
        if (
          !(await _adminConfirm(
            'Remove subscription for this supplier? They will lose Pro/Pro+ features immediately.'
          ))
        ) {
          return;
        }
        api(`/api/admin/suppliers/${id}/subscription`, 'DELETE')
          .then(() => {
            _adminToast('Subscription removed.', 'success');
            loadAll();
          })
          .catch(err => {
            console.error('setProPlan (cancel) failed', err);
            _adminToast(`Failed to remove subscription: ${err.message}`, 'error');
          });
      }
    }
  };

  window.approvePkg = function (id, approved) {
    return safeExecute(() => {
      const action = approved ? 'approve' : 'unapprove';
      api(`/api/admin/packages/${id}/approve`, 'POST', { approved: approved })
        .then(() => {
          if (typeof Toast !== 'undefined') {
            Toast.success(`Package ${action}d successfully.`);
          } else {
            _adminToast(`Package ${action}d successfully.`, 'success');
          }
          loadAll();
        })
        .catch(err => {
          console.error('approvePkg failed', err);
          if (typeof Toast !== 'undefined') {
            Toast.error(`Failed to ${action} package: ${err.message}`);
          } else {
            _adminToast(`Failed to ${action} package: ${err.message}`, 'error');
          }
        });
    });
  };

  window.featurePkg = function (id, featured) {
    return safeExecute(() => {
      const action = featured ? 'feature' : 'unfeature';
      api(`/api/admin/packages/${id}/feature`, 'POST', { featured: featured })
        .then(() => {
          if (typeof Toast !== 'undefined') {
            Toast.success(`Package ${action}d successfully.`);
          } else {
            _adminToast(`Package ${action}d successfully.`, 'success');
          }
          loadAll();
        })
        .catch(err => {
          console.error('featurePkg failed', err);
          if (typeof Toast !== 'undefined') {
            Toast.error(`Failed to ${action} package: ${err.message}`);
          } else {
            _adminToast(`Failed to ${action} package: ${err.message}`, 'error');
          }
        });
    });
  };

  window.disableUser = function (id) {
    api(`/api/admin/users/${id}/suspend`, 'POST', { suspended: true, reason: 'Disabled by admin' })
      .then(loadAll)
      .catch(err => {
        console.error('disableUser failed', err);
      });
  };

  // New user management functions
  window.deleteUser = async function (id) {
    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Delete User',
        content: '<p>Are you sure you want to delete this user? This action cannot be undone.</p>',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        onConfirm: function () {
          api(`/api/admin/users/${id}`, 'DELETE')
            .then(() => {
              if (typeof Toast !== 'undefined') {
                Toast.success('User deleted successfully.');
              } else {
                _adminToast('User deleted successfully.', 'success');
              }
              loadAll();
            })
            .catch(err => {
              console.error('deleteUser failed', err);
              if (typeof Toast !== 'undefined') {
                Toast.error(`Failed to delete user: ${err.message}`);
              } else {
                _adminToast(`Failed to delete user: ${err.message}`, 'error');
              }
            });
        },
      });
      modal.show();
    } else {
      if (
        !(await _adminConfirm(
          'Are you sure you want to delete this user? This action cannot be undone.'
        ))
      ) {
        return;
      }
      api(`/api/admin/users/${id}`, 'DELETE')
        .then(() => {
          _adminToast('User deleted successfully.', 'success');
          loadAll();
        })
        .catch(err => {
          console.error('deleteUser failed', err);
          _adminToast(`Failed to delete user: ${err.message}`, 'error');
        });
    }
  };

  window.editUser = function (id) {
    const user = allUsers.find(u => {
      return u.id === id;
    });
    if (!user) {
      if (typeof Toast !== 'undefined') {
        Toast.error('User not found');
      } else {
        _adminToast('User not found', 'error');
      }
      return;
    }

    // Create modal content with form
    const content = document.createElement('div');
    content.innerHTML =
      `<div style="display: grid; gap: 1rem;">` +
      `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Name</label>` +
      `<input type="text" id="edit-user-name" value="${escapeHtml(
        user.name || ''
      )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
      `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Email</label>` +
      `<input type="email" id="edit-user-email" value="${escapeHtml(
        user.email || ''
      )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
      `</div>`;

    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Edit User',
        content: content,
        confirmText: 'Save',
        cancelText: 'Cancel',
        onConfirm: function () {
          const name = document.getElementById('edit-user-name').value;
          const email = document.getElementById('edit-user-email').value;

          api(`/api/admin/users/${id}`, 'PUT', { name: name, email: email })
            .then(() => {
              if (typeof Toast !== 'undefined') {
                Toast.success('User updated successfully.');
              } else {
                _adminToast('User updated successfully.', 'success');
              }
              loadAll();
            })
            .catch(err => {
              console.error('editUser failed', err);
              if (typeof Toast !== 'undefined') {
                Toast.error(`Failed to update user: ${err.message}`);
              } else {
                _adminToast(`Failed to update user: ${err.message}`, 'error');
              }
            });
        },
      });
      modal.show();
    } else {
      // Fallback using AdminShared.showInputModal if available
      if (window.AdminShared && window.AdminShared.showInputModal) {
        window.AdminShared.showInputModal({
          title: 'Edit User Name',
          message: 'Enter new name for this user',
          label: 'Name',
          initialValue: user.name || '',
          required: true,
        }).then(nameResult => {
          if (!nameResult.confirmed) {
            return;
          }

          return window.AdminShared.showInputModal({
            title: 'Edit User Email',
            message: 'Enter new email for this user',
            label: 'Email',
            initialValue: user.email || '',
            required: true,
            validateFn: window.AdminShared.validateEmail,
          }).then(emailResult => {
            if (!emailResult.confirmed) {
              return;
            }

            return api(`/api/admin/users/${id}`, 'PUT', {
              name: nameResult.value,
              email: emailResult.value,
            })
              .then(() => {
                if (window.AdminShared && window.AdminShared.showToast) {
                  window.AdminShared.showToast('User updated successfully.', 'success');
                } else {
                  _adminToast('User updated successfully.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('editUser failed', err);
                if (window.AdminShared && window.AdminShared.showToast) {
                  window.AdminShared.showToast(`Failed to update user: ${err.message}`, 'error');
                } else {
                  _adminToast(`Failed to update user: ${err.message}`, 'error');
                }
              });
          });
        });
      } else {
        _adminToast('User editing requires the Modal component. Please reload the page.', 'error');
      }
    }
  };

  window.grantAdmin = async function (id) {
    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Grant Admin Privileges',
        content: '<p>Grant admin privileges to this user?</p>',
        confirmText: 'Grant Admin',
        cancelText: 'Cancel',
        onConfirm: function () {
          api(`/api/admin/users/${id}/grant-admin`, 'POST')
            .then(() => {
              if (typeof Toast !== 'undefined') {
                Toast.success('Admin privileges granted successfully.');
              } else {
                _adminToast('Admin privileges granted successfully.', 'success');
              }
              loadAll();
            })
            .catch(err => {
              console.error('grantAdmin failed', err);
              if (typeof Toast !== 'undefined') {
                Toast.error(`Failed to grant admin privileges: ${err.message}`);
              } else {
                _adminToast(`Failed to grant admin privileges: ${err.message}`, 'error');
              }
            });
        },
      });
      modal.show();
    } else {
      if (!(await _adminConfirm('Grant admin privileges to this user?'))) {
        return;
      }
      api(`/api/admin/users/${id}/grant-admin`, 'POST')
        .then(() => {
          _adminToast('Admin privileges granted successfully.', 'success');
          loadAll();
        })
        .catch(err => {
          console.error('grantAdmin failed', err);
          _adminToast(`Failed to grant admin privileges: ${err.message}`, 'error');
        });
    }
  };

  window.revokeAdmin = async function (id) {
    // Create modal content with role selection
    const content = document.createElement('div');
    content.innerHTML =
      '<p>Revoke admin privileges from this user?</p>' +
      '<div style="margin-top: 1rem;"><label style="display:block;margin-bottom:4px;font-weight:600;">New Role</label>' +
      '<select id="revoke-admin-role" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">' +
      '<option value="customer">Customer</option>' +
      '<option value="supplier">Supplier</option>' +
      '</select></div>';

    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Revoke Admin Privileges',
        content: content,
        confirmText: 'Revoke Admin',
        cancelText: 'Cancel',
        onConfirm: function () {
          const newRole = document.getElementById('revoke-admin-role').value;

          api(`/api/admin/users/${id}/revoke-admin`, 'POST', { newRole: newRole })
            .then(() => {
              if (typeof Toast !== 'undefined') {
                Toast.success('Admin privileges revoked successfully.');
              } else {
                _adminToast('Admin privileges revoked successfully.', 'success');
              }
              loadAll();
            })
            .catch(err => {
              console.error('revokeAdmin failed', err);
              if (typeof Toast !== 'undefined') {
                Toast.error(`Failed to revoke admin privileges: ${err.message}`);
              } else {
                _adminToast(`Failed to revoke admin privileges: ${err.message}`, 'error');
              }
            });
        },
      });
      modal.show();
    } else {
      // Fallback using AdminShared.showConfirmModal and showInputModal if available
      if (
        window.AdminShared &&
        window.AdminShared.showConfirmModal &&
        window.AdminShared.showInputModal
      ) {
        window.AdminShared.showConfirmModal({
          title: 'Revoke Admin Privileges',
          message: 'Revoke admin privileges from this user?',
          confirmText: 'Continue',
          cancelText: 'Cancel',
          type: 'warning',
        }).then(confirmed => {
          if (!confirmed) {
            return;
          }

          return window.AdminShared.showInputModal({
            title: 'Select New Role',
            message: 'Choose the new role for this user after revoking admin privileges',
            label: 'New Role',
            placeholder: 'customer',
            initialValue: 'customer',
            required: true,
            validateFn: value => window.AdminShared.validateRole(value, ['customer', 'supplier']),
          }).then(result => {
            if (!result.confirmed) {
              return;
            }

            return api(`/api/admin/users/${id}/revoke-admin`, 'POST', { newRole: result.value })
              .then(() => {
                if (window.AdminShared && window.AdminShared.showToast) {
                  window.AdminShared.showToast('Admin privileges revoked successfully.', 'success');
                } else {
                  _adminToast('Admin privileges revoked successfully.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('revokeAdmin failed', err);
                if (window.AdminShared && window.AdminShared.showToast) {
                  window.AdminShared.showToast(
                    `Failed to revoke admin privileges: ${err.message}`,
                    'error'
                  );
                } else {
                  _adminToast(`Failed to revoke admin privileges: ${err.message}`, 'error');
                }
              });
          });
        });
      } else {
        _adminToast(
          'Admin management requires AdminShared utilities. Please reload the page.',
          'error'
        );
      }
    }
  };

  window.verifyUser = async function (id) {
    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Verify User Email',
        content: "<p>Manually verify this user's email address?</p>",
        confirmText: 'Verify',
        cancelText: 'Cancel',
        onConfirm: function () {
          api(`/api/admin/users/${id}/verify`, 'POST')
            .then(() => {
              if (typeof Toast !== 'undefined') {
                Toast.success('User verified successfully.');
              } else {
                _adminToast('User verified successfully.', 'success');
              }
              loadAll();
            })
            .catch(err => {
              console.error('verifyUser failed', err);
              if (typeof Toast !== 'undefined') {
                Toast.error(`Failed to verify user: ${err.message}`);
              } else {
                _adminToast(`Failed to verify user: ${err.message}`, 'error');
              }
            });
        },
      });
      modal.show();
    } else {
      if (!(await _adminConfirm("Manually verify this user's email address?"))) {
        return;
      }
      api(`/api/admin/users/${id}/verify`, 'POST')
        .then(() => {
          if (typeof Toast !== 'undefined') {
            Toast.success('User verified successfully.');
          } else {
            _adminToast('User verified successfully.', 'success');
          }
          loadAll();
        })
        .catch(err => {
          console.error('verifyUser failed', err);
          if (typeof Toast !== 'undefined') {
            Toast.error(`Failed to verify user: ${err.message}`);
          } else {
            _adminToast(`Failed to verify user: ${err.message}`, 'error');
          }
        });
    }
  };

  // Supplier management functions
  window.deleteSupplier = async function (id) {
    return safeExecute(async () => {
      if (typeof Modal !== 'undefined') {
        const modal = new Modal({
          title: 'Delete Supplier',
          content:
            '<p>Are you sure you want to delete this supplier and all associated packages? This action cannot be undone.</p>',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          onConfirm: function () {
            api(`/api/admin/suppliers/${id}`, 'DELETE')
              .then(() => {
                if (typeof Toast !== 'undefined') {
                  Toast.success('Supplier deleted successfully.');
                } else {
                  _adminToast('Supplier deleted successfully.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('deleteSupplier failed', err);
                if (typeof Toast !== 'undefined') {
                  Toast.error(`Failed to delete supplier: ${err.message}`);
                } else {
                  _adminToast(`Failed to delete supplier: ${err.message}`, 'error');
                }
              });
          },
        });
        modal.show();
      } else {
        if (
          !(await _adminConfirm(
            'Are you sure you want to delete this supplier and all associated packages? This action cannot be undone.'
          ))
        ) {
          return;
        }
        api(`/api/admin/suppliers/${id}`, 'DELETE')
          .then(() => {
            _adminToast('Supplier deleted successfully.', 'success');
            loadAll();
          })
          .catch(err => {
            console.error('deleteSupplier failed', err);
            _adminToast(`Failed to delete supplier: ${err.message}`, 'error');
          });
      }
    });
  };

  window.editSupplier = function (id) {
    // Use cached suppliers if available, otherwise fetch and cache
    const fetchSuppliers = allSuppliers.length
      ? Promise.resolve({ items: allSuppliers })
      : api('/api/admin/suppliers').then(resp => {
          allSuppliers = (resp && resp.items) || [];
          return resp;
        });
    fetchSuppliers
      .then(resp => {
        const suppliers = (resp && resp.items) || allSuppliers;
        const supplier = suppliers.find(s => {
          return s.id === id;
        });

        if (!supplier) {
          if (typeof Toast !== 'undefined') {
            Toast.error('Supplier not found');
          } else {
            _adminToast('Supplier not found', 'error');
          }
          return;
        }

        // Create modal content
        const content = document.createElement('div');
        content.innerHTML =
          `<div style="display: grid; gap: 1rem;">` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Name</label>` +
          `<input type="text" id="edit-sup-name" value="${escapeHtml(
            supplier.name || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Category</label>` +
          `<input type="text" id="edit-sup-category" value="${escapeHtml(
            supplier.category || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Location</label>` +
          `<input type="text" id="edit-sup-location" value="${escapeHtml(
            supplier.location || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Price Display</label>` +
          `<input type="text" id="edit-sup-price" value="${escapeHtml(
            supplier.price_display || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Website</label>` +
          `<input type="url" id="edit-sup-website" value="${escapeHtml(
            supplier.website || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Email</label>` +
          `<input type="email" id="edit-sup-email" value="${escapeHtml(
            supplier.email || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Max Guests</label>` +
          `<input type="number" id="edit-sup-maxGuests" value="${escapeHtml(
            supplier.maxGuests || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Short Description</label>` +
          `<textarea id="edit-sup-desc-short" rows="2" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">${escapeHtml(
            supplier.description_short || ''
          )}</textarea></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Long Description</label>` +
          `<textarea id="edit-sup-desc-long" rows="4" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">${escapeHtml(
            supplier.description_long || ''
          )}</textarea></div>` +
          `</div>`;

        // Create modal
        if (typeof Modal !== 'undefined') {
          const modal = new Modal({
            title: `Edit Supplier: ${escapeHtml(supplier.name)}`,
            content: content,
            confirmText: 'Save Changes',
            cancelText: 'Cancel',
            onConfirm: function () {
              const updateData = {
                name: document.getElementById('edit-sup-name').value,
                category: document.getElementById('edit-sup-category').value,
                location: document.getElementById('edit-sup-location').value,
                price_display: document.getElementById('edit-sup-price').value,
                website: document.getElementById('edit-sup-website').value,
                email: document.getElementById('edit-sup-email').value,
                maxGuests: Math.max(
                  0,
                  parseInt(document.getElementById('edit-sup-maxGuests').value, 10) || 0
                ),
                description_short: document.getElementById('edit-sup-desc-short').value,
                description_long: document.getElementById('edit-sup-desc-long').value,
              };

              api(`/api/admin/suppliers/${id}`, 'PUT', updateData)
                .then(() => {
                  if (typeof Toast !== 'undefined') {
                    Toast.success('Supplier updated successfully.');
                  } else {
                    _adminToast('Supplier updated successfully.', 'success');
                  }
                  loadAll();
                })
                .catch(err => {
                  console.error('editSupplier failed', err);
                  if (typeof Toast !== 'undefined') {
                    Toast.error(`Failed to update supplier: ${err.message}`);
                  } else {
                    _adminToast(`Failed to update supplier: ${err.message}`, 'error');
                  }
                });
            },
          });
          modal.show();
        } else {
          // Fallback if Modal is not available
          _adminToast(
            'Supplier editing requires the Modal component. Please reload the page.',
            'error'
          );
        }
      })
      .catch(err => {
        console.error('Failed to load supplier', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to load supplier data');
        } else {
          _adminToast('Failed to load supplier data', 'error');
        }
      });
  };

  // Package management functions
  window.deletePackage = async function (id) {
    return safeExecute(async () => {
      if (typeof Modal !== 'undefined') {
        const modal = new Modal({
          title: 'Delete Package',
          content:
            '<p>Are you sure you want to delete this package? This action cannot be undone.</p>',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          onConfirm: function () {
            api(`/api/admin/packages/${id}`, 'DELETE')
              .then(() => {
                if (typeof Toast !== 'undefined') {
                  Toast.success('Package deleted successfully.');
                } else {
                  _adminToast('Package deleted successfully.', 'success');
                }
                loadAll();
              })
              .catch(err => {
                console.error('deletePackage failed', err);
                if (typeof Toast !== 'undefined') {
                  Toast.error(`Failed to delete package: ${err.message}`);
                } else {
                  _adminToast(`Failed to delete package: ${err.message}`, 'error');
                }
              });
          },
        });
        modal.show();
      } else {
        if (
          !(await _adminConfirm(
            'Are you sure you want to delete this package? This action cannot be undone.'
          ))
        ) {
          return;
        }
        api(`/api/admin/packages/${id}`, 'DELETE')
          .then(() => {
            _adminToast('Package deleted successfully.', 'success');
            loadAll();
          })
          .catch(err => {
            console.error('deletePackage failed', err);
            _adminToast(`Failed to delete package: ${err.message}`, 'error');
          });
      }
    });
  };

  window.editPackage = function (id) {
    // Use cached packages if available, otherwise fetch and cache
    const fetchPackages = allPackages.length
      ? Promise.resolve({ items: allPackages })
      : api('/api/admin/packages').then(resp => {
          allPackages = (resp && resp.items) || [];
          return resp;
        });
    fetchPackages
      .then(resp => {
        const packages = (resp && resp.items) || allPackages;
        const pkg = packages.find(p => {
          return p.id === id;
        });

        if (!pkg) {
          if (typeof Toast !== 'undefined') {
            Toast.error('Package not found');
          } else {
            _adminToast('Package not found', 'error');
          }
          return;
        }

        // Create modal content
        const content = document.createElement('div');
        content.innerHTML =
          `<div style="display: grid; gap: 1rem;">` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Title *</label>` +
          `<input type="text" id="edit-pkg-title" value="${escapeHtml(
            pkg.title || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Description</label>` +
          `<textarea id="edit-pkg-description" rows="3" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">${escapeHtml(
            pkg.description || ''
          )}</textarea></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Price Display</label>` +
          `<input type="text" id="edit-pkg-price" value="${escapeHtml(
            pkg.price_display || pkg.price || ''
          )}" placeholder="e.g., £1,500" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div><label style="display:block;margin-bottom:4px;font-weight:600;">Image URL</label>` +
          `<input type="url" id="edit-pkg-image" value="${escapeHtml(
            pkg.image || ''
          )}" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>` +
          `<div style="display:flex;gap:1rem;align-items:center;">` +
          `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">` +
          `<input type="checkbox" id="edit-pkg-approved" ${
            pkg.approved ? 'checked' : ''
          } style="width:18px;height:18px;">` +
          `<span style="font-weight:600;">Approved</span>` +
          `</label>` +
          `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">` +
          `<input type="checkbox" id="edit-pkg-featured" ${
            pkg.featured ? 'checked' : ''
          } style="width:18px;height:18px;">` +
          `<span style="font-weight:600;">Featured</span>` +
          `</label>` +
          `</div>` +
          `<div class="small" style="color:#52525b;margin-top:8px;padding:8px;background:#f9fafb;border-radius:4px;">` +
          `<strong>Gallery Management:</strong><br>` +
          `Photo gallery can be managed by the supplier through their dashboard.` +
          `</div>` +
          `</div>`;

        // Create modal
        if (typeof Modal !== 'undefined') {
          const modal = new Modal({
            title: `Edit Package: ${escapeHtml(pkg.title)}`,
            content: content,
            confirmText: 'Save Changes',
            cancelText: 'Cancel',
            onConfirm: function () {
              const updateData = {
                title: document.getElementById('edit-pkg-title').value,
                description: document.getElementById('edit-pkg-description').value,
                price_display: document.getElementById('edit-pkg-price').value,
                image: document.getElementById('edit-pkg-image').value,
                approved: document.getElementById('edit-pkg-approved').checked,
                featured: document.getElementById('edit-pkg-featured').checked,
              };

              api(`/api/admin/packages/${id}`, 'PUT', updateData)
                .then(() => {
                  if (typeof Toast !== 'undefined') {
                    Toast.success('Package updated successfully.');
                  } else {
                    _adminToast('Package updated successfully.', 'success');
                  }
                  loadAll();
                })
                .catch(err => {
                  console.error('editPackage failed', err);
                  if (typeof Toast !== 'undefined') {
                    Toast.error(`Failed to update package: ${err.message}`);
                  } else {
                    _adminToast(`Failed to update package: ${err.message}`, 'error');
                  }
                });
            },
          });
          modal.show();
        } else {
          // Fallback if Modal is not available
          _adminToast(
            'Package editing requires the Modal component. Please reload the page.',
            'error'
          );
        }
      })
      .catch(err => {
        console.error('Failed to load package', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to load package data');
        } else {
          _adminToast('Failed to load package data', 'error');
        }
      });
  };

  // Initialize when DOM is ready (since this script is deferred, load event may have already fired)
  function initializeAdmin() {
    safeExecute(() => {
      loadAll();

      const search = document.getElementById('userSearch');
      if (search) {
        search.addEventListener('input', applyUserFilters);
      }

      const dateFilter = document.getElementById('userDateFilter');
      if (dateFilter) {
        dateFilter.addEventListener('change', applyUserFilters);
      }

      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          loadAll();
        });
      }

      const dlUsers = document.getElementById('downloadUsersCsv');
      if (dlUsers) {
        dlUsers.addEventListener('click', () => {
          window.location.href = '/api/v1/admin/users-export';
        });
      }

      const dlMarketing = document.getElementById('downloadMarketingCsv');
      if (dlMarketing) {
        dlMarketing.addEventListener('click', () => {
          window.location.href = '/api/v1/admin/marketing-export';
        });
      }

      const dlJson = document.getElementById('downloadAllJson');
      if (dlJson) {
        dlJson.addEventListener('click', () => {
          window.location.href = '/api/v1/admin/export/all';
        });
      }

      const smartTagBtn = document.getElementById('smartTagSuppliersBtn');
      if (smartTagBtn) {
        smartTagBtn.addEventListener('click', () => {
          smartTagBtn.disabled = true;
          smartTagBtn.innerText = 'Running smart tagging…';
          api('/api/admin/suppliers/smart-tags', 'POST', {})
            .then(() => {
              return loadAll();
            })
            .catch(err => {
              console.error('Smart tagging failed', err);
              _adminToast('Smart tagging failed – check server logs.', 'error');
            })
            .finally(() => {
              smartTagBtn.disabled = false;
              smartTagBtn.innerText = 'Run smart tagging (beta)';
            });
        });
      }

      const createUserBtn = document.getElementById('createUserBtn');
      if (createUserBtn) {
        createUserBtn.addEventListener('click', () => {
          showCreateUserModal();
        });
      }

      // Navigation button helpers with keyboard support
      function setupNavButton(btnId, href) {
        const btn = document.getElementById(btnId);
        if (btn) {
          btn.addEventListener('click', () => {
            window.location.href = href;
          });
          // Support keyboard activation (Enter and Space)
          btn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              window.location.href = href;
            }
          });
          // Make sure button is tabbable
          if (!btn.hasAttribute('tabindex')) {
            btn.setAttribute('tabindex', '0');
          }
        } else {
          console.warn('Navigation button not found:', btnId);
        }
      }

      setupNavButton('userManagementBtn', '/admin-users');
      setupNavButton('packageManagementBtn', '/admin-packages');
      setupNavButton('homepageChangesBtn', '/admin-homepage');
      setupNavButton('supportTicketsBtn', '/admin-tickets');
      setupNavButton('paymentsAnalyticsBtn', '/admin-payments');
      setupNavButton('reportsQueueBtn', '/admin-reports');
      setupNavButton('auditLogBtn', '/admin-audit');
      setupNavButton('adminSettingsBtn', '/admin-settings');

      // Moderation queue buttons
      setupNavButton('reviewPhotosBtn', '/admin-photos');
      setupNavButton('reviewReportsBtn', '/admin-reports');
      setupNavButton('verifySuppliersBtn', '/admin-suppliers');

      const reviewReviewsBtn = document.getElementById('reviewReviewsBtn');
      if (reviewReviewsBtn) {
        reviewReviewsBtn.addEventListener('click', () => {
          reviewPendingReviews();
        });
        reviewReviewsBtn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            reviewPendingReviews();
          }
        });
        if (!reviewReviewsBtn.hasAttribute('tabindex')) {
          reviewReviewsBtn.setAttribute('tabindex', '0');
        }
      }

      const logoutBtn = document.getElementById('adminLogoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          // Wait for CSRF token to be available if not already set
          const performLogout = function () {
            api('/api/auth/logout', 'POST', {})
              .then(() => {
                // Clear any local storage
                try {
                  localStorage.clear();
                } catch (e) {
                  console.warn('Could not clear localStorage:', e);
                }
              })
              .catch(err => {
                console.error('Logout error:', err);
                // Still redirect even if logout fails
              })
              .finally(() => {
                window.location.href = '/';
              });
          };

          if (window.__CSRF_TOKEN__) {
            performLogout();
          } else {
            // Fetch token if not available, then logout
            api('/api/csrf-token', 'GET')
              .then(data => {
                if (data && data.csrfToken) {
                  window.__CSRF_TOKEN__ = data.csrfToken;
                }
              })
              .catch(err => {
                console.warn('Could not fetch CSRF token:', err);
              })
              .finally(() => {
                performLogout();
              });
          }
        });
      }

      // Fetch CSRF token for state-changing requests
      api('/api/csrf-token', 'GET')
        .then(data => {
          if (data && data.csrfToken) {
            window.__CSRF_TOKEN__ = data.csrfToken;
          }
        })
        .catch(() => {
          console.warn('Could not fetch CSRF token on page load');
        });
    });
  }

  // Call initialization immediately since this script is deferred
  // (DOMContentLoaded has already fired by the time deferred scripts execute)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAdmin);
  } else {
    initializeAdmin();
  }

  window.showCreateUserModal = function () {
    // Create modal content with form
    const content = document.createElement('div');
    content.innerHTML =
      '<div style="display: grid; gap: 1rem;">' +
      '<div><label style="display:block;margin-bottom:4px;font-weight:600;">Name *</label>' +
      '<input type="text" id="create-user-name" required style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-weight:600;">Email *</label>' +
      '<input type="email" id="create-user-email" required style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-weight:600;">Password *</label>' +
      '<input type="password" id="create-user-password" required style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;"></div>' +
      '<div><label style="display:block;margin-bottom:4px;font-weight:600;">Role</label>' +
      '<select id="create-user-role" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">' +
      '<option value="customer">Customer</option>' +
      '<option value="supplier">Supplier</option>' +
      '<option value="admin">Admin</option>' +
      '</select></div>' +
      '<p class="small" style="color:#52525b;margin:0;">Password must be at least 8 characters with uppercase, lowercase, and number.</p>' +
      '</div>';

    if (typeof Modal !== 'undefined') {
      const modal = new Modal({
        title: 'Create New User',
        content: content,
        confirmText: 'Create User',
        cancelText: 'Cancel',
        onConfirm: function () {
          const name = document.getElementById('create-user-name').value;
          const email = document.getElementById('create-user-email').value;
          const password = document.getElementById('create-user-password').value;
          const role = document.getElementById('create-user-role').value;

          if (!name || !email || !password) {
            if (typeof Toast !== 'undefined') {
              Toast.error('All fields are required');
            } else {
              _adminToast('All fields are required', 'error');
            }
            return;
          }

          api('/api/admin/users', 'POST', {
            name: name,
            email: email,
            password: password,
            role: role,
          })
            .then(() => {
              if (typeof Toast !== 'undefined') {
                Toast.success('User created successfully.');
              } else {
                _adminToast('User created successfully.', 'success');
              }
              // Close modal first, then reload data
              modal.hide();
              // Small delay to ensure modal is fully closed before reloading
              setTimeout(() => {
                loadAll();
              }, 100);
            })
            .catch(err => {
              console.error('createUser failed', err);
              if (typeof Toast !== 'undefined') {
                Toast.error(`Failed to create user: ${err.message}`);
              } else {
                _adminToast(`Failed to create user: ${err.message}`, 'error');
              }
            });
        },
      });
      modal.show();
    } else {
      // Fallback using AdminShared.showInputModal if available
      if (window.AdminShared && window.AdminShared.showInputModal) {
        window.AdminShared.showInputModal({
          title: 'Create New User - Step 1/3',
          message: 'Enter the name for the new user',
          label: 'Name',
          required: true,
        }).then(nameResult => {
          if (!nameResult.confirmed) {
            return;
          }

          return window.AdminShared.showInputModal({
            title: 'Create New User - Step 2/3',
            message: 'Enter the email for the new user',
            label: 'Email',
            required: true,
            validateFn: window.AdminShared.validateEmail,
          }).then(emailResult => {
            if (!emailResult.confirmed) {
              return;
            }

            return window.AdminShared.showInputModal({
              title: 'Create New User - Step 3/3',
              message: 'Enter password (min 8 chars with uppercase, lowercase, and number)',
              label: 'Password',
              required: true,
              validateFn: window.AdminShared.validatePassword,
            }).then(passwordResult => {
              if (!passwordResult.confirmed) {
                return;
              }

              return api('/api/admin/users', 'POST', {
                name: nameResult.value,
                email: emailResult.value,
                password: passwordResult.value,
                role: 'customer',
              })
                .then(() => {
                  if (window.AdminShared && window.AdminShared.showToast) {
                    window.AdminShared.showToast('User created successfully.', 'success');
                  } else {
                    _adminToast('User created successfully.', 'success');
                  }
                  loadAll();
                })
                .catch(err => {
                  console.error('createUser failed', err);
                  if (window.AdminShared && window.AdminShared.showToast) {
                    window.AdminShared.showToast(`Failed to create user: ${err.message}`, 'error');
                  } else {
                    _adminToast(`Failed to create user: ${err.message}`, 'error');
                  }
                });
            });
          });
        });
      } else {
        _adminToast(
          'User creation requires AdminShared utilities. Please reload the page.',
          'error'
        );
      }
    }
  };

  window.reviewPendingReviews = function () {
    api('/api/admin/reviews/pending')
      .then(data => {
        const reviews = (data.reviews || []).filter(r => !r.approved && !r.rejected);
        if (reviews.length === 0) {
          if (typeof Toast !== 'undefined') {
            Toast.info('No pending reviews to moderate.');
          } else {
            _adminToast('No pending reviews to moderate.', 'warning');
          }
          return;
        }

        const modal = document.createElement('div');
        modal.className = 'review-modal-overlay review-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Pending Reviews');
        modal.innerHTML =
          `<div class="review-modal-container">` +
          `<h2>Pending Reviews (${reviews.length})</h2>` +
          `<div id="review-list"></div>` +
          `<button data-action="closeReviewModal">Close</button>` +
          `</div>`;
        document.body.appendChild(modal);

        // Close on backdrop click
        modal.addEventListener('click', e => {
          if (e.target === modal) {
            modal.remove();
          }
        });

        // Close on Escape key
        function onKeyDown(e) {
          if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', onKeyDown);
          }
        }
        document.addEventListener('keydown', onKeyDown);

        const list = modal.querySelector('#review-list');
        reviews.forEach(r => {
          const item = document.createElement('div');
          item.className = 'review-modal-item';
          item.innerHTML =
            `<p><b>Rating:</b> ${escapeHtml(String(r.rating || 0))} stars</p>` +
            `<p><b>Comment:</b> ${escapeHtml(r.comment || '')}</p>` +
            `<p class="small"><b>Supplier ID:</b> ${escapeHtml(r.supplierId)}</p>` +
            `<p class="small"><b>Date:</b> ${escapeHtml(
              new Date(r.createdAt).toLocaleString()
            )}</p>` +
            `<button data-action="approveReview" data-id="${escapeHtml(
              r.id
            )}" data-param="true">Approve</button> ` +
            `<button data-action="approveReview" data-id="${escapeHtml(
              r.id
            )}" data-param="false">Reject</button>`;
          list.appendChild(item);
        });
      })
      .catch(err => {
        console.error('Failed to load reviews', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to load reviews');
        } else {
          _adminToast('Failed to load reviews', 'error');
        }
      });
  };

  window.approveReview = function (id, approved) {
    api(`/api/admin/reviews/${id}/approve`, 'POST', { approved: approved })
      .then(() => {
        if (typeof Toast !== 'undefined') {
          Toast.success(`Review ${approved ? 'approved' : 'rejected'}`);
        } else {
          _adminToast(`Review ${approved ? 'approved' : 'rejected'}`, 'success');
        }
        loadAll();
        closeReviewModal();
      })
      .catch(err => {
        console.error('Failed to moderate review', err);
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to moderate review');
        } else {
          _adminToast('Failed to moderate review', 'error');
        }
      });
  };

  window.closeReviewModal = function () {
    const modal = document.querySelector('.review-modal');
    if (modal) {
      modal.remove();
    }
  };

  // Event delegation for all dynamically created buttons
  document.body.addEventListener('click', e => {
    const target = e.target;
    if (target.tagName !== 'BUTTON') {
      return;
    }

    const action = target.getAttribute('data-action');
    if (!action) {
      return;
    }

    const id = target.getAttribute('data-id');
    const param = target.getAttribute('data-param');

    // Call the appropriate function based on the action
    switch (action) {
      case 'viewSupplier':
        if (id) {
          window.location.href = `/supplier?id=${id}`;
        }
        break;
      case 'viewPackage':
        if (id) {
          window.location.href = `/package?id=${id}`;
        }
        break;
      case 'editUser':
        if (window.editUser && id) {
          window.editUser(id);
        }
        break;
      case 'verifyUser':
        if (window.verifyUser && id) {
          window.verifyUser(id);
        }
        break;
      case 'revokeAdmin':
        if (window.revokeAdmin && id) {
          window.revokeAdmin(id);
        }
        break;
      case 'grantAdmin':
        if (window.grantAdmin && id) {
          window.grantAdmin(id);
        }
        break;
      case 'deleteUser':
        if (window.deleteUser && id) {
          window.deleteUser(id);
        }
        break;
      case 'editSupplier':
        if (window.editSupplier && id) {
          window.editSupplier(id);
        }
        break;
      case 'approveSup':
        if (window.approveSup && id) {
          window.approveSup(id);
        }
        break;
      case 'rejectSup':
        if (window.rejectSup && id) {
          window.rejectSup(id);
        }
        break;
      case 'deleteSupplier':
        if (window.deleteSupplier && id) {
          window.deleteSupplier(id);
        }
        break;
      case 'setProPlan':
        if (window.setProPlan && id && param) {
          window.setProPlan(id, param);
        }
        break;
      case 'editPackage':
        if (window.editPackage && id) {
          window.editPackage(id);
        }
        break;
      case 'approvePkg':
        if (window.approvePkg && id && param !== null) {
          window.approvePkg(id, param === 'true');
        }
        break;
      case 'featurePkg':
        if (window.featurePkg && id && param !== null) {
          window.featurePkg(id, param === 'true');
        }
        break;
      case 'deletePackage':
        if (window.deletePackage && id) {
          window.deletePackage(id);
        }
        break;
      case 'approveReview':
        if (window.approveReview && id && param !== null) {
          window.approveReview(id, param === 'true');
        }
        break;
      case 'closeReviewModal':
        if (window.closeReviewModal) {
          window.closeReviewModal();
        }
        break;
    }
  });

  // Bulk operation handlers
  function setupBulkOperations() {
    // Show/hide bulk buttons based on checkbox selection
    function updateBulkButtons(type) {
      const checkboxes = document.querySelectorAll(`.${type}-checkbox:checked`);
      const buttons = document.querySelectorAll(
        `#bulkApprove${type.charAt(0).toUpperCase() + type.slice(1)}s, #bulkReject${type.charAt(0).toUpperCase() + type.slice(1)}s, #bulkDelete${type.charAt(0).toUpperCase() + type.slice(1)}s, #bulkFeature${type.charAt(0).toUpperCase() + type.slice(1)}s`
      );

      buttons.forEach(btn => {
        if (checkboxes.length > 0) {
          btn.style.display = 'inline-block';
          const match = btn.id.match(/bulk\w+/);
          if (match) {
            const text = btn.textContent.replace(/\(.*?\)/, '').trim();
            btn.textContent = `${text} (${checkboxes.length})`;
          }
        } else {
          btn.style.display = 'none';
        }
      });
    }

    // Select all checkboxes
    document.getElementById('selectAllSuppliers')?.addEventListener('change', e => {
      document
        .querySelectorAll('.supplier-checkbox')
        .forEach(cb => (cb.checked = e.target.checked));
      updateBulkButtons('supplier');
    });

    document.getElementById('selectAllPackages')?.addEventListener('change', e => {
      document.querySelectorAll('.package-checkbox').forEach(cb => (cb.checked = e.target.checked));
      updateBulkButtons('package');
    });

    // Listen for individual checkbox changes
    document.addEventListener('change', e => {
      if (e.target.classList.contains('supplier-checkbox')) {
        updateBulkButtons('supplier');
      } else if (e.target.classList.contains('package-checkbox')) {
        updateBulkButtons('package');
      }
    });

    // Bulk approve suppliers
    document.getElementById('bulkApproveSuppliers')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.supplier-checkbox:checked')).map(
        cb => cb.dataset.id
      );
      if (!selected.length) {
        return;
      }

      if (!(await _adminConfirm(`Approve ${selected.length} supplier(s)?`))) {
        return;
      }

      try {
        await Promise.all(selected.map(id => api(`/api/admin/suppliers/${id}/approve`, 'POST')));
        if (typeof Toast !== 'undefined') {
          Toast.success(`Approved ${selected.length} supplier(s)`);
        } else {
          _adminToast(`Approved ${selected.length} supplier(s)`, 'success');
        }
        loadAll();
      } catch (err) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to approve suppliers');
        } else {
          _adminToast('Failed to approve suppliers', 'error');
        }
      }
    });

    // Bulk reject suppliers
    document.getElementById('bulkRejectSuppliers')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.supplier-checkbox:checked')).map(
        cb => cb.dataset.id
      );
      if (!selected.length) {
        return;
      }

      if (!(await _adminConfirm(`Reject ${selected.length} supplier(s)?`))) {
        return;
      }

      try {
        await Promise.all(selected.map(id => api(`/api/admin/suppliers/${id}/reject`, 'POST')));
        if (typeof Toast !== 'undefined') {
          Toast.success(`Rejected ${selected.length} supplier(s)`);
        } else {
          _adminToast(`Rejected ${selected.length} supplier(s)`, 'success');
        }
        loadAll();
      } catch (err) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to reject suppliers');
        } else {
          _adminToast('Failed to reject suppliers', 'error');
        }
      }
    });

    // Bulk delete suppliers
    document.getElementById('bulkDeleteSuppliers')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.supplier-checkbox:checked')).map(
        cb => cb.dataset.id
      );
      if (!selected.length) {
        return;
      }

      if (!(await _adminConfirm(`DELETE ${selected.length} supplier(s)? This cannot be undone.`))) {
        return;
      }

      try {
        await Promise.all(selected.map(id => api(`/api/admin/suppliers/${id}`, 'DELETE')));
        if (typeof Toast !== 'undefined') {
          Toast.success(`Deleted ${selected.length} supplier(s)`);
        } else {
          _adminToast(`Deleted ${selected.length} supplier(s)`, 'success');
        }
        loadAll();
      } catch (err) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to delete suppliers');
        } else {
          _adminToast('Failed to delete suppliers', 'error');
        }
      }
    });

    // Bulk approve packages
    document.getElementById('bulkApprovePackages')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.package-checkbox:checked')).map(
        cb => cb.dataset.id
      );
      if (!selected.length) {
        return;
      }

      if (!(await _adminConfirm(`Approve ${selected.length} package(s)?`))) {
        return;
      }

      try {
        await Promise.all(
          selected.map(id => api(`/api/admin/packages/${id}/approve`, 'POST', { approved: true }))
        );
        if (typeof Toast !== 'undefined') {
          Toast.success(`Approved ${selected.length} package(s)`);
        } else {
          _adminToast(`Approved ${selected.length} package(s)`, 'success');
        }
        loadAll();
      } catch (err) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to approve packages');
        } else {
          _adminToast('Failed to approve packages', 'error');
        }
      }
    });

    // Bulk feature packages
    document.getElementById('bulkFeaturePackages')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.package-checkbox:checked')).map(
        cb => cb.dataset.id
      );
      if (!selected.length) {
        return;
      }

      if (!(await _adminConfirm(`Feature ${selected.length} package(s)?`))) {
        return;
      }

      try {
        await Promise.all(
          selected.map(id => api(`/api/admin/packages/${id}/feature`, 'POST', { featured: true }))
        );
        if (typeof Toast !== 'undefined') {
          Toast.success(`Featured ${selected.length} package(s)`);
        } else {
          _adminToast(`Featured ${selected.length} package(s)`, 'success');
        }
        loadAll();
      } catch (err) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to feature packages');
        } else {
          _adminToast('Failed to feature packages', 'error');
        }
      }
    });

    // Bulk delete packages
    document.getElementById('bulkDeletePackages')?.addEventListener('click', async () => {
      const selected = Array.from(document.querySelectorAll('.package-checkbox:checked')).map(
        cb => cb.dataset.id
      );
      if (!selected.length) {
        return;
      }

      if (!(await _adminConfirm(`DELETE ${selected.length} package(s)? This cannot be undone.`))) {
        return;
      }

      try {
        await Promise.all(selected.map(id => api(`/api/admin/packages/${id}`, 'DELETE')));
        if (typeof Toast !== 'undefined') {
          Toast.success(`Deleted ${selected.length} package(s)`);
        } else {
          _adminToast(`Deleted ${selected.length} package(s)`, 'success');
        }
        loadAll();
      } catch (err) {
        if (typeof Toast !== 'undefined') {
          Toast.error('Failed to delete packages');
        } else {
          _adminToast('Failed to delete packages', 'error');
        }
      }
    });
  }

  // Initialize bulk operations
  setupBulkOperations();
})();
