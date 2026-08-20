(function (root) {
  'use strict';

  const api = root.XMax || {};

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    if (root.getComputedStyle) {
      const style = root.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return true;
  }

  function isEnabled(element) {
    return Boolean(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  }

  function textFromIds(element) {
    const ids = normalizeText(element.getAttribute('aria-labelledby')).split(' ').filter(Boolean);
    if (!ids.length || !element.ownerDocument) return '';
    return normalizeText(ids.map((id) => {
      const referenced = element.ownerDocument.getElementById(id);
      return referenced ? referenced.textContent : '';
    }).join(' '));
  }

  function associatedLabel(element) {
    const labelled = textFromIds(element);
    if (labelled) return labelled;
    const aria = normalizeText(element.getAttribute('aria-label'));
    if (aria) return aria;
    const title = normalizeText(element.getAttribute('title'));
    if (title) return title;
    const id = element.getAttribute('id');
    if (id && element.ownerDocument) {
      const escape = root.CSS && typeof root.CSS.escape === 'function'
        ? root.CSS.escape(id)
        : id.replace(/([\\"\[\]#.>+~=:])/g, '\\$1');
      const label = element.ownerDocument.querySelector(`label[for="${escape}"]`);
      if (label) return normalizeText(label.textContent);
    }
    const wrappingLabel = typeof element.closest === 'function' ? element.closest('label') : null;
    if (wrappingLabel) return normalizeText(wrappingLabel.textContent);
    return '';
  }

  function accessibleName(element) {
    return associatedLabel(element) || normalizeText(element.textContent);
  }

  function all(rootElement, selector) {
    if (!rootElement || typeof rootElement.querySelectorAll !== 'function') return [];
    return Array.from(rootElement.querySelectorAll(selector));
  }

  function searchBody(rootElement) {
    if (rootElement && rootElement.body && typeof rootElement.body.querySelectorAll === 'function') return rootElement.body;
    return rootElement || (root.document && root.document.body);
  }

  function exactLabel(element, expected) {
    return normalizeText(associatedLabel(element)).toLowerCase() === normalizeText(expected).toLowerCase();
  }

  function findVisibleHeading(dialog) {
    return all(dialog, '[role="heading"], h1, h2, h3, h4, h5, h6').find((heading) => {
      const text = normalizeText(heading.textContent);
      return isVisible(heading) && /\bschedule\b/i.test(text);
    }) || null;
  }

  function findScheduleDialog(rootElement) {
    const searchRoot = searchBody(rootElement);
    const dialogs = all(searchRoot, '[role="dialog"]').filter(isVisible);
    const candidates = dialogs.filter((dialog) => Boolean(findVisibleHeading(dialog)));
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function findGroup(dialog, label) {
    return all(dialog, '[role="group"]').find((group) => {
      const aria = normalizeText(group.getAttribute('aria-label')).toLowerCase();
      return aria === label.toLowerCase() && isVisible(group);
    }) || null;
  }

  function findControlByLabel(container, label) {
    const controls = all(container, 'select, input').filter(isVisible);
    return controls.find((control) => exactLabel(control, label)) || null;
  }

  function findFallbackInput(dialog, type, name) {
    return all(dialog, `input[type="${type}"]`).find((input) => {
      return (!name || input.getAttribute('name') === name) && isVisible(input);
    }) || null;
  }

  function findScheduleFields(dialog) {
    if (!dialog) return null;
    const dateGroup = findGroup(dialog, 'Date');
    const timeGroup = findGroup(dialog, 'Time');
    if (dateGroup && timeGroup) {
      const fields = {
        month: findControlByLabel(dateGroup, 'Month'),
        day: findControlByLabel(dateGroup, 'Day'),
        year: findControlByLabel(dateGroup, 'Year'),
        hour: findControlByLabel(timeGroup, 'Hour'),
        minute: findControlByLabel(timeGroup, 'Minute'),
        period: findControlByLabel(timeGroup, 'AM/PM')
      };
      if (Object.values(fields).every(Boolean) && new Set(Object.values(fields)).size === 6) {
        return { kind: 'selects', dateGroup, timeGroup, fields };
      }
    }

    const dateInput = findFallbackInput(dialog, 'date', 'Date');
    const timeInput = findFallbackInput(dialog, 'time', 'Time picker');
    if (dateInput && timeInput) return { kind: 'inputs', dateInput, timeInput, dateGroup, timeGroup };
    return null;
  }

  function scheduleName(name) {
    const normalized = normalizeText(name).toLowerCase();
    return /\bschedule\b/.test(normalized) && !normalized.includes('scheduled posts');
  }

  function isScheduleTestId(element) {
    const testId = normalizeText(element.getAttribute('data-testid')).toLowerCase();
    return testId === 'scheduleoption';
  }

  function isExcludedAction(element) {
    const testId = normalizeText(element.getAttribute('data-testid')).toLowerCase();
    return testId === 'scheduledconfirmationprimaryaction' || testId.includes('tweetbutton');
  }

  function interactiveDescendant(element) {
    if (!element) return null;
    const interactive = element.tagName === 'BUTTON' || element.getAttribute('role') === 'button' ||
      element.tagName === 'A' || (element.tagName === 'INPUT' && ['button', 'submit'].includes(String(element.getAttribute('type')).toLowerCase()));
    if (interactive) return element;
    return all(element, 'button, [role="button"], a, input[type="button"], input[type="submit"]')[0] || null;
  }

  function findScheduleOpener(composer) {
    if (!composer) return null;
    const candidates = all(composer, 'button, [role="button"], a, input[type="button"], input[type="submit"], [data-testid="scheduleOption"]')
      .map((element) => isScheduleTestId(element) ? interactiveDescendant(element) : element)
      .filter(Boolean)
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter((element) => isVisible(element) && isEnabled(element) && !isExcludedAction(element));

    // X currently exposes the schedule toolbar control as scheduleOption in
    // some composer revisions. Treat this explicit contract as stronger than
    // its generated descendants or absent icon text.
    const explicit = candidates.find((element) => isScheduleTestId(element) || isScheduleTestId(element.parentElement));
    if (explicit) return explicit;

    const named = candidates.find((element) => {
      const name = accessibleName(element);
      if (!scheduleName(name)) return false;
      return true;
    });
    if (named) return named;

    // Compatibility fallback: only consider a schedule-bearing test id when
    // the control has no useful accessible name. This is deliberately narrow.
    return candidates.find((element) => {
      const testId = normalizeText(element.getAttribute('data-testid')).toLowerCase();
      return !accessibleName(element) && testId.includes('schedule') && !testId.includes('scheduledconfirmationprimaryaction');
    }) || null;
  }

  function isTextBox(element) {
    if (!element || element.nodeType !== 1) return false;
    const role = normalizeText(element.getAttribute('role')).toLowerCase();
    const contentEditable = element.getAttribute('contenteditable');
    return element.tagName === 'TEXTAREA' || role === 'textbox' || contentEditable === '' || contentEditable === 'true';
  }

  function findComposer(rootElement) {
    const searchRoot = searchBody(rootElement);
    const textboxes = all(searchRoot, 'textarea, [role="textbox"], [contenteditable="true"], [contenteditable=""]')
      .filter((element) => isVisible(element));
    const candidates = [];
    for (const textbox of textboxes) {
      let current = textbox.parentElement;
      // Composer markup contains many generated wrapper nodes. Walk the full
      // semantic ancestor chain and stop at the nearest ancestor that owns a
      // schedule opener; a fixed depth silently missed real X layouts.
      while (current && current !== searchRoot) {
        if (!findVisibleHeading(current)) {
          const opener = findScheduleOpener(current);
          if (opener) {
            candidates.push({ container: current, opener, textbox });
            break;
          }
        }
        current = current.parentElement;
      }
    }
    if (candidates.length === 0) return { status: 'none', element: null, opener: null, candidates: [] };

    // Multiple visible textboxes with different schedule controls represent
    // separate eligible composers. Never guess which post should be changed.
    const uniqueOpeners = Array.from(new Set(candidates.map((candidate) => candidate.opener)));
    const uniqueContainers = Array.from(new Set(candidates.map((candidate) => candidate.container)));
    if (uniqueOpeners.length > 1) {
      return { status: 'multiple', element: null, opener: null, candidates: uniqueContainers };
    }
    const candidate = candidates[0];
    return { status: 'ok', element: candidate.container, opener: candidate.opener, candidates: uniqueContainers };
  }

  function findPrimaryConfirmation(dialog) {
    const controls = all(dialog, '[data-testid="scheduledConfirmationPrimaryAction"]');
    if (controls.length !== 1) return null;
    const control = controls[0];
    return isVisible(control) && isEnabled(control) && (control.tagName === 'BUTTON' || control.getAttribute('role') === 'button') ? control : null;
  }

  function findSummary(dialog) {
    return all(dialog, '*').find((element) => {
      const text = normalizeText(element.textContent);
      return isVisible(element) && /^Will send\s+on\b/i.test(text) && !Array.from(element.children || []).some((child) => /^Will send\s+on\b/i.test(normalizeText(child.textContent)));
    }) || null;
  }

  function findLatestVisibleScheduleTimestamp(rootElement, zone) {
    if (typeof api.parseEnglishScheduleSummary !== 'function') return null;
    const searchRoot = searchBody(rootElement);
    const timestamps = all(searchRoot, '*')
      .filter((element) => {
        const text = normalizeText(element.textContent);
        return isVisible(element) && /^Will send\s+on\b/i.test(text) &&
          !Array.from(element.children || []).some((child) => /^Will send\s+on\b/i.test(normalizeText(child.textContent)));
      })
      .map((element) => api.parseEnglishScheduleSummary(element.textContent, zone))
      .filter((timestamp) => Number.isFinite(timestamp));
    return timestamps.length ? Math.max(...timestamps) : null;
  }

  function waitFor(predicate, options) {
    const settings = Object.assign({ timeout: 3000, interval: 50, root: root.document && root.document.body }, options || {});
    return new Promise((resolve) => {
      const started = Date.now();
      let timer = null;
      let observer = null;
      let settled = false;
      const cleanup = () => {
        if (timer) clearInterval(timer);
        if (observer) observer.disconnect();
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const check = () => {
        let value = null;
        try {
          value = predicate();
        } catch (_error) {
          value = null;
        }
        if (value) return finish(value);
        if (Date.now() - started >= settings.timeout) return finish(null);
      };
      check();
      if (settled) return;
      timer = setInterval(check, settings.interval);
      if (settings.root && typeof root.MutationObserver === 'function') {
        observer = new root.MutationObserver(check);
        observer.observe(settings.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-labelledby', 'disabled', 'aria-disabled', 'value'] });
      }
    });
  }

  function nextFrame() {
    return new Promise((resolve) => {
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  api.normalizeText = normalizeText;
  api.isVisible = isVisible;
  api.isEnabled = isEnabled;
  api.associatedLabel = associatedLabel;
  api.accessibleName = accessibleName;
  api.findScheduleDialog = findScheduleDialog;
  api.findScheduleFields = findScheduleFields;
  api.findScheduleOpener = findScheduleOpener;
  api.findComposer = findComposer;
  api.findPrimaryConfirmation = findPrimaryConfirmation;
  api.findSummary = findSummary;
  api.findLatestVisibleScheduleTimestamp = findLatestVisibleScheduleTimestamp;
  api.waitFor = waitFor;
  api.nextFrame = nextFrame;
  root.XMax = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
