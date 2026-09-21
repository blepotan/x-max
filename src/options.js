(function (root) {
  'use strict';

  const api = root.XMax || {};
  const byId = (id) => root.document.getElementById(id);
  const COMMAND = 'set-schedule-time';
  const SUGGESTED_SHORTCUT = 'Alt+Shift+X';
  const SHORTCUT_SETTINGS_URL = 'chrome://extensions/shortcuts';
  let current = api.DEFAULT_SETTINGS;
  let sequenceCursor = null;
  let sequenceWasReset = false;
  let selectComponents = [];

  function setStatus(message, error) {
    const element = byId('status');
    element.textContent = message || '';
    element.dataset.kind = error ? 'error' : 'success';
  }

  function renderMode() {
    const next = byId('mode').value === 'next-slot';
    byId('fixed-fields').hidden = next;
    byId('slot-fields').hidden = !next;
  }

  function renderShortcut(shortcut) {
    const value = typeof shortcut === 'string' ? shortcut.trim() : '';
    const state = byId('shortcut-state');
    const keys = byId('shortcut-keys');
    state.textContent = value ? 'Current shortcut' : 'Not assigned · Suggested';
    state.dataset.state = value ? 'assigned' : 'unassigned';
    keys.dataset.state = value ? 'assigned' : 'suggested';
    keys.replaceChildren();
    const parts = (value || SUGGESTED_SHORTCUT).split('+').map((part) => part.trim()).filter(Boolean);
    parts.forEach((part, index) => {
      if (index > 0) {
        const separator = root.document.createElement('span');
        separator.textContent = '+';
        separator.setAttribute('aria-hidden', 'true');
        keys.appendChild(separator);
      }
      const key = root.document.createElement('kbd');
      key.textContent = part;
      keys.appendChild(key);
    });
    keys.setAttribute('aria-label', value
      ? parts.join(' plus ')
      : `No shortcut assigned. Suggested shortcut: ${parts.join(' plus ')}`);
  }

  function loadShortcut() {
    const commands = root.chrome && root.chrome.commands;
    if (!commands || typeof commands.getAll !== 'function') {
      renderShortcut('');
      return Promise.resolve('');
    }
    return new Promise((resolve) => {
      try {
        commands.getAll((items) => {
          const runtimeError = root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
          const command = !runtimeError && Array.isArray(items)
            ? items.find((item) => item && item.name === COMMAND)
            : null;
          const shortcut = command && command.shortcut || '';
          renderShortcut(shortcut);
          resolve(shortcut);
        });
      } catch (_error) {
        renderShortcut('');
        resolve('');
      }
    });
  }

  function openShortcutSettings() {
    const feedback = byId('shortcut-feedback');
    feedback.textContent = '';
    const tabs = root.chrome && root.chrome.tabs;
    if (!tabs || typeof tabs.create !== 'function') {
      feedback.textContent = `Open ${SHORTCUT_SETTINGS_URL} in Chrome’s address bar.`;
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      try {
        tabs.create({ url: SHORTCUT_SETTINGS_URL }, () => {
          const runtimeError = root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
          if (runtimeError) {
            feedback.textContent = `Open ${SHORTCUT_SETTINGS_URL} in Chrome’s address bar.`;
            resolve(false);
            return;
          }
          resolve(true);
        });
      } catch (_error) {
        feedback.textContent = `Open ${SHORTCUT_SETTINGS_URL} in Chrome’s address bar.`;
        resolve(false);
      }
    });
  }

  function cursorLabel(timestamp, timezone) {
    if (!Number.isFinite(timestamp)) return '';
    const zone = timezone === 'local' ? api.browserTimeZone() : timezone;
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit'
      }).format(new Date(timestamp));
    } catch (_error) {
      return new Date(timestamp).toLocaleString();
    }
  }

  function renderSequenceState(settings) {
    const copy = byId('sequence-state-copy');
    const reset = byId('reset-sequence');
    if (sequenceWasReset || !Number.isFinite(sequenceCursor)) {
      copy.textContent = 'Starts from the current time on your next shortcut.';
      reset.disabled = true;
      reset.textContent = 'Already reset';
      return;
    }
    copy.textContent = `Continues after ${cursorLabel(sequenceCursor, settings.timezone)}.`;
    reset.disabled = false;
    reset.textContent = 'Reset to current time';
  }

  function readForm() {
    return {
      version: api.SCHEMA_VERSION,
      enabled: byId('enabled').checked,
      mode: byId('mode').value,
      delayMinutes: Number(byId('delay-minutes').value),
      slotIntervalMinutes: Number(byId('slot-interval').value),
      minimumLeadMinutes: Number(byId('minimum-lead').value),
      timezone: byId('timezone').value.trim() || 'local'
    };
  }

  function updatePreview() {
    const draft = readForm();
    const validation = api.validateSettings(draft);
    const preview = byId('preview');
    if (!validation.ok) {
      preview.textContent = 'Enter valid settings to preview the next target.';
      return;
    }
    const cursor = validation.settings.mode === 'next-slot' && !sequenceWasReset ? sequenceCursor : null;
    const target = api.computeTarget(new Date(), validation.settings, cursor);
    if (!target.ok) {
      preview.textContent = 'The next target is unavailable with these settings.';
      return;
    }
    const rows = [
      ['Rule time', `${api.formatTimestamp(target.timestamp, target.configuredTimeZone)} · ${target.configuredTimeZone}`]
    ];
    if (target.configuredTimeZone !== target.timeZone) {
      rows.push(['X time', `${api.formatTimestamp(target.timestamp, target.timeZone)} · ${target.timeZone}`]);
    }
    preview.replaceChildren(...rows.map(([label, value]) => {
      const row = root.document.createElement('div');
      row.className = 'preview-row';
      const name = root.document.createElement('span');
      name.className = 'preview-label';
      name.textContent = label;
      const copy = root.document.createElement('strong');
      copy.textContent = value;
      row.append(name, copy);
      return row;
    }));
    renderSequenceState(validation.settings);
  }

  function writeForm(settings) {
    current = settings;
    byId('enabled').checked = settings.enabled;
    byId('mode').value = settings.mode;
    byId('delay-minutes').value = settings.delayMinutes;
    byId('slot-interval').value = settings.slotIntervalMinutes;
    byId('minimum-lead').value = settings.minimumLeadMinutes;
    byId('timezone').value = settings.timezone;
    selectComponents.forEach((component) => component.sync());
    renderMode();
    updatePreview();
  }

  async function initialize() {
    const loaded = await Promise.all([
      api.loadSettings(),
      typeof api.loadLastScheduledAt === 'function' ? api.loadLastScheduledAt() : null,
      typeof api.isSequenceReset === 'function' ? api.isSequenceReset() : false
    ]);
    sequenceCursor = loaded[1];
    sequenceWasReset = loaded[2];
    writeForm(loaded[0]);
    if (root.XMaxUI && typeof root.XMaxUI.enhanceSelect === 'function') {
      selectComponents = [
        root.XMaxUI.enhanceSelect(byId('mode')),
        root.XMaxUI.enhanceSelect(byId('slot-interval')),
        root.XMaxUI.enhanceCombobox(byId('timezone'), api.TIME_ZONE_OPTIONS)
      ].filter(Boolean);
    }
    byId('mode').addEventListener('change', () => { renderMode(); updatePreview(); });
    ['enabled', 'delay-minutes', 'slot-interval', 'minimum-lead', 'timezone'].forEach((id) => {
      byId(id).addEventListener('input', updatePreview);
      byId(id).addEventListener('change', updatePreview);
    });
    byId('settings-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const validation = api.validateSettings(readForm());
      if (!validation.ok) {
        setStatus(validation.message, true);
        return;
      }
      const result = await api.saveSettings(validation.settings);
      if (!result.ok) {
        setStatus(result.message || 'Settings could not be saved.', true);
        return;
      }
      writeForm(result.settings);
      setStatus('Settings saved.', false);
    });
    byId('reset-sequence').addEventListener('click', async () => {
      const button = byId('reset-sequence');
      button.disabled = true;
      button.textContent = 'Resetting…';
      const result = await api.resetSequenceCursor();
      if (!result.ok) {
        button.disabled = false;
        button.textContent = 'Reset to current time';
        setStatus(result.message || 'The sequence could not be reset.', true);
        return;
      }
      sequenceCursor = null;
      sequenceWasReset = true;
      updatePreview();
      setStatus('Sequence reset. The next shortcut starts from the current time.', false);
    });
    byId('open-shortcut-settings').addEventListener('click', async () => {
      const button = byId('open-shortcut-settings');
      button.disabled = true;
      await openShortcutSettings();
      button.disabled = false;
    });
    await loadShortcut();
  }

  if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize);
  else if (root.document) initialize();
})(typeof globalThis !== 'undefined' ? globalThis : window);
