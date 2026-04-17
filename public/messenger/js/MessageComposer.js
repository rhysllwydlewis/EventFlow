/**
 * MessageComposer Component
 * Handles message input and sending with auto-growing textarea,
 * emoji picker, file attachments, and keyboard shortcuts
 */

'use strict';

class MessageComposer {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.options = {
      placeholder: 'Type a message...',
      maxLength: 5000,
      maxFiles: 10,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowedFileTypes: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
      ],
      onSend: null,
      onTyping: null,
      onFileSelect: null,
      ...options,
    };

    this.attachedFiles = [];
    this.isSending = false;
    this.isTyping = false;
    this.typingTimeout = null;

    this.init();
  }

  /**
   * Initialize the composer
   */
  init() {
    this.render();
    this.setupEventListeners();
  }

  /**
   * Render the composer HTML
   */
  render() {
    this.container.innerHTML = `
      <div class="message-composer">
        <!-- Attached files preview -->
        <div class="message-composer__attachments" style="display: none;"></div>
        
        <!-- Input area -->
        <div class="message-composer__input-wrapper">
          <button 
            type="button" 
            class="ef-cta message-composer__btn message-composer__btn--file" 
            title="Attach files"
            aria-label="Attach files">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M16.88 9.1A4 4 0 0 1 16 17H5a5 5 0 0 1-1-9.9V7a3 3 0 0 1 4.52-2.59A4.98 4.98 0 0 1 17 8c0 .38-.04.74-.12 1.1z"/>
            </svg>
          </button>
          
          <textarea
            class="message-composer__textarea"
            placeholder="${this.options.placeholder}"
            maxlength="${this.options.maxLength}"
            rows="1"
            aria-label="Message input"></textarea>
          
          <button 
            type="button" 
            class="ef-cta message-composer__btn message-composer__btn--emoji" 
            title="Add emoji"
            aria-label="Add emoji">
            😊
          </button>
          
          <button 
            type="button" 
            class="ef-cta message-composer__btn message-composer__btn--send" 
            title="Send message"
            aria-label="Send message"
            disabled>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
            </svg>
          </button>
        </div>
        
        <!-- Character count -->
        <div class="message-composer__footer">
          <span class="message-composer__char-count" style="display: none;">
            <span class="message-composer__char-current">0</span> / ${this.options.maxLength}
          </span>
        </div>
        
        <!-- Hidden file input -->
        <input 
          type="file" 
          class="message-composer__file-input" 
          multiple 
          accept="${this.options.allowedFileTypes.join(',')}"
          style="display: none;">
      </div>
    `;

    // Cache DOM elements
    this.textarea = this.container.querySelector('.message-composer__textarea');
    this.sendBtn = this.container.querySelector('.message-composer__btn--send');
    this.fileBtn = this.container.querySelector('.message-composer__btn--file');
    this.emojiBtn = this.container.querySelector('.message-composer__btn--emoji');
    this.fileInput = this.container.querySelector('.message-composer__file-input');
    this.attachmentsContainer = this.container.querySelector('.message-composer__attachments');
    this.charCount = this.container.querySelector('.message-composer__char-count');
    this.charCurrent = this.container.querySelector('.message-composer__char-current');
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Auto-grow textarea
    this.textarea.addEventListener('input', () => {
      this.autoGrow();
      this.updateCharCount();
      this.updateSendButton();
      this.handleTyping();
    });

    // Keyboard shortcuts
    this.textarea.addEventListener('keydown', e => {
      // Enter to send (Shift+Enter for new line)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    // Send button
    this.sendBtn.addEventListener('click', () => {
      this.send();
    });

    // File button
    this.fileBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    // File input
    this.fileInput.addEventListener('change', e => {
      this.handleFileSelect(e.target.files);
      this.fileInput.value = ''; // Reset so same file can be selected again
    });

    // Emoji button (simple implementation - just insert common emojis)
    this.emojiBtn.addEventListener('click', () => {
      this.showEmojiPicker();
    });

    // Drag and drop
    this.container.addEventListener('dragover', e => {
      e.preventDefault();
      this.container.classList.add('message-composer--dragover');
    });

    this.container.addEventListener('dragleave', () => {
      this.container.classList.remove('message-composer--dragover');
    });

    this.container.addEventListener('drop', e => {
      e.preventDefault();
      this.container.classList.remove('message-composer--dragover');
      this.handleFileSelect(e.dataTransfer.files);
    });
  }

  /**
   * Auto-grow textarea based on content
   */
  autoGrow() {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 200)}px`;
  }

  /**
   * Update character count display
   */
  updateCharCount() {
    const length = this.textarea.value.length;
    this.charCurrent.textContent = length;

    // Show count when getting close to limit
    if (length > this.options.maxLength * 0.8) {
      this.charCount.style.display = 'inline';

      // Warn when approaching limit
      if (length > this.options.maxLength * 0.95) {
        this.charCount.classList.add('message-composer__char-count--warning');
      } else {
        this.charCount.classList.remove('message-composer__char-count--warning');
      }
    } else {
      this.charCount.style.display = 'none';
    }
  }

  /**
   * Update send button state
   */
  updateSendButton() {
    const hasContent = this.textarea.value.trim().length > 0 || this.attachedFiles.length > 0;
    this.sendBtn.disabled = !hasContent || this.isSending;
  }

  /**
   * Handle typing indicator
   */
  handleTyping() {
    if (!this.options.onTyping) {
      return;
    }

    const hasContent = this.textarea.value.trim().length > 0;

    if (hasContent && !this.isTyping) {
      this.isTyping = true;
      this.options.onTyping(true);
    }

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Set timeout to stop typing indicator
    this.typingTimeout = setTimeout(() => {
      if (this.isTyping) {
        this.isTyping = false;
        this.options.onTyping(false);
      }
    }, 3000);
  }

  /**
   * Handle file selection
   */
  handleFileSelect(files) {
    const filesArray = Array.from(files);

    for (const file of filesArray) {
      // Check file count
      if (this.attachedFiles.length >= this.options.maxFiles) {
        this.showError(`Maximum ${this.options.maxFiles} files allowed`);
        break;
      }

      // Check file size
      if (file.size > this.options.maxFileSize) {
        this.showError(
          `${file.name} is too large (max ${this.formatFileSize(this.options.maxFileSize)})`
        );
        continue;
      }

      // Check file type
      if (!this.options.allowedFileTypes.includes(file.type)) {
        this.showError(`${file.name} has an unsupported file type`);
        continue;
      }

      // Add file
      this.attachedFiles.push(file);
    }

    this.renderAttachments();
    this.updateSendButton();

    if (this.options.onFileSelect) {
      this.options.onFileSelect(this.attachedFiles);
    }
  }

  /**
   * Render attached files
   */
  renderAttachments() {
    if (this.attachedFiles.length === 0) {
      this.attachmentsContainer.style.display = 'none';
      this.attachmentsContainer.innerHTML = '';
      return;
    }

    this.attachmentsContainer.style.display = 'block';
    this.attachmentsContainer.innerHTML = this.attachedFiles
      .map(
        (file, index) => `
      <div class="message-composer__attachment" data-index="${index}">
        <div class="message-composer__attachment-icon">
          ${this.getFileIcon(file)}
        </div>
        <div class="message-composer__attachment-info">
          <div class="message-composer__attachment-name">${this.escapeHtml(file.name)}</div>
          <div class="message-composer__attachment-size">${this.formatFileSize(file.size)}</div>
        </div>
        <button 
          type="button" 
          class="ef-cta message-composer__attachment-remove" 
          data-index="${index}"
          aria-label="Remove ${this.escapeHtml(file.name)}">
          ×
        </button>
      </div>
    `
      )
      .join('');

    // Add remove handlers
    this.attachmentsContainer
      .querySelectorAll('.message-composer__attachment-remove')
      .forEach(btn => {
        btn.addEventListener('click', () => {
          const index = parseInt(btn.dataset.index, 10);
          this.removeAttachment(index);
        });
      });
  }

  /**
   * Remove an attachment
   */
  removeAttachment(index) {
    this.attachedFiles.splice(index, 1);
    this.renderAttachments();
    this.updateSendButton();

    if (this.options.onFileSelect) {
      this.options.onFileSelect(this.attachedFiles);
    }
  }

  /**
   * Show simple emoji picker
   */
  showEmojiPicker() {
    const emojis = ['😊', '😂', '❤️', '👍', '👎', '🎉', '🔥', '✨', '💯', '🙏'];
    const emojiHtml = emojis
      .map(emoji => `<button type="button" class="ef-cta emoji-picker__emoji">${emoji}</button>`)
      .join('');

    // Create or update picker
    let picker = this.container.querySelector('.emoji-picker');
    if (!picker) {
      picker = document.createElement('div');
      picker.className = 'emoji-picker';
      picker.innerHTML = `<div class="emoji-picker__emojis">${emojiHtml}</div>`;
      this.container.appendChild(picker);

      // Add emoji click handlers
      picker.querySelectorAll('.emoji-picker__emoji').forEach(btn => {
        btn.addEventListener('click', () => {
          this.insertEmoji(btn.textContent);
          picker.remove();
        });
      });

      // Click outside to close
      setTimeout(() => {
        document.addEventListener(
          'click',
          e => {
            if (!picker.contains(e.target) && e.target !== this.emojiBtn) {
              picker.remove();
            }
          },
          { once: true }
        );
      }, 0);
    }
  }

  /**
   * Insert emoji at cursor position
   */
  insertEmoji(emoji) {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const text = this.textarea.value;

    this.textarea.value = text.substring(0, start) + emoji + text.substring(end);
    this.textarea.selectionStart = this.textarea.selectionEnd = start + emoji.length;
    this.textarea.focus();

    this.autoGrow();
    this.updateCharCount();
    this.updateSendButton();
  }

  /**
   * Send message
   */
  async send() {
    if (this.isSending) {
      return;
    }

    const content = this.textarea.value.trim();

    if (!content && this.attachedFiles.length === 0) {
      return;
    }

    if (!this.options.onSend) {
      console.error('MessageComposer: onSend callback not provided');
      return;
    }

    // Set sending state
    this.isSending = true;
    this.sendBtn.disabled = true;
    this.sendBtn.classList.add('message-composer__btn--sending');

    try {
      await this.options.onSend(content, this.attachedFiles);

      // Clear on success
      this.clear();

      // Success animation
      this.sendBtn.classList.add('message-composer__btn--sent');
      setTimeout(() => {
        this.sendBtn.classList.remove('message-composer__btn--sent');
      }, 1000);
    } catch (error) {
      console.error('Failed to send message:', error);
      this.showError('Failed to send message');
    } finally {
      this.isSending = false;
      this.sendBtn.classList.remove('message-composer__btn--sending');
      this.updateSendButton();
    }
  }

  /**
   * Clear the composer
   */
  clear() {
    this.textarea.value = '';
    this.attachedFiles = [];
    this.autoGrow();
    this.updateCharCount();
    this.renderAttachments();
    this.updateSendButton();

    if (this.isTyping) {
      this.isTyping = false;
      if (this.options.onTyping) {
        this.options.onTyping(false);
      }
    }
  }

  /**
   * Focus the textarea
   */
  focus() {
    this.textarea.focus();
  }

  /**
   * Set value
   */
  setValue(value) {
    this.textarea.value = value;
    this.autoGrow();
    this.updateCharCount();
    this.updateSendButton();
  }

  /**
   * Get value
   */
  getValue() {
    return this.textarea.value;
  }

  /**
   * Show error message
   */
  showError(message) {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.className = 'message-composer__toast message-composer__toast--error';
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('message-composer__toast--visible');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('message-composer__toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) {
      return '0 Bytes';
    }
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  }

  /**
   * Get file icon based on type
   */
  getFileIcon(file) {
    if (file.type.startsWith('image/')) {
      return '🖼️';
    } else if (file.type === 'application/pdf') {
      return '📄';
    } else if (file.type.includes('word')) {
      return '📝';
    } else if (file.type.includes('excel') || file.type.includes('sheet')) {
      return '📊';
    } else {
      return '📎';
    }
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Destroy the composer
   */
  destroy() {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.container.innerHTML = '';
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.MessageComposer = MessageComposer;
}
