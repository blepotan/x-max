(function (root) {
  'use strict';

  const REQUEST = 'xmax:webmcp:markdown:get';
  const RESPONSE = 'xmax:webmcp:markdown:result';
  const REQUEST_TIMEOUT_MS = 3500;

  function postFromUrl(value) {
    let url;
    try {
      url = new URL(value, root.location.href);
    } catch (_) {
      throw new Error('A valid X post URL is required.');
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'x.com' && hostname !== 'www.x.com' && hostname !== 'twitter.com' && hostname !== 'www.twitter.com') {
      throw new Error('The post URL must use x.com or twitter.com.');
    }
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (!match) return null;
    return { username: match[1], id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` };
  }

  function visibleTimelinePost() {
    if (!root.document || typeof root.document.querySelectorAll !== 'function') return null;
    const viewportWidth = root.innerWidth || 0;
    const viewportHeight = root.innerHeight || 0;
    let best = null;
    let bestArea = 0;
    const articles = root.document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      if (!article || typeof article.getBoundingClientRect !== 'function') continue;
      const rect = article.getBoundingClientRect();
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const visibleArea = visibleWidth * visibleHeight;
      if (visibleArea <= bestArea) continue;
      const anchors = article.querySelectorAll('a[href*="/status/"]');
      for (const anchor of anchors) {
        const post = postFromUrl(anchor.getAttribute('href') || '');
        if (!post) continue;
        best = post;
        bestArea = visibleArea;
        break;
      }
    }
    return best;
  }

  function parsePostUrl(value) {
    if (value) {
      const explicit = postFromUrl(value);
      // Some WebMCP clients automatically populate URL-like optional fields with
      // the current page URL. On timeline surfaces that value is /home, /search,
      // etc. Treat it as page context and select the dominant visible post below.
      if (explicit) return explicit;
    }
    const pagePost = postFromUrl(root.location.href);
    if (pagePost) return pagePost;
    const timelinePost = visibleTimelinePost();
    if (timelinePost) return timelinePost;
    throw new Error('No visible X post was found. Open a post, scroll one into view, or provide post_url.');
  }

  function requestMarkdown(post, signal) {
    return new Promise((resolve, reject) => {
      const requestId = root.crypto && typeof root.crypto.randomUUID === 'function'
        ? root.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let settled = false;
      let timer;
      const cleanup = () => {
        root.removeEventListener('message', onMessage);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (timer) root.clearTimeout(timer);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => finish(reject, new DOMException('WebMCP tool execution was cancelled.', 'AbortError'));
      const onMessage = (event) => {
        const data = event.data;
        if (event.source !== root || !data || data.__xmax !== RESPONSE || data.requestId !== requestId) return;
        if (data.ok && typeof data.markdown === 'string') finish(resolve, data.markdown);
        else finish(reject, new Error(data.error || 'Could not extract this X post.'));
      };
      if (signal && signal.aborted) return onAbort();
      root.addEventListener('message', onMessage);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      timer = root.setTimeout(() => finish(reject, new Error('X post metadata extraction timed out.')), REQUEST_TIMEOUT_MS);
      root.postMessage({ __xmax: REQUEST, requestId, id: post.id, username: post.username }, '*');
    });
  }

  const tool = {
    name: 'get_x_post_markdown',
    title: 'Get X post as Markdown',
    description: 'Return the currently open or specified X post as Markdown, including author, canonical URL, posting date, format, public performance metrics, and post text.',
    inputSchema: {
      type: 'object',
      properties: {
        post_url: {
          type: 'string',
          description: 'Optional x.com or twitter.com post URL. Omit it when an individual post is currently open.'
        }
      },
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true
    },
    execute: async (input, context) => {
      const post = parsePostUrl(input && input.post_url);
      return requestMarkdown(post, context && context.signal);
    }
  };

  async function registerWebMcpTool() {
    const modelContext = root.document && root.document.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return false;
    await modelContext.registerTool(tool);
    return true;
  }

  root.XMaxWebMCP = { parsePostUrl, visibleTimelinePost, requestMarkdown, registerWebMcpTool, tool };
  registerWebMcpTool().catch(() => {
    // WebMCP is experimental and may be blocked by its flag, origin trial, or policy.
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
