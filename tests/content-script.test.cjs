const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');

class SeedNode {
  constructor(text = '') {
    this.nodeType = 1;
    this._text = text;
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
  }
  append(...children) {
    children.forEach((child) => { child.parentElement = this; this.children.push(child); });
    return this;
  }
  get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(' '); }
  getAttribute() { return null; }
  querySelectorAll(selector) {
    if (selector !== '*') return [];
    const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
    return descendants(this);
  }
}

class SeedDocument {
  constructor(...children) {
    this.body = new SeedNode().append(...children);
  }
}

function loadContentApi(documentOverride) {
  const body = {
    querySelectorAll: () => [],
    appendChild: () => {},
    getElementById: () => null
  };
  const document = documentOverride || {
    body,
    getElementById: () => null,
    createElement: () => ({
      setAttribute: () => {}, dataset: {}, style: {}, isConnected: true,
      remove: () => {}, append: () => {}, appendChild: () => {}, addEventListener: () => {}, querySelectorAll: () => [], textContent: ''
    })
  };
  const context = vm.createContext({ console, document, Intl, Date, Math, JSON, setTimeout, clearTimeout });
  context.globalThis = context;
  for (const file of ['src/settings.js', 'src/scheduling.js', 'src/selectors.js', 'src/content-script.js']) {
    vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), context, { filename: file });
  }
  return context.XMax;
}

test('native field updates emit bubbling input and change events', () => {
  const api = loadContentApi();
  const events = [];
  const prototype = { get value() { return this._value || ''; }, set value(value) { this._value = value; } };
  const element = Object.create(prototype);
  element.tagName = 'SELECT';
  element.ownerDocument = { defaultView: { Event: class { constructor(type, init) { this.type = type; Object.assign(this, init); } } } };
  element.dispatchEvent = (event) => events.push(event);
  assert.equal(api.setNativeValue(element, '12'), true);
  assert.equal(element.value, '12');
  assert.deepEqual(events.map((event) => [event.type, event.bubbles]), [['input', true], ['change', true]]);
});

test('schedule field updates skip no-op values that already match', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/content-script.js'), 'utf8');
  assert.match(source, /String\(fields\.fields\[fieldName\]\.value\)\.toLowerCase\(\) === String\(value\)\.toLowerCase\(\)/);
  assert.match(source, /timeout:\s*3000, interval:\s*50, root:\s*dialog/);
});

test('shortcut automation cloak hides and restores only the schedule dialog', () => {
  const api = loadContentApi();
  const values = new Map([['opacity', { value: '0.8', priority: '' }]]);
  const attributes = new Map();
  const dialog = {
    style: {
      getPropertyValue: (property) => values.get(property)?.value || '',
      getPropertyPriority: (property) => values.get(property)?.priority || '',
      setProperty: (property, value, priority) => values.set(property, { value, priority }),
      removeProperty: (property) => values.delete(property)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    hasAttribute: (name) => attributes.has(name),
    removeAttribute: (name) => attributes.delete(name)
  };

  const restore = api.cloakScheduleDialog(dialog);
  assert.equal(values.get('opacity').value, '0.001');
  assert.equal(values.get('pointer-events').value, 'none');
  assert.equal(values.get('transition').value, 'none');
  assert.equal(attributes.get('data-xmax-background-schedule'), 'true');

  restore();
  assert.equal(values.get('opacity').value, '0.8');
  assert.equal(values.has('pointer-events'), false);
  assert.equal(attributes.has('data-xmax-background-schedule'), false);
});

test('background mode is active before the first schedule dialog is inserted', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/content-script.js'), 'utf8');
  assert.match(source, /installBackgroundScheduleStyle\(\);\s*installRuntimeListener\(\)/);
  assert.match(source, /restoreBackgroundMode = enableBackgroundScheduleMode\(\);\s*opener\.click\(\)/);
  assert.match(source, /:not\(\[\$\{EXISTING_MODAL_ATTRIBUTE\}="true"\]\)/);
});

test('notification uses a bottom-centered stacked Sonner lifecycle and reduced-motion CSS', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/content-script.js'), 'utf8');
  assert.match(source, /bottom:\s*max\(18px, env\(safe-area-inset-bottom\)\)/);
  assert.match(source, /left:\s*50%/);
  assert.match(source, /transform:\s*translateX\(-50%\)/);
  assert.match(source, /linear-gradient\(145deg, #191b1e/);
  assert.match(source, /300px/);
  assert.match(source, /display:\s*flex/);
  assert.match(source, /gap:\s*2px/);
  assert.match(source, /min-height:\s*48px/);
  assert.doesNotMatch(source, /inset 2px 0 0 #45d483/);
  assert.match(source, /function reindexToasts\(viewport\)/);
  assert.match(source, /--toast-scale/);
  assert.match(source, /MAX_VISIBLE_TOASTS = 3/);
  assert.match(source, /data-state="open"/);
  assert.match(source, /data-instant="true"/);
  assert.match(source, /requestAnimationFrame\(\(\) => root\.requestAnimationFrame\(open\)\)/);
  assert.match(source, /transition-duration:\s*140ms/);
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
});

test('serial queue accepts repeated shortcuts without concurrent automation', async () => {
  const api = loadContentApi();
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const queue = api.createSerialQueue(async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`start-${value}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    order.push(`end-${value}`);
    active -= 1;
    return value;
  });

  const values = await Promise.all([queue(1), queue(2), queue(3)]);
  assert.deepEqual(values, [1, 2, 3]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
});

test('toast stack keeps the newest three and assigns collapsed transforms', () => {
  const api = loadContentApi();
  const makeToast = () => {
    const properties = new Map();
    return {
      dataset: { state: 'open' },
      style: {
        setProperty: (name, value) => properties.set(name, value),
        getPropertyValue: (name) => properties.get(name),
        zIndex: ''
      },
      removed: false,
      remove() { this.removed = true; }
    };
  };
  const toasts = [makeToast(), makeToast(), makeToast(), makeToast()];
  const viewport = {
    querySelectorAll: () => toasts.filter((toast) => !toast.removed && toast.dataset.state !== 'closed')
  };

  api.pruneToastStack(viewport, toasts[3]);
  assert.equal(toasts[0].removed, true);
  api.reindexToasts(viewport);
  assert.equal(toasts[3].style.getPropertyValue('--toast-y'), '0px');
  assert.equal(toasts[2].style.getPropertyValue('--toast-y'), '-8px');
  assert.equal(toasts[2].style.zIndex, '2');
  assert.equal(toasts[3].style.zIndex, '3');
  assert.equal(toasts[1].style.getPropertyValue('--toast-scale'), '0.92');
});

test('no-composer command fails safely without navigation or confirmation', async () => {
  const api = loadContentApi();
  const result = await api.runScheduling({ ...api.DEFAULT_SETTINGS, timezone: 'UTC' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_COMPOSER');
});

test('confirmed dialog close persists the applied schedule cursor', async () => {
  const api = loadContentApi();
  const saved = [];
  api.saveLastScheduledAt = async (timestamp) => { saved.push(timestamp); return { ok: true, persisted: true, area: 'local' }; };
  const result = await api.recordScheduleCursor({ timestamp: 1234567890 }, { ok: true, dialogClosed: true });
  assert.equal(result.persisted, true);
  assert.deepEqual(saved, [1234567890]);
});

test('uncertain confirmation does not advance the schedule cursor', async () => {
  const api = loadContentApi();
  let saveCount = 0;
  api.saveLastScheduledAt = async () => { saveCount += 1; return { ok: true, persisted: true }; };
  const result = await api.recordScheduleCursor({ timestamp: 1234567890 }, { ok: false, code: 'CONFIRMATION_UNCERTAIN', dialogClosed: false });
  assert.equal(result.skipped, true);
  assert.equal(saveCount, 0);
});

test('visible scheduled-list rows seed the cursor without invoking scheduling or storing post text', async () => {
  const row = new SeedNode('Will send on Thu, Aug 20, 2026 at 2:30 PM');
  const api = loadContentApi(new SeedDocument(row));
  api.loadSettings = async () => ({ ...api.DEFAULT_SETTINGS, enabled: true, timezone: 'UTC' });
  api.loadLastScheduledAt = async () => null;
  let savedPayload = null;
  api.saveLastScheduledAt = async (timestamp) => {
    savedPayload = { xmaxLastScheduledAt: timestamp };
    return { ok: true, persisted: true, area: 'local' };
  };
  let schedulingInvoked = false;
  api.runScheduling = () => { schedulingInvoked = true; };

  const result = await api.seedVisibleScheduleCursor();
  assert.equal(result.persisted, true);
  assert.equal(result.timestamp, Date.parse('2026-08-20T14:30:00.000Z'));
  assert.equal(schedulingInvoked, false);
  assert.deepEqual(Object.keys(savedPayload), ['xmaxLastScheduledAt']);
  assert.equal(typeof savedPayload.xmaxLastScheduledAt, 'number');
});

test('visible earlier rows never reduce an existing cursor', async () => {
  const row = new SeedNode('Will send on Thu, Aug 20, 2026 at 2:30 PM');
  const api = loadContentApi(new SeedDocument(row));
  api.loadSettings = async () => ({ ...api.DEFAULT_SETTINGS, enabled: true, timezone: 'UTC' });
  api.loadLastScheduledAt = async () => Date.parse('2026-08-20T15:00:00.000Z');
  let saveCount = 0;
  api.saveLastScheduledAt = async () => { saveCount += 1; return { ok: true, persisted: true }; };

  const result = await api.seedVisibleScheduleCursor();
  assert.equal(result.code, 'CURSOR_CURRENT');
  assert.equal(saveCount, 0);
});

test('runtime scheduling uses only the X-max cursor for sequential intervals', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/content-script.js'), 'utf8');
  const runScheduling = source.slice(source.indexOf('async function runScheduling'), source.indexOf('const enqueueScheduling'));
  assert.match(runScheduling, /loadLastScheduledAt/);
  assert.doesNotMatch(runScheduling, /findLatestVisibleScheduleTimestamp/);
  assert.doesNotMatch(source.slice(source.lastIndexOf('installToastStyle')), /installVisibleScheduleCursorSeeding\(\)/);
});

test('confirmation logic is scoped to the exact native schedule test id', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/content-script.js'), 'utf8');
  assert.match(source, /findPrimaryConfirmation\(dialog\)/);
  assert.match(source, /confirmation\.click\(\)/);
  assert.doesNotMatch(source, /querySelectorAll\([^)]*confirm|querySelectorAll\([^)]*schedule/i);
  assert.doesNotMatch(source, /tweetButton[^\n]*\.click/);
});
