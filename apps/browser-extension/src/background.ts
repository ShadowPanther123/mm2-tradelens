/**
 * Background service worker. Kept intentionally minimal — the extension does no
 * tracking and requests no host permissions. It only responds to popup
 * messages, leaving room for a future "send trade to desktop app" bridge.
 */

chrome.runtime.onInstalled.addListener(() => {
  // Reserved for first-run setup (defaults, welcome page) if ever needed.
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
  }
  return false;
});
