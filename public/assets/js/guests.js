/**
 * EventFlow Guest List Manager
 * Manages event guests, RSVPs, dietary requirements, and table assignments
 * Data is persisted server-side via /api/me/plans/:planId/guests
 */

// Guest Manager
class GuestManager {
  constructor() {
    this.guests = [];
    this.planId = null;
    this.chart = null;
    this.init();
  }

  async init() {
    // Resolve planId before doing anything else
    const resolved = await this.resolvePlanId();
    if (!resolved) {
      return;
    }
    await this.loadFromServer();
    this.setupEventListeners();
    this.render();
  }

  async getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    try {
      const r = await fetch('/api/csrf-token', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const t = d.csrfToken || d.token || '';
        if (t) {
          window.__CSRF_TOKEN__ = t;
        }
        return t;
      }
    } catch (_) {
      /* ignore */
    }
    const m = document.cookie.match(/(?:^|;\s*)(?:csrf|csrfToken)=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async resolvePlanId() {
    const container = document.getElementById('guests-list');
    try {
      const r = await fetch('/api/me/plans', { credentials: 'include' });
      if (!r.ok) {
        if (container) {
          container.innerHTML =
            '<div style="text-align:center;padding:3rem;color:#9ca3af;">Please <a href="/auth">sign in</a> to manage guests.</div>';
        }
        return false;
      }
      const d = await r.json();
      const plans = d.plans || [];
      if (plans.length === 0) {
        if (container) {
          container.innerHTML =
            '<div style="text-align:center;padding:3rem;color:#9ca3af;">No event plans found. <a href="/start">Create a plan</a> first.</div>';
        }
        return false;
      }
      if (plans.length === 1) {
        this.planId = plans[0].id;
        this.showPlanLabel(plans[0]);
        return true;
      }
      // Multiple plans — show selector
      this.planId = await this.showPlanSelector(plans);
      return !!this.planId;
    } catch (err) {
      console.error('Failed to resolve planId:', err);
      if (container) {
        container.innerHTML =
          '<div style="text-align:center;padding:3rem;color:#9ca3af;">Unable to load plans. Please refresh.</div>';
      }
      return false;
    }
  }

  showPlanLabel(plan) {
    const label = document.getElementById('active-plan-label');
    if (label) {
      label.textContent = `Showing guests for: ${plan.name || plan.eventType || 'Your Plan'}`;
      label.style.display = 'block';
    }
  }

  showPlanSelector(plans) {
    return new Promise(resolve => {
      const container = document.getElementById('guests-list');
      const wrapper = document.createElement('div');
      wrapper.className = 'guests-empty-state';
      wrapper.innerHTML = `
        <p style="margin-bottom:1rem;font-weight:600;">Select a plan to manage guests for:</p>
        <select id="plan-selector" class="focus-ring" style="padding:0.5rem 1rem;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:1rem;">
          <option value="">— Choose a plan —</option>
          ${plans.map(p => `<option value="${this.escapeHtml(p.id)}">${this.escapeHtml(p.name || p.eventType || 'Untitled Plan')}</option>`).join('')}
        </select><br>
        <button id="confirm-plan-btn" class="cta" style="margin-top:0.5rem;">Continue</button>
      `;
      if (container) {
        container.innerHTML = '';
        container.appendChild(wrapper);
      }
      document.getElementById('confirm-plan-btn').addEventListener('click', () => {
        const sel = document.getElementById('plan-selector');
        const selectedId = sel ? sel.value : '';
        if (!selectedId) {
          return;
        }
        const plan = plans.find(p => p.id === selectedId);
        this.planId = selectedId;
        if (plan) {
          this.showPlanLabel(plan);
        }
        if (container) {
          container.innerHTML = '';
        }
        resolve(selectedId);
      });
    });
  }

  async loadFromServer() {
    if (!this.planId) {
      return;
    }
    try {
      const r = await fetch(`/api/me/plans/${encodeURIComponent(this.planId)}/guests`, {
        credentials: 'include',
      });
      if (!r.ok) {
        console.error('Failed to load guests from server');
        return;
      }
      const d = await r.json();
      this.guests = (d.guests || []).map(g => this.normalizeGuest(g));
    } catch (err) {
      console.error('Error loading guests:', err);
    }
  }

  /**
   * Normalise a server guest record into the shape the UI expects:
   * firstName/lastName split from name, rsvp from rsvpStatus, plusOne as string.
   */
  normalizeGuest(g) {
    const parts = (g.name || '').trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    return {
      id: g.id,
      firstName,
      lastName,
      email: g.email || '',
      phone: g.phone || '',
      rsvp: g.rsvpStatus || 'pending',
      plusOne: g.plusOne ? 'yes' : 'no',
      dietary: g.dietary || '',
      table: g.table || '',
      notes: g.notes || '',
      createdAt: g.createdAt,
    };
  }

  setupEventListeners() {
    // Add guest button
    document.getElementById('add-guest').addEventListener('click', () => {
      this.showAddGuestModal();
    });

    // Import guests button
    document.getElementById('import-guests').addEventListener('click', () => {
      this.showImportModal();
    });

    // Export guests button
    document.getElementById('export-guests').addEventListener('click', () => {
      this.exportGuests();
    });

    // Search and filter
    document.getElementById('search-guests').addEventListener('input', () => {
      this.renderGuestsList();
    });

    document.getElementById('filter-rsvp').addEventListener('change', () => {
      this.renderGuestsList();
    });
  }

  showAddGuestModal(guest = null) {
    const isEdit = guest !== null;
    const content = document.createElement('div');

    content.innerHTML = `
      <div class="form-row grid grid-cols-2 gap-4">
        <div>
          <label for="guest-firstname">First Name *</label>
          <input type="text" id="guest-firstname" class="focus-ring" value="${guest ? this.escapeHtml(guest.firstName) : ''}" placeholder="John" required>
        </div>
        <div>
          <label for="guest-lastname">Last Name *</label>
          <input type="text" id="guest-lastname" class="focus-ring" value="${guest ? this.escapeHtml(guest.lastName) : ''}" placeholder="Smith" required>
        </div>
      </div>

      <div class="form-row">
        <label for="guest-email">Email</label>
        <input type="email" id="guest-email" class="focus-ring" value="${guest ? this.escapeHtml(guest.email) : ''}" placeholder="john.smith@example.com">
      </div>

      <div class="form-row">
        <label for="guest-phone">Phone</label>
        <input type="tel" id="guest-phone" class="focus-ring" value="${guest ? this.escapeHtml(guest.phone) : ''}" placeholder="+44 7700 900000">
      </div>

      <div class="form-row grid grid-cols-2 gap-4">
        <div>
          <label for="guest-rsvp">RSVP Status</label>
          <select id="guest-rsvp" class="focus-ring">
            <option value="pending" ${!guest || guest.rsvp === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="attending" ${guest && guest.rsvp === 'attending' ? 'selected' : ''}>Attending</option>
            <option value="declined" ${guest && guest.rsvp === 'declined' ? 'selected' : ''}>Declined</option>
          </select>
        </div>
        <div>
          <label for="guest-plusone">Plus One</label>
          <select id="guest-plusone" class="focus-ring">
            <option value="no" ${!guest || guest.plusOne === 'no' ? 'selected' : ''}>No</option>
            <option value="yes" ${guest && guest.plusOne === 'yes' ? 'selected' : ''}>Yes</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <label for="guest-dietary">Dietary Requirements</label>
        <input type="text" id="guest-dietary" class="focus-ring" value="${guest ? this.escapeHtml(guest.dietary) : ''}" placeholder="e.g. Vegetarian, Gluten-free, None">
      </div>

      <div class="form-row">
        <label for="guest-table">Table Assignment</label>
        <input type="text" id="guest-table" class="focus-ring" value="${guest ? this.escapeHtml(guest.table) : ''}" placeholder="e.g. Table 1, Family Table">
      </div>

      <div class="form-row">
        <label for="guest-notes">Notes</label>
        <textarea id="guest-notes" class="focus-ring" rows="2" placeholder="Additional information...">${guest ? this.escapeHtml(guest.notes) : ''}</textarea>
      </div>
    `;

    const modal = new Modal({
      title: isEdit ? 'Edit Guest' : 'Add Guest',
      content: content,
      confirmText: isEdit ? 'Update' : 'Add Guest',
      onConfirm: async () => {
        const firstName = document.getElementById('guest-firstname').value.trim();
        const lastName = document.getElementById('guest-lastname').value.trim();
        const email = document.getElementById('guest-email').value.trim();
        const phone = document.getElementById('guest-phone').value.trim();
        const rsvp = document.getElementById('guest-rsvp').value;
        const plusOne = document.getElementById('guest-plusone').value;
        const dietary = document.getElementById('guest-dietary').value.trim();
        const table = document.getElementById('guest-table').value.trim();
        const notes = document.getElementById('guest-notes').value.trim();

        if (!firstName || !lastName) {
          window.NotificationDispatcher.error('Please enter first and last name');
          return;
        }

        const payload = {
          name: `${firstName} ${lastName}`,
          email: email || null,
          phone: phone || null,
          rsvpStatus: rsvp,
          plusOne: plusOne === 'yes' ? 1 : 0,
          dietary: dietary || null,
          table: table || null,
          notes: notes || null,
        };

        try {
          const csrfToken = await this.getCsrfToken();
          if (isEdit) {
            const r = await fetch(
              `/api/me/plans/${encodeURIComponent(this.planId)}/guests/${encodeURIComponent(guest.id)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                credentials: 'include',
                body: JSON.stringify(payload),
              }
            );
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              throw new Error(d.error || 'Failed to update guest');
            }
            const d = await r.json();
            const idx = this.guests.findIndex(g => g.id === guest.id);
            if (idx !== -1) {
              this.guests[idx] = this.normalizeGuest(d.guest);
            }
            window.NotificationDispatcher.success('Guest updated');
          } else {
            const r = await fetch(`/api/me/plans/${encodeURIComponent(this.planId)}/guests`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
              credentials: 'include',
              body: JSON.stringify(payload),
            });
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              throw new Error(d.error || 'Failed to add guest');
            }
            const d = await r.json();
            this.guests.push(this.normalizeGuest(d.guest));
            window.NotificationDispatcher.success('Guest added');
          }
          this.render();
        } catch (err) {
          console.error('Guest save error:', err);
          window.NotificationDispatcher.error(err.message || 'Failed to save guest');
        }
      },
    });

    modal.show();
    setTimeout(() => document.getElementById('guest-firstname').focus(), 100);
  }

  deleteGuest(id) {
    const guest = this.guests.find(g => g.id === id);
    if (!guest) {
      return;
    }

    const modal = new Modal({
      title: 'Delete Guest',
      content: `<p>Are you sure you want to remove ${this.escapeHtml(guest.firstName)} ${this.escapeHtml(guest.lastName)} from the guest list?</p>`,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          const csrfToken = await this.getCsrfToken();
          const r = await fetch(
            `/api/me/plans/${encodeURIComponent(this.planId)}/guests/${encodeURIComponent(id)}`,
            {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
              credentials: 'include',
            }
          );
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.error || 'Failed to delete guest');
          }
          this.guests = this.guests.filter(g => g.id !== id);
          this.render();
          window.NotificationDispatcher.success('Guest removed');
        } catch (err) {
          console.error('Guest delete error:', err);
          window.NotificationDispatcher.error(err.message || 'Failed to remove guest');
        }
      },
    });

    modal.show();
  }

  showImportModal() {
    const content = document.createElement('div');
    content.innerHTML = `
      <p class="small mb-4">Upload a CSV file with columns: FirstName, LastName, Email, Phone, RSVP, PlusOne, Dietary, Table, Notes</p>
      <div class="form-row">
        <input type="file" id="csv-file" accept=".csv" class="focus-ring">
      </div>
      <div class="small mt-2" style="color: var(--muted);">
        Example format:<br>
        FirstName,LastName,Email,Phone,RSVP,PlusOne,Dietary,Table,Notes<br>
        John,Smith,john@example.com,+441234567890,attending,yes,Vegetarian,Table 1,""
      </div>
    `;

    const modal = new Modal({
      title: 'Import Guests from CSV',
      content: content,
      confirmText: 'Import',
      onConfirm: () => {
        const fileInput = document.getElementById('csv-file');
        const file = fileInput.files[0];

        if (!file) {
          window.NotificationDispatcher.error('Please select a CSV file');
          return;
        }

        const reader = new FileReader();
        reader.addEventListener('load', async e => {
          try {
            const csv = e.target.result;
            const parsed = this.parseCSV(csv);
            let added = 0;
            const csrfToken = await this.getCsrfToken();
            for (const g of parsed) {
              try {
                const r = await fetch(`/api/me/plans/${encodeURIComponent(this.planId)}/guests`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                  credentials: 'include',
                  body: JSON.stringify({
                    name: `${g.firstName} ${g.lastName}`,
                    email: g.email || null,
                    phone: g.phone || null,
                    rsvpStatus: g.rsvp || 'pending',
                    plusOne: g.plusOne === 'yes' ? 1 : 0,
                    dietary: g.dietary || null,
                    table: g.table || null,
                    notes: g.notes || null,
                  }),
                });
                if (r.ok) {
                  const d = await r.json();
                  this.guests.push(this.normalizeGuest(d.guest));
                  added++;
                }
              } catch (_) {
                /* skip failed row */
              }
            }
            this.render();
            window.NotificationDispatcher.success(`Imported ${added} guests`);
          } catch (error) {
            window.NotificationDispatcher.error('Failed to parse CSV file');
            console.error(error);
          }
        });
        reader.readAsText(file);
      },
    });

    modal.show();
  }

  parseCSV(csv) {
    const lines = csv.trim().split('\n');
    const guests = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const guest = {
        firstName: values[0] || '',
        lastName: values[1] || '',
        email: values[2] || '',
        phone: values[3] || '',
        rsvp: values[4] || 'pending',
        plusOne: values[5] || 'no',
        dietary: values[6] || '',
        table: values[7] || '',
        notes: values[8] || '',
      };

      if (guest.firstName && guest.lastName) {
        guests.push(guest);
      }
    }

    return guests;
  }

  exportGuests() {
    if (this.guests.length === 0) {
      window.NotificationDispatcher.warning('No guests to export');
      return;
    }

    const csv = this.generateCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eventflow-guests-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    window.NotificationDispatcher.success('Guest list exported successfully');
  }

  generateCSV() {
    const headers = [
      'FirstName',
      'LastName',
      'Email',
      'Phone',
      'RSVP',
      'PlusOne',
      'Dietary',
      'Table',
      'Notes',
    ];
    const rows = this.guests.map(g => [
      g.firstName,
      g.lastName,
      g.email || '',
      g.phone || '',
      g.rsvp,
      g.plusOne,
      g.dietary || '',
      g.table || '',
      g.notes || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  render() {
    this.renderOverview();
    this.renderRSVPChart();
    this.renderDietaryRequirements();
    this.renderGuestsList();
  }

  renderOverview() {
    const total = this.guests.length;
    const attending = this.guests.filter(g => g.rsvp === 'attending').length;
    const declined = this.guests.filter(g => g.rsvp === 'declined').length;
    const pending = this.guests.filter(g => g.rsvp === 'pending').length;

    // Include plus ones in count
    const attendingWithPlusOnes = this.guests.filter(
      g => g.rsvp === 'attending' && g.plusOne === 'yes'
    ).length;

    document.getElementById('total-guests').textContent = total;
    document.getElementById('attending-count').textContent = attending + attendingWithPlusOnes;
    document.getElementById('declined-count').textContent = declined;
    document.getElementById('pending-count').textContent = pending;

    // Animate counters
    this.animateCounters();
  }

  animateCounters() {
    // Only animate if Counter class is available
    if (typeof Counter !== 'function') {
      return;
    }

    const counters = ['total-guests', 'attending-count', 'declined-count', 'pending-count'];
    counters.forEach(id => {
      const el = document.getElementById(id);
      const target = parseInt(el.textContent);
      if (target > 0 && !el.dataset.animated) {
        el.dataset.animated = 'true';
        const counter = new Counter(el, { target, duration: 1000 });
        counter.animate();
      }
    });
  }

  renderRSVPChart() {
    const attending = this.guests.filter(g => g.rsvp === 'attending').length;
    const declined = this.guests.filter(g => g.rsvp === 'declined').length;
    const pending = this.guests.filter(g => g.rsvp === 'pending').length;

    if (this.guests.length === 0) {
      document.getElementById('rsvp-empty').style.display = 'block';
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
      return;
    }

    document.getElementById('rsvp-empty').style.display = 'none';

    const ctx = document.getElementById('rsvp-chart');

    if (this.chart) {
      this.chart.destroy();
    }

    // Always use light theme colors
    const isDark = false;

    this.chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Attending', 'Declined', 'Pending'],
        datasets: [
          {
            data: [attending, declined, pending],
            backgroundColor: ['#10B981', '#EF4444', '#F59E0B'],
            borderWidth: 2,
            borderColor: isDark ? '#020617' : '#fff',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: isDark ? '#E5E7EB' : '#0B1220',
              padding: 15,
              font: {
                size: 13,
              },
            },
          },
          tooltip: {
            callbacks: {
              label: context => {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return `${label}: ${value} (${percentage}%)`;
              },
            },
          },
        },
      },
    });
  }

  renderDietaryRequirements() {
    const dietary = {};

    this.guests.forEach(guest => {
      if (guest.dietary && guest.rsvp === 'attending') {
        const reqs = guest.dietary
          .split(',')
          .map(r => r.trim())
          .filter(r => r);
        reqs.forEach(req => {
          dietary[req] = (dietary[req] || 0) + 1;
        });
      }
    });

    const entries = Object.entries(dietary);

    if (entries.length === 0) {
      document.getElementById('dietary-list').innerHTML = `
        <div style="text-align: center; color: var(--muted); padding: 2rem;">
          <div class="small">No dietary requirements recorded</div>
        </div>
      `;
      return;
    }

    const html = entries
      .map(([req, count]) => {
        return `
        <div class="flex items-center justify-between mb-3 pb-3" style="border-bottom: 1px solid var(--border);">
          <div>
            <div class="font-medium">${this.escapeHtml(req)}</div>
            <div class="small" style="color: var(--muted);">${count} guest${count !== 1 ? 's' : ''}</div>
          </div>
          <div class="badge">${count}</div>
        </div>
      `;
      })
      .join('');

    document.getElementById('dietary-list').innerHTML = html;
  }

  renderGuestsList() {
    const searchTerm = document.getElementById('search-guests').value.toLowerCase();
    const rsvpFilter = document.getElementById('filter-rsvp').value;

    let guests = [...this.guests];

    // Apply filters
    if (searchTerm) {
      guests = guests.filter(
        g =>
          g.firstName.toLowerCase().includes(searchTerm) ||
          g.lastName.toLowerCase().includes(searchTerm) ||
          (g.email && g.email.toLowerCase().includes(searchTerm))
      );
    }

    if (rsvpFilter) {
      guests = guests.filter(g => g.rsvp === rsvpFilter);
    }

    // Sort by last name
    guests.sort((a, b) => a.lastName.localeCompare(b.lastName));

    if (guests.length === 0) {
      document.getElementById('guests-list').innerHTML = `
        <div style="text-align: center; color: var(--muted); padding: 3rem;">
          <div style="font-size: 2rem; margin-bottom: 1rem;">🔍</div>
          <div class="small">No guests found</div>
        </div>
      `;
      return;
    }

    const html = `
      <div role="region" aria-label="Scrollable guest list" tabindex="0" style="overflow-x:auto;">
      <table aria-label="Guest list" style="width: 100%; border-collapse: collapse; min-width:600px;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border);">
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Name</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Contact</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">RSVP</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Plus One</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Dietary</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Table</th>
            <th style="text-align: right; padding: 0.75rem; font-weight: 600;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${guests
            .map(guest => {
              const rsvpColors = {
                attending: { bg: '#D1FAE5', text: '#065F46' },
                declined: { bg: '#FEE2E2', text: '#991B1B' },
                pending: { bg: '#FEF3C7', text: '#92400E' },
              };
              const color = rsvpColors[guest.rsvp] || rsvpColors.pending;

              return `
              <tr style="border-bottom: 1px solid var(--border);" class="hover-lift">
                <td style="padding: 1rem;">
                  <div class="font-medium">${this.escapeHtml(guest.firstName)} ${this.escapeHtml(guest.lastName)}</div>
                </td>
                <td style="padding: 1rem;">
                  ${guest.email ? `<div class="small">${this.escapeHtml(guest.email)}</div>` : ''}
                  ${guest.phone ? `<div class="small" style="color: var(--muted);">${this.escapeHtml(guest.phone)}</div>` : ''}
                  ${!guest.email && !guest.phone ? '<span class="small" style="color: var(--muted);">—</span>' : ''}
                </td>
                <td style="padding: 1rem;">
                  <span class="badge" style="background: ${color.bg}; color: ${color.text}; text-transform: capitalize;">
                    ${guest.rsvp}
                  </span>
                </td>
                <td style="padding: 1rem;">
                  <span class="small">${guest.plusOne === 'yes' ? '✓ Yes (+1)' : '—'}</span>
                </td>
                <td style="padding: 1rem;">
                  <span class="small">${guest.dietary ? this.escapeHtml(guest.dietary) : '—'}</span>
                </td>
                <td style="padding: 1rem;">
                  <span class="small">${guest.table ? this.escapeHtml(guest.table) : '—'}</span>
                </td>
                <td style="padding: 1rem; text-align: right;">
                  <button class="cta ghost" style="padding: 0.5rem; font-size: 0.875rem;" onclick="guestManager.showAddGuestModal(guestManager.guests.find(g => g.id === '${guest.id}'))">
                    Edit
                  </button>
                  <button class="cta ghost" style="padding: 0.5rem; font-size: 0.875rem; color: #EF4444;" onclick="guestManager.deleteGuest('${guest.id}')">
                    Delete
                  </button>
                </td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
      </div>
    `;

    document.getElementById('guests-list').innerHTML = html;
  }

  escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
      return '';
    }
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// Initialize guest manager
// eslint-disable-next-line no-unused-vars
let guestManager;

document.addEventListener('DOMContentLoaded', () => {
  guestManager = new GuestManager();
});
