(function(l){"use strict";const c={apiBaseUrl:"",assistantName:"Jade",greetingText:"Hi! 👋 I'm Jade, your event planning assistant. Can I help you plan your special day?",greetingTooltipText:"👋 Hi! Need help planning your event?",avatarUrl:"https://cdn.jsdelivr.net/gh/rhysllwydlewis/JadeAssist@main/packages/widget/assets/avatar-woman.png",primaryColor:"#0B8073",accentColor:"#13B6A2",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',showDelayMs:1e3,offsetBottom:"80px",offsetRight:"24px",offsetLeft:"",offsetBottomMobile:"",offsetRightMobile:"",offsetLeftMobile:"",scale:1,debug:!1},r={STATE:"jade-widget-state",MESSAGES:"jade-widget-messages",CONVERSATION_ID:"jade-widget-conversation-id",GREETING_DISMISSED:"jade-widget-greeting-dismissed"};class n{static saveState(e){try{const s={...this.loadState(),...e};localStorage.setItem(r.STATE,JSON.stringify(s))}catch(a){console.warn("Failed to save widget state:",a)}}static loadState(){try{const e=localStorage.getItem(r.STATE);return e?JSON.parse(e):{}}catch(e){return console.warn("Failed to load widget state:",e),{}}}static saveMessages(e){try{localStorage.setItem(r.MESSAGES,JSON.stringify(e))}catch(a){console.warn("Failed to save messages:",a)}}static loadMessages(){try{const e=localStorage.getItem(r.MESSAGES);return e?JSON.parse(e):[]}catch(e){return console.warn("Failed to load messages:",e),[]}}static saveConversationId(e){try{localStorage.setItem(r.CONVERSATION_ID,e)}catch(a){console.warn("Failed to save conversation ID:",a)}}static loadConversationId(){try{return localStorage.getItem(r.CONVERSATION_ID)}catch(e){return console.warn("Failed to load conversation ID:",e),null}}static clearAll(){try{localStorage.removeItem(r.STATE),localStorage.removeItem(r.MESSAGES),localStorage.removeItem(r.CONVERSATION_ID),localStorage.removeItem(r.GREETING_DISMISSED)}catch(e){console.warn("Failed to clear storage:",e)}}static isGreetingDismissed(){try{return localStorage.getItem(r.GREETING_DISMISSED)==="true"}catch(e){return console.warn("Failed to check greeting dismissed state:",e),!1}}static setGreetingDismissed(){try{localStorage.setItem(r.GREETING_DISMISSED,"true")}catch(e){console.warn("Failed to save greeting dismissed state:",e)}}}class p{constructor(e){this.baseUrl=e||"",this.demoMode=!e}async sendMessage(e,a){var s;if(this.demoMode)return this.mockResponse(e);try{const i=await fetch(`${this.baseUrl}/api/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:e,conversationId:a,userId:"anonymous"})});if(!i.ok)throw new Error(`API error: ${i.status}`);const t=await i.json();if(!t.success||!t.data)throw new Error(((s=t.error)==null?void 0:s.message)||"API request failed");return{conversationId:t.data.conversationId,message:{id:t.data.message.id,role:"assistant",content:t.data.message.content,timestamp:Date.now(),quickReplies:t.data.suggestions}}}catch(i){console.error("API request failed, falling back to demo mode:",i);const t=await this.mockResponse(e);return t.message.content=`⚠️ (Demo Mode) ${t.message.content}`,t}}async mockResponse(e){await new Promise(d=>setTimeout(d,800));const a="demo-"+Date.now(),s=e.toLowerCase();let i="",t;return s.includes("yes")&&s.includes("please")?(i="Wonderful! I'd love to help you plan your event. What type of event are you planning? 🎉",t=["Wedding","Birthday Party","Corporate Event","Other"]):s.includes("wedding")?(i="Exciting! A wedding is such a special occasion. Do you have a date in mind? 💍",t=["Yes, I do","Not yet","Need help choosing"]):s.includes("no")&&s.includes("thanks")?i="No problem! If you change your mind or need any event planning help, I'm always here. Have a great day! 😊":s.includes("budget")?(i="I can help you create a realistic budget! What's your approximate total budget for the event? 💷",t=["Under £5k","£5k-£10k","£10k-£20k","£20k+"]):s.includes("venue")?(i="Great question! I can help you find the perfect venue. What region are you looking in? 📍",t=["London","Scotland","Wales","Other UK"]):(i="I'm here to help with all aspects of event planning! I can assist with budget planning, venue selection, supplier recommendations, timelines, and more. What would you like to know? 😊",t=["Budget Planning","Find Venues","Get Timeline","Talk to Expert"]),{conversationId:a,message:{id:"msg-"+Date.now(),role:"assistant",content:i,timestamp:Date.now(),quickReplies:t}}}}function u(o,e,a,s,i,t,d,b,v,h){return`
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :host {
      all: initial;
      display: block;
      font-family: ${a};
      font-size: 14px;
      line-height: 1.5;
      color: #1f2937;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      
      /* CSS Custom Properties for positioning - can be overridden by consumers */
      --jade-offset-bottom: ${s};
      --jade-offset-right: ${i};
      --jade-offset-left: ${t};
      --jade-scale: ${h};
      --jade-primary-color: ${o};
      --jade-accent-color: ${e};
    }

    .jade-widget-container {
      position: fixed;
      bottom: var(--jade-offset-bottom, ${s});
      ${t?`left: var(--jade-offset-left, ${t});`:`right: var(--jade-offset-right, ${i});`}
      ${t?"right: auto;":""}
      z-index: 999999;
      transform: scale(var(--jade-scale, ${h}));
      transform-origin: ${t?"left":"right"} bottom;
    }

    /* Avatar Button */
    .jade-avatar-button {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--jade-primary-color, ${o}) 0%, var(--jade-accent-color, ${e}) 100%);
      border: 3px solid white;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      animation: float 3s ease-in-out infinite;
      /* Larger tap target using pseudo-element */
      overflow: visible;
    }

    /* Larger invisible tap target for better mobile UX */
    .jade-avatar-button::before {
      content: '';
      position: absolute;
      top: -20px;
      left: -20px;
      right: -20px;
      bottom: -20px;
      border-radius: 50%;
      /* Ensures tap events are captured in the expanded area */
    }

    .jade-avatar-button:hover {
      transform: translateY(-4px) scale(1.05);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2), 0 6px 12px rgba(0, 0, 0, 0.15);
    }

    .jade-avatar-button:active {
      transform: translateY(0) scale(0.98);
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(0px);
      }
      50% {
        transform: translateY(-10px);
      }
    }

    .jade-avatar-icon {
      width: 100%;
      height: 100%;
      color: white;
      font-size: 32px;
      border-radius: 50%;
      object-fit: cover;
    }

    .jade-avatar-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, ${o} 0%, ${e} 100%);
    }

    .jade-avatar-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      background: #ef4444;
      border: 2px solid white;
      color: white;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      animation: badgePulse 2s ease-in-out infinite;
    }

    @keyframes badgePulse {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.1);
      }
    }

    /* Greeting Tooltip */
    .jade-greeting-tooltip {
      position: absolute;
      bottom: 84px;
      ${t?"left: 0;":"right: 0;"}
      background: white;
      padding: 18px 22px;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
      max-width: 300px;
      opacity: 0;
      transform: translateY(10px);
      animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(0, 0, 0, 0.05);
    }

    .jade-greeting-tooltip:hover {
      transform: translateY(-4px);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2), 0 6px 16px rgba(0, 0, 0, 0.12);
    }

    @keyframes slideUp {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .jade-greeting-tooltip::after {
      content: '';
      position: absolute;
      bottom: -8px;
      ${t?"left: 24px;":"right: 24px;"}
      width: 16px;
      height: 16px;
      background: white;
      transform: rotate(45deg);
      box-shadow: 4px 4px 8px rgba(0, 0, 0, 0.08);
      border-right: 1px solid rgba(0, 0, 0, 0.05);
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }

    .jade-greeting-text {
      position: relative;
      z-index: 1;
      font-size: 15px;
      color: #374151;
      line-height: 1.6;
      font-weight: 500;
    }

    .jade-greeting-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: #9ca3af;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0;
      z-index: 2;
    }

    .jade-greeting-close:hover {
      color: #4b5563;
    }

    /* Chat Popup */
    .jade-chat-popup {
      position: absolute;
      bottom: 84px;
      ${t?"left: 0;":"right: 0;"}
      width: 400px;
      height: 600px;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      animation: popupOpen 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      border: 1px solid rgba(0, 0, 0, 0.08);
      overflow: hidden;
    }

    @keyframes popupOpen {
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    /* Header */
    .jade-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      background: linear-gradient(135deg, ${o} 0%, ${e} 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .jade-chat-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .jade-chat-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      border: 2px solid rgba(255, 255, 255, 0.3);
    }

    .jade-chat-title {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .jade-chat-status {
      font-size: 13px;
      opacity: 0.95;
      font-weight: 400;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .jade-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      display: inline-block;
      animation: statusPulse 2s ease-in-out infinite;
    }

    @keyframes statusPulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }

    .jade-chat-controls {
      display: flex;
      gap: 8px;
    }

    .jade-chat-minimize,
    .jade-chat-close {
      width: 32px;
      height: 32px;
      border: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      color: white;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      transition: background 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .jade-chat-minimize:hover,
    .jade-chat-close:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    /* Messages */
    .jade-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: #f9fafb;
    }

    .jade-chat-messages::-webkit-scrollbar {
      width: 6px;
    }

    .jade-chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }

    .jade-chat-messages::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 3px;
    }

    .jade-message {
      display: flex;
      gap: 8px;
      animation: messageSlide 0.3s ease;
    }

    @keyframes messageSlide {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .jade-message-user {
      flex-direction: row-reverse;
    }

    .jade-message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .jade-message-avatar.assistant {
      background: linear-gradient(135deg, ${o} 0%, ${e} 100%);
      color: white;
    }

    .jade-message-avatar.user {
      background: #e5e7eb;
      color: #6b7280;
    }

    .jade-message-content {
      max-width: 70%;
    }

    .jade-message-bubble {
      padding: 10px 14px;
      border-radius: 16px;
      word-wrap: break-word;
    }

    .jade-message-assistant .jade-message-bubble {
      background: white;
      color: #1f2937;
      border-bottom-left-radius: 4px;
    }

    .jade-message-user .jade-message-bubble {
      background: ${o};
      color: white;
      border-bottom-right-radius: 4px;
    }

    .jade-message-time {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 4px;
      padding: 0 4px;
    }

    /* Quick Replies */
    .jade-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .jade-quick-reply-btn {
      padding: 8px 16px;
      border: 1px solid ${o};
      background: white;
      color: ${o};
      border-radius: 20px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .jade-quick-reply-btn:hover {
      background: ${o};
      color: white;
    }

    /* Input Area */
    .jade-chat-input-area {
      padding: 16px 20px;
      background: white;
      border-top: 1px solid #e5e7eb;
      border-radius: 0 0 16px 16px;
    }

    .jade-chat-input-wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .jade-chat-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 20px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      resize: none;
      max-height: 100px;
      min-height: 40px;
    }

    .jade-chat-input:focus {
      border-color: ${o};
      box-shadow: 0 0 0 3px rgba(11, 128, 115, 0.1);
    }

    .jade-char-count {
      font-size: 11px;
      color: #9ca3af;
      text-align: right;
      margin-top: 4px;
      height: 16px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .jade-char-count-visible {
      opacity: 1;
    }

    .jade-chat-send-btn {
      width: 40px;
      height: 40px;
      border: none;
      background: ${o};
      color: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s ease;
    }

    .jade-chat-send-btn:hover:not(:disabled) {
      background: ${e};
      transform: scale(1.05);
    }

    .jade-chat-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Loading indicator */
    .jade-typing-indicator {
      display: flex;
      gap: 4px;
      padding: 10px 14px;
    }

    .jade-typing-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #9ca3af;
      animation: typing 1.4s infinite;
    }

    .jade-typing-dot:nth-child(2) {
      animation-delay: 0.2s;
    }

    .jade-typing-dot:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes typing {
      0%, 60%, 100% {
        transform: translateY(0);
        opacity: 0.7;
      }
      30% {
        transform: translateY(-10px);
        opacity: 1;
      }
    }

    /* Responsive */
    @media (max-width: 480px) {
      :host {
        /* Mobile-specific CSS custom properties */
        --jade-offset-bottom: ${d||s};
        --jade-offset-right: ${b||(i==="24px"?"16px":i)};
        --jade-offset-left: ${v||(t&&t==="24px"?"16px":t)};
      }
      
      .jade-widget-container {
        bottom: var(--jade-offset-bottom);
        ${t?"left: var(--jade-offset-left);":"right: var(--jade-offset-right);"}
        ${t?"right: auto;":""}
      }

      .jade-chat-popup {
        width: calc(100vw - 32px);
        /* Fallback for browsers without dvh or min() support */
        max-height: 600px;
        /* Fallback for browsers without dvh support */
        height: min(600px, calc(100vh - 120px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
        /* Modern browsers with dvh support - prevents cut-off on mobile */
        height: min(600px, calc(100dvh - 120px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)));
      }

      .jade-greeting-tooltip {
        max-width: calc(100vw - 120px);
      }
    }

    /* Hidden utility */
    .jade-hidden {
      display: none !important;
    }
  `}class m{constructor(e={}){this.config={...c,...e},this.apiClient=new p(this.config.apiBaseUrl),this.config.debug&&(console.log("[JadeWidget] Initializing with config:",this.config),console.log("[JadeWidget] Avatar URL:",this.config.avatarUrl)),this.escapeKeyHandler=t=>{t.key==="Escape"&&this.state.isOpen&&this.closeChat()};const a=n.loadState(),s=n.loadMessages(),i=n.loadConversationId();this.state={isOpen:a.isOpen||!1,isMinimized:a.isMinimized||!1,showGreeting:!1,conversationId:i||void 0,messages:s.length>0?s:this.getInitialMessages()},this.container=document.createElement("div"),this.container.className="jade-widget-root",this.shadowRoot=this.container.attachShadow({mode:"open"}),this.render(),this.attachEventListeners()}getInitialMessages(){return[{id:"initial",role:"assistant",content:this.config.greetingText,timestamp:Date.now(),quickReplies:["Yes, please","No, thanks"]}]}render(){const e=u(this.config.primaryColor,this.config.accentColor,this.config.fontFamily,this.config.offsetBottom,this.config.offsetRight,this.config.offsetLeft,this.config.offsetBottomMobile,this.config.offsetRightMobile,this.config.offsetLeftMobile,this.config.scale);this.shadowRoot.innerHTML=`
      <style>${e}</style>
      <div class="jade-widget-container">
        ${this.renderAvatar()}
        ${this.state.showGreeting&&!this.state.isOpen?this.renderGreeting():""}
        ${this.state.isOpen?this.renderChatPopup():""}
      </div>
    `}renderAvatar(){const e=this.config.avatarUrl?`<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="Chat Assistant" class="jade-avatar-icon jade-avatar-img" />
         <span class="jade-avatar-icon jade-avatar-fallback" style="display:none;">💬</span>`:'<span class="jade-avatar-icon">💬</span>',a=this.state.showGreeting&&!this.state.isOpen?'<span class="jade-avatar-badge" aria-label="1 new notification">1</span>':"";return`
      <button class="jade-avatar-button" aria-label="Toggle chat" data-action="toggle-chat">
        ${e}
        ${a}
      </button>
    `}renderGreeting(){return`
      <div class="jade-greeting-tooltip" data-action="open-chat" role="tooltip" aria-live="polite">
        <button class="jade-greeting-close" aria-label="Dismiss greeting" data-action="close-greeting">×</button>
        <div class="jade-greeting-text">${this.escapeHtml(this.config.greetingTooltipText)}</div>
      </div>
    `}renderChatPopup(){return`
      <div class="jade-chat-popup" role="dialog" aria-label="Chat">
        ${this.renderHeader()}
        ${this.renderMessages()}
        ${this.renderInputArea()}
      </div>
    `}renderHeader(){return`
      <div class="jade-chat-header">
        <div class="jade-chat-header-left">
          <div class="jade-chat-avatar">
            ${this.config.avatarUrl?`<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="${this.escapeHtml(this.config.assistantName)}" class="jade-header-avatar-img" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`:"💬"}
          </div>
          <div>
            <div class="jade-chat-title">${this.escapeHtml(this.config.assistantName)}</div>
            <div class="jade-chat-status"><span class="jade-status-dot"></span>Online</div>
          </div>
        </div>
        <div class="jade-chat-controls">
          <button class="jade-chat-minimize" aria-label="Minimize chat" data-action="minimize-chat" title="Minimize">−</button>
          <button class="jade-chat-close" aria-label="Close chat" data-action="close-chat" title="Close">×</button>
        </div>
      </div>
    `}renderMessages(){return`
      <div class="jade-chat-messages" data-messages-container>
        ${this.state.messages.map(a=>this.renderMessage(a)).join("")}
      </div>
    `}renderMessage(e){const a=e.role==="user",s=new Date(e.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),i=!a&&e.quickReplies?`
      <div class="jade-quick-replies">
        ${e.quickReplies.map(t=>`<button class="jade-quick-reply-btn" data-action="quick-reply" data-reply="${this.escapeHtml(t)}">${this.escapeHtml(t)}</button>`).join("")}
      </div>
    `:"";return`
      <div class="jade-message jade-message-${e.role}" data-message-id="${e.id}">
        <div class="jade-message-avatar ${e.role}">
          ${a?"👤":"💬"}
        </div>
        <div class="jade-message-content">
          <div class="jade-message-bubble">${this.escapeHtml(e.content)}</div>
          <div class="jade-message-time">${s}</div>
          ${i}
        </div>
      </div>
    `}renderInputArea(){return`
      <div class="jade-chat-input-area">
        <div class="jade-chat-input-wrapper">
          <textarea 
            class="jade-chat-input" 
            placeholder="Type your message..."
            rows="1"
            aria-label="Message input"
            maxlength="1000"
            data-input
          ></textarea>
          <button class="jade-chat-send-btn" aria-label="Send message" data-action="send" title="Send">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 1L7 9M15 1L10 15L7 9M15 1L1 6L7 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="jade-char-count" aria-live="polite" aria-atomic="true"></div>
      </div>
    `}attachEventListeners(){this.shadowRoot.addEventListener("click",s=>{const i=s.target,t=i.getAttribute("data-action");if(t==="toggle-chat")this.toggleChat();else if(t==="open-chat")this.openChat();else if(t==="close-chat")this.closeChat();else if(t==="minimize-chat")this.minimizeChat();else if(t==="close-greeting")s.stopPropagation(),this.closeGreeting();else if(t==="send")this.handleSend();else if(t==="quick-reply"){const d=i.getAttribute("data-reply");d&&this.handleQuickReply(d)}}),this.shadowRoot.addEventListener("keydown",s=>{const i=s;s.target.hasAttribute("data-input")&&i.key==="Enter"&&!i.shiftKey&&(s.preventDefault(),this.handleSend())}),document.addEventListener("keydown",this.escapeKeyHandler),this.shadowRoot.addEventListener("input",s=>{const i=s.target;if(i.hasAttribute("data-input")){i.style.height="auto",i.style.height=Math.min(i.scrollHeight,100)+"px";const t=this.shadowRoot.querySelector(".jade-char-count");if(t){const d=i.value.length;d>1e3*.8?(t.textContent=`${d}/1000`,t.classList.add("jade-char-count-visible")):(t.textContent="",t.classList.remove("jade-char-count-visible"))}}});const e=this.shadowRoot.querySelector(".jade-avatar-img");e&&(e.addEventListener("error",()=>{this.config.debug&&console.error("[JadeWidget] Failed to load avatar image:",this.config.avatarUrl),e.setAttribute("style","display:none;");const s=this.shadowRoot.querySelector(".jade-avatar-fallback");s&&s.setAttribute("style","display:flex;")}),e.addEventListener("load",()=>{this.config.debug&&console.log("[JadeWidget] Avatar image loaded successfully:",this.config.avatarUrl)}));const a=this.shadowRoot.querySelector(".jade-header-avatar-img");a&&(a.addEventListener("error",()=>{this.config.debug&&console.error("[JadeWidget] Failed to load header avatar image:",this.config.avatarUrl);const s=a.parentElement;s&&(s.innerHTML="💬")}),a.addEventListener("load",()=>{this.config.debug&&console.log("[JadeWidget] Header avatar image loaded successfully:",this.config.avatarUrl)}))}toggleChat(){this.state.isOpen?this.closeChat():this.openChat()}openChat(){this.state.isOpen=!0,this.state.showGreeting=!1,this.greetingTimeout&&clearTimeout(this.greetingTimeout),n.setGreetingDismissed(),n.saveState({isOpen:!0,showGreeting:!1}),this.render(),this.scrollToBottom(),this.focusInput()}closeChat(){this.state.isOpen=!1,n.saveState({isOpen:!1}),this.render()}minimizeChat(){this.state.isMinimized=!0,this.state.isOpen=!1,n.saveState({isOpen:!1,isMinimized:!0}),this.render()}closeGreeting(){this.state.showGreeting=!1,n.setGreetingDismissed(),this.render()}async handleSend(){const e=this.shadowRoot.querySelector("[data-input]");if(!e)return;const a=e.value.trim();if(!a)return;const s={id:"user-"+Date.now(),role:"user",content:a,timestamp:Date.now()};this.state.messages.push(s),n.saveMessages(this.state.messages),e.value="",e.style.height="auto",this.render(),this.scrollToBottom(),this.showTypingIndicator();try{const i=await this.apiClient.sendMessage(a,this.state.conversationId);this.state.conversationId||(this.state.conversationId=i.conversationId,n.saveConversationId(i.conversationId)),this.state.messages.push(i.message),n.saveMessages(this.state.messages),this.removeTypingIndicator(),this.render(),this.scrollToBottom(),this.focusInput()}catch(i){console.error("Failed to send message:",i),this.removeTypingIndicator();const t={id:"error-"+Date.now(),role:"assistant",content:"I'm sorry, I'm having trouble connecting. Please try again.",timestamp:Date.now()};this.state.messages.push(t),n.saveMessages(this.state.messages),this.render(),this.scrollToBottom()}}handleQuickReply(e){const a=this.shadowRoot.querySelector("[data-input]");a&&(a.value=e,this.handleSend())}showTypingIndicator(){this.removeTypingIndicator();const e=this.shadowRoot.querySelector("[data-messages-container]");if(e){const a=document.createElement("div");a.className="jade-message jade-message-assistant",a.setAttribute("data-typing-indicator",""),a.innerHTML=`
        <div class="jade-message-avatar assistant">💬</div>
        <div class="jade-message-content">
          <div class="jade-message-bubble">
            <div class="jade-typing-indicator">
              <div class="jade-typing-dot"></div>
              <div class="jade-typing-dot"></div>
              <div class="jade-typing-dot"></div>
            </div>
          </div>
        </div>
      `,e.appendChild(a),this.scrollToBottom()}}removeTypingIndicator(){const e=this.shadowRoot.querySelector("[data-typing-indicator]");e&&e.remove()}scrollToBottom(){setTimeout(()=>{const e=this.shadowRoot.querySelector("[data-messages-container]");e&&(e.scrollTop=e.scrollHeight)},100)}focusInput(){setTimeout(()=>{const e=this.shadowRoot.querySelector("[data-input]");e&&e.focus()},100)}escapeHtml(e){const a=document.createElement("div");return a.textContent=e,a.innerHTML}shouldShowGreeting(){const e=n.loadMessages(),a=e.length===0||e.length===1;return!this.state.isOpen&&a&&!n.isGreetingDismissed()}mount(e){(e||document.body).appendChild(this.container),this.shouldShowGreeting()&&(this.greetingTimeout=window.setTimeout(()=>{this.state.showGreeting=!0,this.render()},1e3))}unmount(){this.container.remove(),this.greetingTimeout&&clearTimeout(this.greetingTimeout),document.removeEventListener("keydown",this.escapeKeyHandler)}open(){this.openChat()}close(){this.closeChat()}toggle(){this.toggleChat()}reset(){n.clearAll(),this.state={isOpen:!1,isMinimized:!1,showGreeting:!1,messages:this.getInitialMessages()},this.render()}}function f(o){var a;(a=window.JadeWidget)!=null&&a.instance&&window.JadeWidget.instance.unmount();const e=(o==null?void 0:o.showDelayMs)??c.showDelayMs;setTimeout(()=>{const s=new m(o);s.mount(),window.JadeWidget&&(window.JadeWidget.instance=s)},e)}const g={init:f};typeof window<"u"&&(window.JadeWidget=g),l.default=g,Object.defineProperties(l,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}})})(this.JadeWidget=this.JadeWidget||{});
