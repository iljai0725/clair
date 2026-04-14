(function() {
  'use strict';
  if (window.__clairPageScript) return;
  window.__clairPageScript = true;
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url || '';
    const isAPI = url.includes('/api/') && (
      url.includes('chat_conversations') || url.includes('completion') || url.includes('organizations')
    );
    if (!isAPI) return _fetch.apply(this, args);

    window.postMessage({
      type: 'clair:fetch-request',
      data: { url, method: init?.method || 'GET', timestamp: Date.now() }
    }, '*');

    try {
      const response = await _fetch.apply(this, args);
      const clone = response.clone();
      (async () => {
        try {
          const ct = clone.headers.get('content-type') || '';
          if (ct.includes('event-stream')) {
            const reader = clone.body.getReader();
            const dec = new TextDecoder();
            let usage = null, model = null;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              for (const line of dec.decode(value, { stream: true }).split('\n')) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const d = JSON.parse(line.slice(6));
                  if (d.usage) usage = d.usage;
                  if (d.model) model = d.model;
                } catch {}
              }
            }
            window.postMessage({
              type: 'clair:fetch-response',
              data: { url, status: response.status, streaming: true, usage, model, timestamp: Date.now() }
            }, '*');
          } else if (ct.includes('json')) {
            const data = await clone.json();
            window.postMessage({
              type: 'clair:fetch-response',
              data: { url, status: response.status, streaming: false, model: data?.model, usage: data?.usage, timestamp: Date.now() }
            }, '*');
          }
        } catch {}
      })();
      return response;
    } catch (err) {
      window.postMessage({ type: 'clair:fetch-error', data: { url, error: err.message } }, '*');
      throw err;
    }
  };
})();
