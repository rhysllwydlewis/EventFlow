/**
 * Auth hint: lets the header be drawn the way it will end up.
 *
 * The header cannot know who is signed in until /api/v1/auth/me answers, which takes a moment on
 * every page. Until then it drew the signed-out header ("Log in") and then swapped it for the
 * signed-in one, so a signed-in person saw "Log in" flash up and the nav links jump sideways,
 * sometimes under their cursor.
 *
 * navbar.js remembers the kind of account it last saw in localStorage (ef_auth_hint). This script
 * runs in the <head>, before the first paint, reads it, and marks <html> with `ef-hint-in` so
 * navbar.css can draw the signed-in layout from the start. navbar.js then confirms or corrects it
 * once the server answers. The hint only changes how the header looks while it waits; it never
 * decides what anyone may do, and a wrong one (an expired session) is replaced by "Log in" as
 * soon as the server says so.
 *
 * The signed-in buttons take a width that depends on the fonts this device uses, so navbar.js also
 * remembers the width it measured (ef_auth_hint_w) and this script hands it to the stylesheet as
 * --ef-hint-actions-w; a first visit uses the stylesheet's own measured default.
 *
 * The early state hides "Log in", so it must not outlive a header script that never settles it
 * (blocked, failed to load, or an auth request that never returns). After a few seconds it is
 * dropped regardless, which puts "Log in" back.
 *
 * It must stay tiny and synchronous, and load from <head> ahead of navbar.css.
 */
'use strict';

(function () {
  try {
    const role = window.localStorage.getItem('ef_auth_hint');
    if (role === 'customer' || role === 'supplier') {
      const root = document.documentElement;
      root.classList.add('ef-hint-in');
      const width = Number(window.localStorage.getItem('ef_auth_hint_w'));
      if (width >= 150 && width <= 500) {
        root.style.setProperty('--ef-hint-actions-w', `${width}px`);
      }
      window.setTimeout(() => root.classList.remove('ef-hint-in'), 6000);
    }
  } catch {
    // Storage can be blocked (private windows, strict settings); the header then waits as before.
  }
})();
