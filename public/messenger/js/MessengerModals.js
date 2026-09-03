/**
 * Custom Modal Dialogs for Messenger
 * Replaces native prompt() and confirm() with liquid-glass themed modals
 */

'use strict';

class MessengerModals {
  /**
   * Show emoji picker modal
   */
  static showEmojiPicker() {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'messenger-modal messenger-modal--emoji';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'emojiPickerTitle');

      const emojis = [
        { emoji: '👍', label: 'Thumbs up' },
        { emoji: '❤️', label: 'Heart' },
        { emoji: '😂', label: 'Laughing' },
        { emoji: '😮', label: 'Surprised' },
        { emoji: '😢', label: 'Sad' },
        { emoji: '👏', label: 'Clapping' },
        { emoji: '🎉', label: 'Party' },
        { emoji: '🔥', label: 'Fire' },
        { emoji: '✨', label: 'Sparkles' },
        { emoji: '💯', label: '100' },
        { emoji: '🚀', label: 'Rocket' },
        { emoji: '🤔', label: 'Thinking' },
      ];

      modal.innerHTML = `
        <div class="messenger-modal__overlay"></div>
        <div class="messenger-modal__content messenger-modal__content--small">
          <header class="messenger-modal__header">
            <h2 id="emojiPickerTitle">Choose Reaction</h2>
            <button class="ef-cta messenger-modal__close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </header>
          <div class="messenger-modal__body">
            <div class="messenger-emoji-picker">
              ${emojis
                .map(
                  ({ emoji, label }) => `
                <button class="ef-cta messenger-emoji-picker__item" data-emoji="${emoji}" title="${label}" aria-label="${label}">
                  ${emoji}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Focus first emoji
      requestAnimationFrame(() => {
        const firstEmoji = modal.querySelector('.messenger-emoji-picker__item');
        if (firstEmoji) {
          firstEmoji.focus();
        }
      });

      // Handle emoji selection
      modal.querySelectorAll('.messenger-emoji-picker__item').forEach(btn => {
        btn.addEventListener('click', () => {
          const emoji = btn.dataset.emoji;
          cleanup();
          resolve(emoji);
        });
      });

      // Handle close
      const closeBtn = modal.querySelector('.messenger-modal__close');
      const overlay = modal.querySelector('.messenger-modal__overlay');

      const close = () => {
        cleanup();
        resolve(null);
      };

      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', close);

      // Handle keyboard
      modal.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          close();
        }
      });

      function cleanup() {
        modal.remove();
      }

      // Show with animation
      modal.style.display = 'flex';
      requestAnimationFrame(() => {
        modal.classList.add('messenger-modal--visible');
      });
    });
  }

  /**
   * Show edit message modal
   */
  static showEditPrompt(currentContent) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'messenger-modal messenger-modal--edit';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'editMessageTitle');

      modal.innerHTML = `
        <div class="messenger-modal__overlay"></div>
        <div class="messenger-modal__content">
          <header class="messenger-modal__header">
            <h2 id="editMessageTitle">Edit Message</h2>
            <button class="ef-cta messenger-modal__close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </header>
          <div class="messenger-modal__body">
            <textarea 
              class="messenger-modal__textarea" 
              id="editMessageInput"
              rows="4"
              placeholder="Type your message..."
              aria-label="Message content"
            >${MessengerModals.escapeHtml(currentContent)}</textarea>
            <div class="messenger-modal__actions">
              <button class="ef-cta messenger-modal__button messenger-modal__button--secondary" id="cancelEdit">
                Cancel
              </button>
              <button class="ef-cta messenger-modal__button messenger-modal__button--primary" id="saveEdit">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const textarea = modal.querySelector('#editMessageInput');
      const saveBtn = modal.querySelector('#saveEdit');
      const cancelBtn = modal.querySelector('#cancelEdit');
      const closeBtn = modal.querySelector('.messenger-modal__close');
      const overlay = modal.querySelector('.messenger-modal__overlay');

      // Focus and select text
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(0, textarea.value.length);
      });

      // Handle save
      const save = () => {
        const newContent = textarea.value.trim();
        if (newContent && newContent !== currentContent) {
          cleanup();
          resolve(newContent);
        } else {
          cleanup();
          resolve(null);
        }
      };

      // Handle cancel
      const cancel = () => {
        cleanup();
        resolve(null);
      };

      saveBtn.addEventListener('click', save);
      cancelBtn.addEventListener('click', cancel);
      closeBtn.addEventListener('click', cancel);
      overlay.addEventListener('click', cancel);

      // Handle keyboard
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          save();
        } else if (e.key === 'Escape') {
          cancel();
        }
      });

      function cleanup() {
        modal.remove();
      }

      // Show with animation
      modal.style.display = 'flex';
      requestAnimationFrame(() => {
        modal.classList.add('messenger-modal--visible');
      });
    });
  }

  /**
   * Show a report-reason prompt. Resolves to { reason, details } or null if
   * cancelled. `reason` matches the values routes/reports.js accepts.
   */
  static showReportPrompt(title) {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'messenger-modal messenger-modal--edit';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'reportModalTitle');

      modal.innerHTML = `
        <div class="messenger-modal__overlay"></div>
        <div class="messenger-modal__content">
          <header class="messenger-modal__header">
            <h2 id="reportModalTitle">${MessengerModals.escapeHtml(title)}</h2>
            <button class="ef-cta messenger-modal__close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </header>
          <div class="messenger-modal__body">
            <label for="reportReasonSelect" style="display:block;margin-bottom:6px;font-weight:600">Reason</label>
            <select id="reportReasonSelect" class="messenger-modal__textarea" style="height:auto;margin-bottom:12px">
              <option value="spam">Spam</option>
              <option value="harassment">Harassment</option>
              <option value="inappropriate_content">Inappropriate content</option>
              <option value="false_information">False information</option>
              <option value="other">Other</option>
            </select>
            <label for="reportDetailsInput" style="display:block;margin-bottom:6px;font-weight:600">Details (optional)</label>
            <textarea
              class="messenger-modal__textarea"
              id="reportDetailsInput"
              rows="3"
              placeholder="Anything else that would help us review this..."
              aria-label="Report details"
            ></textarea>
            <div class="messenger-modal__actions">
              <button class="ef-cta messenger-modal__button messenger-modal__button--secondary" id="cancelReport">
                Cancel
              </button>
              <button class="ef-cta messenger-modal__button messenger-modal__button--primary" id="submitReport">
                Submit report
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const reasonSelect = modal.querySelector('#reportReasonSelect');
      const detailsInput = modal.querySelector('#reportDetailsInput');
      const submitBtn = modal.querySelector('#submitReport');
      const cancelBtn = modal.querySelector('#cancelReport');
      const closeBtn = modal.querySelector('.messenger-modal__close');
      const overlay = modal.querySelector('.messenger-modal__overlay');

      const submit = () => {
        cleanup();
        resolve({ reason: reasonSelect.value, details: detailsInput.value.trim() });
      };
      const cancel = () => {
        cleanup();
        resolve(null);
      };

      submitBtn.addEventListener('click', submit);
      cancelBtn.addEventListener('click', cancel);
      closeBtn.addEventListener('click', cancel);
      overlay.addEventListener('click', cancel);
      modal.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          cancel();
        }
      });

      function cleanup() {
        modal.remove();
      }

      modal.style.display = 'flex';
      requestAnimationFrame(() => {
        modal.classList.add('messenger-modal--visible');
      });
    });
  }

  /**
   * Show confirmation dialog
   */
  static showConfirm(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise(resolve => {
      const modal = document.createElement('div');
      modal.className = 'messenger-modal messenger-modal--confirm';
      modal.setAttribute('role', 'alertdialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'confirmTitle');
      modal.setAttribute('aria-describedby', 'confirmMessage');

      modal.innerHTML = `
        <div class="messenger-modal__overlay"></div>
        <div class="messenger-modal__content messenger-modal__content--small">
          <header class="messenger-modal__header">
            <h2 id="confirmTitle">${MessengerModals.escapeHtml(title)}</h2>
            <button class="ef-cta messenger-modal__close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </header>
          <div class="messenger-modal__body">
            <p id="confirmMessage" class="messenger-modal__message">${MessengerModals.escapeHtml(message)}</p>
            <div class="messenger-modal__actions">
              <button class="ef-cta messenger-modal__button messenger-modal__button--secondary" id="confirmCancel">
                ${MessengerModals.escapeHtml(cancelText)}
              </button>
              <button class="ef-cta messenger-modal__button messenger-modal__button--danger" id="confirmOk">
                ${MessengerModals.escapeHtml(confirmText)}
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const confirmBtn = modal.querySelector('#confirmOk');
      const cancelBtn = modal.querySelector('#confirmCancel');
      const closeBtn = modal.querySelector('.messenger-modal__close');
      const overlay = modal.querySelector('.messenger-modal__overlay');

      // Focus confirm button
      requestAnimationFrame(() => {
        confirmBtn.focus();
      });

      // Handle confirm
      const confirm = () => {
        cleanup();
        resolve(true);
      };

      // Handle cancel
      const cancel = () => {
        cleanup();
        resolve(false);
      };

      confirmBtn.addEventListener('click', confirm);
      cancelBtn.addEventListener('click', cancel);
      closeBtn.addEventListener('click', cancel);
      overlay.addEventListener('click', cancel);

      // Handle keyboard: Enter activates focused button; Escape cancels
      modal.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          // Only confirm when focus is on the confirm button or somewhere outside the cancel button
          if (document.activeElement !== cancelBtn) {
            e.preventDefault();
            confirm();
          }
          // If cancel button is focused, let the button's native click fire
        } else if (e.key === 'Escape') {
          cancel();
        }
      });

      function cleanup() {
        modal.remove();
      }

      // Show with animation
      modal.style.display = 'flex';
      requestAnimationFrame(() => {
        modal.classList.add('messenger-modal--visible');
      });
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.MessengerModals = MessengerModals;
}
