(function (root) {
  'use strict';

  const api = root.XMax || {};
  let running = false;
  let statusTimer = null;
  let seedObserver = null;
  let seedDebounceTimer = null;
  let seedWindowTimer = null;
  let seedRun = null;
  const STATUS_ID = 'xmax-status';
  const SEED_DEBOUNCE_MS = 180;
  const SEED_WINDOW_MS = 4500;

  const ERROR_MESSAGES = Object.freeze({
    BUSY: 'X-max is already setting a schedule time.',
    NO_COMPOSER: 'Open an X post composer first.',
    MULTIPLE_COMPOSERS: 'Choose one composer and try again.',
    OPENER_NOT_FOUND: "X's Schedule control was not found.",
    DIALOG_TIMEOUT: 'Schedule fields did not load.',
    FIELDS_TIMEOUT: 'Schedule fields did not load.',
    TARGET_OPTION_UNAVAILABLE: 'X does not offer that date/time.',
    VALUE_NOT_ACCEPTED: 'X did not accept the schedule values.',
    SUMMARY_MISMATCH: 'X did not show the requested schedule time.',
    CONFIRMATION_NOT_FOUND: 'The Schedule confirmation control was not available.',
    CONFIRMATION_UNCERTAIN: 'The schedule result is uncertain. Inspect the composer before trying again.',
    CONFIRMATION_APPLIED_UNVERIFIED: 'Schedule applied; inspect the composer to verify the displayed time.',
    INVALID_SETTINGS: 'X-max settings are invalid. Open settings and try again.',
    UNSUPPORTED: 'Open X in the active tab.'
  });

  function messageFor(code, fallback) {
    return ERROR_MESSAGES[code] || fallback || 'X-max could not set the schedule time.';
  }

  function showStatus(message, kind, timeout) {
    if (!root.document || !root.document.body) return;
    const previous = root.document.getElementById(STATUS_ID);
    if (previous) previous.remove();
    if (statusTimer) clearTimeout(statusTimer);
    const status = root.document.createElement('div');
    status.id = STATUS_ID;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.dataset.xmaxOwned = 'true';
    status.textContent = String(message).slice(0, 240);
    status.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
      'max-width:360px', 'padding:12px 16px', 'border-radius:12px',
      'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)', 'color:#fff',
      kind === 'success' ? 'background:#0b6b42' : kind === 'warning' ? 'background:#7a4b00' : 'background:#8b1e2d'
    ].join(';');
    root.document.body.appendChild(status);
    statusTimer = setTimeout(() => {
      if (status.isConnected) status.remove();
    }, timeout || 4500);
  }

  function dispatchChange(element) {
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    const EventCtor = (view && view.Event) || root.Event;
    if (typeof EventCtor !== 'function') return;
    element.dispatchEvent(new EventCtor('input', { bubbles: true }));
    element.dispatchEvent(new EventCtor('change', { bubbles: true }));
  }

  function nativeValueSetter(element) {
    const proto = Object.getPrototypeOf(element);
    const own = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (own && typeof own.set === 'function') return own.set;
    const selectProto = root.HTMLSelectElement && root.HTMLSelectElement.prototype;
    const inputProto = root.HTMLInputElement && root.HTMLInputElement.prototype;
    const selectDescriptor = selectProto && Object.getOwnPropertyDescriptor(selectProto, 'value');
    const inputDescriptor = inputProto && Object.getOwnPropertyDescriptor(inputProto, 'value');
    return element.tagName === 'SELECT' ? selectDescriptor && selectDescriptor.set : inputDescriptor && inputDescriptor.set;
  }

  function setNativeValue(element, value) {
    if (!element) return false;
    const setter = nativeValueSetter(element);
    try {
      if (setter) setter.call(element, String(value));
      else element.value = String(value);
      dispatchChange(element);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function optionExists(select, value) {
    if (!select || !select.options) return false;
    return Array.from(select.options).some((option) => String(option.value) === String(value));
  }

  function readSelectValues(fields) {
    return {
      month: String(fields.month.value),
      day: String(fields.day.value),
      year: String(fields.year.value),
      hour: String(fields.hour.value),
      minute: String(fields.minute.value),
      period: String(fields.period.value).toLowerCase()
    };
  }

  function expectedSelectValues(target) {
    return {
      month: String(target.fields.month),
      day: String(target.fields.day),
      year: String(target.fields.year),
      hour: String(target.hour12),
      minute: String(target.fields.minute),
      period: target.period
    };
  }

  function selectValuesMatch(fields, target) {
    if (!fields || fields.kind !== 'selects') return false;
    const actual = readSelectValues(fields.fields);
    const expected = expectedSelectValues(target);
    return Object.keys(expected).every((key) => actual[key] === expected[key]);
  }

  function inputValuesMatch(fields, target) {
    if (!fields || fields.kind !== 'inputs') return false;
    const date = target.fields;
    const dateValue = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
    const timeValue = `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`;
    return fields.dateInput.value === dateValue && fields.timeInput.value === timeValue;
  }

  function targetSupported(fields, target) {
    if (fields.kind === 'inputs') return true;
    const expected = expectedSelectValues(target);
    return Object.keys(expected).every((key) => optionExists(fields.fields[key], expected[key]));
  }

  async function setAndWait(dialog, fieldName, value, timeout) {
    let fields = api.findScheduleFields(dialog);
    if (!fields || fields.kind !== 'selects' || !fields.fields[fieldName]) return false;
    if (!optionExists(fields.fields[fieldName], value)) return false;
    if (!setNativeValue(fields.fields[fieldName], value)) return false;
    await api.nextFrame();
    const updated = await api.waitFor(() => {
      const current = api.findScheduleFields(dialog);
      return current && current.kind === 'selects' && String(current.fields[fieldName].value) === String(value) ? current : null;
    }, { timeout: timeout || 850, interval: 40 });
    return Boolean(updated);
  }

  async function applySelectValues(dialog, target) {
    const expected = expectedSelectValues(target);
    const order = ['year', 'month', 'day', 'period', 'hour', 'minute'];
    for (let pass = 0; pass < 2; pass += 1) {
      for (const fieldName of order) {
        if (!(await setAndWait(dialog, fieldName, expected[fieldName]))) return false;
      }
      const fields = api.findScheduleFields(dialog);
      if (selectValuesMatch(fields, target)) return true;
    }
    return false;
  }

  async function applyInputValues(dialog, fields, target) {
    const date = target.fields;
    const dateValue = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
    const timeValue = `${String(date.hour).padStart(2, '0')}:${String(date.minute).padStart(2, '0')}`;
    if (!setNativeValue(fields.dateInput, dateValue) || !setNativeValue(fields.timeInput, timeValue)) return false;
    await api.nextFrame();
    return inputValuesMatch(api.findScheduleFields(dialog), target);
  }

  function summaryMatchesTarget(dialog, target) {
    const summary = api.findSummary(dialog);
    if (!summary) return false;
    const text = api.normalizeText(summary.textContent);
    const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, target.fields.month - 1, 1)));
    const monthLong = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, target.fields.month - 1, 1)));
    const minute = String(target.fields.minute).padStart(2, '0');
    return (text.toLowerCase().includes(month.toLowerCase()) || text.toLowerCase().includes(monthLong.toLowerCase())) &&
      text.includes(String(target.fields.day)) && text.includes(String(target.fields.year)) &&
      text.includes(`${target.hour12}:${minute}`) && text.toLowerCase().includes(target.period);
  }

  function composerTimestampMatches(composer, target) {
    if (!composer) return false;
    const text = api.normalizeText(composer.textContent);
    const minute = String(target.fields.minute).padStart(2, '0');
    const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, target.fields.month - 1, 1)));
    const hasState = /\b(schedule|scheduled|will send)\b/i.test(text);
    return hasState && text.toLowerCase().includes(month.toLowerCase()) && text.includes(String(target.fields.day)) &&
      text.includes(`${target.hour12}:${minute}`) && text.toLowerCase().includes(target.period);
  }

  async function waitForDialog() {
    return api.waitFor(() => api.findScheduleDialog(root.document), { timeout: 3200, interval: 45, root: root.document && root.document.body });
  }

  async function verifyAndApply(dialog, target) {
    const fields = await api.waitFor(() => api.findScheduleFields(dialog), { timeout: 3000, interval: 45, root: root.document && root.document.body });
    if (!fields) return { ok: false, code: 'FIELDS_TIMEOUT' };
    if (!targetSupported(fields, target)) return { ok: false, code: 'TARGET_OPTION_UNAVAILABLE' };
    const applied = fields.kind === 'selects' ? await applySelectValues(dialog, target) : await applyInputValues(dialog, fields, target);
    if (!applied) return { ok: false, code: 'VALUE_NOT_ACCEPTED' };
    const verified = await api.waitFor(() => {
      const current = api.findScheduleFields(dialog);
      const fieldMatch = current && (current.kind === 'selects' ? selectValuesMatch(current, target) : inputValuesMatch(current, target));
      return fieldMatch && summaryMatchesTarget(dialog, target) ? current : null;
    }, { timeout: 1800, interval: 50, root: root.document && root.document.body });
    if (!verified) return { ok: false, code: 'SUMMARY_MISMATCH' };
    return { ok: true };
  }

  async function verifyAfterConfirmation(target) {
    const closed = await api.waitFor(() => api.findScheduleDialog(root.document) === null ? true : null, { timeout: 2600, interval: 60, root: root.document && root.document.body });
    if (!closed) return { ok: false, code: 'CONFIRMATION_UNCERTAIN', dialogClosed: false };
    const composerResult = api.findComposer(root.document);
    if (composerResult.status === 'ok' && composerTimestampMatches(composerResult.element, target)) return { ok: true, dialogClosed: true };
    // The dialog is definitely gone, so advancing the local cursor prevents a
    // duplicate even when X does not expose the resulting timestamp in the
    // composer. The user still receives an inspection warning.
    return { ok: false, code: 'CONFIRMATION_APPLIED_UNVERIFIED', warning: true, dialogClosed: true };
  }

  async function recordScheduleCursor(target, confirmationResult) {
    if (!confirmationResult || confirmationResult.dialogClosed !== true || typeof api.saveLastScheduledAt !== 'function') {
      return { ok: false, persisted: false, skipped: true };
    }
    try {
      return await api.saveLastScheduledAt(target.timestamp);
    } catch (_error) {
      return { ok: false, persisted: false, code: 'STORAGE_FAILED' };
    }
  }

  async function seedVisibleScheduleCursor() {
    if (seedRun) return seedRun;
    seedRun = (async () => {
      const settings = await api.loadSettings();
      if (!settings.enabled || typeof api.findLatestVisibleScheduleTimestamp !== 'function') {
        return { ok: false, persisted: false, code: 'SEED_DISABLED' };
      }
      const visibleTimestamp = api.findLatestVisibleScheduleTimestamp(root.document, settings.timezone);
      if (!Number.isFinite(visibleTimestamp)) return { ok: true, persisted: false, code: 'NO_VISIBLE_SCHEDULE' };
      const existing = typeof api.loadLastScheduledAt === 'function' ? await api.loadLastScheduledAt() : null;
      if (Number.isFinite(existing) && visibleTimestamp <= existing) {
        return { ok: true, persisted: false, timestamp: existing, code: 'CURSOR_CURRENT' };
      }
      if (typeof api.saveLastScheduledAt !== 'function') return { ok: false, persisted: false, code: 'STORAGE_UNAVAILABLE' };
      const saved = await api.saveLastScheduledAt(visibleTimestamp);
      return Object.assign({ timestamp: visibleTimestamp }, saved);
    })().finally(() => {
      seedRun = null;
    });
    return seedRun;
  }

  function scheduleVisibleScheduleSeed() {
    if (seedDebounceTimer) clearTimeout(seedDebounceTimer);
    seedDebounceTimer = setTimeout(() => {
      seedDebounceTimer = null;
      seedVisibleScheduleCursor().catch(() => {});
    }, SEED_DEBOUNCE_MS);
  }

  function stopVisibleScheduleSeedWindow() {
    if (seedObserver) {
      seedObserver.disconnect();
      seedObserver = null;
    }
    if (seedWindowTimer) {
      clearTimeout(seedWindowTimer);
      seedWindowTimer = null;
    }
  }

  function startVisibleScheduleSeedWindow() {
    stopVisibleScheduleSeedWindow();
    scheduleVisibleScheduleSeed();
    const body = root.document && root.document.body;
    if (body && typeof root.MutationObserver === 'function') {
      seedObserver = new root.MutationObserver((records) => {
        if (records.some((record) => record.addedNodes.length || record.removedNodes.length)) scheduleVisibleScheduleSeed();
      });
      seedObserver.observe(body, { childList: true, subtree: true });
      seedWindowTimer = setTimeout(stopVisibleScheduleSeedWindow, SEED_WINDOW_MS);
    }
  }

  function installVisibleScheduleCursorSeeding() {
    if (!root.document || !root.chrome || !root.chrome.storage) return;
    const onNavigation = () => startVisibleScheduleSeedWindow();
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('popstate', onNavigation);
      root.addEventListener('hashchange', onNavigation);
      root.addEventListener('xmax:navigation', onNavigation);
    }
    if (root.document && typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('click', (event) => {
        const target = event && event.target;
        const interactive = target && typeof target.closest === 'function' &&
          target.closest('a, button, [role="link"], [role="button"]');
        if (!interactive) return;
        if (seedObserver) scheduleVisibleScheduleSeed();
        else startVisibleScheduleSeedWindow();
      }, true);
    }
    const history = root.history;
    if (history) {
      ['pushState', 'replaceState'].forEach((method) => {
        const original = history[method];
        if (typeof original !== 'function' || original.__xmaxCursorSeedWrapped) return;
        const wrapped = function () {
          const result = original.apply(this, arguments);
          if (typeof root.dispatchEvent === 'function') {
            try {
              const EventCtor = root.Event;
              root.dispatchEvent(new EventCtor('xmax:navigation'));
            } catch (_error) {
              // Navigation hooks are best effort; X remains fully usable.
            }
          }
          return result;
        };
        wrapped.__xmaxCursorSeedWrapped = true;
        try {
          history[method] = wrapped;
        } catch (_error) {
          // Some browsers may expose a non-writable history method.
        }
      });
    }
    if (root.document.body) startVisibleScheduleSeedWindow();
    else if (typeof root.document.addEventListener === 'function') root.document.addEventListener('DOMContentLoaded', startVisibleScheduleSeedWindow, { once: true });
  }

  async function runScheduling(rawSettings) {
    if (running) return { ok: false, code: 'BUSY', message: messageFor('BUSY') };
    running = true;
    try {
      const validation = api.validateSettings(rawSettings);
      if (!validation.ok) return { ok: false, code: 'INVALID_SETTINGS', message: messageFor('INVALID_SETTINGS') };
      if (!validation.settings.enabled) return { ok: false, code: 'DISABLED', message: 'X-max scheduling is disabled in settings.' };
      let latestScheduledTimestamp = null;
      if (validation.settings.mode === 'next-slot') {
        const stored = typeof api.loadLastScheduledAt === 'function' ? await api.loadLastScheduledAt() : null;
        const visible = typeof api.findLatestVisibleScheduleTimestamp === 'function'
          ? api.findLatestVisibleScheduleTimestamp(root.document, validation.settings.timezone)
          : null;
        const known = [stored, visible].filter((timestamp) => Number.isFinite(timestamp));
        latestScheduledTimestamp = known.length ? Math.max(...known) : null;
      }
      const target = api.computeTarget(new Date(), validation.settings, latestScheduledTimestamp);
      if (!target.ok) return { ok: false, code: target.code, message: messageFor(target.code) };

      let dialog = api.findScheduleDialog(root.document);
      if (!dialog) {
        const composerResult = api.findComposer(root.document);
        if (composerResult.status === 'multiple') {
          showStatus(messageFor('MULTIPLE_COMPOSERS'), 'error');
          return { ok: false, code: 'MULTIPLE_COMPOSERS', message: messageFor('MULTIPLE_COMPOSERS') };
        }
        if (composerResult.status !== 'ok') {
          showStatus(messageFor('NO_COMPOSER'), 'error');
          return { ok: false, code: 'NO_COMPOSER', message: messageFor('NO_COMPOSER') };
        }
        const opener = api.findScheduleOpener(composerResult.element);
        if (!opener) {
          showStatus(messageFor('OPENER_NOT_FOUND'), 'error');
          return { ok: false, code: 'OPENER_NOT_FOUND', message: messageFor('OPENER_NOT_FOUND') };
        }
        opener.click();
        dialog = await waitForDialog();
        if (!dialog) {
          showStatus(messageFor('DIALOG_TIMEOUT'), 'error');
          return { ok: false, code: 'DIALOG_TIMEOUT', message: messageFor('DIALOG_TIMEOUT') };
        }
      }

      const applied = await verifyAndApply(dialog, target);
      if (!applied.ok) {
        showStatus(messageFor(applied.code), 'error');
        return Object.assign(applied, { message: messageFor(applied.code), target: { timestamp: target.timestamp, timeZone: target.timeZone } });
      }

      const confirmation = api.findPrimaryConfirmation(dialog);
      if (!confirmation) {
        showStatus(messageFor('CONFIRMATION_NOT_FOUND'), 'error');
        return { ok: false, code: 'CONFIRMATION_NOT_FOUND', message: messageFor('CONFIRMATION_NOT_FOUND') };
      }
      confirmation.click();
      const after = await verifyAfterConfirmation(target);
      const cursorResult = await recordScheduleCursor(target, after);
      const formatted = api.formatTarget(target);
      if (after.ok) {
        const cursorNote = cursorResult.persisted ? '' : ' Queue memory could not be saved.';
        const message = `Scheduled for ${formatted} (${target.timeZone}).${cursorNote}`;
        showStatus(message, cursorNote ? 'warning' : 'success');
        return { ok: true, code: 'SCHEDULE_APPLIED', message: message, cursorPersisted: Boolean(cursorResult.persisted), target: { timestamp: target.timestamp, timeZone: target.timeZone } };
      }
      const warning = messageFor(after.code);
      showStatus(warning, 'warning');
      return { ok: false, code: after.code, warning: true, cursorPersisted: Boolean(cursorResult.persisted), message: warning, target: { timestamp: target.timestamp, timeZone: target.timeZone } };
    } finally {
      running = false;
    }
  }

  function installRuntimeListener() {
    const runtime = root.chrome && root.chrome.runtime;
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') return;
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== 'xmax.setScheduleTime' || message.version !== 1) return undefined;
      runScheduling(message.settings || api.DEFAULT_SETTINGS)
        .then((response) => sendResponse(response))
        .catch((_error) => sendResponse({ ok: false, code: 'UNEXPECTED', message: 'X-max could not set the schedule time.' }));
      return true;
    });
  }

  api.runScheduling = runScheduling;
  api.recordScheduleCursor = recordScheduleCursor;
  api.seedVisibleScheduleCursor = seedVisibleScheduleCursor;
  api.startVisibleScheduleSeedWindow = startVisibleScheduleSeedWindow;
  api.stopVisibleScheduleSeedWindow = stopVisibleScheduleSeedWindow;
  api.showStatus = showStatus;
  api.setNativeValue = setNativeValue;
  api.selectValuesMatch = selectValuesMatch;
  api.inputValuesMatch = inputValuesMatch;
  root.XMax = api;
  installRuntimeListener();
  installVisibleScheduleCursorSeeding();
})(typeof globalThis !== 'undefined' ? globalThis : window);
