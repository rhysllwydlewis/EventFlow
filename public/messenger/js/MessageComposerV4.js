/**
 * MessageComposerV4 Component
 * Auto-growing textarea, emoji picker, file drag-and-drop,
 * reply preview bar, typing broadcast, and paste-image support.
 * BEM prefix: messenger-v4__
 */

'use strict';

class MessageComposerV4 {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = {
      onSend: null,
      onTyping: null,
      onFileSelect: null,
      maxLength: 5000,
      maxFiles: 10,
      maxFileSize: 10 * 1024 * 1024, // 10 MB
      conversationId: null,
      ...options,
    };

    this.attachedFiles = [];
    this.replyTo = null;
    this.isSending = false;
    this._typingTimer = null;
    this._typingDebounce = null;
    this._emojiPickerOpen = false;

    // Categorized emoji for picker
    this._emojis = {
      Smileys: [
        '😀',
        '😂',
        '😍',
        '🥰',
        '😎',
        '😊',
        '🤣',
        '😭',
        '😅',
        '🤔',
        '😏',
        '😢',
        '😤',
        '🥺',
        '😜',
      ],
      Gestures: [
        '👋',
        '👍',
        '👎',
        '✌️',
        '🤞',
        '👏',
        '🙌',
        '🤜',
        '🤝',
        '🫶',
        '🫂',
        '👌',
        '🤙',
        '💪',
        '🖐️',
      ],
      Objects: [
        '💻',
        '📱',
        '📷',
        '🎵',
        '🎉',
        '🎁',
        '💡',
        '🔑',
        '📌',
        '✅',
        '❌',
        '⭐',
        '🔥',
        '💯',
        '🚀',
      ],
      Food: [
        '🍕',
        '🍔',
        '🌮',
        '🍜',
        '🍣',
        '🍰',
        '☕',
        '🍺',
        '🥑',
        '🍇',
        '🍓',
        '🍩',
        '🎂',
        '🥗',
        '🍦',
      ],
    };

    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render() {
    this.container.innerHTML = `
      <div class="messenger-v4__composer">
        <!-- Reply preview bar (hidden by default) -->
        <div class="messenger-v4__reply-bar" id="v4ReplyBar" style="display:none" aria-live="polite">
          <span class="messenger-v4__reply-bar-label">Replying to</span>
          <span class="messenger-v4__reply-bar-name" id="v4ReplyName"></span>
          <span class="messenger-v4__reply-bar-preview" id="v4ReplyPreview"></span>
          <button class="messenger-v4__reply-bar-close" id="v4ReplyCancelBtn" aria-label="Cancel reply">✕</button>
        </div>

        <!-- Attached files preview -->
        <div class="messenger-v4__file-preview-list" id="v4FilePreviewList" style="display:none"></div>

        <!-- Input row -->
        <div class="messenger-v4__composer-row">
          <div class="messenger-v4__composer-actions">
            <button type="button" class="messenger-v4__composer-button" id="v4EmojiBtn" aria-label="Emoji picker" aria-expanded="false" aria-haspopup="true">
              😊
            </button>
            <button type="button" class="messenger-v4__composer-button" id="v4AttachBtn" aria-label="Attach files">
              📎
              <input type="file" id="v4FileInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" style="display:none" aria-hidden="true" />
            </button>
          </div>

          <textarea
            class="messenger-v4__composer-input"
            id="v4ComposerTextarea"
            placeholder="Type a message…"
            maxlength="${this.options.maxLength}"
            rows="1"
            aria-label="Message input"
            aria-multiline="true"></textarea>

          <button type="button" class="messenger-v4__send-button" id="v4SendBtn" aria-label="Send message" disabled>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M2 21l21-9L2 3v7l15 2-15 2z"/>
            </svg>
          </button>
        </div>

        <!-- Character count (shown when > 80% of limit) -->
        <div class="messenger-v4__char-count" id="v4CharCount" style="display:none" aria-live="polite"></div>

        <!-- Emoji picker panel -->
        <div class="messenger-emoji-picker" id="v4EmojiPicker" style="display:none" role="dialog" aria-label="Emoji picker">
          ${this._buildEmojiPickerHTML()}
        </div>

        <!-- Drag-and-drop overlay -->
        <div class="messenger-v4__drop-overlay" id="v4DropOverlay" style="display:none" aria-hidden="true">
          <span>Drop files to attach</span>
        </div>
      </div>`;

    this.textarea = this.container.querySelector('#v4ComposerTextarea');
    this.sendBtn = this.container.querySelector('#v4SendBtn');
    this.charCount = this.container.querySelector('#v4CharCount');
    this.emojiPicker = this.container.querySelector('#v4EmojiPicker');
    this.fileInput = this.container.querySelector('#v4FileInput');
    this.filePreviewList = this.container.querySelector('#v4FilePreviewList');
    this.replyBar = this.container.querySelector('#v4ReplyBar');
    this.dropOverlay = this.container.querySelector('#v4DropOverlay');
  }

  _buildEmojiPickerHTML() {
    return Object.entries(this._emojis)
      .map(
        ([category, emojis]) => `
      <div class="messenger-emoji-picker__category">
        <h4 class="messenger-emoji-picker__label">${this.escape(category)}</h4>
        <div class="messenger-emoji-picker__grid">
          ${emojis.map(e => `<button type="button" class="messenger-emoji-picker__item" data-emoji="${this.escape(e)}" aria-label="${this.escape(e)}">${e}</button>`).join('')}
        </div>
      </div>`
      )
      .join('');
  }

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  attachEventListeners() {
    // Textarea: auto-grow, character count, send on Enter, typing broadcast
    this.textarea.addEventListener('input', () => this._onTextareaInput());
    this.textarea.addEventListener('keydown', e => this._onKeyDown(e));
    this.textarea.addEventListener('paste', e => this._onPaste(e));

    // Send button
    this.sendBtn.addEventListener('click', () => this.send());

    // Emoji button
    this.container
      .querySelector('#v4EmojiBtn')
      .addEventListener('click', () => this._toggleEmojiPicker());

    // Emoji item selection (delegated)
    this.emojiPicker.addEventListener('click', e => {
      const item = e.target.closest('.messenger-emoji-picker__item');
      if (item) {
        this._insertEmoji(item.dataset.emoji);
      }
    });

    // Attach button → file input
    this.container
      .querySelector('#v4AttachBtn')
      .addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', e =>
      this._handleFileSelect(Array.from(e.target.files))
    );

    // Reply cancel
    this.container
      .querySelector('#v4ReplyCancelBtn')
      .addEventListener('click', () => this.clearReply());

    // Drag and drop on the whole composer
    this.container.addEventListener('dragenter', e => {
      e.preventDefault();
      this.dropOverlay.style.display = 'flex';
    });
    this.container.addEventListener('dragover', e => {
      e.preventDefault();
    });
    this.container.addEventListener('dragleave', e => {
      if (!this.container.contains(e.relatedTarget)) {
        this.dropOverlay.style.display = 'none';
      }
    });
    this.container.addEventListener('drop', e => {
      e.preventDefault();
      this.dropOverlay.style.display = 'none';
      const files = Array.from(e.dataTransfer.files);
      if (files.length) {
        this._handleFileSelect(files);
      }
    });

    // Close emoji picker when clicking outside
    this._onDocumentClick = e => {
      if (this._emojiPickerOpen && !this.container.contains(e.target)) {
        this._closeEmojiPicker();
      }
    };
    document.addEventListener('click', this._onDocumentClick);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Set a reply-to context (shows the reply bar above the input).
   * @param {Object} message - { _id, senderName, content }
   */
  setReplyTo(message) {
    this.replyTo = message;
    this.container.querySelector('#v4ReplyName').textContent = message.senderName || 'Unknown';
    this.container.querySelector('#v4ReplyPreview').textContent =
      (message.content || '').substring(0, 80) || '📎 Attachment';
    this.replyBar.style.display = 'flex';
    this.focus();
  }

  /** Clear the current reply-to context. */
  clearReply() {
    this.replyTo = null;
    this.replyBar.style.display = 'none';
    this.container.querySelector('#v4ReplyName').textContent = '';
    this.container.querySelector('#v4ReplyPreview').textContent = '';
  }

  /** Send the current message (validates, dispatches event, resets). */
  async send() {
    const content = this.textarea.value.trim();
    if ((!content && !this.attachedFiles.length) || this.isSending) {
      return;
    }

    // Guard: don't send if no conversation is active
    if (!this.options.conversationId) {
      return;
    }

    this.isSending = true;
    this.sendBtn.disabled = true;
    this.sendBtn.classList.add('messenger-v4__send-button--loading');

    const payload = {
      message: content,
      files: [...this.attachedFiles],
      replyTo: this.replyTo ? { ...this.replyTo } : null,
      conversationId: this.options.conversationId,
    };

    try {
      // Fire the custom event; MessengerAppV4 handles the API call
      window.dispatchEvent(new CustomEvent('composer:send', { detail: payload }));

      if (typeof this.options.onSend === 'function') {
        await this.options.onSend(payload);
      }

      this.reset();
    } catch (err) {
      console.error('[MessageComposerV4] Send failed:', err);
    } finally {
      this.isSending = false;
      this.sendBtn.classList.remove('messenger-v4__send-button--loading');
      this._updateSendButton();
    }
  }

  /** Focus the textarea. */
  focus() {
    this.textarea.focus();
  }

  /** Reset composer to empty state. */
  reset() {
    this.textarea.value = '';
    this._resizeTextarea();
    this.attachedFiles = [];
    this._renderFilePreviews();
    this.clearReply();
    this._updateSendButton();
    this._updateCharCount();
  }

  /** Clean up listeners and DOM. */
  destroy() {
    clearTimeout(this._typingTimer);
    clearTimeout(this._typingDebounce);
    if (this._onDocumentClick) {
      document.removeEventListener('click', this._onDocumentClick);
      this._onDocumentClick = null;
    }
    this.container.innerHTML = '';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _onTextareaInput() {
    this._resizeTextarea();
    this._updateSendButton();
    this._updateCharCount();
    this._broadcastTyping();
  }

  _onKeyDown(e) {
    // Send on Enter (not Shift+Enter)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.send();
    }
  }

  _onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          this._handleFileSelect([file]);
        }
      }
    }
  }

  _resizeTextarea() {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 160)}px`;
  }

  _updateSendButton() {
    const hasContent = this.textarea.value.trim().length > 0 || this.attachedFiles.length > 0;
    this.sendBtn.disabled = !hasContent || this.isSending;
  }

  _updateCharCount() {
    const len = this.textarea.value.length;
    const max = this.options.maxLength;
    const threshold = Math.floor(max * 0.8);
    if (len >= threshold) {
      this.charCount.textContent = `${len} / ${max}`;
      this.charCount.style.display = 'block';
      this.charCount.classList.toggle(
        'messenger-v4__char-count--warning',
        len >= Math.floor(max * 0.95)
      );
    } else {
      this.charCount.style.display = 'none';
    }
  }

  /** Broadcast typing event with 2s debounce to avoid spamming. */
  _broadcastTyping() {
    clearTimeout(this._typingDebounce);
    if (typeof this.options.onTyping === 'function') {
      this.options.onTyping(true);
    }
    window.dispatchEvent(
      new CustomEvent('messenger:typing', {
        detail: { conversationId: this.options.conversationId, isTyping: true },
      })
    );
    this._typingDebounce = setTimeout(() => {
      if (typeof this.options.onTyping === 'function') {
        this.options.onTyping(false);
      }
      window.dispatchEvent(
        new CustomEvent('messenger:typing', {
          detail: { conversationId: this.options.conversationId, isTyping: false },
        })
      );
    }, 2000);
  }

  _toggleEmojiPicker() {
    this._emojiPickerOpen ? this._closeEmojiPicker() : this._openEmojiPicker();
  }

  _openEmojiPicker() {
    this._emojiPickerOpen = true;
    this.emojiPicker.style.display = 'block';
    this.container.querySelector('#v4EmojiBtn').setAttribute('aria-expanded', 'true');
  }

  _closeEmojiPicker() {
    this._emojiPickerOpen = false;
    this.emojiPicker.style.display = 'none';
    this.container.querySelector('#v4EmojiBtn').setAttribute('aria-expanded', 'false');
  }

  _insertEmoji(emoji) {
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const val = this.textarea.value;
    this.textarea.value = val.substring(0, start) + emoji + val.substring(end);
    this.textarea.selectionStart = this.textarea.selectionEnd = start + emoji.length;
    this.textarea.focus();
    this._onTextareaInput();
    this._closeEmojiPicker();
  }

  /**
   * Validate and stage selected files.
   * @param {File[]} files
   */
  _handleFileSelect(files) {
    const remaining = this.options.maxFiles - this.attachedFiles.length;
    const toAdd = files.slice(0, remaining);

    const oversized = [];
    toAdd.forEach(file => {
      if (file.size > this.options.maxFileSize) {
        oversized.push(file.name);
        return;
      }
      this.attachedFiles.push(file);
    });

    if (oversized.length) {
      this._showInlineError(
        `${oversized.map(n => `"${n}"`).join(', ')} exceed${oversized.length === 1 ? 's' : ''} the 10 MB limit and ${oversized.length === 1 ? 'was' : 'were'} not attached.`
      );
    }

    if (typeof this.options.onFileSelect === 'function') {
      this.options.onFileSelect(this.attachedFiles);
    }

    this._renderFilePreviews();
    this._updateSendButton();

    // Reset file input so the same file can be re-selected
    this.fileInput.value = '';
  }

  _renderFilePreviews() {
    if (!this.attachedFiles.length) {
      this.filePreviewList.style.display = 'none';
      this.filePreviewList.innerHTML = '';
      return;
    }

    this.filePreviewList.style.display = 'flex';
    this.filePreviewList.innerHTML = this.attachedFiles
      .map(
        (file, i) => `
      <div class="messenger-v4__file-chip" data-index="${i}">
        <span class="messenger-v4__file-chip-name" title="${this.escape(file.name)}">${this.escape(file.name)}</span>
        <button type="button" class="messenger-v4__file-chip-remove" data-index="${i}" aria-label="Remove ${this.escape(file.name)}">✕</button>
      </div>`
      )
      .join('');

    this.filePreviewList.querySelectorAll('.messenger-v4__file-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.attachedFiles.splice(idx, 1);
        this._renderFilePreviews();
        this._updateSendButton();
      });
    });
  }

  /** Show a non-blocking inline error message that auto-dismisses after 4 s. */
  _showInlineError(message) {
    let errEl = this.container.querySelector('.messenger-v4__composer-error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'messenger-v4__composer-error';
      errEl.setAttribute('role', 'alert');
      this.container.querySelector('.messenger-v4__composer').prepend(errEl);
    }
    errEl.textContent = message;
    errEl.style.display = 'block';
    clearTimeout(this._errorTimer);
    this._errorTimer = setTimeout(() => {
      errEl.style.display = 'none';
    }, 4000);
  }

  escape(str) {
    if (str === null || str === undefined) {
      return '';
    }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

if (typeof window !== 'undefined') {
  window.MessageComposerV4 = MessageComposerV4;
}
