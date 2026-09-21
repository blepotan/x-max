(function () {
  'use strict';

  const REQUEST = 'xmax:metadata:get';
  const RESPONSE = 'xmax:metadata:tweet';
  const cache = new Map();

  function resolveTweet(value) {
    if (!value || typeof value !== 'object') return null;
    return value.__typename === 'TweetWithVisibilityResults' && value.tweet ? value.tweet : value;
  }

  function isTweet(value) {
    return value && value.__typename === 'Tweet' && typeof value.rest_id === 'string' && value.legacy;
  }

  function richness(tweet) {
    return (tweet.note_tweet ? 2 : 0) + (tweet.legacy && tweet.legacy.extended_entities ? 1 : 0) + (tweet.views ? 1 : 0);
  }

  function indexTweet(tweet) {
    const keys = [tweet.rest_id, tweet.legacy && tweet.legacy.id_str].filter(Boolean);
    for (const key of keys) {
      const previous = cache.get(key);
      if (!previous || richness(tweet) >= richness(previous)) cache.set(key, tweet);
    }
  }

  function indexPayload(payload) {
    const stack = [payload];
    let visited = 0;
    while (stack.length && visited < 200000) {
      const current = stack.pop();
      visited += 1;
      if (!current || typeof current !== 'object') continue;
      const tweet = resolveTweet(current);
      if (isTweet(tweet)) indexTweet(tweet);
      if (Array.isArray(current)) stack.push(...current);
      else for (const key in current) stack.push(current[key]);
    }
  }

  function parseResponse(text) {
    if (!text || text.length < 20 || !text.includes('"tweet_results"')) return;
    try { indexPayload(JSON.parse(text)); } catch (_) { /* X returned non-JSON data. */ }
  }

  function isGraphql(url) {
    return String(url || '').includes('/i/api/graphql/');
  }

  const xhr = XMLHttpRequest.prototype;
  const originalOpen = xhr.open;
  const originalSend = xhr.send;
  xhr.open = function (...args) {
    this.__xmaxUrl = args[1];
    return originalOpen.apply(this, args);
  };
  xhr.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (isGraphql(this.__xmaxUrl) && (this.responseType === '' || this.responseType === 'text')) parseResponse(this.responseText);
      } catch (_) { /* Ignore response types that cannot be read as text. */ }
    });
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const url = typeof input === 'string' ? input : input && input.url;
    const response = originalFetch.apply(this, args);
    if (isGraphql(url)) {
      response.then((value) => value.clone().text().then(parseResponse).catch(() => {})).catch(() => {});
    }
    return response;
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || !data || data.__xmax !== REQUEST || typeof data.id !== 'string') return;
    window.postMessage({ __xmax: RESPONSE, id: data.id, tweet: cache.get(data.id) || null }, '*');
  });
})();
