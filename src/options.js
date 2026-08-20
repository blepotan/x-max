(function (root) {
  'use strict';

  const api = root.XMax || {};
  const byId = (id) => root.document.getElementById(id);
  let current = api.DEFAULT_SETTINGS;

  function setStatus(message, error) {
    const element = byId('status');
    element.textContent = message || '';
    element.style.color = error ? '#b42318' : '#087443';
  }

  function renderMode() {
    const next = byId('mode').value === 'next-slot';
    byId('fixed-fields').hidden = next;
    byId('slot-fields').hidden = !next;
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
    const target = api.computeTarget(new Date(), validation.settings);
    if (!target.ok) {
      preview.textContent = 'The next target is unavailable with these settings.';
      return;
    }
    preview.textContent = `Next target: ${api.formatTarget(target)} (${target.timeZone})`;
  }

  function writeForm(settings) {
    current = settings;
    byId('enabled').checked = settings.enabled;
    byId('mode').value = settings.mode;
    byId('delay-minutes').value = settings.delayMinutes;
    byId('slot-interval').value = settings.slotIntervalMinutes;
    byId('minimum-lead').value = settings.minimumLeadMinutes;
    byId('timezone').value = settings.timezone;
    renderMode();
    updatePreview();
  }

  async function initialize() {
    writeForm(await api.loadSettings());
    byId('mode').addEventListener('change', () => { renderMode(); updatePreview(); });
    ['enabled', 'delay-minutes', 'slot-interval', 'minimum-lead', 'timezone'].forEach((id) => {
      byId(id).addEventListener('input', updatePreview);
      byId(id).addEventListener('change', updatePreview);
    });
    const list = byId('timezone-list');
    for (const zone of api.TIME_ZONE_OPTIONS || []) {
      const option = root.document.createElement('option');
      option.value = zone;
      list.appendChild(option);
    }
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
  }

  if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', initialize);
  else if (root.document) initialize();
})(typeof globalThis !== 'undefined' ? globalThis : window);
