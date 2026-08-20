const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
function loadApi(files) {
  const context = vm.createContext({ console, Intl, Date, setTimeout, clearTimeout, Math, JSON });
  context.globalThis = context;
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(rootDir, file), 'utf8'), context, { filename: file });
  return context.XMax;
}

const api = loadApi(['src/settings.js', 'src/scheduling.js']);

test('fixed delay rounds upward to the next whole minute', () => {
  const now = Date.parse('2026-08-20T12:07:25.250Z');
  const result = api.computeTarget(now, { ...api.DEFAULT_SETTINGS, timezone: 'UTC', delayMinutes: 60 });
  assert.equal(result.ok, true);
  assert.equal(result.timestamp, Date.parse('2026-08-20T13:08:00.000Z'));
  assert.equal(result.fields.second, 0);
});

test('fixed delay preserves an exact minute without adding an unnecessary minute', () => {
  const now = Date.parse('2026-08-20T12:07:00.000Z');
  const result = api.computeTarget(now, { ...api.DEFAULT_SETTINGS, timezone: 'UTC', delayMinutes: 60 });
  assert.equal(result.timestamp, Date.parse('2026-08-20T13:07:00.000Z'));
});

test('next-slot rounds the minimum-lead threshold to the configured interval', () => {
  const now = Date.parse('2026-08-20T12:07:25.250Z');
  const result = api.computeTarget(now, {
    ...api.DEFAULT_SETTINGS,
    mode: 'next-slot',
    timezone: 'UTC',
    minimumLeadMinutes: 5,
    slotIntervalMinutes: 30
  });
  assert.equal(result.ok, true);
  assert.equal(result.timestamp, Date.parse('2026-08-20T12:30:00.000Z'));
});

test('next-slot without a cursor remains clock-based', () => {
  const now = Date.parse('2026-08-20T14:07:25.000Z');
  const settings = { ...api.DEFAULT_SETTINGS, mode: 'next-slot', timezone: 'UTC', minimumLeadMinutes: 5, slotIntervalMinutes: 30 };
  const withoutCursor = api.computeTarget(now, settings);
  const explicitNull = api.computeTarget(now, settings, null);
  assert.equal(withoutCursor.timestamp, Date.parse('2026-08-20T14:30:00.000Z'));
  assert.equal(explicitNull.timestamp, withoutCursor.timestamp);
});

test('next-slot advances strictly after a latest scheduled cursor', () => {
  const now = Date.parse('2026-08-20T14:07:25.000Z');
  const cursor = Date.parse('2026-08-20T14:30:00.000Z');
  const result = api.computeTarget(now, {
    ...api.DEFAULT_SETTINGS,
    mode: 'next-slot',
    timezone: 'UTC',
    minimumLeadMinutes: 5,
    slotIntervalMinutes: 30
  }, cursor);
  assert.equal(result.timestamp, Date.parse('2026-08-20T15:00:00.000Z'));
});

test('stale next-slot cursor cannot move the target behind the clock-based slot', () => {
  const now = Date.parse('2026-08-20T14:07:25.000Z');
  const staleCursor = Date.parse('2026-08-20T13:30:00.000Z');
  const result = api.computeTarget(now, {
    ...api.DEFAULT_SETTINGS,
    mode: 'next-slot',
    timezone: 'UTC',
    minimumLeadMinutes: 5,
    slotIntervalMinutes: 30
  }, staleCursor);
  assert.equal(result.timestamp, Date.parse('2026-08-20T14:30:00.000Z'));
});

test('last scheduled cursor reads the newest timestamp from local or sync storage', async () => {
  const result = await api.loadLastScheduledAt({
    local: { get: async () => ({ xmaxLastScheduledAt: 1000 }) },
    sync: { get: async () => ({ xmaxLastScheduledAt: 2000 }) }
  });
  assert.equal(result, 2000);
});

test('last scheduled cursor persists timestamp only to local storage', async () => {
  let payload = null;
  const result = await api.saveLastScheduledAt(1234567890.9, {
    local: { set: async (value) => { payload = value; } },
    sync: { set: async () => { throw new Error('sync should not be used'); } }
  });
  assert.equal(result.persisted, true);
  assert.equal(result.area, 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { xmaxLastScheduledAt: 1234567890 });
});

test('reset sequence clears both cursors and suppresses cursor reads', async () => {
  const removed = [];
  let reset = false;
  const storage = {
    local: {
      get: async (keys) => keys.includes('xmaxSequenceReset')
        ? { xmaxSequenceReset: reset }
        : { xmaxLastScheduledAt: 2000 },
      set: async (value) => { if (value.xmaxSequenceReset === true) reset = true; },
      remove: async (key) => removed.push(`local:${key}`)
    },
    sync: {
      get: async () => ({ xmaxLastScheduledAt: 3000 }),
      remove: async (key) => removed.push(`sync:${key}`)
    }
  };
  const result = await api.resetSequenceCursor(storage);
  assert.equal(result.ok, true);
  assert.deepEqual(removed.sort(), ['local:xmaxLastScheduledAt', 'sync:xmaxLastScheduledAt']);
  assert.equal(await api.loadLastScheduledAt(storage), null);
});

test('English visible schedule summaries can be converted in the configured zone', () => {
  const result = api.parseEnglishScheduleSummary('Will send on Thu, Aug 20, 2026 at 2:30 PM', 'Asia/Jakarta');
  assert.equal(result, Date.parse('2026-08-20T07:30:00.000Z'));
});

test('target calculation handles month and year rollover', () => {
  const now = Date.parse('2026-12-31T23:59:30.000Z');
  const result = api.computeTarget(now, { ...api.DEFAULT_SETTINGS, timezone: 'UTC', delayMinutes: 1 });
  assert.equal(result.timestamp, Date.parse('2027-01-01T00:01:00.000Z'));
});

test('configured IANA zones produce the expected local fields', () => {
  const originalBrowserTimeZone = api.browserTimeZone;
  api.browserTimeZone = () => 'Asia/Jakarta';
  const now = Date.parse('2026-08-20T12:07:25.000Z');
  const result = api.computeTarget(now, { ...api.DEFAULT_SETTINGS, timezone: 'Asia/Jakarta', delayMinutes: 60 });
  api.browserTimeZone = originalBrowserTimeZone;
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result.fields), JSON.stringify({ year: 2026, month: 8, day: 20, hour: 20, minute: 8, second: 0 }));
  assert.equal(result.timeZone, 'Asia/Jakarta');
});

test('configured rule zone converts the final instant into the browser zone used by X', () => {
  const originalBrowserTimeZone = api.browserTimeZone;
  api.browserTimeZone = () => 'UTC';
  const now = Date.parse('2026-08-20T12:07:25.000Z');
  const result = api.computeTarget(now, { ...api.DEFAULT_SETTINGS, timezone: 'Asia/Jakarta', delayMinutes: 60 });
  api.browserTimeZone = originalBrowserTimeZone;
  assert.equal(result.timestamp, Date.parse('2026-08-20T13:08:00.000Z'));
  assert.equal(result.configuredTimeZone, 'Asia/Jakarta');
  assert.equal(result.timeZone, 'UTC');
  assert.equal(JSON.stringify(result.fields), JSON.stringify({ year: 2026, month: 8, day: 20, hour: 13, minute: 8, second: 0 }));
  assert.equal(api.formatTimestamp(result.timestamp, result.configuredTimeZone), 'Aug 20, 2026 at 8:08 PM');
  assert.equal(api.formatTimestamp(result.timestamp, result.timeZone), 'Aug 20, 2026 at 1:08 PM');
});

test('Intl-backed conversion advances a nonexistent DST wall time', () => {
  const result = api.zonedFieldsToInstant({ year: 2024, month: 3, day: 10, hour: 2, minute: 0 }, 'America/New_York');
  assert.equal(result.ok, true);
  assert.equal(result.adjusted, true);
  assert.equal(result.fields.year, 2024);
  assert.equal(result.fields.month, 3);
  assert.equal(result.fields.day, 10);
  assert.equal(result.fields.hour, 3);
  assert.equal(result.fields.minute, 0);
});

test('Intl-backed conversion deterministically chooses the earlier DST ambiguity', () => {
  const result = api.zonedFieldsToInstant({ year: 2024, month: 11, day: 3, hour: 1, minute: 30 }, 'America/New_York');
  assert.equal(result.ok, true);
  assert.equal(result.ambiguous, true);
  assert.equal(result.timestamp, Date.parse('2024-11-03T05:30:00.000Z'));
  assert.equal(result.candidates.length, 2);
});

test('settings reject unsafe or out-of-range values', () => {
  assert.equal(api.validateSettings({ ...api.DEFAULT_SETTINGS, delayMinutes: 0 }).ok, false);
  assert.equal(api.validateSettings({ ...api.DEFAULT_SETTINGS, delayMinutes: 1.5 }).ok, false);
  assert.equal(api.validateSettings({ ...api.DEFAULT_SETTINGS, timezone: 'Not/AZone' }).ok, false);
  assert.equal(api.validateSettings({ ...api.DEFAULT_SETTINGS, slotIntervalMinutes: 7 }).ok, false);
});

test('loadSettings falls back to local settings when sync has no key', async () => {
  const localSettings = { ...api.DEFAULT_SETTINGS, delayMinutes: 90, timezone: 'Asia/Jakarta' };
  const storage = {
    sync: { get: async (keys) => { assert.deepEqual(keys, ['xmaxSettings']); return {}; } },
    local: { get: async () => ({ xmaxSettings: localSettings }) }
  };
  const result = await api.loadSettings(storage);
  assert.equal(result.delayMinutes, 90);
  assert.equal(result.timezone, 'Asia/Jakarta');
});

test('loadSettings gives a present sync value precedence over local', async () => {
  const syncSettings = { ...api.DEFAULT_SETTINGS, delayMinutes: 120 };
  const storage = {
    sync: { get: async () => ({ xmaxSettings: syncSettings }) },
    local: { get: async () => ({ xmaxSettings: { ...api.DEFAULT_SETTINGS, delayMinutes: 15 } }) }
  };
  const result = await api.loadSettings(storage);
  assert.equal(result.delayMinutes, 120);
});

test('loadSettings falls back to local settings when sync read fails', async () => {
  const localSettings = { ...api.DEFAULT_SETTINGS, mode: 'next-slot', slotIntervalMinutes: 15 };
  const storage = {
    sync: { get: async () => { throw new Error('sync unavailable'); } },
    local: { get: async () => ({ xmaxSettings: localSettings }) }
  };
  const result = await api.loadSettings(storage);
  assert.equal(result.mode, 'next-slot');
  assert.equal(result.slotIntervalMinutes, 15);
});

test('extension sources contain no private endpoint, credential, or network code', () => {
  const sourceFiles = fs.readdirSync(path.join(rootDir, 'src')).filter((name) => name.endsWith('.js'));
  const source = sourceFiles.map((name) => fs.readFileSync(path.join(rootDir, 'src', name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /viewer\.json|authorization\s*:/i);
  assert.doesNotMatch(source, /csrf[-_]?token|bearer\s+[a-z0-9]/i);
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test('settings dropdowns use the reusable accessible select popover component', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src/select-popover.js'), 'utf8');
  const html = fs.readFileSync(path.join(rootDir, 'src/options.html'), 'utf8');
  assert.match(source, /function enhanceSelect\(select\)/);
  assert.match(source, /aria-haspopup/);
  assert.match(source, /role', 'listbox/);
  assert.match(source, /role', 'option/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /function enhanceCombobox\(input, items\)/);
  assert.match(source, /aria-autocomplete/);
  assert.match(source, /if \(!filtering\) return values/);
  assert.match(html, /src="select-popover\.js"/);
  assert.doesNotMatch(html, /<datalist/);
});
