const ClairInjector = {
  async init() {
    // Wait for main content area
    try {
      await new Promise((res, rej) => {
        const check = () => document.querySelector('main') ? res() : setTimeout(check, 500);
        check();
        setTimeout(() => rej(), 15000);
      });
    } catch { console.warn('[Clair] Main content area not found'); }

    if (!document.getElementById('clair-root')) {
      const root = ClairDOM.create('div', { id: 'clair-root', class: 'clair-root' });
      document.body.appendChild(root);
    }
    this._watchNav();
  },

  _watchNav() {
    let lastPath = location.pathname;
    const orig = history.pushState;
    history.pushState = function(...a) {
      orig.apply(this, a);
      window.dispatchEvent(new Event('clair:nav'));
    };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('clair:nav')));
    window.addEventListener('clair:nav', () => {
      const p = location.pathname;
      if (p !== lastPath) {
        lastPath = p;
        setTimeout(() => window.dispatchEvent(new CustomEvent('clair:page-change', {
          detail: {
            path: p,
            isConversation: /\/chat\/[a-f0-9-]+/.test(p),
            isNewChat: p === '/new' || p === '/',
            conversationId: (p.match(/\/chat\/([a-f0-9-]+)/) || [])[1] || null,
          }
        })), 500);
      }
    });
  },

  getContainer(moduleId) {
    const root = document.getElementById('clair-root');
    if (!root) return null;
    let c = root.querySelector(`[data-module="${moduleId}"]`);
    if (!c) {
      c = ClairDOM.create('div', { 'data-module': moduleId, class: `clair-mod clair-mod--${moduleId}` });
      root.appendChild(c);
    }
    return c;
  },

  removeContainer(id) {
    document.querySelector(`[data-module="${id}"]`)?.remove();
  },
};
