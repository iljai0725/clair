const ClairCompressor = {
  STRATEGIES: {
    auto:   { label: 'Balanced',                  keepStart: 1, keepEnd: 4, maxMid: 15, truncAt: 2000 },
    opus:   { label: 'For Opus (reasoning)',       keepStart: 2, keepEnd: 3, maxMid: 20, truncAt: 3000 },
    sonnet: { label: 'For Sonnet (execution)',     keepStart: 1, keepEnd: 4, maxMid: 10, truncAt: 1500 },
    haiku:  { label: 'For Haiku (quick tasks)',    keepStart: 0, keepEnd: 2, maxMid: 5,  truncAt: 500 },
  },

  async init() { console.log('[Clair] Compressor ready'); },

  async compressAndCopy() {
    const msgs = await ClairExporter.extractMessages();
    if (!msgs.length) { ClairDOM.toast('No messages to compress'); return; }
    this._showPicker(async (key) => {
      const title = await ClairExporter.getTitle();
      const cfg = this.STRATEGIES[key];
      const summary = this._build(msgs, title, cfg, key);
      try {
        await navigator.clipboard.writeText(summary);
        ClairDOM.toast(`Compressed for ${cfg.label}. Paste into a new chat!`);
      } catch { this._showFallback(summary); }
    });
  },

  _build(msgs, title, cfg, key) {
    let out = `# Continuing: ${title}\n\n> Compressed from ${msgs.length} messages by Clair (${this.STRATEGIES[key].label})\n\n`;

    // Original request
    if (cfg.keepStart > 0) {
      out += `## Original request\n\n`;
      for (const m of msgs.slice(0, cfg.keepStart)) {
        if (m.role === 'human') out += m.content + '\n\n';
      }
    }

    // Middle summary
    const endIdx = cfg.keepEnd > 0 ? -cfg.keepEnd : msgs.length;
    const mid = msgs.slice(cfg.keepStart, endIdx);
    if (mid.length > 0) {
      out += `## Key progress\n\n`;
      let pts = 0;
      for (const m of mid) {
        if (pts >= cfg.maxMid) break;
        if (m.role === 'human') {
          out += `- **User:** ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}\n`;
          pts++;
        } else {
          const firstLine = m.content.split('\n').find(l => l.trim().length > 10) || m.content.substring(0, 150);
          out += `- **Claude:** ${firstLine.substring(0, 200)}${firstLine.length > 200 ? '...' : ''}\n`;
          pts++;
        }
      }
      out += '\n';
    }

    // Recent messages in full
    if (cfg.keepEnd > 0) {
      const recent = msgs.slice(-cfg.keepEnd);
      out += `## Recent conversation (last ${recent.length} messages)\n\n`;
      for (const m of recent) {
        const label = m.role === 'human' ? '**Human:**' : '**Claude:**';
        const content = m.content.length > cfg.truncAt
          ? m.content.substring(0, cfg.truncAt) + '\n\n[...truncated]'
          : m.content;
        out += `${label}\n${content}\n\n`;
      }
    }

    out += '---\n\n**Please continue this work from where we left off.** The conversation is summarized above.\n';
    return out;
  },

  _showPicker(onSelect) {
    document.getElementById('clair-compress-picker')?.remove();
    const overlay = ClairDOM.create('div', { id: 'clair-compress-picker', class: 'clair-overlay' });
    const modal = ClairDOM.create('div', { class: 'clair-modal' });

    modal.appendChild(ClairDOM.create('div', { class: 'clair-modal__header' }, [
      ClairDOM.create('span', { class: 'clair-modal__title' }, ['Compress & Continue']),
      ClairDOM.create('button', { class: 'clair-btn clair-btn--ghost', onClick: () => overlay.remove() }, ['✕']),
    ]));
    modal.appendChild(ClairDOM.create('p', { class: 'clair-modal__desc' }, ['Choose compression strategy based on your next model.']));

    for (const [key, cfg] of Object.entries(this.STRATEGIES)) {
      modal.appendChild(ClairDOM.create('button', {
        class: `clair-compress-opt ${key === 'auto' ? 'clair-compress-opt--default' : ''}`,
        onClick: () => { overlay.remove(); onSelect(key); }
      }, [ClairDOM.create('strong', {}, [cfg.label])]));
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  },

  _showFallback(content) {
    const overlay = ClairDOM.create('div', { class: 'clair-overlay' });
    const modal = ClairDOM.create('div', { class: 'clair-modal' }, [
      ClairDOM.create('div', { class: 'clair-modal__header' }, [
        ClairDOM.create('span', {}, ['Compressed Context']),
        ClairDOM.create('button', { class: 'clair-btn clair-btn--ghost', onClick: () => overlay.remove() }, ['✕']),
      ]),
      ClairDOM.create('textarea', { class: 'clair-textarea', style: { width: '100%', height: '300px' }, innerHTML: content }),
    ]);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modal.querySelector('textarea')?.select();
  },
};
