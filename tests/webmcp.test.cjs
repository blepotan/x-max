const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadWebMcp(options = {}) {
  const listeners = new Map();
  let registeredTool;
  const context = vm.createContext({
    console, URL, Date, Math, Error, DOMException,
    innerWidth: 1000,
    innerHeight: 800,
    location: { href: options.href || 'https://x.com/example/status/123' },
    document: {
      modelContext: { registerTool: async (tool) => { registeredTool = tool; } },
      querySelectorAll: () => options.articles || []
    },
    crypto: { randomUUID: () => 'request-1' },
    setTimeout, clearTimeout,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
    postMessage(message) {
      if (message.__xmax !== 'xmax:webmcp:markdown:get') return;
      queueMicrotask(() => listeners.get('message')({
        source: context,
        data: {
          __xmax: 'xmax:webmcp:markdown:result', requestId: message.requestId,
          ok: true, markdown: '## Metadata\n\n- Author: @example'
        }
      }));
    }
  });
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'webmcp.js'), 'utf8'), context);
  return { context, getTool: () => registeredTool };
}

test('registers a read-only WebMCP Markdown metadata tool', async () => {
  const harness = loadWebMcp();
  await new Promise((resolve) => setImmediate(resolve));
  const tool = harness.getTool();
  assert.equal(tool.name, 'get_x_post_markdown');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.untrustedContentHint, true);
  assert.equal(tool.inputSchema.properties.post_url.type, 'string');
});

test('WebMCP tool returns Markdown from the extension metadata bridge', async () => {
  const harness = loadWebMcp();
  await new Promise((resolve) => setImmediate(resolve));
  const result = await harness.getTool().execute({}, {});
  assert.equal(result, '## Metadata\n\n- Author: @example');
});

test('WebMCP tool rejects non-X URLs', async () => {
  const harness = loadWebMcp();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => harness.getTool().execute({ post_url: 'https://example.com/post/123' }, {}),
    /must use x\.com or twitter\.com/
  );
});

test('WebMCP tool selects the most visible post on the X timeline', async () => {
  const article = (href, rect) => ({
    getBoundingClientRect: () => rect,
    querySelectorAll: () => [{ getAttribute: () => href }]
  });
  const harness = loadWebMcp({
    href: 'https://x.com/home',
    articles: [
      article('/partly/status/111', { left: 0, right: 600, top: -300, bottom: 100 }),
      article('/visible/status/222', { left: 0, right: 600, top: 120, bottom: 620 })
    ]
  });
  await new Promise((resolve) => setImmediate(resolve));
  const post = harness.context.XMaxWebMCP.parsePostUrl();
  assert.equal(post.url, 'https://x.com/visible/status/222');
  // The Inspector may auto-fill post_url with the active timeline URL.
  const result = await harness.getTool().execute({ post_url: 'https://x.com/home' }, {});
  assert.match(result, /^## Metadata/);
});
