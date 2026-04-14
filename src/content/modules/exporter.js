const ClairExporter = {
  _cached: null,
  _cachedId: null,

  async init() {
    window.addEventListener('clair:page-change', () => { this._cached = null; this._cachedId = null; });
    console.log('[Clair] Exporter ready');
  },

  async extractMessages() {
    const id = ClairDOM.getConversationId();
    if (!id) return [];
    if (this._cachedId === id && this._cached) return this._cached;
    try {
      const data = await ClairAPI.getConversation(id);
      if (data) {
        const msgs = ClairAPI.extractMessages(data);
        if (msgs.length > 0) {
          this._cached = msgs;
          this._cachedId = id;
          console.log(`[Clair] Extracted ${msgs.length} messages via API`);
          return msgs;
        }
      }
    } catch (e) { console.warn('[Clair] API extraction failed:', e); }
    return [];
  },

  async getTitle() {
    const id = ClairDOM.getConversationId();
    if (id) {
      try {
        const d = await ClairAPI.getConversation(id);
        if (d) return ClairAPI.getTitle(d);
      } catch {}
    }
    return document.title.replace(/ [-|] Claude.*$/, '').trim() || 'Untitled';
  },

  async exportMarkdown() {
    const msgs = await this.extractMessages();
    if (!msgs.length) { ClairDOM.toast('No messages found to export'); return; }
    const title = await this.getTitle();
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let md = `# ${title}\n\n*Exported by Clair on ${date}*\n\n---\n\n`;
    for (const m of msgs) {
      md += `### ${m.role === 'human' ? 'Human' : 'Claude'}\n\n${m.content}\n\n---\n\n`;
    }
    this._dl(`${this._san(title)}.md`, md, 'text/markdown');
    ClairDOM.toast(`Exported ${msgs.length} messages as Markdown`);
  },

  async exportJSON() {
    const msgs = await this.extractMessages();
    if (!msgs.length) { ClairDOM.toast('No messages found to export'); return; }
    const title = await this.getTitle();
    const json = JSON.stringify({
      title, exportedAt: new Date().toISOString(), exportedBy: 'Clair v' + CLAIR.VERSION,
      conversationId: ClairDOM.getConversationId(), messages: msgs,
    }, null, 2);
    this._dl(`${this._san(title)}.json`, json, 'application/json');
    ClairDOM.toast(`Exported ${msgs.length} messages as JSON`);
  },

  async exportText() {
    const msgs = await this.extractMessages();
    if (!msgs.length) { ClairDOM.toast('No messages found to export'); return; }
    const title = await this.getTitle();
    let txt = `${title}\nExported by Clair\n${'='.repeat(50)}\n\n`;
    for (const m of msgs) {
      txt += `[${m.role === 'human' ? 'Human' : 'Claude'}]\n${m.content}\n\n${'─'.repeat(40)}\n\n`;
    }
    this._dl(`${this._san(title)}.txt`, txt, 'text/plain');
    ClairDOM.toast(`Exported ${msgs.length} messages as text`);
  },

  _dl(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  _san(n) {
    return n.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').substring(0, 80) || 'conversation';
  },
};
