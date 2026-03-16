// Show notification bell for logged-in users
document.addEventListener('DOMContentLoaded', () => {
  const authState = window.__authState || window.AuthStateManager;
  if (authState) {
    authState.onchange(user => {
      // Support both old and new notification bell IDs
      const notificationBell =
        document.getElementById('ef-notification-btn') ||
        document.getElementById('notification-bell');
      if (notificationBell) {
        notificationBell.style.display = user ? 'block' : 'none';
      }
    });
  }
});

// Setup "Add First Expense" button
const addFirstExpenseBtn = document.getElementById('addFirstExpenseBtn');
if (addFirstExpenseBtn) {
  addFirstExpenseBtn.addEventListener('click', () => {
    document.getElementById('add-expense')?.click();
  });
}
