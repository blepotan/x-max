(function (root) {
  'use strict';

  const api = root.XMax || {};
  let running = false;
  let seedObserver = null;
  let seedDebounceTimer = null;
  let seedWindowTimer = null;
  let seedRun = null;
  const TOAST_VIEWPORT_ID = 'xmax-toast-viewport';
  const TOAST_STYLE_ID = 'xmax-toast-style';
  const MAX_VISIBLE_TOASTS = 3;
  const TOAST_LAYER = 2147483647; // Required to stay above X's third-party stacking contexts.
  const BACKGROUND_DIALOG_ATTRIBUTE = 'data-xmax-background-schedule';
  const BACKGROUND_MODE_ATTRIBUTE = 'data-xmax-background-mode';
  const EXISTING_MODAL_ATTRIBUTE = 'data-xmax-existing-modal';
  const BACKGROUND_STYLE_ID = 'xmax-background-schedule-style';
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

  function installToastStyle() {
    if (!root.document || !root.document.documentElement) return;
    if (root.document.getElementById(TOAST_STYLE_ID)) return;
    const style = root.document.createElement('style');
    style.id = TOAST_STYLE_ID;
    style.dataset.xmaxOwned = 'true';
    style.textContent = `
      #${TOAST_VIEWPORT_ID} {
        position: fixed;
        z-index: ${TOAST_LAYER};
        bottom: max(18px, env(safe-area-inset-bottom));
        left: 50%;
        width: min(calc(100vw - 24px), 300px);
        height: 58px;
        transform: translateX(-50%);
        pointer-events: none;
        isolation: isolate;
      }
      #${TOAST_VIEWPORT_ID} .xmax-toast {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        width: 100%;
        min-height: 48px;
        padding: 8px 12px 9px;
        border: 0;
        border-radius: 14px;
        background: linear-gradient(145deg, #191b1e 0%, #111315 32%, #090a0b 72%, #0e1012 100%);
        box-shadow: 0 0 0 1px rgb(255 255 255 / 12%), 0 2px 5px rgb(0 0 0 / 28%), 0 14px 30px -10px rgb(0 0 0 / 68%), inset 0 1px 0 rgb(255 255 255 / 7%);
        color: #f5f7f9;
        font: 400 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: -.005em;
        opacity: 0;
        transform: translateY(16px) scale(.98);
        transform-origin: bottom center;
        transition: opacity 180ms cubic-bezier(.32, .72, 0, 1), transform 180ms cubic-bezier(.32, .72, 0, 1);
        -webkit-font-smoothing: antialiased;
      }
      #${TOAST_VIEWPORT_ID} .xmax-toast[data-instant="true"] {
        transition-duration: 160ms;
      }
      #${TOAST_VIEWPORT_ID} .xmax-toast[data-state="open"] {
        opacity: 1;
        transform: translateY(var(--toast-y, 0)) scale(var(--toast-scale, 1));
      }
      #${TOAST_VIEWPORT_ID} .xmax-toast[data-state="closed"] {
        opacity: 0;
        transform: translateY(10px) scale(.98);
        transition-duration: 140ms;
        transition-timing-function: ease-in;
      }
      #${TOAST_VIEWPORT_ID} .xmax-toast-title {
        display: block;
        margin: 0;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.3;
      }
      #${TOAST_VIEWPORT_ID} .xmax-toast-message {
        display: block;
        min-width: 0;
        color: #d5d8dc;
        font-size: 11px;
        line-height: 1.35;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        #${TOAST_VIEWPORT_ID} .xmax-toast {
          transition: none;
        }
      }
    `;
    (root.document.head || root.document.documentElement).appendChild(style);
  }

  function reindexToasts(viewport) {
    if (!viewport || typeof viewport.querySelectorAll !== 'function') return;
    const toasts = Array.from(viewport.querySelectorAll('.xmax-toast:not([data-state="closed"])'));
    toasts.forEach((toast, index) => {
      const depth = toasts.length - index - 1;
      toast.style.setProperty('--toast-y', `${depth * -8}px`);
      toast.style.setProperty('--toast-scale', String(Math.max(0.92, 1 - depth * 0.04)));
      toast.style.zIndex = String(MAX_VISIBLE_TOASTS - depth);
      toast.dataset.depth = String(depth);
    });
  }

  function pruneToastStack(viewport, currentToast) {
    if (!viewport || typeof viewport.querySelectorAll !== 'function') return [];
    const active = Array.from(viewport.querySelectorAll('.xmax-toast:not([data-state="closed"])'));
    while (active.length > MAX_VISIBLE_TOASTS) {
      const oldest = active.shift();
      if (oldest && oldest !== currentToast) oldest.remove();
    }
    return active;
  }

  function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    toast.dataset.state = 'closed';
    const viewport = toast.parentElement;
    const remove = () => {
      if (toast.isConnected) toast.remove();
      if (viewport) reindexToasts(viewport);
      if (viewport && !viewport.firstElementChild) viewport.remove();
    };
    toast.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 220);
  }

  function showStatus(message, kind, timeout) {
    if (!root.document || !root.document.body) return;
    installToastStyle();
    let viewport = root.document.getElementById(TOAST_VIEWPORT_ID);
    if (!viewport) {
      viewport = root.document.createElement('div');
      viewport.id = TOAST_VIEWPORT_ID;
      viewport.dataset.xmaxOwned = 'true';
      viewport.setAttribute('aria-label', 'X-max notifications');
      root.document.body.appendChild(viewport);
    }
    const status = root.document.createElement('div');
    status.className = 'xmax-toast';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.dataset.xmaxOwned = 'true';
    status.dataset.kind = kind === 'success' || kind === 'warning' ? kind : 'error';
    status.dataset.state = 'entering';
    const hadVisibleToast = typeof viewport.querySelectorAll === 'function' &&
      viewport.querySelectorAll('.xmax-toast:not([data-state="closed"])').length > 0;
    if (hadVisibleToast) status.dataset.instant = 'true';
    const title = root.document.createElement('strong');
    title.className = 'xmax-toast-title';
    title.textContent = status.dataset.kind === 'success'
      ? 'Schedule applied'
      : status.dataset.kind === 'warning'
        ? 'Schedule needs review'
        : 'Couldn’t schedule';
    const copy = root.document.createElement('span');
    copy.className = 'xmax-toast-message';
    copy.textContent = String(message).slice(0, 240);
    status.append(title, copy);
    viewport.appendChild(status);
    pruneToastStack(viewport, status);
    reindexToasts(viewport);
    const open = () => {
      status.dataset.state = 'open';
      reindexToasts(viewport);
    };
    // Two frames guarantee the entering transform is painted before opening.
    // A single frame can be coalesced by Chrome and make repeated toasts pop in.
    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(() => root.requestAnimationFrame(open));
    }
    else setTimeout(open, 0);
    setTimeout(() => dismissToast(status), timeout || 4500);
  }

  function createSerialQueue(task) {
    let tail = Promise.resolve();
    return function enqueue() {
      const args = arguments;
      const run = tail.then(() => task.apply(null, args));
      tail = run.catch(() => {});
      return run;
    };
  }

  function cloakScheduleDialog(dialog) {
    if (!dialog || !dialog.style || typeof dialog.setAttribute !== 'function') return () => {};
    const properties = ['opacity', 'pointer-events', 'transition', 'animation'];
    const previous = properties.map((property) => ({
      property,
      value: dialog.style.getPropertyValue(property),
      priority: dialog.style.getPropertyPriority(property)
    }));
    const hadAttribute = dialog.hasAttribute(BACKGROUND_DIALOG_ATTRIBUTE);

    dialog.setAttribute(BACKGROUND_DIALOG_ATTRIBUTE, 'true');
    dialog.style.setProperty('opacity', '0.001', 'important');
    dialog.style.setProperty('pointer-events', 'none', 'important');
    dialog.style.setProperty('transition', 'none', 'important');
    dialog.style.setProperty('animation', 'none', 'important');

    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      for (const item of previous) {
        if (item.value) dialog.style.setProperty(item.property, item.value, item.priority);
        else dialog.style.removeProperty(item.property);
      }
      if (!hadAttribute) dialog.removeAttribute(BACKGROUND_DIALOG_ATTRIBUTE);
    };
  }

  function installBackgroundScheduleStyle() {
    if (!root.document || !root.document.documentElement) return;
    if (root.document.getElementById(BACKGROUND_STYLE_ID)) return;
    const style = root.document.createElement('style');
    style.id = BACKGROUND_STYLE_ID;
    style.dataset.xmaxOwned = 'true';
    style.textContent = `
      html[${BACKGROUND_MODE_ATTRIBUTE}="true"] [role="dialog"][aria-modal="true"]:not([${EXISTING_MODAL_ATTRIBUTE}="true"]) {
        opacity: 0.001 !important;
        pointer-events: none !important;
        transition: none !important;
        animation: none !important;
      }
    `;
    (root.document.head || root.document.documentElement).appendChild(style);
  }

  function enableBackgroundScheduleMode() {
    installBackgroundScheduleStyle();
    const documentElement = root.document && root.document.documentElement;
    if (!documentElement) return () => {};
    const existingModals = root.document && typeof root.document.querySelectorAll === 'function'
      ? Array.from(root.document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
      : [];
    const markedModals = existingModals.filter((dialog) => !dialog.hasAttribute(EXISTING_MODAL_ATTRIBUTE));
    markedModals.forEach((dialog) => dialog.setAttribute(EXISTING_MODAL_ATTRIBUTE, 'true'));
    documentElement.setAttribute(BACKGROUND_MODE_ATTRIBUTE, 'true');
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      documentElement.removeAttribute(BACKGROUND_MODE_ATTRIBUTE);
      markedModals.forEach((dialog) => dialog.removeAttribute(EXISTING_MODAL_ATTRIBUTE));
    };
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

  async function setScheduleField(dialog, fieldName, value) {
    const fields = await api.waitFor(() => {
      const current = api.findScheduleFields(dialog);
      return current && current.kind === 'selects' && current.fields[fieldName] ? current : null;
    }, { timeout: 900, interval: 35, root: dialog });
    if (!fields || !optionExists(fields.fields[fieldName], value)) return false;
    // Avoid dispatching synthetic change events for values X already holds.
    // React can replace sibling controls after every real change, so no-op
    // events only create extra rerenders and false verification timeouts.
    if (String(fields.fields[fieldName].value).toLowerCase() === String(value).toLowerCase()) return true;
    if (!setNativeValue(fields.fields[fieldName], value)) return false;
    await api.nextFrame();
    return true;
  }

  async function applySelectValues(dialog, target) {
    const expected = expectedSelectValues(target);
    const order = ['year', 'month', 'day', 'period', 'hour', 'minute'];
    for (let pass = 0; pass < 3; pass += 1) {
      let passCompleted = true;
      for (const fieldName of order) {
        if (!(await setScheduleField(dialog, fieldName, expected[fieldName]))) {
          passCompleted = false;
          break;
        }
      }
      const settled = passCompleted && await api.waitFor(() => {
        const current = api.findScheduleFields(dialog);
        return selectValuesMatch(current, target) ? current : null;
      }, { timeout: 900, interval: 40, root: dialog });
      if (settled) return true;
    }
    // X occasionally commits the last controlled-select update after our
    // normal pass timeout. Judge the final complete form before reporting
    // VALUE_NOT_ACCEPTED; intermediate control lifetimes are not authoritative.
    const finallySettled = await api.waitFor(() => {
      const current = api.findScheduleFields(dialog);
      return selectValuesMatch(current, target) ? current : null;
    }, { timeout: 3000, interval: 50, root: dialog });
    return Boolean(finallySettled);
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

  async function waitForDialog(onFound) {
    return api.waitFor(() => {
      const dialog = api.findScheduleDialog(root.document);
      if (dialog && typeof onFound === 'function') onFound(dialog);
      return dialog;
    }, { timeout: 3200, interval: 45, root: root.document && root.document.body });
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
      if (typeof api.isSequenceReset === 'function' && await api.isSequenceReset()) {
        return { ok: true, persisted: false, code: 'SEQUENCE_RESET_ACTIVE' };
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
    let restoreDialog = () => {};
    let restoreBackgroundMode = () => {};
    let dialogCloaked = false;
    let backgroundOpenedDialog = null;
    let confirmationStarted = false;
    const cloakOnce = (dialog) => {
      if (dialogCloaked) return;
      dialogCloaked = true;
      restoreDialog = cloakScheduleDialog(dialog);
    };
    try {
      const validation = api.validateSettings(rawSettings);
      if (!validation.ok) return { ok: false, code: 'INVALID_SETTINGS', message: messageFor('INVALID_SETTINGS') };
      if (!validation.settings.enabled) return { ok: false, code: 'DISABLED', message: 'X-max scheduling is disabled in settings.' };
      let latestScheduledTimestamp = null;
      if (validation.settings.mode === 'next-slot') {
        // Sequential interval is an X-max-owned queue. Visible scheduled posts
        // may belong to another workflow and must not jump this cursor forward.
        latestScheduledTimestamp = typeof api.loadLastScheduledAt === 'function'
          ? await api.loadLastScheduledAt()
          : null;
      }
      const target = api.computeTarget(new Date(), validation.settings, latestScheduledTimestamp);
      if (!target.ok) return { ok: false, code: target.code, message: messageFor(target.code) };

      let dialog = api.findScheduleDialog(root.document);
      if (dialog) cloakOnce(dialog);
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
        restoreBackgroundMode = enableBackgroundScheduleMode();
        opener.click();
        dialog = await waitForDialog(cloakOnce);
        if (!dialog) {
          showStatus(messageFor('DIALOG_TIMEOUT'), 'error');
          return { ok: false, code: 'DIALOG_TIMEOUT', message: messageFor('DIALOG_TIMEOUT') };
        }
        backgroundOpenedDialog = dialog;
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
      confirmationStarted = true;
      confirmation.click();
      const after = await verifyAfterConfirmation(target);
      const cursorResult = await recordScheduleCursor(target, after);
      const formatted = api.formatTarget(target);
      const ruleFormatted = typeof api.formatTimestamp === 'function'
        ? api.formatTimestamp(target.timestamp, target.configuredTimeZone)
        : formatted;
      if (after.ok) {
        const cursorNote = cursorResult.persisted ? '' : ' Queue memory could not be saved.';
        const scheduleCopy = target.configuredTimeZone !== target.timeZone
          ? `Rule: ${ruleFormatted} (${target.configuredTimeZone}) · X: ${formatted} (${target.timeZone}).`
          : `Scheduled for ${formatted} (${target.timeZone}).`;
        const message = `${scheduleCopy}${cursorNote}`;
        showStatus(message, cursorNote ? 'warning' : 'success');
        return { ok: true, code: 'SCHEDULE_APPLIED', message: message, cursorPersisted: Boolean(cursorResult.persisted), target: { timestamp: target.timestamp, timeZone: target.timeZone } };
      }
      const warning = messageFor(after.code);
      showStatus(warning, 'warning');
      return { ok: false, code: after.code, warning: true, cursorPersisted: Boolean(cursorResult.persisted), message: warning, target: { timestamp: target.timestamp, timeZone: target.timeZone } };
    } finally {
      if (backgroundOpenedDialog && !confirmationStarted && backgroundOpenedDialog.isConnected) {
        const close = backgroundOpenedDialog.querySelector('[data-testid="app-bar-close"], button[aria-label="Close"]');
        if (close && typeof close.click === 'function') {
          close.click();
          await api.waitFor(() => backgroundOpenedDialog.isConnected ? null : true, {
            timeout: 600,
            interval: 30,
            root: root.document && root.document.body
          });
        }
      }
      restoreDialog();
      restoreBackgroundMode();
      running = false;
    }
  }

  const enqueueScheduling = createSerialQueue(runScheduling);

  function installRuntimeListener() {
    const runtime = root.chrome && root.chrome.runtime;
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') return;
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== 'xmax.setScheduleTime' || message.version !== 1) return undefined;
      enqueueScheduling(message.settings || api.DEFAULT_SETTINGS)
        .then((response) => sendResponse(response))
        .catch((_error) => sendResponse({ ok: false, code: 'UNEXPECTED', message: 'X-max could not set the schedule time.' }));
      return true;
    });
  }

  api.runScheduling = runScheduling;
  api.enqueueScheduling = enqueueScheduling;
  api.createSerialQueue = createSerialQueue;
  api.recordScheduleCursor = recordScheduleCursor;
  api.seedVisibleScheduleCursor = seedVisibleScheduleCursor;
  api.cloakScheduleDialog = cloakScheduleDialog;
  api.enableBackgroundScheduleMode = enableBackgroundScheduleMode;
  api.startVisibleScheduleSeedWindow = startVisibleScheduleSeedWindow;
  api.stopVisibleScheduleSeedWindow = stopVisibleScheduleSeedWindow;
  api.showStatus = showStatus;
  api.reindexToasts = reindexToasts;
  api.pruneToastStack = pruneToastStack;
  api.dismissToast = dismissToast;
  api.setNativeValue = setNativeValue;
  api.selectValuesMatch = selectValuesMatch;
  api.inputValuesMatch = inputValuesMatch;
  root.XMax = api;
  installToastStyle();
  installBackgroundScheduleStyle();
  installRuntimeListener();
})(typeof globalThis !== 'undefined' ? globalThis : window);
