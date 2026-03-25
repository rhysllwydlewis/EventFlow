/**
 * Auth Intent / Reason Notice
 * Reads `intent`, `redirect`, `reason`, and `next` query params on the auth
 * page and displays a dismissible contextual notice explaining why the user
 * was sent to sign in.
 *
 * Supported sources:
 *  - intent + redirect  (soft-auth prompts, e.g. save/message/plan actions)
 *  - reason + next      (hard-auth redirects from middleware, e.g. unauthenticated / forbidden)
 */
(function () {
  // Messages shown when a soft-auth action (intent) is required
  const INTENT_MESSAGES = {
    save: {
      title: 'Log in to save suppliers',
      body: "Create an account or log in to save suppliers to your shortlist. After you sign in, we'll take you back to where you were.",
    },
    message: {
      title: 'Log in to message suppliers',
      body: "Create an account or log in to message this supplier. After you sign in, we'll take you back to where you were.",
    },
    plan: {
      title: 'Log in to add packages to your plan',
      body: "Create an account or log in to add packages to your event plan. After you sign in, we'll take you back to where you were.",
    },
  };

  // Messages shown when the server redirected the user (reason param)
  const REASON_MESSAGES = {
    unauthenticated: {
      title: 'Please log in to continue',
      body: 'You need to log in to access that page.',
      type: 'warning',
    },
    forbidden: {
      title: 'Access denied',
      body: 'You do not have permission to access that page. Please log in with an account that has the required access.',
      type: 'error',
    },
  };

  function buildRoleBody(required) {
    if (!required) {
      return REASON_MESSAGES.forbidden.body;
    }
    const roleMap = {
      customer: 'customer account',
      supplier: 'supplier account',
      admin: 'admin account',
    };
    const roles = required.split(',').map(r => roleMap[r.trim()] || r.trim());
    const roleLabel = roles.join(' or ');
    return `You need a ${roleLabel} to access that page.`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showNotice(notice, title, body, type) {
    const safeTitle = escapeHtml(title);
    const safeBody = escapeHtml(body);
    notice.innerHTML =
      `<strong class="auth-intent-title">${safeTitle}</strong>` +
      `<p class="auth-intent-body">${safeBody}</p>` +
      `<button class="auth-intent-dismiss" type="button" aria-label="Dismiss this message">` +
      `<span aria-hidden="true">\u00d7</span></button>`;

    // Wire up dismiss button
    const btn = notice.querySelector('.auth-intent-dismiss');
    if (btn) {
      btn.addEventListener('click', () => {
        notice.classList.remove('is-visible', 'is-info', 'is-warning', 'is-error');
        notice.style.display = 'none';
      });
    }

    notice.classList.add('is-visible', `is-${type}`);
    notice.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notice.style.display = '';
  }

  function init() {
    const notice = document.getElementById('auth-intent-notice');
    if (!notice) {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    // --- reason-based redirect (from server middleware) ---
    const reason = params.get('reason');
    if (reason && REASON_MESSAGES[reason]) {
      const def = REASON_MESSAGES[reason];
      let body = def.body;
      if (reason === 'forbidden') {
        const required = params.get('required') || '';
        body = buildRoleBody(required);
      }
      showNotice(notice, def.title, body, def.type);
      return;
    }

    // --- intent-based soft-auth prompt ---
    const intent = params.get('intent');
    const redirect = params.get('redirect');

    // Only show when both intent and redirect are present and redirect is relative
    if (!intent || !redirect || !redirect.startsWith('/')) {
      return;
    }

    const msg = INTENT_MESSAGES[intent];
    if (!msg) {
      return;
    }

    showNotice(notice, msg.title, msg.body, 'info');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
