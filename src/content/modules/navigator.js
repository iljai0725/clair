/**
 * Clair v0.5.0 — Conversation Navigator
 *
 * Two modes:
 *   - rail (default): subtle dots along the right edge, hover to expand
 *   - list (Alt+L):   persistent vertical list of all enquiries with summaries
 *
 * NEW in v0.5.0:
 *   - Smart enquiry summaries (intent-extracting, not truncation)
 *   - Bookmarks: gold dots on the rail, Alt+B to add, Alt+Click to remove
 *   - List mode for long conversations where the dot rail gets too dense
 *   - Filter box in list mode — search across enquiries by keyword
 */
const ClairNavigator = {
  _msgs: [],
  _humanMsgs: [],
  _idx: -1,
  _container: null,
  _rail: null,
  _list: null,
  _mode: 'rail',
  _bookmarks: [],
  _filter: '',

  async init() {
    const s = await ClairStorage.getSettings();
    if (s.showNavigator === false) return;
    this._mode = s.navigatorMode || 'rail';
    this._container = ClairInjector.getContainer('nav');
    if (!this._container) return;
    this._container.innerHTML = '';
    this._build();

    window.addEventListener('clair:page-change', () => {
      this._idx = -1;
      this._filter = '';
      setTimeout(() => this._refresh(), 1500);
    });
    window.addEventListener('clair:health-updated', () => this._refresh());
    window.addEventListener(CLAIR.EVENTS.SETTINGS_CHANGED, (e) => {
      if (e.detail?.navigatorMode && e.detail.navigatorMode !== this._mode) {
        this._mode = e.detail.navigatorMode;
        this._build();
        this._refresh();
      }
    });

    const chatObs = () => {
      const chat = document.querySelector('main .overflow-y-auto, main [class*="scroll"], main');
      if (chat) {
        new MutationObserver(ClairDOM.debounce(() => this._refresh(), 1000))
          .observe(chat, { childList: true, subtree: true });
        this._refresh();
      } else {
        setTimeout(chatObs, 2000);
      }
    };
    chatObs();
    console.log('[Clair] Navigator ready · mode=' + this._mode);
  },

  _build() {
    if (!this._container) return;
    this._container.innerHTML = '';
    this._container.classList.toggle('clair-mod--nav-list', this._mode === 'list');

    if (this._mode === 'list') {
      this._buildList();
    } else {
      this._buildRail();
    }
  },

  _buildRail() {
    this._rail = ClairDOM.create('div', { class: 'clair-rail', id: 'clair-rail' });
    this._rail.appendChild(ClairDOM.create('div', { class: 'clair-rail__dots', id: 'clair-rail-dots' }));
    // Mode toggle button at top
    const toggle = ClairDOM.create('button', {
      class: 'clair-rail__mode-toggle',
      title: 'Switch to list mode (Alt+L)',
      onClick: () => this.toggleMode(),
    }, ['☰']);
    this._rail.appendChild(toggle);
    this._container.appendChild(this._rail);
    this._list = null;
  },

  _buildList() {
    this._list = ClairDOM.create('div', { class: 'clair-navlist', id: 'clair-navlist' });

    const header = ClairDOM.create('div', { class: 'clair-navlist__header' });
    const title = ClairDOM.create('div', { class: 'clair-navlist__title' }, ['Enquiries']);
    const closeBtn = ClairDOM.create('button', {
      class: 'clair-navlist__close',
      title: 'Switch to rail mode (Alt+L)',
      onClick: () => this.toggleMode(),
    }, ['×']);
    header.appendChild(title);
    header.appendChild(closeBtn);
    this._list.appendChild(header);

    const filter = ClairDOM.create('input', {
      class: 'clair-navlist__filter',
      type: 'text',
      placeholder: 'Filter enquiries…',
    });
    filter.addEventListener('input', (e) => {
      this._filter = e.target.value.toLowerCase();
      this._renderList();
    });
    this._list.appendChild(filter);

    const itemsWrap = ClairDOM.create('div', { class: 'clair-navlist__items', id: 'clair-navlist-items' });
    this._list.appendChild(itemsWrap);

    this._container.appendChild(this._list);
    this._rail = null;
  },

  toggleMode() {
    this._mode = this._mode === 'rail' ? 'list' : 'rail';
    ClairStorage.updateSettings({ navigatorMode: this._mode });
    this._build();
    this._refresh();
  },

  async _refresh() {
    if (!ClairDOM.isConversationPage()) {
      if (this._rail) this._rail.style.display = 'none';
      if (this._list) this._list.style.display = 'none';
      return;
    }

    let msgs = [];
    try {
      const id = ClairDOM.getConversationId();
      if (id) {
        const data = await ClairAPI.getConversation(id);
        if (data) msgs = ClairAPI.extractMessages(data);
        // Load bookmarks for this conversation
        this._bookmarks = await ClairStorage.getBookmarks(id);
      }
    } catch {}

    this._msgs = msgs;
    this._humanMsgs = msgs.filter(m => m.role === 'human');

    if (this._humanMsgs.length < 2) {
      if (this._rail) this._rail.style.display = 'none';
      if (this._list) this._list.style.display = 'none';
      return;
    }

    if (this._rail) { this._rail.style.display = ''; this._renderDots(); }
    if (this._list) { this._list.style.display = ''; this._renderList(); }
  },

  _renderDots() {
    const dotsEl = this._rail?.querySelector('#clair-rail-dots');
    if (!dotsEl) return;
    dotsEl.innerHTML = '';

    const total = this._humanMsgs.length;
    const bookmarkSet = new Set(this._bookmarks.map(b => b.turnIdx));

    this._humanMsgs.forEach((msg, i) => {
      const summary = ClairDOM.summarizePrompt(msg.content);
      const pct = total <= 1 ? 50 : (i / (total - 1)) * 100;

      const isBookmarked = bookmarkSet.has(i);
      const hue = Math.round(120 - (i / Math.max(1, total - 1)) * 120);
      const dotColor = isBookmarked ? '#C4841D' : `hsl(${hue}, 50%, 50%)`;

      const dot = ClairDOM.create('div', {
        class: `clair-dot ${i === this._idx ? 'clair-dot--active' : ''} ${isBookmarked ? 'clair-dot--bookmarked' : ''}`,
        style: { top: `${Math.min(pct, 98)}%` },
        title: msg.content.substring(0, 200),
        onClick: (e) => {
          if (e.altKey && isBookmarked) {
            this.removeBookmark(i);
          } else {
            this._jumpToTurn(i);
          }
        },
      });

      const circle = ClairDOM.create('div', {
        class: 'clair-dot__circle',
        style: { background: dotColor },
      });
      const num = ClairDOM.create('span', { class: 'clair-dot__num' }, [
        isBookmarked ? '★' : String(i + 1)
      ]);
      const label = ClairDOM.create('span', { class: 'clair-dot__label' }, [summary]);

      dot.appendChild(circle);
      dot.appendChild(num);
      dot.appendChild(label);
      dotsEl.appendChild(dot);
    });
  },

  _renderList() {
    const itemsWrap = this._list?.querySelector('#clair-navlist-items');
    if (!itemsWrap) return;
    itemsWrap.innerHTML = '';

    const bookmarkSet = new Set(this._bookmarks.map(b => b.turnIdx));
    const filter = this._filter;

    this._humanMsgs.forEach((msg, i) => {
      const summary = ClairDOM.summarizePrompt(msg.content);
      // Filter on summary OR raw content
      if (filter && !summary.toLowerCase().includes(filter) && !msg.content.toLowerCase().includes(filter)) {
        return;
      }

      const isBookmarked = bookmarkSet.has(i);
      const item = ClairDOM.create('div', {
        class: `clair-navlist__item ${i === this._idx ? 'clair-navlist__item--active' : ''} ${isBookmarked ? 'clair-navlist__item--bookmarked' : ''}`,
        title: msg.content.substring(0, 300),
        onClick: () => this._jumpToTurn(i),
      });

      const num = ClairDOM.create('span', { class: 'clair-navlist__num' }, [
        isBookmarked ? '★' : `${i + 1}`
      ]);
      const label = ClairDOM.create('span', { class: 'clair-navlist__label' }, [summary]);
      const bookmarkBtn = ClairDOM.create('button', {
        class: 'clair-navlist__bookmark',
        title: isBookmarked ? 'Remove bookmark' : 'Bookmark',
        onClick: (e) => {
          e.stopPropagation();
          if (isBookmarked) this.removeBookmark(i);
          else this.bookmarkTurn(i, summary);
        },
      }, [isBookmarked ? '★' : '☆']);

      item.appendChild(num);
      item.appendChild(label);
      item.appendChild(bookmarkBtn);
      itemsWrap.appendChild(item);
    });

    if (itemsWrap.children.length === 0) {
      itemsWrap.appendChild(ClairDOM.create('div', { class: 'clair-navlist__empty' }, [
        filter ? `No enquiries match "${filter}"` : 'No enquiries yet'
      ]));
    }
  },

  // ── Bookmarks ────────────────────────────────────────
  async bookmarkCurrent() {
    // Bookmark whichever turn is closest to the current scroll position
    const idx = this._findCurrentTurn();
    if (idx < 0) {
      ClairDOM.toast('Could not find a turn to bookmark');
      return;
    }
    const summary = ClairDOM.summarizePrompt(this._humanMsgs[idx]?.content || '');
    await this.bookmarkTurn(idx, summary);
  },

  async bookmarkTurn(turnIdx, label) {
    const id = ClairDOM.getConversationId();
    if (!id) return;
    this._bookmarks = await ClairStorage.addBookmark(id, { turnIdx, label });
    ClairDOM.toast(`★ Bookmarked: ${label}`);
    if (this._mode === 'rail') this._renderDots();
    else this._renderList();
  },

  async removeBookmark(turnIdx) {
    const id = ClairDOM.getConversationId();
    if (!id) return;
    this._bookmarks = await ClairStorage.removeBookmark(id, turnIdx);
    ClairDOM.toast('Bookmark removed');
    if (this._mode === 'rail') this._renderDots();
    else this._renderList();
  },

  _findCurrentTurn() {
    // Find the human message closest to viewport center
    const msgEls = this._findMessageElements();
    const humanEls = [];
    for (const el of msgEls) {
      if (this._isHumanMessage(el)) humanEls.push(el);
    }
    if (!humanEls.length) return -1;

    const viewportCenter = window.innerHeight / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    humanEls.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const center = (rect.top + rect.bottom) / 2;
      const dist = Math.abs(center - viewportCenter);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    return bestIdx;
  },

  _jumpToTurn(i) {
    if (i < 0 || i >= this._humanMsgs.length) return;
    this._idx = i;

    if (this._rail) {
      const dots = this._rail.querySelectorAll('.clair-dot');
      dots?.forEach((el, j) => el.classList.toggle('clair-dot--active', j === i));
    }
    if (this._list) {
      const items = this._list.querySelectorAll('.clair-navlist__item');
      items?.forEach((el, j) => el.classList.toggle('clair-navlist__item--active', j === i));
    }

    const msgEls = this._findMessageElements();
    let humanIdx = 0;
    for (const el of msgEls) {
      if (this._isHumanMessage(el)) {
        if (humanIdx === i) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.style.transition = 'background 0.3s';
          el.style.background = 'rgba(201,100,66,0.06)';
          setTimeout(() => { el.style.background = ''; }, 1500);
          return;
        }
        humanIdx++;
      }
    }

    // Fallback: scroll by ratio
    const chat = document.querySelector('main .overflow-y-auto, main');
    if (chat) {
      const ratio = i / Math.max(1, this._humanMsgs.length - 1);
      chat.scrollTo({ top: ratio * (chat.scrollHeight - chat.clientHeight), behavior: 'smooth' });
    }
  },

  _findMessageElements() {
    for (const sel of [
      '[data-testid*="message"]',
      '.group\\/conversation-turn',
      '[class*="ConversationTurn"]',
    ]) {
      const els = ClairDOM.qsa(sel);
      if (els.length >= 2) return els;
    }
    const proseEls = ClairDOM.qsa('.prose, [data-testid="message-content"]');
    return proseEls.map(el => el.closest('[data-testid*="message"]') || el.parentElement?.parentElement || el);
  },

  _isHumanMessage(el) {
    if (el.querySelector('button[aria-label*="feedback"], button[aria-label*="Good"], button[aria-label*="Bad"]')) return false;
    return true;
  },

  prev() { if (this._humanMsgs.length) this._jumpToTurn(Math.max(0, this._idx - 1)); },
  next() { if (this._humanMsgs.length) this._jumpToTurn(Math.min(this._humanMsgs.length - 1, this._idx + 1)); },
};
