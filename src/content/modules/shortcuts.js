const ClairShortcuts = {
  _map: {},
  async init() {
    const s = await ClairStorage.getSettings();
    this._map = { ...CLAIR.DEFAULTS.shortcuts, ...(s.shortcuts || {}) };
    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.contentEditable === 'true') return;
      const k = this._key(e);
      if (!k) return;
      for (const [action, shortcut] of Object.entries(this._map)) {
        if (k === shortcut.toLowerCase()) { e.preventDefault(); this._exec(action); return; }
      }
    });
    console.log('[Clair] Shortcuts ready');
  },
  _key(e) {
    const p = [];
    if (e.ctrlKey) p.push('ctrl');
    if (e.altKey) p.push('alt');
    if (e.shiftKey) p.push('shift');
    if (e.key && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) p.push(e.key.toLowerCase());
    return p.join('+');
  },
  _exec(action) {
    switch (action) {
      case 'toggleSidebar': {
        const sb = document.querySelector('nav[aria-label*="Chat"], aside nav, [class*="sidebar"]');
        if (sb) sb.style.display = sb.style.display === 'none' ? '' : 'none';
        break;
      }
      case 'exportChat': ClairExporter.exportMarkdown(); break;
      case 'compressChat': ClairCompressor.compressAndCopy(); break;
      case 'newChat': {
        const btn = document.querySelector('a[href="/new"]');
        if (btn) btn.click(); else location.href = '/new';
        break;
      }
      case 'prevMessage': ClairNavigator.prev(); break;
      case 'nextMessage': ClairNavigator.next(); break;
      case 'bookmark': ClairNavigator.bookmarkCurrent(); break;
      case 'toggleNavList': ClairNavigator.toggleMode(); break;
    }
  },
};
