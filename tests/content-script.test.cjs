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
      remove: () => {}, textContent: ''
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

test('confirmation logic is scoped to the exact native schedule test id', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/content-script.js'), 'utf8');
  assert.match(source, /findPrimaryConfirmation\(dialog\)/);
  assert.match(source, /confirmation\.click\(\)/);
  assert.doesNotMatch(source, /querySelectorAll\([^)]*confirm|querySelectorAll\([^)]*schedule/i);
  assert.doesNotMatch(source, /tweetButton[^\n]*\.click/);
});
