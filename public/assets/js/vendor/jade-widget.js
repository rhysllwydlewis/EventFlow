(function (w) {
  'use strict';
  const y = 'jade-launcher-assets-style',
    S = 'jadeassist:widget-dismissed',
    T = 'jadeassist:widget-restored';
  class E {
    constructor(e, a, s) {
      ((this.decorating = !1), (this.root = e), (this.widget = a), (this.config = s));
    }
    start() {
      this.hasActiveDismissal() ? this.setVisible(!1) : (this.setVisible(!0), this.decorate());
      const e = this.root.shadowRoot;
      e &&
        ((this.observer = new MutationObserver(() => this.decorate())),
        this.observer.observe(e, { childList: !0, subtree: !0 }));
    }
    destroy() {
      var e;
      ((e = this.observer) == null || e.disconnect(), (this.observer = void 0));
    }
    hide(e = 'api') {
      (this.widget.close(),
        this.persistDismissal(),
        this.setVisible(!1),
        window.dispatchEvent(new CustomEvent(S, { detail: { source: e, timestamp: Date.now() } })));
    }
    show(e = 'api') {
      (this.clearDismissal(),
        this.setVisible(!0),
        this.decorate(),
        window.dispatchEvent(new CustomEvent(T, { detail: { source: e, timestamp: Date.now() } })));
    }
    isVisible() {
      return this.root.isConnected && !this.root.hidden;
    }
    isOpen() {
      var e;
      return !!((e = this.root.shadowRoot) != null && e.querySelector('.jade-chat-popup'));
    }
    decorate() {
      if (this.decorating || !this.isVisible()) return;
      const e = this.root.shadowRoot;
      if (e) {
        this.decorating = !0;
        try {
          (this.ensureStyles(e),
            this.decorateAvatar(e),
            this.decorateNotificationBadge(e),
            this.ensureDismissButton(e));
        } finally {
          this.decorating = !1;
        }
      }
    }
    ensureStyles(e) {
      if (e.getElementById(y)) return;
      const a = document.createElement('style');
      ((a.id = y),
        (a.textContent = `
      .jade-widget-container {
        overflow: visible !important;
      }

      .jade-avatar-button {
        border: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }

      .jade-avatar-button:focus-visible {
        outline: 3px solid rgba(0, 178, 169, 0.55);
        outline-offset: 4px;
      }

      .jade-avatar-img {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
      }

      .jade-avatar-badge {
        top: -10px !important;
        right: -10px !important;
        width: 30px !important;
        min-width: 30px !important;
        height: 30px !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 50% !important;
        background: transparent !important;
        box-shadow: none !important;
        overflow: visible !important;
      }

      .jade-avatar-badge-asset {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        pointer-events: none;
      }

      .jade-launcher-dismiss {
        position: absolute;
        top: -10px;
        left: -10px;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        cursor: pointer;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 160ms ease, filter 160ms ease;
        -webkit-tap-highlight-color: transparent;
      }

      .jade-launcher-dismiss::before {
        content: '';
        position: absolute;
        width: 44px;
        height: 44px;
        border-radius: 50%;
      }

      .jade-launcher-dismiss:hover {
        transform: scale(1.08);
        filter: brightness(0.96);
      }

      .jade-launcher-dismiss:active {
        transform: scale(0.96);
      }

      .jade-launcher-dismiss:focus-visible {
        outline: 3px solid rgba(75, 85, 99, 0.5);
        outline-offset: 3px;
      }

      .jade-launcher-dismiss-asset {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        pointer-events: none;
      }

      .jade-launcher-dismiss-fallback {
        display: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        align-items: center;
        justify-content: center;
        background: #9ca3af;
        color: #fff;
        font-size: 16px;
        line-height: 1;
        font-weight: 700;
        pointer-events: none;
      }

      @media (max-width: 480px) {
        .jade-avatar-badge,
        .jade-launcher-dismiss {
          width: 28px !important;
          min-width: 28px !important;
          height: 28px !important;
        }
      }
    `),
        e.appendChild(a));
    }
    decorateAvatar(e) {
      const a = e.querySelector('.jade-avatar-img');
      a && ((a.alt = `${this.config.assistantName} chat assistant`), (a.decoding = 'async'));
    }
    decorateNotificationBadge(e) {
      const a = e.querySelector('.jade-avatar-badge');
      if (!a || a.dataset.assetEnhanced === 'true') return;
      ((a.dataset.assetEnhanced = 'true'), (a.textContent = ''));
      const s = document.createElement('img');
      ((s.className = 'jade-avatar-badge-asset'),
        (s.src = this.config.notificationBadgeUrl),
        (s.alt = ''),
        s.setAttribute('aria-hidden', 'true'),
        (s.decoding = 'async'),
        s.addEventListener('error', () => {
          (s.remove(), (a.textContent = '1'));
        }),
        a.appendChild(s));
    }
    ensureDismissButton(e) {
      var i;
      if (!this.config.launcherDismissible) {
        (i = e.querySelector('.jade-launcher-dismiss')) == null || i.remove();
        return;
      }
      const a = e.querySelector('.jade-widget-container');
      if (!a || a.querySelector('.jade-launcher-dismiss')) return;
      const s = document.createElement('button');
      ((s.type = 'button'),
        (s.className = 'jade-launcher-dismiss'),
        s.setAttribute('aria-label', `Hide ${this.config.assistantName} chat assistant`),
        (s.title = `Hide ${this.config.assistantName}`));
      const o = document.createElement('img');
      ((o.className = 'jade-launcher-dismiss-asset'),
        (o.src = this.config.closeButtonUrl),
        (o.alt = ''),
        o.setAttribute('aria-hidden', 'true'),
        (o.decoding = 'async'));
      const t = document.createElement('span');
      ((t.className = 'jade-launcher-dismiss-fallback'),
        (t.textContent = '×'),
        t.setAttribute('aria-hidden', 'true'),
        o.addEventListener('error', () => {
          ((o.style.display = 'none'), (t.style.display = 'flex'));
        }),
        s.append(o, t),
        s.addEventListener('click', n => {
          (n.preventDefault(), n.stopPropagation(), this.hide('launcher-close-button'));
        }),
        a.appendChild(s));
    }
    hasActiveDismissal() {
      if (this.config.launcherDismissDurationMs <= 0) return !1;
      try {
        const e = localStorage.getItem(this.config.launcherDismissStorageKey);
        if (!e) return !1;
        const a = Number(e),
          s = Number.isFinite(a) && Date.now() - a < this.config.launcherDismissDurationMs;
        return (s || localStorage.removeItem(this.config.launcherDismissStorageKey), s);
      } catch {
        return !1;
      }
    }
    persistDismissal() {
      if (!(this.config.launcherDismissDurationMs <= 0))
        try {
          localStorage.setItem(this.config.launcherDismissStorageKey, String(Date.now()));
        } catch {}
    }
    clearDismissal() {
      try {
        localStorage.removeItem(this.config.launcherDismissStorageKey);
      } catch {}
    }
    setVisible(e) {
      ((this.root.hidden = !e),
        e
          ? this.root.removeAttribute('aria-hidden')
          : this.root.setAttribute('aria-hidden', 'true'));
    }
  }
  const b = 1e3,
    x = 'https://cdn.jsdelivr.net/gh/rhysllwydlewis/JadeAssist@main/packages/widget/assets',
    M = `${x}/jadeassist-agent.png`,
    $ = `${x}/jadeassist-notification-badge.png`,
    C = `${x}/jadeassist-close-button.png`,
    j = {
      apiBaseUrl: '',
      authToken: '',
      assistantName: 'Jade',
      greetingText:
        "Hi! 👋 I'm Jade, your event planning assistant. Can I help you plan your special day?",
      greetingTooltipText: '👋 Hi! Need help planning your event?',
      avatarUrl: M,
      notificationBadgeUrl: $,
      closeButtonUrl: C,
      launcherDismissible: !0,
      launcherDismissStorageKey: 'jade-widget-launcher-dismissed-at',
      launcherDismissDurationMs: 30 * 24 * 60 * 60 * 1e3,
      primaryColor: '#0B8073',
      accentColor: '#13B6A2',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      showDelayMs: 1e3,
      offsetBottom: '80px',
      offsetRight: '24px',
      offsetLeft: '',
      offsetBottomMobile: '',
      offsetRightMobile: '',
      offsetLeftMobile: '',
      scale: 1,
      debug: !1,
      enableSpeechInput: !1,
      enableSpeechOutput: !1,
      speechLanguage: 'en-GB',
    },
    c = {
      STATE: 'jade-widget-state',
      MESSAGES: 'jade-widget-messages',
      CONVERSATION_ID: 'jade-widget-conversation-id',
      GREETING_DISMISSED: 'jade-widget-greeting-dismissed',
      SOUND_ENABLED: 'jade-widget-sound-enabled',
      SOUND_VOLUME: 'jade-widget-sound-volume',
    };
  class l {
    static saveState(e) {
      try {
        const s = { ...this.loadState(), ...e };
        localStorage.setItem(c.STATE, JSON.stringify(s));
      } catch (a) {
        console.warn('Failed to save widget state:', a);
      }
    }
    static loadState() {
      try {
        const e = localStorage.getItem(c.STATE);
        return e ? JSON.parse(e) : {};
      } catch (e) {
        return (console.warn('Failed to load widget state:', e), {});
      }
    }
    static saveMessages(e) {
      try {
        localStorage.setItem(c.MESSAGES, JSON.stringify(e));
      } catch (a) {
        console.warn('Failed to save messages:', a);
      }
    }
    static loadMessages() {
      try {
        const e = localStorage.getItem(c.MESSAGES);
        return e ? JSON.parse(e) : [];
      } catch (e) {
        return (console.warn('Failed to load messages:', e), []);
      }
    }
    static saveConversationId(e) {
      try {
        localStorage.setItem(c.CONVERSATION_ID, e);
      } catch (a) {
        console.warn('Failed to save conversation ID:', a);
      }
    }
    static loadConversationId() {
      try {
        return localStorage.getItem(c.CONVERSATION_ID);
      } catch (e) {
        return (console.warn('Failed to load conversation ID:', e), null);
      }
    }
    static clearAll() {
      try {
        (localStorage.removeItem(c.STATE),
          localStorage.removeItem(c.MESSAGES),
          localStorage.removeItem(c.CONVERSATION_ID),
          localStorage.removeItem(c.GREETING_DISMISSED));
      } catch (e) {
        console.warn('Failed to clear storage:', e);
      }
    }
    static isGreetingDismissed() {
      try {
        return localStorage.getItem(c.GREETING_DISMISSED) === 'true';
      } catch (e) {
        return (console.warn('Failed to check greeting dismissed state:', e), !1);
      }
    }
    static setGreetingDismissed() {
      try {
        localStorage.setItem(c.GREETING_DISMISSED, 'true');
      } catch (e) {
        console.warn('Failed to save greeting dismissed state:', e);
      }
    }
    static loadSoundEnabled() {
      try {
        const e = localStorage.getItem(c.SOUND_ENABLED);
        return e === null ? !1 : e === 'true';
      } catch (e) {
        return (console.warn('Failed to load sound enabled state:', e), !1);
      }
    }
    static saveSoundEnabled(e) {
      try {
        localStorage.setItem(c.SOUND_ENABLED, String(e));
      } catch (a) {
        console.warn('Failed to save sound enabled state:', a);
      }
    }
    static loadSoundVolume() {
      try {
        const e = localStorage.getItem(c.SOUND_VOLUME);
        if (e === null) return 0.5;
        const a = parseFloat(e);
        return isNaN(a) ? 0.5 : Math.min(1, Math.max(0, a));
      } catch (e) {
        return (console.warn('Failed to load sound volume:', e), 0.5);
      }
    }
    static saveSoundVolume(e) {
      try {
        localStorage.setItem(c.SOUND_VOLUME, String(e));
      } catch (a) {
        console.warn('Failed to save sound volume:', a);
      }
    }
  }
  function k() {
    if (typeof window > 'u') return !1;
    const r = window.location.hostname.toLowerCase();
    return !['localhost', '127.0.0.1', '0.0.0.0'].includes(r) && !r.endsWith('.local');
  }
  function I(r, e = 0.75) {
    return {
      mode: r,
      confidence: e,
      uiActions: r === 'degraded' ? [{ type: 'show_degraded_mode_banner' }] : [],
    };
  }
  class A {
    constructor(e, a) {
      ((this.demoState = {}),
        (this.baseUrl = e || ''),
        (this.authToken = a || ''),
        (this.demoMode = !e),
        this.demoMode &&
          k() &&
          console.warn(
            '[JadeAssist] apiBaseUrl is not configured on a production-like host. The widget will show explicit degraded guidance rather than silent demo-mode intelligence.'
          ));
    }
    async sendMessage(e, a) {
      var n, u, p, m, f;
      if (this.demoMode) return this.mockResponse(e);
      const s = { 'Content-Type': 'application/json' };
      this.authToken && (s.Authorization = `Bearer ${this.authToken}`);
      const o = await fetch(`${this.baseUrl}/api/widget/chat`, {
          method: 'POST',
          headers: s,
          body: JSON.stringify({ message: e, conversationId: a, userId: 'anonymous' }),
        }),
        t = await this.parseJsonResponse(o);
      if (
        o.status === 421 &&
        ((n = t == null ? void 0 : t.error) == null ? void 0 : n.code) === 'WRONG_SERVICE'
      )
        throw new Error(
          'The JadeAssist widget is pointed at the widget/static Railway service instead of the backend API service. Update apiBaseUrl to the backend service domain.'
        );
      if (o.status === 429)
        throw new Error(
          ((u = t == null ? void 0 : t.error) == null ? void 0 : u.message) ||
            '429: Rate limit exceeded. Please wait and try again.'
        );
      if (o.status === 401 || o.status === 403)
        throw new Error(
          ((p = t == null ? void 0 : t.error) == null ? void 0 : p.message) ||
            `${o.status}: Authentication failed.`
        );
      if (!o.ok)
        throw new Error(
          ((m = t == null ? void 0 : t.error) == null ? void 0 : m.message) ||
            `API error: ${o.status}`
        );
      if (!(t != null && t.success) || !t.data)
        throw new Error(
          ((f = t == null ? void 0 : t.error) == null ? void 0 : f.message) || 'API request failed'
        );
      const i = t.data.assistantResponse
        ? {
            mode: t.data.assistantResponse.mode,
            confidence: t.data.assistantResponse.confidence,
            nextQuestion: t.data.assistantResponse.nextQuestion,
            uiActions: t.data.assistantResponse.uiActions,
            statePatch: t.data.assistantResponse.statePatch,
          }
        : void 0;
      return {
        conversationId: t.data.conversationId,
        conversation: t.data.conversation,
        searchResults: t.data.searchResults,
        message: {
          id: t.data.message.id,
          role: 'assistant',
          content: t.data.message.content,
          timestamp: Date.now(),
          quickReplies: t.data.suggestions,
          assistantMeta: i,
        },
      };
    }
    async parseJsonResponse(e) {
      if (!(e.headers.get('content-type') || '').includes('application/json')) return null;
      try {
        return await e.json();
      } catch (s) {
        return (console.warn('Failed to parse JadeAssist API response:', s), null);
      }
    }
    async mockResponse(e) {
      await new Promise(n => setTimeout(n, 700 + Math.random() * 400));
      const a = 'demo-' + Date.now(),
        s = e.toLowerCase();
      this.updateDemoState(s);
      const { content: o, quickReplies: t } = this.buildDemoResponse(s),
        i = k() ? 'Jade is not connected to the live planning service on this page. ' : '';
      return {
        conversationId: a,
        conversation: {
          eventType: this.demoState.eventType,
          guestCount: this.demoState.guestCount ? Number(this.demoState.guestCount) : void 0,
          budget:
            (this.demoState.budget && Number(this.demoState.budget.replace(/[^0-9]/g, ''))) ||
            void 0,
          location: this.demoState.location,
          planningStage: this.demoState.eventType ? 'brief-building' : 'discovery',
          contextCompleteness: Object.values(this.demoState).filter(Boolean).length * 20,
        },
        message: {
          id: 'msg-' + Date.now(),
          role: 'assistant',
          content: `${i}${o}`,
          timestamp: Date.now(),
          quickReplies: t,
          assistantMeta: I('degraded', 0.45),
        },
      };
    }
    updateDemoState(e) {
      (e.includes('wedding') || e.includes('civil partnership')
        ? (this.demoState.eventType = 'wedding')
        : e.includes('birthday')
          ? (this.demoState.eventType = 'birthday')
          : e.includes('corporate') ||
              e.includes('away day') ||
              e.includes('away-day') ||
              e.includes('work event')
            ? (this.demoState.eventType = 'corporate')
            : e.includes('conference') || e.includes('seminar')
              ? (this.demoState.eventType = 'conference')
              : e.includes('anniversary')
                ? (this.demoState.eventType = 'anniversary')
                : (e.includes('party') || e.includes('celebration')) &&
                  (this.demoState.eventType = 'party'),
        /under\s*[£$]?5k\b/i.test(e) || /under\s*£?5,000\b/.test(e)
          ? (this.demoState.budget = 'under £5,000')
          : /\b[£$]?50k\b|\b50,000\b/.test(e)
            ? (this.demoState.budget = '£50,000+')
            : /\b[£$]?20k\b|\b20,000\b/.test(e)
              ? (this.demoState.budget = '£20,000–£50,000')
              : /\b[£$]?10k\b|\b10,000\b/.test(e)
                ? (this.demoState.budget = '£10,000–£20,000')
                : /\b[£$]?5k\b|\b5,000\b/.test(e) && (this.demoState.budget = '£5,000–£10,000'));
      const a = /\b(\d{1,3}(?:,\d{3})*|\d+)\s*(guests?|people|attendees?|pax)\b/.exec(e);
      (a
        ? (this.demoState.guestCount = a[1].replace(/,/g, ''))
        : e.includes('under 30') || e.includes('intimate')
          ? (this.demoState.guestCount = '20–30')
          : (e.includes('150+') || e.includes('large')) && (this.demoState.guestCount = '150+'),
        e.includes('london')
          ? (this.demoState.location = 'London')
          : e.includes('scotland') || e.includes('edinburgh') || e.includes('glasgow')
            ? (this.demoState.location = 'Scotland')
            : e.includes('south wales')
              ? (this.demoState.location = 'South Wales')
              : e.includes('north wales')
                ? (this.demoState.location = 'North Wales')
                : e.includes('wales') || e.includes('cardiff')
                  ? (this.demoState.location = 'Wales')
                  : e.includes('north west') || e.includes('manchester') || e.includes('liverpool')
                    ? (this.demoState.location = 'North West')
                    : e.includes('yorkshire') || e.includes('leeds') || e.includes('sheffield')
                      ? (this.demoState.location = 'Yorkshire')
                      : e.includes('south east') ||
                          e.includes('surrey') ||
                          e.includes('kent') ||
                          e.includes('sussex')
                        ? (this.demoState.location = 'South East')
                        : e.includes('midlands') || e.includes('birmingham')
                          ? (this.demoState.location = 'Midlands')
                          : (e.includes('south west') ||
                              e.includes('bristol') ||
                              e.includes('cornwall') ||
                              e.includes('devon')) &&
                            (this.demoState.location = 'South West'),
        e.includes('this year')
          ? (this.demoState.eventDate = 'this year')
          : e.includes('next year') && (this.demoState.eventDate = 'next year'));
    }
    buildDemoResponse(e) {
      const a = this.demoState;
      return ((e.includes('yes') && e.includes('please')) ||
        e === 'help' ||
        e === 'start' ||
        e === 'hi' ||
        e === 'hello' ||
        e === 'hey') &&
        !a.eventType
        ? {
            content:
              "I'm in degraded demo mode, but I can still help you capture the brief manually. What type of event are you organising? 🎉",
            quickReplies: ['Wedding', 'Birthday Party', 'Corporate Event', 'Anniversary', 'Other'],
          }
        : e.includes('no') && e.includes('thanks')
          ? {
              content:
                "No problem — I'm here whenever you're ready. Feel free to come back any time! 😊",
            }
          : this.buildDetailedDemoResponse(e, a);
    }
    buildDetailedDemoResponse(e, a) {
      const s = a.eventType || 'event',
        o = a.location || 'your area';
      return e.includes('venue') ||
        e.includes('supplier') ||
        e.includes('search') ||
        e.includes('recommend')
        ? {
            content: `I'm in degraded demo mode. In live mode I can search EventFlow suppliers and website sections. For now, here is the supplier approach I would use for a ${s} in ${o}:

- Shortlist 3 options so you can compare like-for-like.
- Ask for full written quotes, not headline prices.
- Check insurance, cancellation terms, setup times and what is included.
- For venues, confirm capacity, access, curfew and wet-weather options.

In live mode, I would return actual supplier or website results from EventFlow where available.`,
            quickReplies: [
              'Budget breakdown',
              'Venue checklist',
              'Planning timeline',
              'Supplier questions',
            ],
          }
        : e.includes('budget') || e.includes('cost') || e.includes('price')
          ? {
              content: `I'm in degraded demo mode. For a ${s} in ${o}, start with this practical budget split:

- Venue: 25–35%
- Food and drink: 30–40%
- Photography, entertainment or main experience: 10–20%
- Styling, stationery and extras: 10–15%
- Contingency: keep 10% back

If you give me your guest count and rough budget, I can make the numbers more specific.`,
              quickReplies: ['Venue checklist', 'Planning timeline', 'Supplier questions'],
            }
          : e.includes('timeline') ||
              e.includes('schedule') ||
              e.includes('when') ||
              e.includes('plan')
            ? {
                content: `I'm in degraded demo mode. A sensible ${s} planning order is:

- Confirm budget, guest count and location.
- Shortlist and secure the venue/date.
- Book key suppliers that affect availability.
- Confirm guest communication, timings and layout.
- In the final month, lock final numbers, balances and the day schedule.`,
                quickReplies: ['Find suppliers', 'Budget breakdown', 'Venue checklist'],
              }
            : {
                content:
                  "I'm in degraded demo mode. To give you useful advice, what type of event are you planning?",
                quickReplies: [
                  'Wedding',
                  'Birthday Party',
                  'Corporate Event',
                  'Anniversary',
                  'Other',
                ],
              };
    }
  }
  function D(r, e, a, s, o, t, i, n, u, p) {
    return `
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
      --jade-offset-right: ${o};
      --jade-offset-left: ${t};
      --jade-scale: ${p};
      --jade-primary-color: ${r};
      --jade-accent-color: ${e};
    }

    .jade-widget-container {
      position: fixed;
      bottom: var(--jade-offset-bottom, ${s});
      ${t ? `left: var(--jade-offset-left, ${t});` : `right: var(--jade-offset-right, ${o});`}
      ${t ? 'right: auto;' : ''}
      z-index: 999999;
      transform: scale(var(--jade-scale, ${p}));
      transform-origin: ${t ? 'left' : 'right'} bottom;
    }

    /* Avatar Button */
    .jade-avatar-button {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--jade-primary-color, ${r}) 0%, var(--jade-accent-color, ${e}) 100%);
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
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
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
      ${t ? 'left: 0;' : 'right: 0;'}
      background: white;
      padding: 18px 42px 18px 22px;
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
      ${t ? 'left: 24px;' : 'right: 24px;'}
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
      top: 4px;
      right: 4px;
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: #9ca3af;
      cursor: pointer;
      padding: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }

    .jade-greeting-close:hover {
      color: #4b5563;
    }

    .jade-greeting-close:focus-visible {
      outline: 2px solid #9ca3af;
      outline-offset: 2px;
    }

    /* Chat Popup */
    .jade-chat-popup {
      position: absolute;
      bottom: 84px;
      ${t ? 'left: 0;' : 'right: 0;'}
      width: 400px;
      height: 600px;
      border-radius: 22px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      animation: popupOpen 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      border: 1px solid rgba(0, 0, 0, 0.06);
      /* overflow: visible so the settings menu panel is never clipped */
      overflow: visible;
    }

    /* Inner content wrapper — provides overflow clipping for rounded corners */
    .jade-chat-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      border-radius: 22px;
      background: white;
      width: 100%;
      height: 100%;
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
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
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

    /* Menu button */
    .jade-menu-btn {
      width: 32px;
      height: 32px;
      border: none;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: white;
      cursor: pointer;
      transition: background 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .jade-menu-btn:hover {
      background: rgba(255, 255, 255, 0.28);
    }

    .jade-menu-btn--open {
      background: rgba(255, 255, 255, 0.3);
      box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.5);
    }

    .jade-menu-btn:focus-visible {
      outline: 2px solid rgba(255,255,255,0.85);
      outline-offset: 2px;
    }

    /* Settings menu panel */
    .jade-menu-panel {
      position: absolute;
      top: 68px;
      right: 14px;
      background: white;
      border: 1px solid rgba(0,0,0,0.09);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.14), 0 3px 10px rgba(0,0,0,0.08);
      z-index: 30;
      min-width: 232px;
      padding: 6px 0;
      animation: jade-menu-enter 0.17s cubic-bezier(0.2, 0, 0, 1.2);
    }

    @keyframes jade-menu-enter {
      from { opacity: 0; transform: translateY(-8px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .jade-menu-item {
      display: flex;
      align-items: center;
      gap: 11px;
      width: 100%;
      padding: 11px 16px;
      background: none;
      border: none;
      font-size: 13.5px;
      font-family: inherit;
      color: #1f2937;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
      line-height: 1.4;
    }

    .jade-menu-item svg {
      flex-shrink: 0;
      opacity: 0.65;
    }

    .jade-menu-item:hover {
      background: #f3f4f6;
    }

    .jade-menu-item:hover svg {
      opacity: 0.9;
    }

    .jade-menu-item:focus-visible {
      outline: none;
      background: #e5e7eb;
    }

    .jade-menu-item--danger {
      color: #dc2626;
    }

    .jade-menu-item--danger svg {
      opacity: 0.75;
    }

    .jade-menu-item--danger:hover {
      background: #fff1f1;
    }

    .jade-menu-item--disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .jade-menu-divider {
      height: 1px;
      background: rgba(0,0,0,0.07);
      margin: 5px 0;
    }

    /* Sound toggle row */
    .jade-menu-sound-row {
      justify-content: space-between;
      cursor: default;
      user-select: none;
    }

    .jade-menu-sound-row:hover {
      background: none;
    }

    .jade-menu-sound-label {
      display: flex;
      align-items: center;
      gap: 11px;
      color: #1f2937;
      font-size: 13.5px;
    }

    .jade-menu-sound-label svg {
      opacity: 0.65;
    }

    /* Toggle switch */
    .jade-sound-toggle {
      position: relative;
      width: 40px;
      height: 23px;
      background: #d1d5db;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.22s ease;
      flex-shrink: 0;
      padding: 0;
    }

    .jade-sound-toggle--on {
      background: ${r};
    }

    .jade-sound-toggle-knob {
      position: absolute;
      top: 3.5px;
      left: 3.5px;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      transition: transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      pointer-events: none;
    }

    .jade-sound-toggle--on .jade-sound-toggle-knob {
      transform: translateX(17px);
    }

    .jade-sound-toggle:focus-visible {
      outline: 2px solid ${r};
      outline-offset: 2px;
    }

    /* Volume row */
    .jade-menu-volume-row {
      gap: 10px;
      flex-wrap: nowrap;
      cursor: default;
      padding-top: 8px;
      padding-bottom: 10px;
    }

    .jade-menu-volume-row:hover {
      background: none;
    }

    .jade-volume-label {
      font-size: 12.5px;
      color: #6b7280;
      white-space: nowrap;
      flex-shrink: 0;
      user-select: none;
    }

    .jade-volume-slider {
      flex: 1;
      -webkit-appearance: none;
      appearance: none;
      height: 5px;
      background: #e5e7eb;
      border-radius: 3px;
      outline: none;
      cursor: pointer;
      min-width: 0;
    }

    .jade-volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 15px;
      height: 15px;
      background: ${r};
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      transition: transform 0.12s ease;
    }

    .jade-volume-slider::-webkit-slider-thumb:hover {
      transform: scale(1.15);
    }

    .jade-volume-slider::-moz-range-thumb {
      width: 15px;
      height: 15px;
      background: ${r};
      border-radius: 50%;
      border: none;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    }

    .jade-volume-slider:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }

    .jade-volume-value {
      font-size: 12px;
      color: #6b7280;
      white-space: nowrap;
      flex-shrink: 0;
      min-width: 30px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* Clear chat confirmation modal */
    .jade-modal-overlay {
      position: absolute;
      inset: 0;
      background: rgba(17, 24, 39, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
      border-radius: 20px;
      animation: jade-overlay-enter 0.18s ease;
    }

    @keyframes jade-overlay-enter {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .jade-modal {
      background: white;
      border-radius: 16px;
      padding: 22px 20px 18px;
      margin: 20px;
      box-shadow: 0 20px 48px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.12);
      max-width: 285px;
      width: 100%;
      animation: jade-modal-enter 0.2s cubic-bezier(0.34, 1.3, 0.64, 1);
    }

    @keyframes jade-modal-enter {
      from { opacity: 0; transform: scale(0.92) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    .jade-modal-title {
      font-size: 15.5px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }

    .jade-modal-desc {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.55;
      margin-bottom: 20px;
    }

    .jade-modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .jade-modal-btn {
      padding: 8px 18px;
      border-radius: 9px;
      border: none;
      font-size: 13.5px;
      font-family: inherit;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .jade-modal-btn--cancel {
      background: #f3f4f6;
      color: #374151;
    }

    .jade-modal-btn--cancel:hover {
      background: #e5e7eb;
    }

    .jade-modal-btn--confirm {
      background: #dc2626;
      color: white;
      box-shadow: 0 2px 6px rgba(220,38,38,0.35);
    }

    .jade-modal-btn--confirm:hover {
      background: #b91c1c;
      box-shadow: 0 3px 8px rgba(185,28,28,0.4);
    }

    .jade-modal-btn:focus-visible {
      outline: 2px solid ${r};
      outline-offset: 2px;
    }

    /* Export success toast */
    .jade-toast {
      position: absolute;
      bottom: 76px;
      left: 50%;
      transform: translateX(-50%);
      background: #111827;
      color: white;
      font-size: 13px;
      font-weight: 500;
      padding: 9px 16px;
      border-radius: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      z-index: 40;
      white-space: nowrap;
      animation: jade-toast-enter 0.25s cubic-bezier(0.34, 1.3, 0.64, 1);
      pointer-events: none;
    }

    @keyframes jade-toast-enter {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }


    .jade-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #f8f9fb;
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
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      overflow: hidden;
    }

    .jade-msg-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }

    .jade-message-avatar.user {
      background: #e5e7eb;
      color: #6b7280;
    }

    .jade-message-content {
      max-width: 70%;
    }

    .jade-message-bubble {
      padding: 10px 16px;
      border-radius: 18px;
      word-wrap: break-word;
      word-break: break-word;
      overflow-wrap: break-word;
      line-height: 1.55;
      font-size: 14px;
    }

    .jade-message-assistant .jade-message-bubble {
      background: white;
      color: #1f2937;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
    }

    .jade-message-user .jade-message-bubble {
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      border-bottom-right-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .jade-message-time {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 5px;
      padding: 0 4px;
    }

    /* Markdown rendering styles */
    .jade-md-list {
      margin: .35em 0 .35em 1.25em;
      padding: 0;
      line-height: 1.65;
    }

    .jade-md-list li {
      margin-bottom: .2em;
    }

    .jade-inline-code {
      background: rgba(0,0,0,.07);
      padding: 2px 5px;
      border-radius: 4px;
      font-size: .88em;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      letter-spacing: -.01em;
    }


    /* Search result cards */
    .jade-search-cards {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }

    .jade-search-card {
      display: block;
      padding: 10px 12px;
      border: 1px solid rgba(11, 128, 115, 0.18);
      border-radius: 12px;
      background: #f8fffd;
      color: #1f2937;
      text-decoration: none;
      transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease;
    }

    .jade-search-card:hover {
      border-color: ${r};
      box-shadow: 0 4px 12px rgba(11, 128, 115, 0.14);
      transform: translateY(-1px);
    }

    .jade-search-card-title {
      display: block;
      font-weight: 700;
      font-size: 13px;
      color: #0f766e;
      margin-bottom: 3px;
    }

    .jade-search-card-meta {
      display: block;
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 5px;
    }

    .jade-search-card-description {
      display: block;
      font-size: 12px;
      line-height: 1.4;
      color: #374151;
    }

    .jade-search-card-cta {
      display: inline-block;
      margin-top: 7px;
      font-size: 11.5px;
      font-weight: 700;
      color: ${r};
    }

    /* Quick Replies */
    .jade-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .jade-quick-reply-btn {
      padding: 7px 14px;
      border: 1.5px solid ${r};
      background: white;
      color: ${r};
      border-radius: 20px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      letter-spacing: 0.01em;
    }

    .jade-quick-reply-btn:hover {
      background: ${r};
      color: white;
      transform: translateY(-1px);
      box-shadow: 0 3px 8px rgba(0,0,0,0.15);
    }

    .jade-quick-reply-btn:active {
      transform: translateY(0);
    }

    /* Input Area */
    .jade-chat-input-area {
      padding: 14px 18px 16px;
      background: white;
      border-top: 1px solid rgba(0,0,0,0.06);
      border-radius: 0 0 20px 20px;
    }

    .jade-chat-input-wrapper {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .jade-chat-input {
      flex: 1;
      padding: 10px 16px;
      border: 1.5px solid #e5e7eb;
      border-radius: 22px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      resize: none;
      max-height: 100px;
      min-height: 40px;
      background: #f9fafb;
      transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      color: #1f2937;
      line-height: 1.5;
    }

    .jade-chat-input:focus {
      border-color: ${r};
      background: white;
      box-shadow: 0 0 0 3px rgba(0, 178, 169, 0.12);
    }

    .jade-chat-input::placeholder {
      color: #9ca3af;
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
      background: linear-gradient(135deg, ${r} 0%, ${e} 100%);
      color: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    .jade-chat-send-btn:hover:not(:disabled) {
      transform: scale(1.08);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    .jade-chat-send-btn:active:not(:disabled) {
      transform: scale(0.96);
    }

    .jade-chat-send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
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
        --jade-offset-bottom: ${i || s};
        --jade-offset-right: ${n || (o === '24px' ? '16px' : o)};
        --jade-offset-left: ${u || (t && t === '24px' ? '16px' : t)};
      }
      
      .jade-widget-container {
        bottom: var(--jade-offset-bottom);
        ${t ? 'left: var(--jade-offset-left);' : 'right: var(--jade-offset-right);'}
        ${t ? 'right: auto;' : ''}
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

      .jade-chat-content {
        border-radius: 22px;
      }

      .jade-greeting-tooltip {
        max-width: calc(100vw - 120px);
      }
    }

    /* Hidden utility */
    .jade-hidden {
      display: none !important;
    }
  `;
  }
  const O =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  class R {
    constructor(e = {}) {
      ((this.isMenuOpen = !1),
        (this.showClearConfirm = !1),
        (this.showExportToast = !1),
        (this.config = { ...j, ...e }),
        (this.apiClient = new A(this.config.apiBaseUrl, this.config.authToken)),
        this.config.debug &&
          (console.log('[JadeWidget] Initializing with config:', this.config),
          console.log('[JadeWidget] Avatar URL:', this.config.avatarUrl)));
      try {
        (localStorage.setItem('__jade_test__', '1'), localStorage.removeItem('__jade_test__'));
      } catch {
        console.warn(
          '[JadeWidget] localStorage is unavailable – chat history, sound settings and session state will not be persisted across page loads.'
        );
      }
      ((this.escapeKeyHandler = t => {
        t.key === 'Escape' &&
          (this.showClearConfirm
            ? ((this.showClearConfirm = !1), this.render())
            : this.isMenuOpen
              ? ((this.isMenuOpen = !1), this.render())
              : this.state.isOpen && this.closeChat());
      }),
        (this.soundEnabled = l.loadSoundEnabled()),
        (this.soundVolume = l.loadSoundVolume()));
      const a = l.loadState(),
        s = l.loadMessages(),
        o = l.loadConversationId();
      ((this.state = {
        isOpen: a.isOpen || !1,
        isMinimized: a.isMinimized || !1,
        showGreeting: !1,
        conversationId: o || void 0,
        messages: s.length > 0 ? s : this.getInitialMessages(),
      }),
        (this.container = document.createElement('div')),
        (this.container.className = 'jade-widget-root'),
        (this.shadowRoot = this.container.attachShadow({ mode: 'open' })),
        this.render(),
        this.attachEventListeners());
    }
    getInitialMessages() {
      return [
        {
          id: 'initial',
          role: 'assistant',
          content: this.config.greetingText,
          timestamp: Date.now(),
          quickReplies: ['Yes, please', 'No, thanks'],
        },
      ];
    }
    render() {
      const e = D(
        this.config.primaryColor,
        this.config.accentColor,
        this.config.fontFamily,
        this.config.offsetBottom,
        this.config.offsetRight,
        this.config.offsetLeft,
        this.config.offsetBottomMobile,
        this.config.offsetRightMobile,
        this.config.offsetLeftMobile,
        this.config.scale
      );
      this.shadowRoot.innerHTML = `
      <style>${e}</style>
      <div class="jade-widget-container">
        ${this.renderAvatar()}
        ${this.state.showGreeting && !this.state.isOpen ? this.renderGreeting() : ''}
        ${this.state.isOpen ? this.renderChatPopup() : ''}
      </div>
    `;
    }
    renderAvatar() {
      const e = this.config.avatarUrl
          ? `<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="Chat Assistant" class="jade-avatar-icon jade-avatar-img" />
         <span class="jade-avatar-icon jade-avatar-fallback" style="display:none;">💬</span>`
          : '<span class="jade-avatar-icon">💬</span>',
        a =
          this.state.showGreeting && !this.state.isOpen
            ? '<span class="jade-avatar-badge" aria-label="1 new notification">1</span>'
            : '';
      return `
      <button class="jade-avatar-button" aria-label="Toggle chat" data-action="toggle-chat">
        ${e}
        ${a}
      </button>
    `;
    }
    renderGreeting() {
      return this.config.greetingTooltipText
        ? `
      <div class="jade-greeting-tooltip" data-action="open-chat" role="tooltip" aria-live="polite">
        <button class="jade-greeting-close" aria-label="Dismiss greeting" data-action="close-greeting">${O}</button>
        <div class="jade-greeting-text">${this.escapeHtml(this.config.greetingTooltipText)}</div>
      </div>
    `
        : '';
    }
    renderChatPopup() {
      return `
      <div class="jade-chat-popup" role="dialog" aria-label="Chat">
        <div class="jade-chat-content">
          ${this.renderHeader()}
          ${this.renderMessages()}
          ${this.renderInputArea()}
          ${this.showClearConfirm ? this.renderClearConfirmModal() : ''}
          ${this.showExportToast ? this.renderExportToast() : ''}
        </div>
        ${this.isMenuOpen ? this.renderMenu() : ''}
      </div>
    `;
    }
    renderHeader() {
      const e = `jade-menu-btn${this.isMenuOpen ? ' jade-menu-btn--open' : ''}`;
      return `
      <div class="jade-chat-header">
        <div class="jade-chat-header-left">
          <div class="jade-chat-avatar">
            ${this.config.avatarUrl ? `<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="${this.escapeHtml(this.config.assistantName)}" class="jade-header-avatar-img" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />` : '💬'}
          </div>
          <div>
            <div class="jade-chat-title">${this.escapeHtml(this.config.assistantName)}</div>
            <div class="jade-chat-status"><span class="jade-status-dot"></span>Online</div>
          </div>
        </div>
        <div class="jade-chat-controls">
          <button class="${e}" aria-label="${this.isMenuOpen ? 'Close menu' : 'Open menu'}" aria-haspopup="true" aria-expanded="${this.isMenuOpen}" data-action="toggle-menu" title="Menu">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="8" cy="3" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
              <circle cx="8" cy="13" r="1.5" fill="currentColor"/>
            </svg>
          </button>
          <button class="jade-chat-minimize" aria-label="Minimize chat" data-action="minimize-chat" title="Minimize">−</button>
          <button class="jade-chat-close" aria-label="Close chat" data-action="close-chat" title="Close">×</button>
        </div>
      </div>
    `;
    }
    renderMenu() {
      const e = Math.round(this.soundVolume * 100);
      return `
      <div class="jade-menu-panel" role="menu" aria-label="Chat options">
        <button class="jade-menu-item" data-action="export-chat" role="menuitem">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M7.5 1v9M4 7l3.5 3.5L11 7M2 12h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Export chat
        </button>
        <div class="jade-menu-divider" role="separator"></div>
        <div class="jade-menu-item jade-menu-sound-row">
          <span class="jade-menu-sound-label">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M3 5.5H1.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5H3l3 3V2.5L3 5.5z" fill="currentColor"/>
              <path d="M9.5 5.5c.83.83.83 2.17 0 3M11.5 3.5c1.66 1.66 1.66 4.34 0 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
            Sounds
          </span>
          <button
            class="jade-sound-toggle ${this.soundEnabled ? 'jade-sound-toggle--on' : ''}"
            data-action="toggle-sound"
            aria-label="${this.soundEnabled ? 'Disable sounds' : 'Enable sounds'}"
            aria-pressed="${this.soundEnabled}"
            title="${this.soundEnabled ? 'Sounds on' : 'Sounds off'}"
          >
            <span class="jade-sound-toggle-knob"></span>
          </button>
        </div>
        <div class="jade-menu-item jade-menu-volume-row ${this.soundEnabled ? '' : 'jade-menu-item--disabled'}">
          <label class="jade-volume-label" for="jade-volume-slider">Volume</label>
          <input
            type="range"
            id="jade-volume-slider"
            class="jade-volume-slider"
            min="0"
            max="100"
            value="${e}"
            aria-label="Notification volume"
            data-action="volume-change"
            ${this.soundEnabled ? '' : 'disabled'}
          />
          <span class="jade-volume-value">${e}%</span>
        </div>
        <div class="jade-menu-divider" role="separator"></div>
        <button class="jade-menu-item jade-menu-item--danger" data-action="show-clear-confirm" role="menuitem">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M3 3.5h9M5.5 3.5V2h4v1.5M6 6v5M9 6v5M3.5 3.5l.75 9h7.5l.75-9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Clear chat
        </button>
      </div>
    `;
    }
    renderClearConfirmModal() {
      return `
      <div class="jade-modal-overlay" data-action="cancel-clear-chat" role="presentation">
        <div class="jade-modal" data-action="modal-stop" role="alertdialog" aria-modal="true" aria-labelledby="jade-modal-title" aria-describedby="jade-modal-desc">
          <p class="jade-modal-title" id="jade-modal-title">Clear conversation?</p>
          <p class="jade-modal-desc" id="jade-modal-desc">This will delete all messages and reset the chat. This action cannot be undone.</p>
          <div class="jade-modal-actions">
            <button class="jade-modal-btn jade-modal-btn--cancel" data-action="cancel-clear-chat">Cancel</button>
            <button class="jade-modal-btn jade-modal-btn--confirm" data-action="confirm-clear-chat">Clear chat</button>
          </div>
        </div>
      </div>
    `;
    }
    renderExportToast() {
      return `
      <div class="jade-toast" role="status" aria-live="polite">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M2 7.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Chat exported successfully
      </div>
    `;
    }
    renderMessages() {
      return `
      <div class="jade-chat-messages" data-messages-container>
        ${this.state.messages.map(a => this.renderMessage(a)).join('')}
      </div>
    `;
    }
    renderMessage(e) {
      const a = e.role === 'user',
        s = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        o =
          !a && e.quickReplies
            ? `
      <div class="jade-quick-replies">
        ${e.quickReplies.map(u => `<button class="jade-quick-reply-btn" data-action="quick-reply" data-reply="${this.escapeHtml(u)}">${this.escapeHtml(u)}</button>`).join('')}
      </div>
    `
            : '',
        t =
          !a && e.searchResults && e.searchResults.length > 0
            ? this.renderSearchResultCards(e.searchResults)
            : '',
        i = a ? this.escapeHtml(e.content) : this.renderMarkdown(e.content),
        n = a
          ? '👤'
          : this.config.avatarUrl
            ? `<img src="${this.escapeHtml(this.config.avatarUrl)}" alt="${this.escapeHtml(this.config.assistantName)}" class="jade-msg-avatar-img" />`
            : '💬';
      return `
      <div class="jade-message jade-message-${e.role}" data-message-id="${e.id}">
        <div class="jade-message-avatar ${e.role}">
          ${n}
        </div>
        <div class="jade-message-content">
          <div class="jade-message-bubble">${i}</div>
          ${t}
          <div class="jade-message-time">${s}</div>
          ${o}
        </div>
      </div>
    `;
    }
    renderSearchResultCards(e) {
      const a = e
        .filter(s => s.url)
        .slice(0, 4)
        .map(s => {
          const o = this.searchSourceLabel(s.source),
            t = [s.location, s.category, o].filter(Boolean).join(' • ');
          return `
          <a class="jade-search-card" href="${this.escapeHtml(s.url ?? '#')}" target="_blank" rel="noopener noreferrer">
            <span class="jade-search-card-title">${this.escapeHtml(s.title)}</span>
            ${t ? `<span class="jade-search-card-meta">${this.escapeHtml(t)}</span>` : ''}
            <span class="jade-search-card-description">${this.escapeHtml(s.description)}</span>
            <span class="jade-search-card-cta">${['online-search', 'google-places', 'serpapi-maps', 'brave-search'].includes(s.source) ? 'Open result' : 'View profile'}</span>
          </a>
        `;
        })
        .join('');
      return a ? `<div class="jade-search-cards">${a}</div>` : '';
    }
    searchSourceLabel(e) {
      switch (e) {
        case 'local-db':
          return 'EventFlow profile';
        case 'eventflow-catalog':
          return 'EventFlow catalog';
        case 'google-places':
          return 'Google Places';
        case 'serpapi-maps':
          return 'Google Maps';
        case 'brave-search':
          return 'Web search';
        case 'online-search':
          return 'Online fallback';
        default:
          return 'EventFlow';
      }
    }
    renderMarkdown(e) {
      const o = this.escapeHtml(e)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*([^*\n]+?)\*/g, (u, p) => `<em>${p}</em>`)
          .replace(/`([^`\n]+?)`/g, '<code class="jade-inline-code">$1</code>').split(`
`),
        t = [];
      let i = !1,
        n = null;
      for (let u = 0; u < o.length; u++) {
        const p = o[u],
          m = /^[-*•]\s+(.*)/.exec(p),
          f = /^\d+\.\s+(.*)/.exec(p);
        m
          ? ((!i || n !== 'ul') &&
              (i && t.push(n === 'ol' ? '</ol>' : '</ul>'),
              t.push('<ul class="jade-md-list">'),
              (i = !0),
              (n = 'ul')),
            t.push(`<li>${m[1]}</li>`))
          : f
            ? ((!i || n !== 'ol') &&
                (i && t.push(n === 'ul' ? '</ul>' : '</ol>'),
                t.push('<ol class="jade-md-list">'),
                (i = !0),
                (n = 'ol')),
              t.push(`<li>${f[1]}</li>`))
            : (i && (t.push(n === 'ol' ? '</ol>' : '</ul>'), (i = !1), (n = null)),
              p.trim() === '' ? t.push('<br>') : t.push(p));
      }
      return (
        i && t.push(n === 'ol' ? '</ol>' : '</ul>'),
        t.join(`
`)
      );
    }
    renderInputArea() {
      return `
      <div class="jade-chat-input-area">
        <div class="jade-chat-input-wrapper">
          <textarea 
            class="jade-chat-input" 
            placeholder="Type your message..."
            rows="1"
            aria-label="Message input"
            maxlength="${b}"
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
    `;
    }
    attachEventListeners() {
      (this.shadowRoot.addEventListener('click', s => {
        const t = s.target.closest('[data-action]'),
          i = t == null ? void 0 : t.getAttribute('data-action');
        if (
          (this.config.debug && i && console.log('[JadeWidget] Menu action dispatched:', i),
          i === 'toggle-chat')
        )
          this.toggleChat();
        else if (i === 'open-chat') this.openChat();
        else if (i === 'close-chat') this.closeChat();
        else if (i === 'minimize-chat') this.minimizeChat();
        else if (i === 'close-greeting') (s.stopPropagation(), this.closeGreeting());
        else if (i === 'send') this.handleSend();
        else if (i === 'quick-reply') {
          const n = t == null ? void 0 : t.getAttribute('data-reply');
          n && this.handleQuickReply(n);
        } else if (i === 'toggle-menu')
          (s.stopPropagation(),
            (this.isMenuOpen = !this.isMenuOpen),
            this.render(),
            this.isMenuOpen &&
              setTimeout(() => {
                const n = this.shadowRoot.querySelector('.jade-menu-panel [role="menuitem"]');
                n == null || n.focus();
              }, 50));
        else if (i === 'export-chat') ((this.isMenuOpen = !1), this.render(), this.exportChat());
        else if (i === 'toggle-sound')
          (s.stopPropagation(),
            (this.soundEnabled = !this.soundEnabled),
            l.saveSoundEnabled(this.soundEnabled),
            this.soundEnabled && this.unlockAudioContext(),
            this.render());
        else if (i === 'show-clear-confirm')
          ((this.isMenuOpen = !1),
            (this.showClearConfirm = !0),
            this.render(),
            setTimeout(() => {
              const n = this.shadowRoot.querySelector('.jade-modal-btn--cancel');
              n == null || n.focus();
            }, 50));
        else if (i === 'cancel-clear-chat') ((this.showClearConfirm = !1), this.render());
        else if (i === 'confirm-clear-chat')
          ((this.showClearConfirm = !1), this.performClearChat());
        else if (i === 'modal-stop') {
          s.stopPropagation();
          return;
        }
        this.isMenuOpen &&
          i !== 'toggle-menu' &&
          !(t != null && t.closest('.jade-menu-panel')) &&
          ((this.isMenuOpen = !1), this.render());
      }),
        this.shadowRoot.addEventListener('keydown', s => {
          const o = s,
            t = s.target;
          (t.hasAttribute('data-input') &&
            o.key === 'Enter' &&
            !o.shiftKey &&
            (s.preventDefault(), this.handleSend()),
            t.classList.contains('jade-menu-btn') &&
              (o.key === 'Enter' || o.key === ' ') &&
              (s.preventDefault(),
              (this.isMenuOpen = !this.isMenuOpen),
              this.render(),
              this.isMenuOpen &&
                setTimeout(() => {
                  const i = this.shadowRoot.querySelector('.jade-menu-panel [role="menuitem"]');
                  i == null || i.focus();
                }, 50)));
        }),
        this.shadowRoot.addEventListener('input', s => {
          const o = s.target;
          if (o.hasAttribute('data-input')) {
            const t = o;
            ((t.style.height = 'auto'), (t.style.height = Math.min(t.scrollHeight, 100) + 'px'));
            const i = this.shadowRoot.querySelector('.jade-char-count');
            if (i) {
              const n = t.value.length;
              n > b * 0.8
                ? ((i.textContent = `${n}/${b}`), i.classList.add('jade-char-count-visible'))
                : ((i.textContent = ''), i.classList.remove('jade-char-count-visible'));
            }
          } else if (o.getAttribute('data-action') === 'volume-change') {
            const i = parseInt(o.value, 10) / 100;
            ((this.soundVolume = i), l.saveSoundVolume(i));
            const n = this.shadowRoot.querySelector('.jade-volume-value');
            n && (n.textContent = `${Math.round(i * 100)}%`);
          }
        }),
        document.addEventListener('keydown', this.escapeKeyHandler));
      const e = this.shadowRoot.querySelector('.jade-avatar-img');
      e &&
        (e.addEventListener('error', () => {
          (this.config.debug &&
            console.error('[JadeWidget] Failed to load avatar image:', this.config.avatarUrl),
            e.setAttribute('style', 'display:none;'));
          const s = this.shadowRoot.querySelector('.jade-avatar-fallback');
          s && s.setAttribute('style', 'display:flex;');
        }),
        e.addEventListener('load', () => {
          this.config.debug &&
            console.log('[JadeWidget] Avatar image loaded successfully:', this.config.avatarUrl);
        }));
      const a = this.shadowRoot.querySelector('.jade-header-avatar-img');
      a &&
        (a.addEventListener('error', () => {
          this.config.debug &&
            console.error(
              '[JadeWidget] Failed to load header avatar image:',
              this.config.avatarUrl
            );
          const s = a.parentElement;
          s && (s.innerHTML = '💬');
        }),
        a.addEventListener('load', () => {
          this.config.debug &&
            console.log(
              '[JadeWidget] Header avatar image loaded successfully:',
              this.config.avatarUrl
            );
        }));
    }
    toggleChat() {
      this.state.isOpen ? this.closeChat() : this.openChat();
    }
    openChat() {
      ((this.state.isOpen = !0),
        (this.state.showGreeting = !1),
        this.greetingTimeout && clearTimeout(this.greetingTimeout),
        l.setGreetingDismissed(),
        l.saveState({ isOpen: !0, showGreeting: !1 }),
        this.render(),
        this.scrollToBottom(),
        this.focusInput());
    }
    closeChat() {
      ((this.state.isOpen = !1),
        (this.isMenuOpen = !1),
        (this.showClearConfirm = !1),
        l.saveState({ isOpen: !1 }),
        this.render());
    }
    minimizeChat() {
      ((this.state.isMinimized = !0),
        (this.state.isOpen = !1),
        (this.isMenuOpen = !1),
        (this.showClearConfirm = !1),
        l.saveState({ isOpen: !1, isMinimized: !0 }),
        this.render());
    }
    closeGreeting() {
      ((this.state.showGreeting = !1), l.setGreetingDismissed(), this.render());
    }
    async handleSend() {
      const e = this.shadowRoot.querySelector('[data-input]');
      if (!e) return;
      const a = e.value.trim();
      if (!a) return;
      const s = { id: 'user-' + Date.now(), role: 'user', content: a, timestamp: Date.now() };
      (this.state.messages.push(s),
        l.saveMessages(this.state.messages),
        (e.value = ''),
        (e.style.height = 'auto'),
        this.render(),
        this.scrollToBottom(),
        this.soundEnabled && this.unlockAudioContext(),
        this.showTypingIndicator());
      try {
        const o = await this.apiClient.sendMessage(a, this.state.conversationId);
        (this.state.conversationId ||
          ((this.state.conversationId = o.conversationId), l.saveConversationId(o.conversationId)),
          this.state.messages.push({ ...o.message, searchResults: o.searchResults }),
          l.saveMessages(this.state.messages),
          this.playNotificationSound(),
          this.removeTypingIndicator(),
          this.render(),
          this.scrollToBottom(),
          this.focusInput());
      } catch (o) {
        (console.error('Failed to send message:', o), this.removeTypingIndicator());
        const t = o instanceof Error ? o.message : '';
        let i;
        t.includes('429') || t.toLowerCase().includes('rate limit')
          ? (i = "I'm getting a lot of requests right now — please wait a moment and try again. ⏳")
          : t.includes('401') || t.includes('403')
            ? (i = "I couldn't authenticate your request. Please refresh the page and try again.")
            : t.includes('503') || t.includes('Failed to fetch')
              ? (i =
                  "I'm having trouble connecting right now. Please check your connection and try again.")
              : (i = "I'm sorry, something went wrong. Please try again.");
        const n = {
          id: 'error-' + Date.now(),
          role: 'assistant',
          content: i,
          timestamp: Date.now(),
        };
        (this.state.messages.push(n),
          l.saveMessages(this.state.messages),
          this.render(),
          this.scrollToBottom());
      }
    }
    handleQuickReply(e) {
      const a = this.shadowRoot.querySelector('[data-input]');
      a && ((a.value = e), this.handleSend());
    }
    showTypingIndicator() {
      this.removeTypingIndicator();
      const e = this.shadowRoot.querySelector('[data-messages-container]');
      if (e) {
        const a = document.createElement('div');
        ((a.className = 'jade-message jade-message-assistant'),
          a.setAttribute('data-typing-indicator', ''),
          (a.innerHTML = `
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
      `),
          e.appendChild(a),
          this.scrollToBottom());
      }
    }
    removeTypingIndicator() {
      const e = this.shadowRoot.querySelector('[data-typing-indicator]');
      e && e.remove();
    }
    unlockAudioContext() {
      try {
        (this.audioCtx ||
          (this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()),
          this.audioCtx.state === 'suspended' && this.audioCtx.resume().catch(() => {}));
      } catch {}
    }
    playNotificationSound() {
      if (this.soundEnabled) {
        this.config.debug &&
          console.log('[JadeWidget] Playing notification sound (volume:', this.soundVolume, ')');
        try {
          this.audioCtx ||
            (this.audioCtx = new (window.AudioContext || window.webkitAudioContext)());
          const e = this.audioCtx,
            a = () => {
              const s = e.createGain();
              (s.gain.setValueAtTime(0, e.currentTime),
                s.gain.linearRampToValueAtTime(this.soundVolume * 0.3, e.currentTime + 0.02),
                s.gain.exponentialRampToValueAtTime(1e-4, e.currentTime + 0.5),
                s.connect(e.destination),
                [880, 1108].forEach((t, i) => {
                  const n = e.createOscillator();
                  ((n.type = 'sine'),
                    n.frequency.setValueAtTime(t, e.currentTime + i * 0.12),
                    n.connect(s),
                    n.start(e.currentTime + i * 0.12),
                    n.stop(e.currentTime + i * 0.12 + 0.35));
                }));
            };
          e.state === 'suspended'
            ? (this.config.debug &&
                console.warn(
                  '[JadeWidget] AudioContext suspended – attempting resume before chime'
                ),
              e
                .resume()
                .then(a)
                .catch(() => {
                  console.info(
                    '[JadeWidget] Notification sound skipped – AudioContext could not be resumed (likely no prior user gesture)'
                  );
                }))
            : a();
        } catch {}
      }
    }
    exportChat() {
      const e = {
          exportedAt: new Date().toISOString(),
          messages: this.state.messages.map(i => ({
            role: i.role,
            content: i.content,
            timestamp: new Date(i.timestamp).toISOString(),
          })),
        },
        a = JSON.stringify(e, null, 2),
        s = new Blob([a], { type: 'application/json' }),
        o = URL.createObjectURL(s),
        t = document.createElement('a');
      ((t.href = o),
        (t.download = `jade-chat-${new Date().toISOString().slice(0, 10)}.json`),
        document.body.appendChild(t),
        t.click(),
        document.body.removeChild(t),
        setTimeout(() => URL.revokeObjectURL(o), 500),
        this.exportToastTimeout && clearTimeout(this.exportToastTimeout),
        (this.showExportToast = !0),
        this.render(),
        (this.exportToastTimeout = window.setTimeout(() => {
          ((this.showExportToast = !1), this.render());
        }, 3e3)));
    }
    performClearChat() {
      (l.clearAll(),
        (this.isMenuOpen = !1),
        (this.showClearConfirm = !1),
        (this.state = {
          isOpen: !1,
          isMinimized: !1,
          showGreeting: !1,
          messages: this.getInitialMessages(),
        }),
        this.render());
    }
    scrollToBottom() {
      setTimeout(() => {
        const e = this.shadowRoot.querySelector('[data-messages-container]');
        e && (e.scrollTop = e.scrollHeight);
      }, 100);
    }
    focusInput() {
      setTimeout(() => {
        const e = this.shadowRoot.querySelector('[data-input]');
        e && e.focus();
      }, 100);
    }
    escapeHtml(e) {
      const a = document.createElement('div');
      return ((a.textContent = e), a.innerHTML);
    }
    shouldShowGreeting() {
      const e = l.loadMessages(),
        a = e.length === 0 || e.length === 1;
      return !this.state.isOpen && a && !l.isGreetingDismissed();
    }
    mount(e) {
      ((e || document.body).appendChild(this.container),
        this.shouldShowGreeting() &&
          (this.greetingTimeout = window.setTimeout(() => {
            ((this.state.showGreeting = !0), this.render());
          }, 1e3)));
    }
    unmount() {
      (this.container.remove(),
        this.greetingTimeout && clearTimeout(this.greetingTimeout),
        this.exportToastTimeout && clearTimeout(this.exportToastTimeout),
        this.audioCtx && (this.audioCtx.close().catch(() => {}), (this.audioCtx = void 0)),
        document.removeEventListener('keydown', this.escapeKeyHandler));
    }
    open() {
      this.openChat();
    }
    close() {
      this.closeChat();
    }
    toggle() {
      this.toggleChat();
    }
    reset() {
      (l.clearAll(),
        (this.state = {
          isOpen: !1,
          isMinimized: !1,
          showGreeting: !1,
          messages: this.getInitialMessages(),
        }),
        this.render());
    }
  }
  let d,
    g,
    v = 0;
  function z() {
    (d == null || d.destroy(),
      (d = void 0),
      h.instance && (h.instance.unmount(), (h.instance = void 0)));
  }
  function N(r = {}) {
    v += 1;
    const e = v;
    (g !== void 0 && (window.clearTimeout(g), (g = void 0)), z());
    const a = { ...j, ...r };
    g = window.setTimeout(() => {
      if (e !== v) return;
      const s = new Set(Array.from(document.querySelectorAll('.jade-widget-root'))),
        o = new R(a);
      o.mount();
      const t = Array.from(document.querySelectorAll('.jade-widget-root')),
        i = t.find(n => !s.has(n)) ?? t[t.length - 1];
      if (!i) {
        (o.unmount(), console.error('[JadeWidget] Unable to locate the mounted widget root.'));
        return;
      }
      ((h.instance = o), (d = new E(i, o, a)), d.start(), (g = void 0));
    }, a.showDelayMs);
  }
  const h = {
    init: N,
    open: () => {
      var r;
      (d == null || d.show('open-api'), (r = h.instance) == null || r.open());
    },
    close: () => {
      var r;
      (r = h.instance) == null || r.close();
    },
    toggle: () => {
      var r, e, a;
      if (!(d != null && d.isVisible())) {
        (d == null || d.show('toggle-api'), (r = h.instance) == null || r.open());
        return;
      }
      d != null && d.isOpen()
        ? (e = h.instance) == null || e.close()
        : (a = h.instance) == null || a.open();
    },
    hide: () => {
      d == null || d.hide('hide-api');
    },
    show: () => {
      d == null || d.show('show-api');
    },
    isOpen: () => (d == null ? void 0 : d.isOpen()) ?? !1,
    isVisible: () => (d == null ? void 0 : d.isVisible()) ?? !1,
    reset: () => {
      var r;
      (d == null || d.show('reset-api'), (r = h.instance) == null || r.reset());
    },
  };
  (typeof window < 'u' && (window.JadeWidget = h),
    (w.default = h),
    Object.defineProperties(w, {
      __esModule: { value: !0 },
      [Symbol.toStringTag]: { value: 'Module' },
    }));
})((this.JadeWidget = this.JadeWidget || {}));
