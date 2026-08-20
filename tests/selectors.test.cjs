const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');

class FakeElement {
  constructor(tagName, attrs = {}, text = '') {
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
    this._text = text;
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.nodeType = 1;
    this.options = this.tagName === 'SELECT' ? [] : undefined;
    this.value = attrs.value || '';
    this.disabled = false;
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      const assignDocument = (node) => node.children.forEach((nested) => { nested.ownerDocument = this.ownerDocument; assignDocument(nested); });
      assignDocument(child);
      this.children.push(child);
    }
    return this;
  }
  get textContent() { return [this._text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this._text = value; this.children = []; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? String(this.attrs[name]) : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  closest(selector) {
    let current = this;
    while (current) { if (matches(current, selector)) return current; current = current.parentElement; }
    return null;
  }
  querySelectorAll(selector) { return descendants(this).filter((element) => selector.split(',').some((part) => matches(element, part.trim()))); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get isConnected() { return true; }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function matches(element, selector) {
  if (selector === '*') return true;
  const tag = selector.match(/^^[a-z]+/i);
  if (tag && element.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
  const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
  return attrs.every(([, name, expected]) => {
    const actual = element.getAttribute(name);
    return actual !== null && (expected === undefined || actual === expected);
  });
}

class FakeDocument extends FakeElement {
  constructor() { super('body'); this.ownerDocument = this; }
  createElement(tag) { const element = new FakeElement(tag); element.ownerDocument = this; return element; }
  getElementById(id) { return descendants(this).find((element) => element.getAttribute('id') === id) || null; }
}

function loadApi() {
  const document = new FakeDocument();
  const context = vm.createContext({ console, document, setTimeout, clearTimeout, Intl, Date, Math, JSON });
  context.globalThis = context;
  for (const file of ['src/settings.js', 'src/scheduling.js', 'src/selectors.js']) {
    vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), context, { filename: file });
  }
  return { api: context.XMax, document };
}

function label(document, id, text) {
  const element = new FakeElement('span', { id }, text);
  element.ownerDocument = document;
  return element;
}

function select(document, labelId, value, values) {
  const element = new FakeElement('select', { 'aria-labelledby': labelId, value });
  element.ownerDocument = document;
  element.options = values.map((item) => ({ value: String(item) }));
  return element;
}

function buildDialog(document, duplicateConfirmation = false) {
  const dialog = new FakeElement('div', { role: 'dialog', 'aria-labelledby': 'modal-header' });
  const heading = new FakeElement('h2', { role: 'heading', id: 'modal-header' }, 'Schedule');
  const dateGroup = new FakeElement('div', { role: 'group', 'aria-label': 'Date' });
  const timeGroup = new FakeElement('div', { role: 'group', 'aria-label': 'Time' });
  const labels = [
    label(document, 'month-label', 'Month'), label(document, 'day-label', 'Day'), label(document, 'year-label', 'Year'),
    label(document, 'hour-label', 'Hour'), label(document, 'minute-label', 'Minute'), label(document, 'period-label', 'AM/PM')
  ];
  const fields = [
    select(document, 'month-label', '8', [1, 8, 12]), select(document, 'day-label', '20', [1, 20, 31]), select(document, 'year-label', '2026', [2026, 2027]),
    select(document, 'hour-label', '2', [1, 2, 12]), select(document, 'minute-label', '7', [0, 7, 30]), select(document, 'period-label', 'pm', ['am', 'pm'])
  ];
  const summary = new FakeElement('div', {}, 'Will send on Thu, Aug 20, 2026 at 2:07 PM');
  const confirmation = new FakeElement('button', { 'data-testid': 'scheduledConfirmationPrimaryAction' }, 'Confirm');
  dateGroup.append(...labels.slice(0, 3), ...fields.slice(0, 3));
  timeGroup.append(...labels.slice(3), ...fields.slice(3));
  dialog.append(heading, summary, dateGroup, timeGroup, confirmation);
  if (duplicateConfirmation) dialog.append(new FakeElement('button', { 'data-testid': 'scheduledConfirmationPrimaryAction' }, 'Confirm'));
  document.append(dialog);
  return { dialog, fields, confirmation };
}

test('schedule dialog and fields resolve through semantic labels', () => {
  const { api, document } = loadApi();
  const fixture = buildDialog(document);
  const dialog = api.findScheduleDialog(document);
  assert.equal(dialog, fixture.dialog);
  const fields = api.findScheduleFields(dialog);
  assert.equal(fields.kind, 'selects');
  assert.equal(fields.fields.month, fixture.fields[0]);
  assert.equal(fields.fields.period, fixture.fields[5]);
  assert.equal(api.findPrimaryConfirmation(dialog), fixture.confirmation);
});

test('generated classes and dynamic selector ids are irrelevant', () => {
  const { api, document } = loadApi();
  const fixture = buildDialog(document);
  fixture.dialog.attrs.class = 'randomized-css-class';
  fixture.fields.forEach((field, index) => { field.attrs.id = `random-id-${index}`; });
  assert.equal(api.findScheduleFields(fixture.dialog).kind, 'selects');
});

test('duplicate confirmation controls fail closed', () => {
  const { api, document } = loadApi();
  const fixture = buildDialog(document, true);
  assert.equal(api.findPrimaryConfirmation(fixture.dialog), null);
});

test('composer discovery requires a textbox and an accessible schedule opener', () => {
  const { api, document } = loadApi();
  const composer = new FakeElement('div', { role: 'dialog' });
  composer.append(new FakeElement('div', { role: 'textbox' }), new FakeElement('button', { 'aria-label': 'Schedule' }));
  document.append(composer);
  const result = api.findComposer(document);
  assert.equal(result.status, 'ok');
  assert.equal(api.findScheduleOpener(result.element).getAttribute('aria-label'), 'Schedule');
});

test('dialog-absent discovery finds a deeply nested scheduleOption and its opener can be clicked', () => {
  const { api, document } = loadApi();
  const composer = new FakeElement('div', { role: 'dialog' });
  let textBranch = composer;
  for (let index = 0; index < 24; index += 1) {
    const wrapper = new FakeElement('div', { 'data-layout-depth': String(index) });
    textBranch.append(wrapper);
    textBranch = wrapper;
  }
  textBranch.append(new FakeElement('div', { role: 'textbox' }));
  const toolbar = new FakeElement('div', { 'aria-label': 'Composer toolbar' });
  const scheduleButton = new FakeElement('button', { 'data-testid': 'scheduleOption' });
  let clicked = false;
  scheduleButton.click = () => { clicked = true; };
  toolbar.append(scheduleButton);
  composer.append(toolbar);
  document.append(composer);

  const result = api.findComposer(document);
  assert.equal(result.status, 'ok');
  const opener = api.findScheduleOpener(result.element);
  assert.equal(opener, scheduleButton);
  opener.click();
  assert.equal(clicked, true);
});

test('multiple visible composers with separate scheduleOption controls fail closed', () => {
  const { api, document } = loadApi();
  for (let index = 0; index < 2; index += 1) {
    const composer = new FakeElement('div', { role: 'dialog' });
    const textbox = new FakeElement('div', { role: 'textbox' });
    const scheduleButton = new FakeElement('button', { 'data-testid': 'scheduleOption' });
    composer.append(textbox, scheduleButton);
    document.append(composer);
  }
  const result = api.findComposer(document);
  assert.equal(result.status, 'multiple');
  assert.equal(result.element, null);
  assert.equal(result.opener, null);
});
