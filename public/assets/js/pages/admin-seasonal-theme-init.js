'use strict';
/**
 * Admin > System Settings > Seasonal Navbar Theme.
 *
 * Reads and saves GET/PUT /api/admin/settings/seasonal-theme. The server owns
 * the rule (services/seasonalTheme.service.js); this card only edits the
 * settings and reports what the server says is live.
 */
(function () {
  const ENDPOINT = '/api/admin/settings/seasonal-theme';

  const autoInput = document.getElementById('seasonalAuto');
  const statusBox = document.getElementById('seasonalStatus');
  const manualBox = document.getElementById('seasonalManual');
  const themeSelect = document.getElementById('seasonalManualTheme');
  const returnInput = document.getElementById('seasonalReturn');
  const occasionList = document.getElementById('seasonalOccasionList');
  const tableNote = document.getElementById('seasonalTableNote');
  const saveButton = document.getElementById('saveSeasonalTheme');

  if (!autoInput || !statusBox || !themeSelect || !occasionList || !saveButton) {
    return;
  }

  let state = null;

  const parseDate = iso => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const longDate = iso =>
    parseDate(iso)
      .toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      .replace(',', '');

  const shortDate = iso =>
    parseDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  const nameOf = key => {
    const occasion = state && state.occasions.find(item => item.key === key);
    return occasion ? occasion.name : null;
  };

  const windowText = occasion =>
    occasion.start
      ? `${shortDate(occasion.start)} to ${shortDate(occasion.end)}`
      : 'no dates available';

  function describeLive() {
    const { resolved, next, ukDate, settings } = state;
    statusBox.textContent = '';

    const live = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = resolved.theme ? nameOf(resolved.theme) : 'No theme (normal site)';
    const source = {
      auto: 'automatic',
      manual: 'set manually',
      returned: 'back on the auto schedule',
    }[resolved.source];
    live.append('Live now: ', strong, ` (${source}). `);
    live.append(
      next
        ? `Next change: ${longDate(next.date)} at 00:00, ${next.theme ? `switching to ${nameOf(next.theme)}` : 'back to the normal site'}.`
        : 'Nothing will change by itself.'
    );
    statusBox.appendChild(live);

    if (resolved.source === 'manual' && resolved.theme) {
      const occasion = state.occasions.find(item => item.key === resolved.theme);
      const inWindow =
        occasion && occasion.start && ukDate >= occasion.start && ukDate <= occasion.end;
      if (!inWindow) {
        const warning = document.createElement('span');
        warning.className = 'seasonal-warning';
        warning.textContent = `${nameOf(resolved.theme)} usually runs ${windowText(occasion)}, so it stays on until ${
          settings.returnToAutoOn ? `${longDate(settings.returnToAutoOn)}` : 'you change it'
        }.`;
        statusBox.appendChild(warning);
      }
    }
  }

  function renderForm() {
    const { settings, occasions } = state;
    autoInput.checked = settings.auto;
    manualBox.hidden = settings.auto;

    themeSelect.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'None (normal site)';
    themeSelect.appendChild(none);
    occasions.forEach(occasion => {
      const option = document.createElement('option');
      option.value = occasion.key;
      option.textContent = occasion.name;
      themeSelect.appendChild(option);
    });
    themeSelect.value = settings.manualTheme || '';
    returnInput.value = settings.returnToAutoOn || '';

    occasionList.textContent = '';
    occasions.forEach(occasion => {
      const label = document.createElement('label');
      label.className = 'checkbox-label-right';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.occasion = occasion.key;
      box.checked = !settings.excluded.includes(occasion.key);
      const text = document.createElement('span');
      text.textContent = occasion.name;
      const dates = document.createElement('span');
      dates.className = 'seasonal-dates';
      dates.textContent = `${windowText(occasion)}${occasion.moves ? ' · moves yearly' : ''}`;
      label.append(box, text, dates);
      occasionList.appendChild(label);
    });

    const year = Number(state.ukDate.slice(0, 4));
    if (tableNote) {
      tableNote.hidden = year < state.chineseNewYearTableEndsIn - 2;
      tableNote.textContent = `Chinese New Year dates are built in up to ${state.chineseNewYearTableEndsIn}. Ask a developer to extend them before then.`;
    }
  }

  function render() {
    renderForm();
    describeLive();
  }

  async function load() {
    try {
      state = await AdminShared.adminFetch(ENDPOINT, { method: 'GET' });
      render();
    } catch (error) {
      AdminShared.debugError('Failed to load seasonal theme settings:', error);
      statusBox.textContent = 'Could not load the seasonal theme settings. Refresh to try again.';
    }
  }

  autoInput.addEventListener('change', () => {
    manualBox.hidden = autoInput.checked;
    // Turning auto off keeps whatever is live now, so nothing jumps.
    if (!autoInput.checked && !themeSelect.value && state && state.resolved.theme) {
      themeSelect.value = state.resolved.theme;
    }
  });

  saveButton.addEventListener('click', async () => {
    if (!state) {
      return;
    }
    const excluded = Array.from(occasionList.querySelectorAll('input[data-occasion]'))
      .filter(box => !box.checked)
      .map(box => box.dataset.occasion);

    try {
      await AdminShared.safeAction(
        saveButton,
        async () => {
          await AdminShared.fetchCSRFToken();
          const result = await AdminShared.adminFetch(ENDPOINT, {
            method: 'PUT',
            body: {
              auto: autoInput.checked,
              manualTheme: themeSelect.value || null,
              returnToAutoOn: returnInput.value || null,
              excluded,
            },
          });
          state = result;
          render();
          return result;
        },
        {
          loadingText: 'Saving...',
          successMessage: 'Seasonal theme settings updated',
          errorMessage: 'Failed to update seasonal theme settings',
        }
      );
    } catch (error) {
      // safeAction has already shown the error; keep the form as the admin left it.
    }
  });

  load();
})();
