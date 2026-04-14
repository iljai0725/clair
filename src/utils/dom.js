const ClairDOM = {
  qs(sel, ctx = document) { return ctx.querySelector(sel); },
  qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; },

  create(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k === 'innerHTML') el.innerHTML = v;
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else if (c instanceof Node) el.appendChild(c);
    }
    return el;
  },

  injectStyle(css, id) {
    const existing = id ? document.getElementById(id) : null;
    if (existing) { existing.textContent = css; return existing; }
    const s = document.createElement('style');
    if (id) s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
    return s;
  },

  debounce(fn, delay = 300) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); };
  },

  toast(message, duration = 3000) {
    document.getElementById('clair-toast')?.remove();
    const t = this.create('div', { id: 'clair-toast', class: 'clair-toast' }, [message]);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('clair-toast--show'));
    setTimeout(() => { t.classList.remove('clair-toast--show'); setTimeout(() => t.remove(), 300); }, duration);
  },

  isConversationPage() {
    return /\/chat\/[a-f0-9-]+/.test(window.location.pathname);
  },

  getConversationId() {
    const m = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return m ? m[1] : null;
  },

  /**
   * Smart enquiry summarizer.
   *
   * Goal: turn "Hey Claude, I was wondering if you could help me fix
   * the scrollbar overflow bug in my chrome extension please" into
   * "Fix scrollbar overflow bug" — so users can actually scan a long
   * conversation and find a specific past question.
   *
   * Strategy (no LLM, all heuristic, fast):
   *   1. Strip code blocks, URLs, file paths, quoted lines (>)
   *   2. Strip greetings and conversational hedges
   *   3. Find the first intent verb (fix/explain/write/...)
   *   4. Keep the verb + the next ~5 content words
   *   5. Capitalize, trim to maxLen
   *   6. Fallback: clean truncation if no verb found
   */
  summarizePrompt(text, maxLen = CLAIR.NAV.maxSummaryLength) {
    if (!text) return '(empty)';

    // 1. Strip noise
    let clean = text
      .replace(/```[\s\S]*?```/g, ' ')             // fenced code
      .replace(/`[^`]+`/g, ' ')                    // inline code
      .replace(/^>.*$/gm, ' ')                     // quoted lines
      .replace(/https?:\/\/\S+/g, ' ')             // urls
      .replace(/[\/\\][\w\-./\\]+\.\w{2,5}/g, ' ') // file paths
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return '(empty)';

    // 2. Strip greetings + hedges (case-insensitive, longest first)
    const lower = clean.toLowerCase();
    const S = CLAIR.SUMMARIZER;
    const allStrips = [...S.greetings, ...S.hedges].sort((a, b) => b.length - a.length);

    let workingLower = lower;
    let working = clean;
    for (const phrase of allStrips) {
      // Match at start, after punctuation, or surrounded by word boundaries
      const re = new RegExp(`(^|[\\s,.!?;:]+)${this._escapeRe(phrase)}(?=[\\s,.!?;:]|$)`, 'gi');
      working = working.replace(re, ' ');
      workingLower = working.toLowerCase();
    }
    working = working.replace(/^[\s,.!?;:]+/, '').replace(/\s+/g, ' ').trim();

    if (!working) {
      // Everything got stripped — fall back to truncating the original
      return this._truncate(clean, maxLen);
    }

    // 3. Drop standalone "i" / "me" / "us" tokens — pure noise in labels
    const filtered = working.split(/\s+/).filter(w => {
      const wl = w.toLowerCase().replace(/[^a-z']/g, '');
      return wl && !['i', 'me', 'us', 'my', 'mine'].includes(wl);
    });
    if (!filtered.length) return this._truncate(clean, maxLen);

    // 4. Find first intent verb. If it's "help"/"tell"/"give", look ahead
    //    for a better action verb in the next few words.
    const words = filtered;
    const wordsLower = words.map(w => w.toLowerCase().replace(/[^a-z']/g, ''));
    const weakVerbs = ['help', 'tell', 'give', 'show'];
    let verbIdx = -1;
    for (let i = 0; i < Math.min(wordsLower.length, 8); i++) {
      if (S.intentVerbs.includes(wordsLower[i])) { verbIdx = i; break; }
    }
    // Upgrade weak verbs: scan next 4 words for a stronger verb
    if (verbIdx >= 0 && weakVerbs.includes(wordsLower[verbIdx])) {
      for (let j = verbIdx + 1; j < Math.min(verbIdx + 5, wordsLower.length); j++) {
        if (S.intentVerbs.includes(wordsLower[j]) && !weakVerbs.includes(wordsLower[j])) {
          verbIdx = j; break;
        }
      }
    }

    let result;
    if (verbIdx >= 0) {
      const slice = words.slice(verbIdx, verbIdx + 7);
      slice[0] = slice[0].charAt(0).toUpperCase() + slice[0].slice(1).toLowerCase();
      result = slice.join(' ');
    } else {
      const slice = words.slice(0, 7);
      if (slice[0]) slice[0] = slice[0].charAt(0).toUpperCase() + slice[0].slice(1);
      result = slice.join(' ');
    }

    // 5. Trim trailing punctuation AND trailing prepositions/articles
    const trailingTrash = /(\s+(for|to|with|of|on|at|in|by|the|a|an|and|or|but|that|this))+[\s,.!?;:]*$/i;
    result = result.replace(/[,.!?;:]+$/, '').replace(trailingTrash, '').trim();
    return this._truncate(result, maxLen);
  },

  _escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  _truncate(s, maxLen) {
    if (s.length <= maxLen) return s;
    const cut = s.substring(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > maxLen * 0.5 ? cut.substring(0, lastSpace) : cut) + '…';
  },
};
