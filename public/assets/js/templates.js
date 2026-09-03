/**
 * Event Templates — EventFlow Planning Wizard
 * Richer template definitions that drive meaningful wizard journeys.
 */

'use strict';
(function () {
  const TEMPLATES = {
    wedding: {
      id: 'wedding',
      name: 'Wedding',
      emoji: '💒',
      tagline: 'Plan a beautiful wedding celebration',
      description:
        'From venue and catering to photography and flowers — everything you need for the perfect day.',
      budgetLabel: '£5,000 – £30,000',
      guestLabel: '50–200 guests',
      budget: 15000,
      guestCount: 100,
      priorities: ['venue', 'catering', 'photography', 'flowers', 'entertainment'],
      styles: ['classic', 'romantic', 'luxury'],
      planningStage: 'just-starting',
      checklist: [
        'Book your venue',
        'Hire a caterer',
        'Book a photographer',
        'Order flowers and décor',
        'Arrange entertainment',
        'Send invitations',
        'Confirm guest list',
      ],
    },
    birthday: {
      id: 'birthday',
      name: 'Birthday Party',
      emoji: '🎂',
      tagline: 'Celebrate a special birthday in style',
      description: 'Venue, food, entertainment and décor — make it an occasion to remember.',
      budgetLabel: '£500 – £5,000',
      guestLabel: '15–60 guests',
      budget: 2000,
      guestCount: 30,
      priorities: ['venue', 'catering', 'entertainment', 'flowers'],
      styles: ['relaxed', 'colourful', 'family-friendly'],
      planningStage: 'just-starting',
      checklist: [
        'Book a venue',
        'Sort food and drinks',
        'Arrange entertainment',
        'Get decorations',
        'Send invitations',
      ],
    },
    corporate: {
      id: 'corporate',
      name: 'Corporate Event',
      emoji: '💼',
      tagline: 'Host a professional corporate event',
      description: 'Venue, catering, AV and logistics — professional event management made easy.',
      budgetLabel: '£2,000 – £20,000',
      guestLabel: '30–150 guests',
      budget: 8000,
      guestCount: 75,
      priorities: ['venue', 'catering', 'av', 'photography'],
      styles: ['corporate', 'modern', 'formal'],
      planningStage: 'just-starting',
      checklist: [
        'Book your venue',
        'Arrange catering',
        'Set up AV and tech',
        'Book a photographer',
        'Arrange transport',
        'Send invitations',
      ],
    },
    conference: {
      id: 'conference',
      name: 'Conference',
      emoji: '🎤',
      tagline: 'Organise a professional conference',
      description:
        'Venue, AV, catering, signage and registration — everything for a large-scale event.',
      budgetLabel: '£5,000 – £50,000+',
      guestLabel: '100–500+ attendees',
      budget: 20000,
      guestCount: 200,
      priorities: ['venue', 'catering', 'av', 'photography'],
      styles: ['corporate', 'formal', 'modern'],
      planningStage: 'just-starting',
      checklist: [
        'Book conference venue',
        'Arrange catering for all sessions',
        'Set up AV and tech',
        'Order signage and materials',
        'Book photographer/videographer',
        'Arrange accommodation for speakers',
        'Manage registrations',
      ],
    },
    other: {
      id: 'other',
      name: 'Other Event',
      emoji: '🎉',
      tagline: 'Plan any type of event your way',
      description: 'A flexible starting point for any occasion — you choose what matters most.',
      budgetLabel: 'Any budget',
      guestLabel: 'Any size',
      budget: null,
      guestCount: null,
      priorities: ['venue', 'catering'],
      styles: ['relaxed'],
      planningStage: 'just-starting',
      checklist: [
        'Define your event goals',
        'Set a budget',
        'Choose a venue',
        'Plan food and drinks',
        'Invite your guests',
      ],
    },
  };

  function getAllTemplates() {
    return Object.values(TEMPLATES);
  }

  function getTemplate(id) {
    return TEMPLATES[id] || null;
  }

  /**
   * Render template selector cards into a container element.
   * @param {string} containerId
   * @param {Function} onSelect - called with template or null
   */
  function renderTemplateSelector(containerId, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    const templates = getAllTemplates();

    const grid = templates
      .map(
        t => `
      <button class="ef-template-card" data-template-id="${t.id}"
              type="button" aria-label="Use ${esc(t.name)} template">
        <span class="ef-template-emoji" aria-hidden="true">${t.emoji}</span>
        <div class="ef-template-body">
          <h4 class="ef-template-name">${esc(t.name)}</h4>
          <p class="ef-template-desc">${esc(t.tagline)}</p>
          <div class="ef-template-meta">
            <span class="ef-template-badge">${esc(t.budgetLabel)}</span>
            <span class="ef-template-badge">${esc(t.guestLabel)}</span>
          </div>
        </div>
        <svg class="ef-template-arrow" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
        </svg>
      </button>`
      )
      .join('');

    container.innerHTML = `
      <div class="ef-template-selector">
        <div class="ef-template-grid">${grid}</div>
        <button class="ef-template-skip" id="skip-template-btn" type="button">
          Start from scratch instead
        </button>
      </div>
    `;

    container.querySelectorAll('.ef-template-card').forEach(card => {
      card.addEventListener('click', () => {
        const template = getTemplate(card.getAttribute('data-template-id'));
        if (template && onSelect) {
          onSelect(template);
        }
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });

    const skipBtn = document.getElementById('skip-template-btn');
    if (skipBtn && onSelect) {
      skipBtn.addEventListener('click', () => onSelect(null));
    }
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  window.EventTemplates = {
    getAll: getAllTemplates,
    getTemplate,
    renderSelector: renderTemplateSelector,
  };
})();
