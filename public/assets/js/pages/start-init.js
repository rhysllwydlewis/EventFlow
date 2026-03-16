/**
 * Map a numeric budget value to the closest matching budget-range label used
 * by the wizard's budget <select> dropdown.
 * @param {number} amount
 * @returns {string}
 */
function mapBudgetToLabel(amount) {
  // eslint-disable-next-line eqeqeq
  if (amount == null || isNaN(Number(amount))) {
    return '';
  }
  const n = Number(amount);
  if (n <= 1000) {
    return 'Up to £1,000';
  }
  if (n <= 3000) {
    return '£1,000–£3,000';
  }
  if (n <= 5000) {
    return '£3,000–£5,000';
  }
  if (n <= 10000) {
    return '£5,000–£10,000';
  }
  if (n <= 20000) {
    return '£10,000–£20,000';
  }
  return '£20,000+';
}

/**
 * Map a template's eventType string (which may be lowercase or use a value
 * not present in the wizard, e.g. 'conference') to the Title Case value that
 * the wizard's event-type buttons compare against.
 * @param {string} type
 * @returns {string}
 */
function mapEventTypeToWizardValue(type) {
  if (!type) {
    return '';
  }
  const map = {
    wedding: 'Wedding',
    corporate: 'Corporate',
    birthday: 'Birthday',
    conference: 'Corporate', // closest wizard match for conference templates
    other: 'Other',
  };
  return map[String(type).toLowerCase()] || 'Other';
}

// Show template selector on page load
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('template-selector-container');
  if (container && window.EventTemplates) {
    container.style.display = 'block';
    window.EventTemplates.renderSelector('template-selector-container', template => {
      if (template) {
        if (window.WizardState) {
          // Pre-fill event type (step 0 = EVENT_TYPE)
          // Templates store lowercase event types (e.g. 'wedding'); normalize to Title Case.
          window.WizardState.saveStep(0, {
            eventType: mapEventTypeToWizardValue(template.eventType || template.type),
          });
          // Pre-fill basic info (step 1 = EVENT_BASICS)
          window.WizardState.saveStep(1, {
            location: '',
            guests: template.guestCount,
            budget: mapBudgetToLabel(template.budget),
          });
        }
      }
      // Hide template selector and show wizard
      container.style.display = 'none';
    });
  }
});
