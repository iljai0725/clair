/**
 * Clair v0.5.0 — Smart Health Monitor
 *
 * REWRITTEN to delegate session math to ClairSession (cross-conversation,
 * 5h rolling, calibrated). This module is now responsible for:
 *
 *   1. PILL UI — bottom-right summary: real session % + context tokens
 *   2. PANEL — expanded view with breakdown, advice, model split, reset clock
 *   3. Per-conversation context health (200K window pressure)
 *   4. Pre-flight cost preview as you type
 *   5. Banner detection → fires LIMIT_BANNER event for ClairSession to calibrate
 *   6. Plan-tiered presentation:
 *      - Pro:    loud, frequent, aggressive Opus→Sonnet coaching
 *      - Max5x:  moderate, helpful but not nagging
 *      - Max20x: quiet — pill collapses to a small unobtrusive count
 */
const ClairHealthMonitor = {
  _container: null,
  _interval: null,

  // Per-conversation context state
  _tokens: 0,
  _msgCount: 0,
  _model: 'unknown',
  _isExtended: false,
  _complexity: 'light',

  // Plan + UI state
  _plan: 'pro',
  _panelOpen: false,
  _inputTokens: 0,
  _limitHit: false,
  _limitResetTime: null,
  _bannerEmittedAt: 0,

  // Latest snapshot from ClairSession
  _session: null,

  async init() {
    const s = await ClairStorage.getSettings();
    if (s.showHealthMonitor === false) return;
    this._plan = s.plan || 'pro';
    this._createUI();
    this._listen();
    this._watchInput();
    this._watchLimitBanner();

    this._interval = setInterval(() => this._check(), 20000);
    setTimeout(() => this._check(), 2000);

    window.addEventListener('clair:page-change', () => {
      ClairAPI.clearCache();
      this._panelOpen = false;
      this._togglePanel(false);
      setTimeout(() => this._check(), 1500);
    });

    window.addEventListener(CLAIR.EVENTS.SETTINGS_CHANGED, (e) => {
      if (e.detail?.plan) {
        this._plan = e.detail.plan;
        this._render();
      }
    });

    // Listen for session updates from ClairSession (real cross-conversation)
    window.addEventListener(CLAIR.EVENTS.SESSION_UPDATED, (e) => {
      this._session = e.detail;
      this._render();
    });

    console.log('[Clair] Health monitor ready · plan=' + this._plan);
  },

  _createUI() {
    this._container = ClairInjector.getContainer('health');
    if (!this._container) return;
    this._container.innerHTML = `
      <div class="clair-health" id="clair-hm" style="display:none">
        <div class="clair-health__pill" id="clair-hm-pill">
          <div class="clair-health__dot" id="clair-hm-dot"></div>
          <span class="clair-health__primary" id="clair-hm-primary">0%</span>
          <span class="clair-health__sep">·</span>
          <span class="clair-health__secondary" id="clair-hm-secondary">0 msgs</span>
          <span class="clair-health__label" id="clair-hm-label"></span>
        </div>
        <div class="clair-health__panel" id="clair-hm-panel" style="display:none">

          <!-- Limit banner alert -->
          <div class="clair-hp__alert" id="clair-hp-alert" style="display:none"></div>

          <!-- ── SESSION SECTION (the big one) ── -->
          <div class="clair-hp__section clair-hp__section--session">
            <div class="clair-hp__section-head">
              <span class="clair-hp__section-title">Session window</span>
              <span class="clair-hp__section-meta" id="clair-hp-window-meta">5h rolling</span>
            </div>
            <div class="clair-hp__bar-wrap">
              <div class="clair-hp__bar" id="clair-hp-session-bar"></div>
            </div>
            <div class="clair-hp__bar-labels">
              <span id="clair-hp-session-pct">0%</span>
              <span id="clair-hp-session-cap">0 / 0 msgs</span>
            </div>
            <div class="clair-hp__row" id="clair-hp-burn-row" style="display:none">
              <span class="clair-hp__dim">Burn rate</span>
              <span class="clair-hp__val" id="clair-hp-burn">—</span>
            </div>
            <div class="clair-hp__row" id="clair-hp-reset-row" style="display:none">
              <span class="clair-hp__dim">Next credit in</span>
              <span class="clair-hp__val" id="clair-hp-reset">—</span>
            </div>
            <div class="clair-hp__row" id="clair-hp-mix-row" style="display:none">
              <span class="clair-hp__dim">Model mix</span>
              <span class="clair-hp__val" id="clair-hp-mix">—</span>
            </div>
          </div>

          <!-- ── CONTEXT SECTION ── -->
          <div class="clair-hp__section">
            <div class="clair-hp__section-head">
              <span class="clair-hp__section-title">This conversation</span>
              <span class="clair-hp__section-meta" id="clair-hp-context-meta">—</span>
            </div>
            <div class="clair-hp__bar-wrap">
              <div class="clair-hp__bar" id="clair-hp-ctx-bar"></div>
            </div>
            <div class="clair-hp__bar-labels">
              <span id="clair-hp-ctx-pct">0%</span>
              <span>of 200K context</span>
            </div>
            <div class="clair-hp__row">
              <span class="clair-hp__dim">Tokens</span>
              <span class="clair-hp__val" id="clair-hp-tokens-detail">—</span>
            </div>
            <div class="clair-hp__row">
              <span class="clair-hp__dim">Task load</span>
              <span class="clair-hp__val" id="clair-hp-complexity">—</span>
            </div>
          </div>

          <!-- ── PRE-FLIGHT (next prompt) ── -->
          <div class="clair-hp__section clair-hp__section--preflight" id="clair-hp-preflight" style="display:none">
            <div class="clair-hp__section-head">
              <span class="clair-hp__section-title">Next prompt cost</span>
            </div>
            <div class="clair-hp__preflight-body" id="clair-hp-preflight-body">—</div>
          </div>

          <!-- Advice + actions -->
          <div class="clair-hp__advice" id="clair-hp-advice"></div>
          <div class="clair-hp__actions">
            <button class="clair-btn clair-btn--accent clair-btn--sm" id="clair-hp-compress" style="display:none">Compress &amp; continue</button>
          </div>
        </div>
      </div>`;

    this._container.querySelector('#clair-hm-pill')?.addEventListener('click', () => {
      this._panelOpen = !this._panelOpen;
      this._togglePanel(this._panelOpen);
      if (this._panelOpen) this._render();
    });
    this._container.querySelector('#clair-hp-compress')?.addEventListener('click', () => {
      ClairCompressor?.compressAndCopy();
    });
    document.addEventListener('click', (e) => {
      if (this._panelOpen && !this._container.contains(e.target)) {
        this._panelOpen = false;
        this._togglePanel(false);
      }
    });
  },

  _togglePanel(show) {
    const panel = this._container?.querySelector('#clair-hm-panel');
    if (panel) panel.style.display = show ? 'block' : 'none';
  },

  // ── DOM detection ────────────────────────────────────
  _detectModelFromDOM() {
    const allText = document.body.innerText || '';
    const bottomText = allText.slice(-500).toLowerCase();
    if (/opus/.test(bottomText)) {
      this._model = 'opus';
      this._isExtended = /extended/.test(bottomText);
    } else if (/sonnet/.test(bottomText)) {
      this._model = 'sonnet';
      this._isExtended = /extended/.test(bottomText);
    } else if (/haiku/.test(bottomText)) {
      this._model = 'haiku';
      this._isExtended = false;
    }
  },

  _watchLimitBanner() {
    const check = () => {
      const bodyText = document.body.innerText || '';
      const limitMatch = bodyText.match(/you'?ve hit your.{0,40}limit/i);

      if (limitMatch) {
        if (!this._limitHit) {
          // Newly detected — fire calibration event for ClairSession
          this._limitHit = true;
          window.dispatchEvent(new CustomEvent(CLAIR.EVENTS.LIMIT_BANNER, {
            detail: { ts: Date.now() }
          }));
        }
        const resetMatch = bodyText.match(/resets?\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (resetMatch) this._limitResetTime = resetMatch[1];
      } else {
        this._limitHit = false;
        this._limitResetTime = null;
      }
    };
    setInterval(check, 5000);
    setTimeout(check, 3000);
  },

  _watchInput() {
    const poll = () => {
      const input = document.querySelector('[contenteditable="true"], textarea[placeholder]');
      if (input) {
        const text = input.innerText || input.value || '';
        const newTokens = Math.ceil(text.length / 3.8);
        if (newTokens !== this._inputTokens) {
          this._inputTokens = newTokens;
          if (this._panelOpen) this._renderPreflight();
        }
      }
      requestAnimationFrame(poll);
    };
    setTimeout(poll, 3000);
  },

  _listen() {
    window.addEventListener(CLAIR.EVENTS.MESSAGE_RECEIVED, (e) => {
      const u = e.detail || {};
      // Update local model state for UI
      const m = (u.model || '').toLowerCase();
      if (m.includes('opus'))   this._model = 'opus';
      else if (m.includes('sonnet')) this._model = 'sonnet';
      else if (m.includes('haiku'))  this._model = 'haiku';
      ClairStorage.recordUsage(u?.inputTokens || 150, u?.outputTokens || 800);
      // ClairSession handles its own logging via the same event
      setTimeout(() => this._check(), 1000);
    });
  },

  // ── Per-conversation check ───────────────────────────
  async _check() {
    if (!ClairDOM.isConversationPage()) {
      // Still show pill on non-chat pages so users see session % everywhere
      this._renderPillOnly();
      return;
    }
    const id = ClairDOM.getConversationId();
    if (!id) { this._renderPillOnly(); return; }

    this._detectModelFromDOM();

    try {
      const data = await ClairAPI.getConversation(id);
      if (data) {
        const msgs = ClairAPI.extractMessages(data);
        this._msgCount = msgs.length;
        this._tokens = ClairAPI.estimateTokens(msgs);
        this._complexity = ClairAPI.detectComplexity(msgs);

        const m = ClairAPI.getModel(data);
        if (m && m !== 'unknown') {
          if (m.includes('opus'))   this._model = 'opus';
          else if (m.includes('sonnet')) this._model = 'sonnet';
          else if (m.includes('haiku'))  this._model = 'haiku';
        }
      }
    } catch {}

    // Pull latest session stats
    if (typeof ClairSession !== 'undefined') {
      this._session = await ClairSession.getStatsAsync();
    }

    this._render();
  },

  // ── Rendering ────────────────────────────────────────

  /**
   * Render only the pill (used on non-chat pages and as part of full render).
   */
  _renderPillOnly() {
    const el = this._container?.querySelector('#clair-hm');
    if (!el) return;

    // Always show the pill if we have session data
    const s = this._session;
    if (!s || s.msgCount === 0) {
      // Hide if no session activity AND no current conversation
      if (this._msgCount < 2) {
        el.style.display = 'none';
        return;
      }
    }

    el.style.display = 'block';
    this._updatePill();
  },

  _render() {
    if (!this._session && typeof ClairSession !== 'undefined') {
      // Try to get session synchronously
      this._session = ClairSession.getStats();
    }
    this._renderPillOnly();
    if (this._panelOpen) {
      this._renderPanel();
      this._renderPreflight();
    }
  },

  _updatePill() {
    const el = this._container?.querySelector('#clair-hm');
    if (!el) return;
    const s = this._session;
    const plan = CLAIR.PLANS[this._plan] || CLAIR.PLANS.pro;

    // The PRIMARY number on the pill is now session %, not tokens.
    // This is the entire point of v0.5.0.
    const primaryEl = el.querySelector('#clair-hm-primary');
    const secondaryEl = el.querySelector('#clair-hm-secondary');
    const dotEl = el.querySelector('#clair-hm-dot');
    const labelEl = el.querySelector('#clair-hm-label');

    if (s && s.msgCount > 0) {
      // Primary: session % used
      if (primaryEl) primaryEl.textContent = `${s.pct}%`;
      // Secondary: msg count
      if (secondaryEl) secondaryEl.textContent = `${s.msgCount} msg${s.msgCount === 1 ? '' : 's'}`;
    } else {
      // No session activity yet — show context tokens as primary
      if (primaryEl) primaryEl.textContent = this._fmtTokens(this._tokens);
      if (secondaryEl) secondaryEl.textContent = `${this._msgCount} msg${this._msgCount === 1 ? '' : 's'}`;
    }

    // Color coding (plan-aware thresholds)
    let dotColor = '#2D8A56';
    let labelText = '';
    let labelColor = '';

    if (this._limitHit) {
      dotColor = '#C93B3B';
      labelText = this._limitResetTime ? `until ${this._limitResetTime}` : 'limit hit';
      labelColor = '#C93B3B';
    } else if (s) {
      if (s.level === 'critical') {
        dotColor = '#C93B3B'; labelText = 'critical'; labelColor = '#C93B3B';
      } else if (s.level === 'alarm') {
        dotColor = '#D97306'; labelText = 'high'; labelColor = '#D97306';
      } else if (s.level === 'warn') {
        dotColor = '#C4841D';
        // Quiet for relaxed plans
        if (plan.tone !== 'relaxed') labelText = 'pacing';
        labelColor = '#C4841D';
      }
    }

    if (dotEl) dotEl.style.background = dotColor;
    if (labelEl) {
      labelEl.textContent = labelText;
      labelEl.style.color = labelColor;
    }
  },

  _renderPanel() {
    const s = this._session;
    const plan = CLAIR.PLANS[this._plan] || CLAIR.PLANS.pro;
    const q = (sel) => this._container?.querySelector(sel);

    // Limit banner alert
    const alertEl = q('#clair-hp-alert');
    if (alertEl) {
      if (this._limitHit) {
        alertEl.style.display = 'block';
        alertEl.innerHTML = `<span class="clair-hp__alert-icon">⚠</span> Limit reached${this._limitResetTime ? ` · Resets at ${this._limitResetTime}` : ''}`;
      } else {
        alertEl.style.display = 'none';
      }
    }

    // ── SESSION ──
    if (s) {
      const sessionPct = Math.min(s.pct, 100);
      const sessionBar = q('#clair-hp-session-bar');
      if (sessionBar) {
        sessionBar.style.width = sessionPct + '%';
        sessionBar.style.background = this._levelColor(s.level);
      }
      const pctEl = q('#clair-hp-session-pct');
      if (pctEl) pctEl.textContent = `${s.pct}% used`;
      const capEl = q('#clair-hp-session-cap');
      if (capEl) capEl.textContent = `${Math.round(s.totalWeight)} / ${plan.msgPer5h} units`;

      // Burn rate
      const burnRow = q('#clair-hp-burn-row');
      const burnEl = q('#clair-hp-burn');
      if (s.burnPerHour > 0.5) {
        burnRow.style.display = 'flex';
        const proj = s.minutesToExhaust != null && s.minutesToExhaust < 300
          ? ` · empty in ~${this._fmtMins(s.minutesToExhaust)}`
          : '';
        burnEl.textContent = `${s.burnPerHour.toFixed(1)} units/h${proj}`;
      } else {
        burnRow.style.display = 'none';
      }

      // Reset
      const resetRow = q('#clair-hp-reset-row');
      const resetEl = q('#clair-hp-reset');
      if (s.earliestResetMins != null) {
        resetRow.style.display = 'flex';
        resetEl.textContent = this._fmtMins(s.earliestResetMins);
      } else {
        resetRow.style.display = 'none';
      }

      // Model mix
      const mixRow = q('#clair-hp-mix-row');
      const mixEl = q('#clair-hp-mix');
      if (s.msgCount > 0) {
        mixRow.style.display = 'flex';
        const parts = [];
        if (s.byModelMsgs.opus)   parts.push(`${s.byModelMsgs.opus} Opus`);
        if (s.byModelMsgs.sonnet) parts.push(`${s.byModelMsgs.sonnet} Sonnet`);
        if (s.byModelMsgs.haiku)  parts.push(`${s.byModelMsgs.haiku} Haiku`);
        mixEl.textContent = parts.join(' · ') || '—';
      } else {
        mixRow.style.display = 'none';
      }

      // Window meta — show plan name
      const metaEl = q('#clair-hp-window-meta');
      if (metaEl) metaEl.textContent = `${plan.name} · 5h rolling`;
    }

    // ── CONTEXT ──
    const ctxLevel = this._getContextLevel();
    const ctxColor = CLAIR.HEALTH[ctxLevel]?.color || '#2D8A56';
    const ctxPct = Math.min(Math.round((this._tokens / 200000) * 100), 100);

    const ctxBar = q('#clair-hp-ctx-bar');
    if (ctxBar) { ctxBar.style.width = ctxPct + '%'; ctxBar.style.background = ctxColor; }
    const ctxPctEl = q('#clair-hp-ctx-pct');
    if (ctxPctEl) ctxPctEl.textContent = `${ctxPct}%`;

    const ctxMetaEl = q('#clair-hp-context-meta');
    if (ctxMetaEl) {
      const mInfo = CLAIR.MODELS[this._model];
      const name = mInfo ? mInfo.name : this._model;
      const ext = this._isExtended ? ' Extended' : '';
      ctxMetaEl.textContent = `${name}${ext} · ${this._msgCount} msgs`;
    }

    const tokDetail = q('#clair-hp-tokens-detail');
    if (tokDetail) tokDetail.textContent = `~${this._tokens.toLocaleString()}`;

    const complexEl = q('#clair-hp-complexity');
    if (complexEl) {
      const labels = { light: 'Light', moderate: 'Moderate', heavy: 'Heavy', extreme: 'Intensive' };
      const colors = { light: '#2D8A56', moderate: '#6B6560', heavy: '#C4841D', extreme: '#C93B3B' };
      complexEl.textContent = labels[this._complexity] || '—';
      complexEl.style.color = colors[this._complexity] || '';
    }

    // ── ADVICE ──
    const adviceEl = q('#clair-hp-advice');
    if (adviceEl && typeof ClairSession !== 'undefined') {
      const advice = ClairSession.generateAdvice();
      adviceEl.innerHTML = '';
      if (advice.text) {
        const adviceText = ClairDOM.create('div', { class: `clair-hp__advice-text clair-hp__advice-text--${advice.urgency}` });
        adviceText.innerHTML = advice.text.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
        adviceEl.appendChild(adviceText);
      }

      // Layer in context-based advice if it's worse than session-based
      if (ctxLevel === 'critical' || ctxLevel === 'strain') {
        const ctxAdvice = ClairDOM.create('div', { class: 'clair-hp__advice-text clair-hp__advice-text--alarm' });
        ctxAdvice.innerHTML = ctxLevel === 'critical'
          ? '🔴 Context near 200K — compress immediately or quality will degrade.'
          : '🔶 Context under strain — earlier details may soften.';
        adviceEl.appendChild(ctxAdvice);
      }

      const compressBtn = q('#clair-hp-compress');
      if (compressBtn) {
        const showCompress = advice.showCompress || ctxLevel === 'critical' || ctxLevel === 'strain';
        compressBtn.style.display = showCompress ? 'inline-flex' : 'none';
      }
    }
  },

  _renderPreflight() {
    const wrap = this._container?.querySelector('#clair-hp-preflight');
    const body = this._container?.querySelector('#clair-hp-preflight-body');
    if (!wrap || !body) return;

    if (this._inputTokens < 10 || typeof ClairSession === 'undefined') {
      wrap.style.display = 'none';
      return;
    }

    const est = ClairSession.estimatePromptCost(this._inputTokens, this._model, this._isExtended);
    if (!est) { wrap.style.display = 'none'; return; }

    wrap.style.display = 'block';
    const modelInfo = CLAIR.MODELS[est.model] || CLAIR.MODELS.sonnet;
    const modelName = modelInfo.name + (this._isExtended ? ' Extended' : '');

    let html = `<div class="clair-hp__pf-row">
      <span class="clair-hp__dim">${this._fmtTokens(this._inputTokens)} tokens on <b>${modelName}</b></span>
      <span class="clair-hp__val">~${est.pctOfTotal}% of window</span>
    </div>`;

    if (est.suggestSonnet) {
      const savings = Math.round((1 - 1/modelInfo.weight) * 100);
      html += `<div class="clair-hp__pf-tip">💡 Sonnet would cost ~${savings}% less for this prompt</div>`;
    }
    body.innerHTML = html;
  },

  // ── Helpers ──────────────────────────────────────────
  _getContextLevel() {
    const H = CLAIR.HEALTH;
    if (this._tokens < H.light.max)    return 'light';
    if (this._tokens < H.moderate.max) return 'moderate';
    if (this._tokens < H.heavy.max)    return 'heavy';
    if (this._tokens < H.strain.max)   return 'strain';
    return 'critical';
  },

  _levelColor(level) {
    return ({
      ok: '#2D8A56', warn: '#C4841D', alarm: '#D97306', critical: '#C93B3B',
    })[level] || '#2D8A56';
  },

  _fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return Math.round(n / 1000) + 'K';
    return String(n);
  },

  _fmtMins(m) {
    if (m == null) return '?';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  },

  getHealthData() {
    return {
      tokens: this._tokens, messageCount: this._msgCount, model: this._model,
      isExtended: this._isExtended, level: this._getContextLevel(), plan: this._plan,
      complexity: this._complexity, session: this._session,
      limitHit: this._limitHit, limitResetTime: this._limitResetTime,
    };
  },

  destroy() { if (this._interval) clearInterval(this._interval); },
};
