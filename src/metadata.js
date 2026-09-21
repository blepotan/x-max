(function (root) {
  'use strict';

  const api = root.XMax || {};
  const BUTTON_ATTRIBUTE = 'data-xmax-metadata-button';
  const BUTTON_SLOT_ATTRIBUTE = 'data-xmax-metadata-slot';
  const STYLE_ID = 'xmax-metadata-style';
  const REQUEST = 'xmax:metadata:get';
  const RESPONSE = 'xmax:metadata:tweet';
  const WEBMCP_REQUEST = 'xmax:webmcp:markdown:get';
  const WEBMCP_RESPONSE = 'xmax:webmcp:markdown:result';
  const MARKDOWN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><g fill="currentColor"><path d="M15.25,3H2.75c-1.517,0-2.75,1.233-2.75,2.75v6.5c0,1.517,1.233,2.75,2.75,2.75H15.25c1.517,0,2.75-1.233,2.75-2.75V5.75c0-1.517-1.233-2.75-2.75-2.75Zm-5.75,8.25c0,.414-.336,.75-.75,.75s-.75-.336-.75-.75v-2.801l-1.155,1.507c-.283,.37-.907,.37-1.19,0l-1.155-1.507v2.801c0,.414-.336,.75-.75,.75s-.75-.336-.75-.75V6.75c0-.414,.336-.75,.75-.75h.394c.233,0,.454,.109,.595,.294l1.511,1.973,1.511-1.973c.142-.185,.362-.294,.595-.294h.394c.414,0,.75,.336,.75,.75v4.5Zm6.03-1.22l-1.75,1.75c-.146,.146-.338,.22-.53,.22s-.384-.073-.53-.22l-1.75-1.75c-.293-.293-.293-.768,0-1.061s.768-.293,1.061,0l.47,.47v-2.689c0-.414,.336-.75,.75-.75s.75,.336,.75,.75v2.689l.47-.47c.293-.293,.768-.293,1.061,0s.293,.768,0,1.061Z"></path></g></svg>';
  let scanQueued = false;

  function statusIdentity(article) {
    const anchors = article ? article.querySelectorAll('a[href*="/status/"]') : [];
    for (const anchor of anchors) {
      const match = (anchor.getAttribute('href') || '').match(/^\/?([^/]+)\/status\/(\d+)/);
      if (match) return { username: match[1], id: match[2] };
    }
    const pageMatch = root.location && root.location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    return pageMatch ? { username: pageMatch[1], id: pageMatch[2] } : null;
  }

  function compactNumber(value) {
    if (value === null || value === undefined || value === '') return '0';
    const number = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(number) ? Math.round(number).toLocaleString('en-US') : String(value);
  }

  function isoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }

  function postFormat(tweet) {
    const media = tweet && tweet.legacy && tweet.legacy.extended_entities && tweet.legacy.extended_entities.media;
    const types = Array.isArray(media) ? media.map((item) => item && item.type) : [];
    if (types.includes('video')) return 'Video';
    if (types.includes('animated_gif')) return 'GIF';
    if (types.includes('photo')) return 'Image';
    return 'Text';
  }

  function metadataFromTweet(tweet, fallback) {
    const user = tweet && tweet.core && tweet.core.user_results && tweet.core.user_results.result;
    const screenName = user && user.core && user.core.screen_name;
    const legacy = tweet && tweet.legacy || {};
    const noteResult = tweet && tweet.note_tweet && tweet.note_tweet.note_tweet_results && tweet.note_tweet.note_tweet_results.result;
    const id = tweet && tweet.rest_id || fallback.id;
    const username = screenName || fallback.username;
    return {
      username,
      url: `https://x.com/${username}/status/${id}`,
      postedAt: isoDate(legacy.created_at || fallback.postedAt),
      format: postFormat(tweet),
      views: tweet && tweet.views && tweet.views.count || fallback.views,
      likes: legacy.favorite_count != null ? legacy.favorite_count : fallback.likes,
      replies: legacy.reply_count != null ? legacy.reply_count : fallback.replies,
      reposts: legacy.retweet_count != null ? legacy.retweet_count : fallback.reposts,
      bookmarks: legacy.bookmark_count != null ? legacy.bookmark_count : fallback.bookmarks,
      text: noteResult && noteResult.text || legacy.full_text || fallback.text || ''
    };
  }

  function markdownQuote(text) {
    return String(text || '').replace(/\r\n/g, '\n').split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');
  }

  function formatMetadataMarkdown(data) {
    return [
      '## Metadata', '',
      `- Author: @${String(data.username || '').replace(/^@/, '')}`,
      `- URL: ${data.url || ''}`,
      `- Posted at: ${data.postedAt || ''}`,
      `- Format: ${data.format || 'Text'}`, '',
      '## Performance', '',
      `- Views: ${compactNumber(data.views)}`,
      `- Likes: ${compactNumber(data.likes)}`,
      `- Replies: ${compactNumber(data.replies)}`,
      `- Reposts: ${compactNumber(data.reposts)}`,
      `- Bookmarks: ${compactNumber(data.bookmarks)}`, '',
      '## Post', '', markdownQuote(data.text)
    ].join('\n');
  }

  function metric(article, testId) {
    const element = article.querySelector(`[data-testid="${testId}"]`);
    const label = element && (element.getAttribute('aria-label') || element.textContent) || '';
    const match = label.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (!match) return 0;
    const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] || '').toUpperCase()] || 1;
    return Math.round(Number(match[1]) * scale);
  }

  function domFallback(article, identity) {
    const time = article.querySelector('time');
    const textElement = article.querySelector('[data-testid="tweetText"]');
    return {
      ...identity,
      postedAt: time && time.getAttribute('datetime'),
      text: textElement && textElement.innerText || textElement && textElement.textContent || '',
      views: metric(article, 'app-text-transition-container'),
      likes: metric(article, 'like'), replies: metric(article, 'reply'),
      reposts: metric(article, 'retweet'), bookmarks: metric(article, 'bookmark')
    };
  }

  function requestTweet(id, timeoutMs) {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        root.removeEventListener('message', onMessage);
        resolve(value);
      };
      const onMessage = (event) => {
        const data = event.data;
        if (event.source === root && data && data.__xmax === RESPONSE && data.id === id) finish(data.tweet || null);
      };
      root.addEventListener('message', onMessage);
      root.postMessage({ __xmax: REQUEST, id }, '*');
      root.setTimeout(() => finish(null), timeoutMs || 800);
    });
  }

  function articleForStatus(id) {
    if (!root.document) return null;
    const articles = root.document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const identity = statusIdentity(article);
      if (identity && identity.id === id) return article;
    }
    return null;
  }

  async function markdownForStatus(id, username) {
    const article = articleForStatus(id);
    const fallback = article
      ? domFallback(article, { id, username })
      : { id, username, postedAt: '', text: '', views: 0, likes: 0, replies: 0, reposts: 0, bookmarks: 0 };
    const tweet = await requestTweet(id);
    if (!tweet && !article) throw new Error('Post data is not available yet. Open or scroll the post into view, then retry.');
    return formatMetadataMarkdown(metadataFromTweet(tweet, fallback));
  }

  function installWebMcpBridge() {
    if (typeof root.addEventListener !== 'function') return;
    root.addEventListener('message', (event) => {
      const data = event.data;
      if (event.source !== root || !data || data.__xmax !== WEBMCP_REQUEST || typeof data.requestId !== 'string') return;
      const id = typeof data.id === 'string' ? data.id : '';
      const username = typeof data.username === 'string' ? data.username : '';
      if (!/^\d+$/.test(id) || !/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        root.postMessage({ __xmax: WEBMCP_RESPONSE, requestId: data.requestId, ok: false, error: 'A valid X post URL is required.' }, '*');
        return;
      }
      markdownForStatus(id, username)
        .then((markdown) => root.postMessage({ __xmax: WEBMCP_RESPONSE, requestId: data.requestId, ok: true, markdown }, '*'))
        .catch((error) => root.postMessage({
          __xmax: WEBMCP_RESPONSE,
          requestId: data.requestId,
          ok: false,
          error: error && error.message || 'Could not extract this X post.'
        }, '*'));
    });
  }

  async function copyText(text) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      await root.navigator.clipboard.writeText(text);
      return;
    }
    const area = root.document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    root.document.body.appendChild(area);
    area.select();
    root.document.execCommand('copy');
    area.remove();
  }

  function installStyle() {
    if (!root.document || root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${BUTTON_SLOT_ATTRIBUTE}] { align-self:stretch; display:flex; flex:1 1 0; min-width:44px; align-items:center; justify-content:flex-start; }
      [${BUTTON_ATTRIBUTE}] { appearance:none; position:relative; align-self:center; flex:0 0 auto; background:transparent; border:0; color:rgb(83,100,113); display:flex; align-items:center; justify-content:center; width:34px; height:34px; margin:0; padding:0; border-radius:9999px; cursor:pointer; font:700 13px/1 system-ui,sans-serif; touch-action:manipulation; transition:background-color 150ms,color 150ms,transform 80ms; }
      [${BUTTON_ATTRIBUTE}]::before { content:""; position:absolute; inset:-5px; border-radius:9999px; }
      [${BUTTON_ATTRIBUTE}]:focus-visible { outline:2px solid rgb(29,155,240); outline-offset:2px; }
      [${BUTTON_ATTRIBUTE}]:active { transform:scale(.94); }
      [${BUTTON_ATTRIBUTE}] svg { display:block; width:18px; height:18px; }
      [${BUTTON_ATTRIBUTE}][data-state="copied"] { color:rgb(0,186,124); }
      @media (hover:hover) and (pointer:fine) { [${BUTTON_ATTRIBUTE}]:hover { background:rgba(29,155,240,.1); color:rgb(29,155,240); } }
      @media (prefers-color-scheme:dark) { [${BUTTON_ATTRIBUTE}] { color:rgb(113,118,123); } }
      @media (prefers-reduced-motion:reduce) { [${BUTTON_ATTRIBUTE}] { transition:none; } }
    `;
    (root.document.head || root.document.documentElement).appendChild(style);
  }

  function mountButton(article) {
    if (article.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const identity = statusIdentity(article);
    const actionRow = article.querySelector('div[role="group"]');
    if (!identity || !actionRow) return;
    const button = root.document.createElement('button');
    button.type = 'button';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.setAttribute('aria-label', 'Copy post metadata as Markdown');
    button.title = 'Copy post metadata as Markdown';
    button.innerHTML = MARKDOWN_ICON;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        const fallback = domFallback(article, identity);
        const tweet = await requestTweet(identity.id);
        await copyText(formatMetadataMarkdown(metadataFromTweet(tweet, fallback)));
        button.dataset.state = 'copied';
        button.textContent = '✓';
        button.setAttribute('aria-label', 'Post metadata copied as Markdown');
        if (typeof api.showStatus === 'function') api.showStatus('Post metadata copied as Markdown.', 'success', undefined, 'Markdown copied');
      } catch (_) {
        if (typeof api.showStatus === 'function') api.showStatus('Could not copy this post metadata.', 'error', undefined, 'Couldn’t copy');
      } finally {
        root.setTimeout(() => {
          button.disabled = false;
          button.dataset.state = '';
          button.setAttribute('aria-label', 'Copy post metadata as Markdown');
          button.innerHTML = MARKDOWN_ICON;
        }, 1500);
      }
    });
    const slot = root.document.createElement('div');
    slot.setAttribute(BUTTON_SLOT_ATTRIBUTE, 'true');
    slot.appendChild(button);
    const shareButton = actionRow.querySelector('button[aria-label="Share post"]');
    let shareSlot = shareButton;
    while (shareSlot && shareSlot.parentElement && shareSlot.parentElement !== actionRow) {
      shareSlot = shareSlot.parentElement;
    }
    if (shareSlot && shareSlot.parentElement === actionRow) actionRow.insertBefore(slot, shareSlot);
    else actionRow.appendChild(slot);
  }

  function scanMetadataButtons() {
    scanQueued = false;
    if (!root.document) return;
    root.document.querySelectorAll('article[data-testid="tweet"]').forEach(mountButton);
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    (root.requestAnimationFrame || root.setTimeout)(scanMetadataButtons);
  }

  function installMetadataExtraction() {
    if (!root.document || !root.document.body) return;
    installStyle();
    scanMetadataButtons();
    if (typeof root.MutationObserver === 'function') {
      new root.MutationObserver(queueScan).observe(root.document.body, { childList: true, subtree: true });
    }
  }

  api.compactNumber = compactNumber;
  api.formatMetadataMarkdown = formatMetadataMarkdown;
  api.metadataFromTweet = metadataFromTweet;
  api.markdownForStatus = markdownForStatus;
  api.statusIdentity = statusIdentity;
  api.installMetadataExtraction = installMetadataExtraction;
  root.XMax = api;

  installWebMcpBridge();
  if (root.document && root.document.body) installMetadataExtraction();
  else if (root.document) root.document.addEventListener('DOMContentLoaded', installMetadataExtraction, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
