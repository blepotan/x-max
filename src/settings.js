(function (root) {
  'use strict';

  const api = root.XMax || {};
  const STORAGE_KEY = 'xmaxSettings';
  const LAST_SCHEDULE_KEY = 'xmaxLastScheduledAt';
  const SEQUENCE_RESET_KEY = 'xmaxSequenceReset';
  const LAST_SCHEDULE_SCHEMA_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const SLOT_INTERVALS = Object.freeze([5, 10, 15, 30, 60]);
  const TIME_ZONE_OPTIONS = Object.freeze([
    'local',
    'UTC',
    'Asia/Jakarta',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Africa/Cairo',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Pacific/Auckland'
  ]);

  function browserTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_error) {
      return 'UTC';
    }
  }

  const DEFAULTS = Object.freeze({
    version: SCHEMA_VERSION,
    enabled: true,
    mode: 'fixed-delay',
    delayMinutes: 60,
    slotIntervalMinutes: 30,
    minimumLeadMinutes: 5,
    timezone: 'local'
  });

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
  }

  function isValidTimeZone(value) {
    if (value === 'local') return true;
    if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function validateSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const settings = {
      version: SCHEMA_VERSION,
      enabled: raw.enabled !== false,
      mode: raw.mode,
      delayMinutes: raw.delayMinutes,
      slotIntervalMinutes: raw.slotIntervalMinutes,
      minimumLeadMinutes: raw.minimumLeadMinutes,
      timezone: raw.timezone
    };

    if (settings.mode !== 'fixed-delay' && settings.mode !== 'next-slot') {
      return { ok: false, code: 'INVALID_MODE', message: 'Choose a fixed delay or sequential-interval rule.' };
    }
    if (!isInteger(settings.delayMinutes) || settings.delayMinutes < 1 || settings.delayMinutes > 43200) {
      return { ok: false, code: 'INVALID_DELAY', message: 'Fixed delay must be an integer from 1 to 43,200 minutes.' };
    }
    if (!isInteger(settings.slotIntervalMinutes) || !SLOT_INTERVALS.includes(settings.slotIntervalMinutes)) {
      return { ok: false, code: 'INVALID_INTERVAL', message: 'Slot interval must be 5, 10, 15, 30, or 60 minutes.' };
    }
    if (!isInteger(settings.minimumLeadMinutes) || settings.minimumLeadMinutes < 1 || settings.minimumLeadMinutes > 120) {
      return { ok: false, code: 'INVALID_LEAD', message: 'Minimum lead time must be an integer from 1 to 120 minutes.' };
    }
    if (!isValidTimeZone(settings.timezone)) {
      return { ok: false, code: 'INVALID_TIMEZONE', message: 'Choose a valid IANA time zone.' };
    }

    return { ok: true, settings: settings };
  }

  function normalizeSettings(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const candidate = Object.assign({}, DEFAULTS, raw, { version: SCHEMA_VERSION });
    const result = validateSettings(candidate);
    return result.ok ? result.settings : copy(DEFAULTS);
  }

  async function loadSettings(storage) {
    const storageApi = storage || (root.chrome && root.chrome.storage);
    if (!storageApi) return copy(DEFAULTS);

    try {
      const sync = storageApi.sync;
      if (sync && typeof sync.get === 'function') {
        // Do not pass defaults here: Chrome would synthesize the key and make
        // an absent sync value indistinguishable from real stored defaults.
        const result = await sync.get([STORAGE_KEY]);
        if (result && Object.prototype.hasOwnProperty.call(result, STORAGE_KEY)) {
          return normalizeSettings(result[STORAGE_KEY]);
        }
      }
    } catch (_syncError) {
      // Fall through to local storage when sync is unavailable or over quota.
    }
    try {
      const local = storageApi.local;
      if (local && typeof local.get === 'function') {
        const result = await local.get([STORAGE_KEY]);
        if (result && Object.prototype.hasOwnProperty.call(result, STORAGE_KEY)) {
          return normalizeSettings(result[STORAGE_KEY]);
        }
      }
    } catch (_localError) {
      // Use defaults if both storage areas are unavailable.
    }
    return copy(DEFAULTS);
  }

  async function saveSettings(input, storage) {
    const validation = validateSettings(input);
    if (!validation.ok) return validation;
    const storageApi = storage || (root.chrome && root.chrome.storage);
    if (!storageApi) return { ok: true, settings: validation.settings, persisted: false };

    const payload = { [STORAGE_KEY]: validation.settings };
    try {
      const sync = storageApi.sync;
      if (sync && typeof sync.set === 'function') {
        await sync.set(payload);
        return { ok: true, settings: validation.settings, persisted: true, area: 'sync' };
      }
    } catch (_syncError) {
      // Sync quota and transient storage failures are handled by local storage below.
    }
    try {
      const local = storageApi.local;
      if (local && typeof local.set === 'function') {
        await local.set(payload);
        return { ok: true, settings: validation.settings, persisted: true, area: 'local' };
      }
    } catch (_localError) {
      return { ok: false, code: 'STORAGE_FAILED', message: 'Settings could not be saved locally.' };
    }
    return { ok: true, settings: validation.settings, persisted: false };
  }

  async function readTimestamp(area) {
    if (!area || typeof area.get !== 'function') return null;
    try {
      const result = await area.get([LAST_SCHEDULE_KEY]);
      if (!result || !Object.prototype.hasOwnProperty.call(result, LAST_SCHEDULE_KEY)) return null;
      const timestamp = Number(result[LAST_SCHEDULE_KEY]);
      return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
    } catch (_error) {
      return null;
    }
  }

  async function loadLastScheduledAt(storage) {
    const storageApi = storage || (root.chrome && root.chrome.storage);
    if (!storageApi) return null;
    if (await isSequenceReset(storageApi)) return null;
    // The cursor is device-local state. Read both areas so a prior fallback
    // write cannot be masked by an older value in the other area.
    const values = await Promise.all([
      readTimestamp(storageApi.local),
      readTimestamp(storageApi.sync)
    ]);
    const valid = values.filter((timestamp) => timestamp !== null);
    return valid.length ? Math.max(...valid) : null;
  }

  async function saveLastScheduledAt(timestamp, storage) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, persisted: false, code: 'INVALID_SCHEDULE_CURSOR' };
    }
    const storageApi = storage || (root.chrome && root.chrome.storage);
    if (!storageApi) return { ok: false, persisted: false, code: 'STORAGE_UNAVAILABLE' };
    const existing = await loadLastScheduledAt(storageApi);
    const payload = { [LAST_SCHEDULE_KEY]: Math.floor(Math.max(value, existing || 0)) };
    try {
      if (storageApi.local && typeof storageApi.local.set === 'function') {
        await storageApi.local.set(payload);
        if (typeof storageApi.local.remove === 'function') await storageApi.local.remove(SEQUENCE_RESET_KEY);
        return { ok: true, persisted: true, area: 'local', timestamp: payload[LAST_SCHEDULE_KEY] };
      }
    } catch (_localError) {
      // A local write failure falls back to sync below.
    }
    try {
      if (storageApi.sync && typeof storageApi.sync.set === 'function') {
        await storageApi.sync.set(payload);
        if (storageApi.local && typeof storageApi.local.remove === 'function') await storageApi.local.remove(SEQUENCE_RESET_KEY);
        return { ok: true, persisted: true, area: 'sync', timestamp: payload[LAST_SCHEDULE_KEY] };
      }
    } catch (_syncError) {
      // Report the failure without retrying or changing the post.
    }
    return { ok: false, persisted: false, code: 'STORAGE_FAILED' };
  }

  async function isSequenceReset(storage) {
    const storageApi = storage || (root.chrome && root.chrome.storage);
    try {
      if (!storageApi || !storageApi.local || typeof storageApi.local.get !== 'function') return false;
      const result = await storageApi.local.get([SEQUENCE_RESET_KEY]);
      return Boolean(result && result[SEQUENCE_RESET_KEY] === true);
    } catch (_error) {
      return false;
    }
  }

  async function resetSequenceCursor(storage) {
    const storageApi = storage || (root.chrome && root.chrome.storage);
    if (!storageApi) return { ok: false, code: 'STORAGE_UNAVAILABLE' };
    try {
      if (!storageApi.local || typeof storageApi.local.set !== 'function') throw new Error('local storage unavailable');
      await storageApi.local.set({ [SEQUENCE_RESET_KEY]: true });
      const removals = [];
      if (typeof storageApi.local.remove === 'function') removals.push(storageApi.local.remove(LAST_SCHEDULE_KEY));
      if (storageApi.sync && typeof storageApi.sync.remove === 'function') removals.push(storageApi.sync.remove(LAST_SCHEDULE_KEY));
      await Promise.all(removals);
      return { ok: true, reset: true };
    } catch (_error) {
      return { ok: false, code: 'STORAGE_FAILED', message: 'The sequence could not be reset.' };
    }
  }

  api.STORAGE_KEY = STORAGE_KEY;
  api.LAST_SCHEDULE_KEY = LAST_SCHEDULE_KEY;
  api.SEQUENCE_RESET_KEY = SEQUENCE_RESET_KEY;
  api.LAST_SCHEDULE_SCHEMA_VERSION = LAST_SCHEDULE_SCHEMA_VERSION;
  api.SCHEMA_VERSION = SCHEMA_VERSION;
  api.SLOT_INTERVALS = SLOT_INTERVALS;
  api.TIME_ZONE_OPTIONS = TIME_ZONE_OPTIONS;
  api.DEFAULT_SETTINGS = DEFAULTS;
  api.browserTimeZone = browserTimeZone;
  api.isValidTimeZone = isValidTimeZone;
  api.validateSettings = validateSettings;
  api.normalizeSettings = normalizeSettings;
  api.loadSettings = loadSettings;
  api.saveSettings = saveSettings;
  api.loadLastScheduledAt = loadLastScheduledAt;
  api.saveLastScheduledAt = saveLastScheduledAt;
  api.isSequenceReset = isSequenceReset;
  api.resetSequenceCursor = resetSequenceCursor;
  root.XMax = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
