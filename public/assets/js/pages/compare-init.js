window.__EF_PAGE__ = 'compare';

document.addEventListener('DOMContentLoaded', () => {
  // Load saved comparison from localStorage
  const savedComparison = localStorage.getItem('supplier-comparison');
  const suppliers = savedComparison ? JSON.parse(savedComparison) : [];

  // Initialize comparison tool
  const comparison = new SupplierComparison({
    container: '#supplier-comparison',
    suppliers: suppliers,
    maxSuppliers: 3,
    onSupplierAdd: supplier => {
      console.log('Supplier added to comparison:', supplier);
      saveComparison();
    },
    onSupplierRemove: supplier => {
      console.log('Supplier removed from comparison:', supplier);
      saveComparison();
    },
  });

  function saveComparison() {
    const suppliers = comparison.getSuppliers();
    localStorage.setItem('supplier-comparison', JSON.stringify(suppliers));
  }

  // Show notification bell for logged-in users
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
