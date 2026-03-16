// Fix CSP violation - move inline onclick to event listener
document.getElementById('add-first-guest-btn')?.addEventListener('click', () => {
  document.getElementById('add-guest')?.click();
});
