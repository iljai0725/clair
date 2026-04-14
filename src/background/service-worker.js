/**
 * Clair v0.5.0 — Background Service Worker
 *
 * Responsibilities:
 *   1. Forward popup → active tab messages
 *   2. On install, seed default settings
 *   3. NEW: Dynamic content script registration for user-added domains
 *      - User adds a domain in options → permission granted →
 *        we register a content script for that origin via chrome.scripting
 *      - On startup, re-register scripts for every currently-granted origin
 *        (Chrome may evict dynamic registrations across browser restarts)
 *      - On permission removal, unregister
 *
 * The same JS/CSS bundle that runs on claude.ai gets injected into custom
 * domains. Some features (the internal API, model detection, conversation
 * navigator) won't work outside claude.ai because they depend on Claude's
 * actual API — but the layout/shortcuts/export modules will still apply.
 */

const CLAIR_SCRIPT_ID = 'clair-dynamic';

const CLAIR_FILES = {
  js: [
    'src/utils/constants.js',
    'src/utils/storage.js',
    'src/utils/dom.js',
    'src/utils/claude-api.js',
    'src/content/api-interceptor.js',
    'src/content/injector.js',
    'src/content/modules/layout.js',
    'src/content/modules/exporter.js',
    'src/content/modules/compressor.js',
    'src/content/modules/session-tracker.js',
    'src/content/modules/health-monitor.js',
    'src/content/modules/navigator.js',
    'src/content/modules/shortcuts.js',
    'src/content/main.js',
  ],
  css: ['src/styles/inject.css'],
};

// ─── Default settings on install ─────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      clair_settings: {
        chatWidth: 70,
        showHealthMonitor: true,
        showNavigator: true,
        navigatorMode: 'rail',
        exportFormat: 'markdown',
        plan: 'pro',
        showPreflight: true,
        autoCompressOnLimitNear: false,
        customDomains: [],
        shortcuts: {
          toggleSidebar: 'Alt+S', exportChat: 'Alt+E', compressChat: 'Alt+C',
          newChat: 'Alt+N', prevMessage: 'Alt+K', nextMessage: 'Alt+J',
          bookmark: 'Alt+B', toggleNavList: 'Alt+L',
        },
      },
    });
    console.log('[Clair] Installed v0.5.0');
  }
  // On any install/update, sync dynamic scripts to whatever permissions exist
  syncDynamicScripts();
});

// On browser startup, re-sync (dynamic registrations don't always persist)
chrome.runtime.onStartup.addListener(() => syncDynamicScripts());

// When the user grants/revokes permissions via the options page,
// chrome fires these events — we re-sync to match.
chrome.permissions.onAdded.addListener(() => syncDynamicScripts());
chrome.permissions.onRemoved.addListener(() => syncDynamicScripts());

// ─── Message router ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getUsageStats') {
    chrome.storage.local.get('clair_usage_history', (result) => {
      const today = new Date().toISOString().split('T')[0];
      const history = result.clair_usage_history || {};
      sendResponse(history[today] || { messages: 0, inputTokens: 0, outputTokens: 0 });
    });
    return true;
  }

  // NEW: options page asks us to sync after a permission change
  if (message.action === 'syncDynamicScripts') {
    syncDynamicScripts().then(() => sendResponse({ ok: true }));
    return true;
  }

  // NEW: options page asks us to list registered custom domains
  if (message.action === 'getCustomDomains') {
    chrome.permissions.getAll((perms) => {
      const origins = (perms.origins || []).filter(o => o !== 'https://claude.ai/*');
      sendResponse({ origins });
    });
    return true;
  }

  // Forward popup messages to active tab. We don't restrict to claude.ai
  // anymore — any tab where Clair is injected should receive popup commands.
  if (!sender.tab) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
  }
});

/**
 * Read all currently-granted host permissions, exclude claude.ai (handled
 * by the static content_scripts), and register a single dynamic content
 * script that matches the rest. If there are none, just unregister.
 */
async function syncDynamicScripts() {
  try {
    const perms = await chrome.permissions.getAll();
    const origins = (perms.origins || []).filter(o =>
      o !== 'https://claude.ai/*' && o !== '<all_urls>'
    );

    // Unregister any prior dynamic script
    try {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CLAIR_SCRIPT_ID] });
      if (existing && existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: [CLAIR_SCRIPT_ID] });
      }
    } catch {}

    if (origins.length === 0) {
      console.log('[Clair] No custom domains — dynamic scripts cleared');
      return;
    }

    await chrome.scripting.registerContentScripts([{
      id: CLAIR_SCRIPT_ID,
      matches: origins,
      js: CLAIR_FILES.js,
      css: CLAIR_FILES.css,
      runAt: 'document_idle',
      world: 'ISOLATED',
      allFrames: false,
    }]);

    console.log('[Clair] Dynamic scripts registered for:', origins);
  } catch (e) {
    console.error('[Clair] syncDynamicScripts failed:', e);
  }
}
