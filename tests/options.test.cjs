const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.join(__dirname, '..');

test('options provide a manual shortcut button and show the registered command', () => {
  const html = fs.readFileSync(path.join(rootDir, 'src', 'options.html'), 'utf8');
  const source = fs.readFileSync(path.join(rootDir, 'src', 'options.js'), 'utf8');

  assert.match(html, /id="open-shortcut-settings"[^>]*>Set shortcut manually<\/button>/);
  assert.match(html, /id="shortcut-state"/);
  assert.doesNotMatch(html, /href="chrome:\/\/extensions\/shortcuts"/);
  assert.match(source, /chrome && root\.chrome\.commands/);
  assert.match(source, /commands\.getAll/);
  assert.match(source, /item\.name === COMMAND/);
  assert.match(source, /tabs\.create\(\{ url: SHORTCUT_SETTINGS_URL \}/);
});
