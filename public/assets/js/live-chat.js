/**
 * Live Chat Widget (P4-02)
 * Simple live chat widget for customer support
 */

(function () {
  'use strict';

  // Chat widget HTML
  const chatWidgetHTML = `
    <div id="ef-chat-widget" class="ef-chat-widget">
      <button id="ef-chat-toggle" class="ef-chat-toggle" aria-label="Toggle chat">
        💬 <span class="ef-chat-toggle-text">Chat with us</span>
      </button>
      <div id="ef-chat-box" class="ef-chat-box" style="display: none;">
        <div class="ef-chat-header">
          <div>
            <h4>Support Chat</h4>
            <div style="font-size: 10px; opacity: 0.8; margin-top: 2px;">Automated replies • Team responds within 24h</div>
          </div>
          <button id="ef-chat-minimize" class="ef-chat-close" aria-label="Minimize chat">−</button>
        </div>
        <div id="ef-chat-messages" class="ef-chat-messages">
          <div class="ef-chat-message ef-chat-bot-message">
            <div class="ef-chat-message-content">
              👋 Hello! How can we help you today?
            </div>
            <div class="ef-chat-message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        <div class="ef-chat-input-container">
          <input 
            type="text" 
            id="ef-chat-input" 
            class="ef-chat-input" 
            placeholder="Type a message..." 
            aria-label="Chat message"
          />
          <button id="ef-chat-send" class="ef-chat-send" aria-label="Send message">Send</button>
        </div>
      </div>
    </div>
  `;

  // Chat widget CSS
  const chatWidgetCSS = `
    .ef-chat-widget {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    
    .ef-chat-toggle {
      background: linear-gradient(135deg, #0B8073 0%, #0a6b5e 100%);
      color: white;
      border: none;
      border-radius: 50px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(11, 128, 115, 0.3);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .ef-chat-toggle:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(11, 128, 115, 0.4);
    }
    
    .ef-chat-toggle:active {
      transform: translateY(0);
    }
    
    @media (max-width: 640px) {
      .ef-chat-toggle-text {
        display: none;
      }
      
      .ef-chat-toggle {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        padding: 0;
        justify-content: center;
        font-size: 24px;
      }
    }
    
    .ef-chat-box {
      position: absolute;
      bottom: 70px;
      right: 0;
      width: 350px;
      max-width: calc(100vw - 40px);
      height: 500px;
      max-height: calc(100vh - 140px);
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .ef-chat-header {
      background: linear-gradient(135deg, #0B8073 0%, #0a6b5e 100%);
      color: white;
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .ef-chat-header h4 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    
    .ef-chat-close {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      transition: background 0.2s;
    }
    
    .ef-chat-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    
    .ef-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      background: #f9fafb;
    }
    
    .ef-chat-message {
      margin-bottom: 12px;
      animation: slideIn 0.3s ease;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .ef-chat-message-content {
      background: white;
      border-radius: 12px;
      padding: 10px 14px;
      max-width: 80%;
      word-wrap: break-word;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
    
    .ef-chat-bot-message .ef-chat-message-content {
      background: #e5f3f1;
      margin-right: auto;
    }
    
    .ef-chat-user-message {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    
    .ef-chat-user-message .ef-chat-message-content {
      background: #0B8073;
      color: white;
      margin-left: auto;
    }
    
    .ef-chat-message-time {
      font-size: 11px;
      color: #6b7280;
      margin-top: 4px;
      padding: 0 4px;
    }
    
    .ef-chat-input-container {
      display: flex;
      gap: 8px;
      padding: 12px;
      background: white;
      border-top: 1px solid #e5e7eb;
    }
    
    .ef-chat-input {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .ef-chat-input:focus {
      border-color: #0B8073;
    }
    
    .ef-chat-send {
      background: #0B8073;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .ef-chat-send:hover {
      background: #0a6b5e;
    }
    
    .ef-chat-send:active {
      transform: scale(0.98);
    }
  `;

  /**
   * Initialize chat widget
   */
  function initChatWidget() {
    // Inject CSS
    const style = document.createElement('style');
    style.textContent = chatWidgetCSS;
    document.head.appendChild(style);

    // Inject HTML
    document.body.insertAdjacentHTML('beforeend', chatWidgetHTML);

    // Get elements
    const chatToggle = document.getElementById('ef-chat-toggle');
    const chatBox = document.getElementById('ef-chat-box');
    const chatMinimize = document.getElementById('ef-chat-minimize');
    const chatInput = document.getElementById('ef-chat-input');
    const chatSend = document.getElementById('ef-chat-send');
    const chatMessages = document.getElementById('ef-chat-messages');

    // Toggle chat visibility
    function toggleChat() {
      const isVisible = chatBox.style.display !== 'none';
      chatBox.style.display = isVisible ? 'none' : 'flex';

      if (!isVisible) {
        chatInput.focus();
      }
    }

    // Add message to chat
    function addMessage(content, isUser = false) {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const messageHTML = `
        <div class="ef-chat-message ${isUser ? 'ef-chat-user-message' : 'ef-chat-bot-message'}">
          <div class="ef-chat-message-content">${escapeHtml(content)}</div>
          <div class="ef-chat-message-time">${time}</div>
        </div>
      `;

      chatMessages.insertAdjacentHTML('beforeend', messageHTML);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Send message
    function sendMessage() {
      const message = chatInput.value.trim();

      if (!message) {
        return;
      }

      // Add user message
      addMessage(message, true);
      chatInput.value = '';

      // Automated responses - clearly marked as bot responses
      // NOTE: This is a placeholder. In production, connect to a real chat service
      // such as Intercom, Zendesk, or a custom WebSocket-based solution.
      setTimeout(() => {
        const responses = [
          '🤖 [Automated] Thanks for your message! This is an automated response. A team member will respond via email within 24 hours.',
          "🤖 [Automated] I'll connect you with our support team right away. Please note this is an automated message - expect a reply within 24 hours.",
          '🤖 [Automated] Great question! For immediate help, please check our FAQ at /faq. A team member will follow up via email soon.',
          '🤖 [Automated] Our team is here to help! This is an automated response. For urgent matters, please email support@event-flow.co.uk directly.',
        ];

        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        addMessage(randomResponse, false);
      }, 1000);
    }

    // Event listeners
    chatToggle.addEventListener('click', toggleChat);
    chatMinimize.addEventListener('click', toggleChat);
    chatSend.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChatWidget);
  } else {
    initChatWidget();
  }
})();
