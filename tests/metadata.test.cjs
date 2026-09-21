const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadApi() {
  const context = vm.createContext({ console, Date, Intl, setTimeout, clearTimeout });
  context.globalThis = context;
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'metadata.js'), 'utf8'),
    context,
    { filename: 'src/metadata.js' }
  );
  return context.XMax;
}

test('raw X tweet data is normalized into metadata', () => {
  const api = loadApi();
  const tweet = {
    rest_id: '123',
    core: { user_results: { result: { core: { screen_name: 'username' } } } },
    views: { count: '2400000' },
    legacy: {
      created_at: 'Thu Aug 20 08:00:00 +0000 2026',
      full_text: 'short fallback',
      favorite_count: 18200,
      reply_count: 940,
      retweet_count: 3200,
      bookmark_count: 7100
    },
    note_tweet: { note_tweet_results: { result: { text: 'first\n\nsecond' } } }
  };
  const metadata = api.metadataFromTweet(tweet, {});
  assert.equal(metadata.username, 'username');
  assert.equal(metadata.url, 'https://x.com/username/status/123');
  assert.equal(metadata.postedAt, '2026-08-20');
  assert.equal(metadata.text, 'first\n\nsecond');
  assert.equal(metadata.format, 'Text');
});

test('metadata is formatted as the requested Markdown document', () => {
  const api = loadApi();
  const markdown = api.formatMetadataMarkdown({
    username: 'username', url: 'https://x.com/username/status/123',
    postedAt: '2026-08-20', format: 'Text', views: 2400000,
    likes: 18200, replies: 940, reposts: 3200, bookmarks: 7100,
    text: 'everyone thinks AI coding is about writing code faster.\n\nthey are wrong.'
  });
  assert.match(markdown, /^## Metadata/);
  assert.match(markdown, /- Author: @username/);
  assert.match(markdown, /- Views: 2,400,000/);
  assert.match(markdown, /- Bookmarks: 7,100/);
  assert.match(markdown, /## Post\n\n> everyone thinks AI coding is about writing code faster\.\n>\n> they are wrong\.$/);
});

test('media type is reflected in Format', () => {
  const api = loadApi();
  const metadata = api.metadataFromTweet({
    rest_id: '123', legacy: { extended_entities: { media: [{ type: 'video' }] } }
  }, { username: 'user' });
  assert.equal(metadata.format, 'Video');
});

test('metadata control uses the provided Markdown SVG icon', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'metadata.js'), 'utf8');
  assert.match(source, /const MARKDOWN_ICON = '<svg[^']*width="18" height="18"/);
  assert.match(source, /fill="currentColor"/);
  assert.match(source, /button\.innerHTML = MARKDOWN_ICON/);
  assert.doesNotMatch(source, /button\.textContent = 'M↓'/);
});

test('metadata control gets an aligned action slot before the native share control', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'metadata.js'), 'utf8');
  assert.match(source, /const BUTTON_SLOT_ATTRIBUTE = 'data-xmax-metadata-slot'/);
  assert.match(source, /align-self:stretch; display:flex; flex:1 1 0; min-width:44px/);
  assert.match(source, /align-self:center; flex:0 0 auto/);
  assert.match(source, /button\[aria-label="Share post"\]/);
  assert.match(source, /actionRow\.insertBefore\(slot, shareSlot\)/);
  assert.doesNotMatch(source, /margin:-8px 0/);
});
