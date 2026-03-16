document.addEventListener('DOMContentLoaded', () => {
  if (typeof MessengerWidgetV4 !== 'undefined') {
    new MessengerWidgetV4('messenger-dashboard-widget', { maxItems: 5 });
  }
});
