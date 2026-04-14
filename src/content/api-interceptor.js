const ClairAPIInterceptor = {
  init() {
    // Inject page-script.js into MAIN world for fetch interception
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/content/page-script.js');
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { console.warn('[Clair] Page script injection failed:', e); }

    // Bridge postMessage from page-script → CustomEvent for modules
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data?.type?.startsWith('clair:')) return;
      const { type, data } = e.data;
      if (type === 'clair:fetch-response' && (data?.streaming || data?.usage)) {
        this._emit(CLAIR.EVENTS.MESSAGE_RECEIVED, {
          model: data.model || 'unknown',
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens,
        });
      }
    });

    // Detect message sends via DOM
    document.addEventListener('click', (e) => {
      if (e.target.closest('button[aria-label*="Send"]'))
        this._emit(CLAIR.EVENTS.MESSAGE_SENT, { timestamp: Date.now() });
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.matches?.('[contenteditable="true"], textarea'))
        this._emit(CLAIR.EVENTS.MESSAGE_SENT, { timestamp: Date.now() });
    }, true);

    console.log('[Clair] API Interceptor ready');
  },

  _emit(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: JSON.parse(JSON.stringify(detail || {})) }));
    } catch {}
  },
};
