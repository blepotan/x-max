const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');

function loadWorker() {
  const commandListeners = [];
  const sent = [];
  const chrome = {
    storage: {
      sync: {
        get: async (defaults) => defaults,
        set: async () => {}
      },
      local: { set: async () => {} }
    },
    tabs: {
      query: async () => [{ id: 7, url: 'https://x.com/compose/post' }],
      sendMessage: async (id, message) => sent.push({ id, message })
    },
    commands: { onCommand: { addListener: (listener) => commandListeners.push(listener) } },
    runtime: { onInstalled: { addListener: () => {} } },
    action: {
      setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    }
  };
  const context = vm.createContext({ console, chrome, URL, Date, Math, JSON, setTimeout, clearTimeout });
  context.globalThis = context;
  context.importScripts = (...files) => files.forEach((file) => vm.runInContext(fs.readFileSync(path.join(rootDir, 'src', file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'src/service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });
  return { worker: context.XMaxServiceWorker, commandListeners, sent, chrome };
}

test('service worker allows only the declared X HTTPS hosts', () => {
  const { worker } = loadWorker();
  assert.equal(worker.allowedUrl('https://x.com/home'), true);
  assert.equal(worker.allowedUrl('https://twitter.com/compose/post'), true);
  assert.equal(worker.allowedUrl('http://x.com/home'), false);
  assert.equal(worker.allowedUrl('https://example.com/?next=https://x.com'), false);
});

test('service worker routes a fresh command with settings and no page data', async () => {
  const { worker, sent } = loadWorker();
  await worker.handleCommand('set-schedule-time');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 7);
  assert.equal(sent[0].message.type, 'xmax.setScheduleTime');
  assert.equal(sent[0].message.version, 1);
  assert.equal(sent[0].message.settings.delayMinutes, 60);
  assert.equal(Object.prototype.hasOwnProperty.call(sent[0].message, 'postText'), false);
});
