/**
 * EventFlow Budget Tracker
 * Manages event budget, expenses, and financial tracking
 */

// Budget Manager
class BudgetManager {
  constructor() {
    this.storageKey = 'ef_budget';
    this.budget = {
      total: 0,
      expenses: [],
      categories: [
        'Venue',
        'Catering',
        'Photography',
        'Entertainment',
        'Decor',
        'Transport',
        'Attire',
        'Other',
      ],
    };
    this.chart = null;
    this.loadFromStorage();
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.render();
  }

  setupEventListeners() {
    // Set budget button
    document.getElementById('set-budget').addEventListener('click', () => {
      this.showSetBudgetModal();
    });

    // Add expense button
    document.getElementById('add-expense').addEventListener('click', () => {
      this.showAddExpenseModal();
    });

    // Export budget button
    document.getElementById('export-budget').addEventListener('click', () => {
      this.exportBudget();
    });

    // Filter listeners
    document.getElementById('filter-category').addEventListener('change', () => {
      this.renderExpensesList();
    });

    document.getElementById('filter-status').addEventListener('change', () => {
      this.renderExpensesList();
    });
  }

  showSetBudgetModal() {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-row">
        <label for="budget-amount">Total Budget (£)</label>
        <input type="number" id="budget-amount" class="focus-ring" value="${this.budget.total}" min="0" step="100" placeholder="e.g. 15000">
      </div>
    `;

    const modal = new Modal({
      title: 'Set Total Budget',
      content: content,
      confirmText: 'Save Budget',
      onConfirm: () => {
        const amount = parseFloat(document.getElementById('budget-amount').value) || 0;
        this.budget.total = amount;
        this.saveToStorage();
        this.render();
        Toast.success(`Budget set to £${amount.toLocaleString()}`);
      },
    });

    modal.show();
    setTimeout(() => document.getElementById('budget-amount').focus(), 100);
  }

  showAddExpenseModal(expense = null) {
    const isEdit = expense !== null;
    const content = document.createElement('div');

    content.innerHTML = `
      <div class="form-row">
        <label for="expense-name">Expense Name *</label>
        <input type="text" id="expense-name" class="focus-ring" value="${expense ? this.escapeHtml(expense.name) : ''}" placeholder="e.g. Wedding Venue Deposit" required>
      </div>

      <div class="form-row grid grid-cols-2 gap-4">
        <div>
          <label for="expense-category">Category *</label>
          <select id="expense-category" class="focus-ring" required>
            ${this.budget.categories
              .map(
                cat =>
                  `<option value="${cat}" ${expense && expense.category === cat ? 'selected' : ''}>${cat}</option>`
              )
              .join('')}
          </select>
        </div>
        <div>
          <label for="expense-amount">Amount (£) *</label>
          <input type="number" id="expense-amount" class="focus-ring" value="${expense ? expense.amount : ''}" min="0" step="0.01" placeholder="0.00" required>
        </div>
      </div>

      <div class="form-row grid grid-cols-2 gap-4">
        <div>
          <label for="expense-status">Payment Status</label>
          <select id="expense-status" class="focus-ring">
            <option value="paid" ${expense && expense.status === 'paid' ? 'selected' : ''}>Paid</option>
            <option value="pending" ${expense && expense.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="overdue" ${expense && expense.status === 'overdue' ? 'selected' : ''}>Overdue</option>
          </select>
        </div>
        <div>
          <label for="expense-date">Date</label>
          <input type="date" id="expense-date" class="focus-ring" value="${expense ? expense.date : new Date().toISOString().split('T')[0]}">
        </div>
      </div>

      <div class="form-row">
        <label for="expense-vendor">Vendor/Supplier</label>
        <input type="text" id="expense-vendor" class="focus-ring" value="${expense ? this.escapeHtml(expense.vendor) : ''}" placeholder="Optional">
      </div>

      <div class="form-row">
        <label for="expense-notes">Notes</label>
        <textarea id="expense-notes" class="focus-ring" rows="3" placeholder="Additional details...">${expense ? this.escapeHtml(expense.notes) : ''}</textarea>
      </div>
    `;

    const modal = new Modal({
      title: isEdit ? 'Edit Expense' : 'Add Expense',
      content: content,
      confirmText: isEdit ? 'Update' : 'Add Expense',
      onConfirm: () => {
        const name = document.getElementById('expense-name').value.trim();
        const category = document.getElementById('expense-category').value;
        const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
        const status = document.getElementById('expense-status').value;
        const date = document.getElementById('expense-date').value;
        const vendor = document.getElementById('expense-vendor').value.trim();
        const notes = document.getElementById('expense-notes').value.trim();

        if (!name || amount <= 0) {
          Toast.error('Please fill in required fields');
          return;
        }

        if (isEdit) {
          Object.assign(expense, { name, category, amount, status, date, vendor, notes });
          Toast.success('Expense updated');
        } else {
          this.budget.expenses.push({
            id: this.generateId(),
            name,
            category,
            amount,
            status,
            date,
            vendor,
            notes,
            createdAt: Date.now(),
          });
          Toast.success('Expense added');

          // Show confetti if this is a significant expense (only if confetti is available)
          if (amount > 1000 && typeof confetti === 'function') {
            confetti({ particleCount: 50, spread: 60 });
          }
        }

        this.saveToStorage();
        this.render();
      },
    });

    modal.show();
    setTimeout(() => document.getElementById('expense-name').focus(), 100);
  }

  deleteExpense(id) {
    const expense = this.budget.expenses.find(e => e.id === id);
    if (!expense) {
      return;
    }

    const modal = new Modal({
      title: 'Delete Expense',
      content: `<p>Are you sure you want to delete "${this.escapeHtml(expense.name)}"?</p>`,
      confirmText: 'Delete',
      onConfirm: () => {
        this.budget.expenses = this.budget.expenses.filter(e => e.id !== id);
        this.saveToStorage();
        this.render();
        Toast.success('Expense deleted');
      },
    });

    modal.show();
  }

  render() {
    this.renderOverview();
    this.renderChart();
    this.renderCategoryBreakdown();
    this.renderExpensesList();
  }

  renderOverview() {
    const totalSpent = this.budget.expenses.reduce((sum, e) => sum + e.amount, 0);
    const remaining = this.budget.total - totalSpent;
    const percentage = this.budget.total > 0 ? (totalSpent / this.budget.total) * 100 : 0;

    document.getElementById('total-budget').textContent = `£${this.budget.total.toLocaleString()}`;
    document.getElementById('total-spent').textContent = `£${totalSpent.toLocaleString()}`;
    document.getElementById('budget-remaining').textContent = `£${remaining.toLocaleString()}`;
    document.getElementById('spent-percentage').textContent = `${percentage.toFixed(1)}% of budget`;
    document.getElementById('spent-progress').style.width = `${Math.min(percentage, 100)}%`;

    // Status indicator
    const statusEl = document.getElementById('remaining-status');
    if (remaining < 0) {
      statusEl.textContent = '⚠️ Over budget';
      statusEl.style.color = '#EF4444';
    } else if (percentage > 90) {
      statusEl.textContent = '⚠️ Nearly spent';
      statusEl.style.color = '#F59E0B';
    } else {
      statusEl.textContent = '✓ On track';
      statusEl.style.color = '#10B981';
    }
  }

  renderChart() {
    const categoryTotals = {};
    this.budget.categories.forEach(cat => (categoryTotals[cat] = 0));

    this.budget.expenses.forEach(expense => {
      categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
    });

    const data = Object.entries(categoryTotals).filter(([_, amount]) => amount > 0);

    if (data.length === 0) {
      document.getElementById('chart-empty').style.display = 'block';
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
      return;
    }

    document.getElementById('chart-empty').style.display = 'none';

    const ctx = document.getElementById('budget-chart');

    if (this.chart) {
      this.chart.destroy();
    }

    // Always use light theme colors
    const isDark = false;

    this.chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(([cat]) => cat),
        datasets: [
          {
            data: data.map(([_, amount]) => amount),
            backgroundColor: [
              '#0B8073',
              '#13B6A2',
              '#5EEAD4',
              '#9be7d9',
              '#10B981',
              '#F59E0B',
              '#EF4444',
              '#9CA3AF',
            ],
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
            position: 'right',
            labels: {
              color: isDark ? '#E5E7EB' : '#0B1220',
              padding: 15,
              font: {
                size: 12,
              },
            },
          },
          tooltip: {
            callbacks: {
              label: context => {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: £${value.toLocaleString()} (${percentage}%)`;
              },
            },
          },
        },
      },
    });
  }

  renderCategoryBreakdown() {
    const categoryTotals = {};
    this.budget.categories.forEach(cat => (categoryTotals[cat] = 0));

    this.budget.expenses.forEach(expense => {
      categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
    });

    const total = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);
    const data = Object.entries(categoryTotals).filter(([_, amount]) => amount > 0);

    if (data.length === 0) {
      document.getElementById('category-list').innerHTML = `
        <div style="text-align: center; color: var(--muted); padding: 2rem;">
          <div class="small">Add expenses to see breakdown</div>
        </div>
      `;
      return;
    }

    const html = data
      .map(([category, amount]) => {
        const percentage = total > 0 ? (amount / total) * 100 : 0;
        return `
        <div class="mb-4">
          <div class="flex items-center justify-between mb-2">
            <span class="font-medium">${category}</span>
            <span class="font-semibold">£${amount.toLocaleString()}</span>
          </div>
          <div class="progress">
            <div class="progress-bar" style="width: ${percentage}%"></div>
          </div>
          <div class="small mt-1" style="color: var(--muted);">${percentage.toFixed(1)}% of total</div>
        </div>
      `;
      })
      .join('');

    document.getElementById('category-list').innerHTML = html;
  }

  renderExpensesList() {
    const categoryFilter = document.getElementById('filter-category').value;
    const statusFilter = document.getElementById('filter-status').value;

    let expenses = [...this.budget.expenses];

    if (categoryFilter) {
      expenses = expenses.filter(e => e.category === categoryFilter);
    }

    if (statusFilter) {
      expenses = expenses.filter(e => e.status === statusFilter);
    }

    // Sort by date (newest first)
    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (expenses.length === 0) {
      document.getElementById('expenses-list').innerHTML = `
        <div style="text-align: center; color: var(--muted); padding: 3rem;">
          <div style="font-size: 2rem; margin-bottom: 1rem;">🔍</div>
          <div class="small">No expenses found</div>
        </div>
      `;
      return;
    }

    const html = `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 2px solid var(--border);">
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Expense</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Category</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Amount</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Status</th>
            <th style="text-align: left; padding: 0.75rem; font-weight: 600;">Date</th>
            <th style="text-align: right; padding: 0.75rem; font-weight: 600;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${expenses
            .map(expense => {
              const statusColors = {
                paid: { bg: '#D1FAE5', text: '#065F46' },
                pending: { bg: '#FEF3C7', text: '#92400E' },
                overdue: { bg: '#FEE2E2', text: '#991B1B' },
              };
              const color = statusColors[expense.status] || statusColors.pending;

              return `
              <tr style="border-bottom: 1px solid var(--border);" class="hover-lift">
                <td style="padding: 1rem;">
                  <div class="font-medium">${this.escapeHtml(expense.name)}</div>
                  ${expense.vendor ? `<div class="small" style="color: var(--muted);">${this.escapeHtml(expense.vendor)}</div>` : ''}
                </td>
                <td style="padding: 1rem;">
                  <span class="badge">${expense.category}</span>
                </td>
                <td style="padding: 1rem;">
                  <span class="font-semibold">£${expense.amount.toLocaleString()}</span>
                </td>
                <td style="padding: 1rem;">
                  <span class="badge" style="background: ${color.bg}; color: ${color.text}; text-transform: capitalize;">
                    ${expense.status}
                  </span>
                </td>
                <td style="padding: 1rem;">
                  <span class="small">${new Date(expense.date).toLocaleDateString()}</span>
                </td>
                <td style="padding: 1rem; text-align: right;">
                  <button class="cta ghost" style="padding: 0.5rem; font-size: 0.875rem;" onclick="budgetManager.showAddExpenseModal(budgetManager.budget.expenses.find(e => e.id === '${expense.id}'))">
                    Edit
                  </button>
                  <button class="cta ghost" style="padding: 0.5rem; font-size: 0.875rem; color: #EF4444;" onclick="budgetManager.deleteExpense('${expense.id}')">
                    Delete
                  </button>
                </td>
              </tr>
            `;
            })
            .join('')}
        </tbody>
      </table>
    `;

    document.getElementById('expenses-list').innerHTML = html;
  }

  exportBudget() {
    // Show export options modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Export Budget</h2>
          <button class="ef-cta modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <p class="mb-4">Choose export format:</p>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button class="ef-cta btn btn-primary" id="export-pdf">
              📄 Export as PDF
            </button>
            <button class="ef-cta btn btn-secondary" id="export-csv">
              📊 Export as CSV
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Handle PDF export
    modal.querySelector('#export-pdf').addEventListener('click', async () => {
      try {
        const totalSpent = this.budget.expenses.reduce((sum, e) => sum + e.amount, 0);
        const remaining = this.budget.total - totalSpent;
        const percentage =
          this.budget.total > 0 ? ((totalSpent / this.budget.total) * 100).toFixed(1) : 0;

        const budgetData = {
          totalBudget: this.budget.total,
          totalSpent: totalSpent,
          remaining: remaining,
          percentageUsed: percentage,
          expenses: this.budget.expenses,
          categoryBreakdown: this.getCategoryBreakdown(),
        };

        if (typeof exportUtility !== 'undefined') {
          await exportUtility.exportBudgetToPDF(
            budgetData,
            `eventflow-budget-${new Date().toISOString().split('T')[0]}.pdf`
          );
          Toast.success('Budget exported as PDF');
        } else {
          Toast.error('Export utility not loaded');
        }
      } catch (error) {
        console.error('PDF export error:', error);
        Toast.error('Failed to export PDF');
      }
      modal.remove();
    });

    // Handle CSV export
    modal.querySelector('#export-csv').addEventListener('click', () => {
      const csv = this.generateCSV();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eventflow-budget-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('Budget exported as CSV');
      modal.remove();
    });

    // Close on overlay click
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  getCategoryBreakdown() {
    const categoryTotals = {};
    this.budget.categories.forEach(cat => (categoryTotals[cat] = 0));

    this.budget.expenses.forEach(expense => {
      categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
    });

    const totalSpent = this.budget.expenses.reduce((sum, e) => sum + e.amount, 0);

    return Object.entries(categoryTotals)
      .filter(([_, amount]) => amount > 0)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalSpent > 0 ? ((amount / totalSpent) * 100).toFixed(1) : 0,
      }));
  }

  generateCSV() {
    const headers = ['Name', 'Category', 'Amount', 'Status', 'Date', 'Vendor', 'Notes'];
    const rows = this.budget.expenses.map(e => [
      e.name,
      e.category,
      e.amount,
      e.status,
      e.date,
      e.vendor || '',
      e.notes || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }

  generateId() {
    return `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  saveToStorage() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.budget));
    } catch (e) {
      console.error('Failed to save budget:', e);
    }
  }

  loadFromStorage() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        this.budget = { ...this.budget, ...parsed };
      }
    } catch (e) {
      console.error('Failed to load budget:', e);
    }
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

// Initialize budget manager
// eslint-disable-next-line no-unused-vars
let budgetManager;

document.addEventListener('DOMContentLoaded', () => {
  budgetManager = new BudgetManager();
});
