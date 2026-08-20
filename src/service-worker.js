importScripts('settings.js');

(function (root) {
  'use strict';

  const api = root.XMax || {};
  const COMMAND = 'set-schedule-time';
  const VERSION = 1;

  function allowedUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' && (url.hostname === 'x.com' || url.hostname.endsWith('.x.com'))) ||
        (url.protocol === 'https:' && (url.hostname === 'twitter.com' || url.hostname.endsWith('.twitter.com')));
    } catch (_error) {
      return false;
    }
  }

  function requestId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return `xmax-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function setUnavailableBadge() {
    if (!root.chrome || !root.chrome.action) return;
    try {
      await root.chrome.action.setBadgeText({ text: '!' });
      await root.chrome.action.setBadgeBackgroundColor({ color: '#8b1e2d' });
      await root.chrome.action.setTitle({ title: 'X-max: refresh X to enable scheduling' });
    } catch (_error) {
      // Badge feedback is best effort and does not affect scheduling safety.
    }
  }

  async function clearBadge() {
    if (!root.chrome || !root.chrome.action) return;
    try {
      await root.chrome.action.setBadgeText({ text: '' });
      await root.chrome.action.setTitle({ title: 'X-max schedule settings' });
    } catch (_error) {
      // Best effort only.
    }
  }

  async function handleCommand(command) {
    if (command !== COMMAND || !root.chrome || !root.chrome.tabs) return;
    let tabs;
    try {
      tabs = await root.chrome.tabs.query({ active: true, lastFocusedWindow: true });
    } catch (_error) {
      return;
    }
    const tab = tabs && tabs[0];
    if (!tab || !allowedUrl(tab.url) || typeof tab.id !== 'number') {
      await setUnavailableBadge();
      return;
    }
    const settings = await api.loadSettings();
    if (!settings.enabled) return;
    try {
      await root.chrome.tabs.sendMessage(tab.id, {
        type: 'xmax.setScheduleTime',
        version: VERSION,
        requestId: requestId(),
        settings: settings
      });
      await clearBadge();
    } catch (_error) {
      // A content script cannot be reached on a pre-install page. Do not inject
      // code dynamically; tell the user to refresh through the action badge.
      await setUnavailableBadge();
    }
  }

  if (root.chrome && root.chrome.commands && root.chrome.commands.onCommand) {
    root.chrome.commands.onCommand.addListener(handleCommand);
  }

  if (root.chrome && root.chrome.runtime && root.chrome.runtime.onInstalled) {
    root.chrome.runtime.onInstalled.addListener(async () => {
      const current = await api.loadSettings();
      // Preserve user settings across upgrades while ensuring the schema exists.
      await api.saveSettings(current);
      await clearBadge();
    });
  }

  root.XMaxServiceWorker = { allowedUrl, handleCommand, COMMAND };
})(globalThis);
