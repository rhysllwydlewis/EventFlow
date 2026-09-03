/**
 * P3-09: FAQ Voting
 * Allow users to vote on FAQ helpfulness
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  /**
   * Initialize FAQ voting on FAQ page
   */
  function initFaqVoting() {
    const faqItems = document.querySelectorAll('.faq-item, .accordion-item, [data-faq-id]');

    if (faqItems.length === 0) {
      return;
    }

    faqItems.forEach((item, index) => {
      const faqId = item.dataset.faqId || `faq-${index + 1}`;
      addVotingButtons(item, faqId);
    });

    if (isDevelopment) {
      console.log(`✓ FAQ voting initialized for ${faqItems.length} items`);
    }
  }

  /**
   * Add voting buttons to FAQ item
   */
  function addVotingButtons(faqItem, faqId) {
    // Check if already has voting buttons
    if (faqItem.querySelector('.faq-vote-section')) {
      return;
    }

    const voteSection = document.createElement('div');
    voteSection.className = 'faq-vote-section';
    voteSection.innerHTML = `
      <p class="faq-vote-label">Was this helpful?</p>
      <div class="faq-vote-buttons">
        <button 
          type="button"
          class="ef-cta faq-vote-btn" 
          data-vote="yes" 
          data-faq-id="${faqId}"
          aria-label="Yes, this was helpful"
        >
          👍 Yes
        </button>
        <button 
          type="button"
          class="ef-cta faq-vote-btn" 
          data-vote="no" 
          data-faq-id="${faqId}"
          aria-label="No, this was not helpful"
        >
          👎 No
        </button>
      </div>
      <div class="faq-vote-thanks" style="display: none;">
        Thank you for your feedback!
      </div>
    `;

    faqItem.appendChild(voteSection);

    // Add click handlers
    const yesBtn = voteSection.querySelector('[data-vote="yes"]');
    const noBtn = voteSection.querySelector('[data-vote="no"]');

    yesBtn.addEventListener('click', () => handleVote(faqId, true, voteSection));
    noBtn.addEventListener('click', () => handleVote(faqId, false, voteSection));
  }

  /**
   * Handle vote submission
   */
  async function handleVote(faqId, helpful, voteSection) {
    try {
      const response = await fetch('/api/v1/public/faq/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          faqId,
          helpful,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit vote');
      }

      // Show thank you message
      const buttons = voteSection.querySelector('.faq-vote-buttons');
      const thanks = voteSection.querySelector('.faq-vote-thanks');

      buttons.style.display = 'none';
      thanks.style.display = 'block';

      // Mark the voted button
      const votedBtn = voteSection.querySelector(`[data-vote="${helpful ? 'yes' : 'no'}"]`);
      if (votedBtn) {
        votedBtn.classList.add('voted');
      }

      if (isDevelopment) {
        console.log(`✓ FAQ vote submitted: ${faqId} - ${helpful ? 'helpful' : 'not helpful'}`);
      }
    } catch (error) {
      console.error('Error submitting FAQ vote:', error);
      alert('Failed to submit your feedback. Please try again.');
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFaqVoting);
  } else {
    initFaqVoting();
  }

  // Export for use in other scripts
  if (typeof window !== 'undefined') {
    window.FaqVoting = {
      init: initFaqVoting,
    };
  }
})();
