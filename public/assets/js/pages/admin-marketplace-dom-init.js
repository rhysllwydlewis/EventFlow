document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('[data-action="bulk-approve"]').addEventListener('click', () => {
    bulkApprove();
  });
  document.querySelector('[data-action="bulk-mark-sold"]').addEventListener('click', () => {
    bulkMarkSold();
  });
  document.querySelector('[data-action="bulk-delete"]').addEventListener('click', () => {
    bulkDelete();
  });
});
