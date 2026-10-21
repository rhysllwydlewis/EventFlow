/**
 * Supplier dashboard: the profile and package editors as dialogs over the dashboard.
 *
 * Each editor is a native <dialog> (#sdh-profile-dialog, #sdh-package-dialog) that holds the
 * form app.js already reads and writes (#supplier-form, #package-form). This script only owns
 * the shell around them:
 *
 *   - open and close, with focus moved in, kept in (native modal) and returned to the opener;
 *   - an unsaved-changes guard: closing a form that has been edited asks first, whether that is
 *     the Cancel button, the close button, Escape, or leaving the page;
 *   - the page scroll lock while an editor is open;
 *   - the `expanded` class on the form section, which app.js reads as "this editor is open".
 *
 * app.js calls open() after it has filled the form, and markClean() once the form shows what is
 * saved. It listens for `sdh:overlay-closed` to reset the form, so a form that was cancelled never
 * comes back half-filled (and never saves as a new profile).
 */
'use strict';

(function () {
  const EDITORS = {
    profile: {
      dialogId: 'sdh-profile-dialog',
      formId: 'supplier-form',
      sectionId: 'profile-form-section',
      toggleId: 'toggle-profile-form',
      cancelId: 'cancel-profile-form',
      discardTitle: 'Discard your changes?',
      discardMessage: 'You have changes to your profile that are not saved.',
    },
    package: {
      dialogId: 'sdh-package-dialog',
      formId: 'package-form',
      sectionId: 'package-form-section',
      toggleId: 'toggle-package-form',
      cancelId: 'cancel-package-form',
      discardTitle: 'Discard your changes?',
      discardMessage: 'You have changes to this package that are not saved.',
    },
  };

  /** The state kept per editor: the form as it was when it opened, and what opened it. */
  const state = {
    profile: { snapshot: '', opener: null, closing: false, allowClose: false },
    package: { snapshot: '', opener: null, closing: false, allowClose: false },
  };

  /** Looks up an element by id. */
  const byId = id => document.getElementById(id);

  /** A string that changes whenever the form's values change (text, selects, checkboxes). */
  function serialise(form) {
    if (!form) {
      return '';
    }
    const values = [];
    form.querySelectorAll('input, select, textarea').forEach(field => {
      if (field.type === 'file' || field.type === 'button' || field.type === 'submit') {
        return;
      }
      const value =
        field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value;
      values.push(`${field.id || field.name}=${value}`);
    });
    return values.join('\u0001');
  }

  /** True while the named editor is open. */
  function isOpen(name) {
    const editor = EDITORS[name];
    const dialog = editor ? byId(editor.dialogId) : null;
    return Boolean(dialog?.open);
  }

  /** True when the form has been edited since it opened or was last marked clean. */
  function isDirty(name) {
    const editor = EDITORS[name];
    return (
      Boolean(editor) && isOpen(name) && serialise(byId(editor.formId)) !== state[name].snapshot
    );
  }

  /** Records the form as it is now: call once the form shows what is saved. */
  function markClean(name) {
    const editor = EDITORS[name];
    if (editor) {
      state[name].snapshot = serialise(byId(editor.formId));
    }
  }

  /** The first field a keyboard user should land in: the first visible field, not the close button. */
  function firstField(dialog) {
    const candidates = dialog.querySelectorAll(
      '.sdh-dialog__body input:not([type="hidden"]):not([type="file"]):not(.sdh-sr), .sdh-dialog__body select, .sdh-dialog__body textarea'
    );
    return (
      Array.from(candidates).find(field => !field.disabled && !field.closest('[hidden]')) || null
    );
  }

  /**
   * Opens an editor. Pass { focusId } to land on a specific field. The form should already be
   * filled in; open() takes the "nothing changed yet" snapshot from it.
   */
  function open(name, options) {
    const editor = EDITORS[name];
    const dialog = editor ? byId(editor.dialogId) : null;
    if (!dialog) {
      return;
    }
    const settings = options || {};
    if (!dialog.open) {
      state[name].opener = document.activeElement;
      byId(editor.sectionId)?.classList.add('expanded');
      document.body.classList.add('sdh-modal-open');
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      document.dispatchEvent(new CustomEvent('sdh:overlay-opened', { detail: { name } }));
    }
    markClean(name);
    const target = settings.focusId ? byId(settings.focusId) : null;
    const focusTarget = target || firstField(dialog);
    // Start at the top of the form; only scroll when asked to land on a particular field.
    dialog.querySelectorAll('.sdh-dialog__body').forEach(body => {
      body.scrollTop = 0;
    });
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center' });
      }
    }
  }

  /** Closes an editor without asking. The form is reset by whoever listens for sdh:overlay-closed. */
  function close(name) {
    const editor = EDITORS[name];
    const dialog = editor ? byId(editor.dialogId) : null;
    if (!dialog || !dialog.open) {
      return;
    }
    state[name].allowClose = true;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      finishClose(name);
    }
  }

  /**
   * Closes an editor, first asking whether to throw away unsaved changes. Resolves to true when
   * the editor closed, false when the supplier chose to keep editing.
   */
  async function requestClose(name) {
    if (!isOpen(name) || state[name].closing) {
      return false;
    }
    const editor = EDITORS[name];
    if (isDirty(name)) {
      state[name].closing = true;
      const home = window.SupplierDashboardHome;
      // The page's own confirmation dialog (SupplierDashboardHome loads first). Without it nothing
      // asks, so the editor stays open rather than throwing the supplier's changes away unasked.
      const discard =
        typeof home?.confirm === 'function'
          ? await home.confirm({
              title: editor.discardTitle,
              message: editor.discardMessage,
              confirmLabel: 'Discard changes',
              cancelLabel: 'Keep editing',
            })
          : false;
      state[name].closing = false;
      if (!discard) {
        return false;
      }
    }
    close(name);
    return true;
  }

  /** Runs when an editor has closed, however it was closed: clears the open state and tells app.js. */
  function finishClose(name) {
    const editor = EDITORS[name];
    const dialog = byId(editor.dialogId);
    const asked = state[name].allowClose;
    state[name].allowClose = false;
    // A browser can close a dialog without a cancel event (a second Escape after a prevented one).
    // Edits must never be lost that way: put the editor back, exactly as it was.
    if (
      !asked &&
      dialog &&
      !dialog.open &&
      serialise(byId(editor.formId)) !== state[name].snapshot &&
      typeof dialog.showModal === 'function'
    ) {
      dialog.showModal();
      return;
    }
    byId(editor.sectionId)?.classList.remove('expanded');
    if (!Object.keys(EDITORS).some(key => isOpen(key))) {
      document.body.classList.remove('sdh-modal-open');
    }
    document.dispatchEvent(new CustomEvent('sdh:overlay-closed', { detail: { name } }));
    // Native dialogs hand focus back to what opened them; this covers an opener that has been
    // re-rendered since (a package row's Edit button, for example).
    const opener = state[name].opener;
    const fallback = byId(editor.toggleId);
    const target = opener?.isConnected ? opener : fallback;
    if (target && (!document.activeElement || document.activeElement === document.body)) {
      target.focus();
    }
    state[name].opener = null;
  }

  /** Wires one editor's dialog: Escape, the close and Cancel buttons, and the close event. */
  function bind(name) {
    const editor = EDITORS[name];
    const dialog = byId(editor.dialogId);
    if (!dialog) {
      return;
    }
    // Escape asks (through the unsaved-changes guard) instead of closing straight away.
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      requestClose(name);
    });
    // On the document, not the dialog: with focus on the page behind (after a click on the
    // backdrop, say) the dialog never sees the key. A confirmation open on top answers it first.
    document.addEventListener('keydown', event => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        isOpen(name) &&
        !byId('sdh-confirm-dialog')?.open
      ) {
        event.preventDefault();
        requestClose(name);
      }
    });
    dialog.addEventListener('close', () => finishClose(name));
    // Editing a field that was flagged clears the flag and the message about it.
    const clearFlag = event => {
      const field = event.target;
      if (field?.getAttribute?.('aria-invalid') === 'true') {
        field.removeAttribute('aria-invalid');
        const status = dialog.querySelector('.sdh-form__status[data-tone="error"]');
        if (status) {
          status.textContent = '';
          status.removeAttribute('data-tone');
        }
      }
    };
    dialog.addEventListener('input', clearFlag);
    dialog.addEventListener('change', clearFlag);
    dialog.querySelectorAll('[data-overlay-close]').forEach(button => {
      button.addEventListener('click', () => requestClose(name));
    });
    byId(editor.cancelId)?.addEventListener('click', () => requestClose(name));
  }

  /** Warns before the page is left while an editor holds unsaved changes. */
  function guardUnload(event) {
    if (Object.keys(EDITORS).some(name => isDirty(name))) {
      event.preventDefault();
      // Browsers ignore the text; setting returnValue is what asks for the prompt.
      event.returnValue = '';
    }
  }

  /** Binds both editors once the page has been parsed. */
  function init() {
    Object.keys(EDITORS).forEach(bind);
    window.addEventListener('beforeunload', guardUnload);
  }

  window.SupplierDashboardOverlays = { open, close, requestClose, isOpen, isDirty, markClean };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
