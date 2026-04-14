(async function initClair() {
  'use strict';
  if (window.__clairInit) return;
  window.__clairInit = true;
  console.log('[Clair] v' + CLAIR.VERSION + ' initializing...');

  try {
    ClairAPIInterceptor.init();
    await ClairInjector.init();

    // Session tracker must be initialized before health monitor
    if (CLAIR.FEATURES.session) {
      try { await ClairSession.init(); }
      catch (e) { console.warn('[Clair] session failed:', e); }
    }

    const mods = [
      ['layout',     ClairLayout,        CLAIR.FEATURES.layout],
      ['exporter',   ClairExporter,      CLAIR.FEATURES.exporter],
      ['compressor', ClairCompressor,    CLAIR.FEATURES.compressor],
      ['session',    ClairSession,       CLAIR.FEATURES.sessionTracker],
      ['health',     ClairHealthMonitor, CLAIR.FEATURES.healthMonitor],
      ['navigator',  ClairNavigator,     CLAIR.FEATURES.navigator],
      ['shortcuts',  ClairShortcuts,     CLAIR.FEATURES.shortcuts],
    ];

    for (const [name, mod, flag] of mods) {
      if (!flag) continue;
      try { await mod.init(); }
      catch (e) { console.warn('[Clair] ' + name + ' failed:', e); }
    }

    chrome.runtime.onMessage.addListener((msg) => {
      switch (msg.action) {
        case 'exportMarkdown':  ClairExporter.exportMarkdown(); break;
        case 'exportJSON':      ClairExporter.exportJSON(); break;
        case 'exportText':      ClairExporter.exportText(); break;
        case 'compressAndCopy': ClairCompressor.compressAndCopy(); break;
        case 'planChanged':
          if (msg.plan && ClairHealthMonitor._plan !== undefined) {
            ClairHealthMonitor._plan = msg.plan;
            ClairDOM.toast('Plan set to ' + (
              msg.plan === 'pro' ? 'Pro' : msg.plan === 'max5x' ? 'Max 5\u00d7' : 'Max 20\u00d7'
            ));
          }
          break;
        case 'clearSession':
          ClairSession.clear().then(() => ClairDOM.toast('Session log cleared'));
          break;
      }
    });

    console.log('[Clair] v' + CLAIR.VERSION + ' ready \u2713');
  } catch (e) {
    console.error('[Clair] Init failed:', e);
  }
})();
