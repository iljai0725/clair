/**
 * Clair v0.5.0 — Session Tracker
 *
 * THE thing that makes Clair worth installing.
 *
 * Tracks every message you send across EVERY conversation on claude.ai
 * inside a rolling 5-hour window. Lives in chrome.storage.local so it
 * survives tab closes, reloads, and conversation switches.
 *
 * Architecture:
 *   - Listens to MESSAGE_RECEIVED events from api-interceptor (page-script
 *     intercepts every fetch to /completion and posts back model + usage)
 *   - Each message → one log entry: {ts, convId, model, isExtended, weight}
 *   - On every read, filters to entries within windowMs and computes:
 *       totalWeight    — Sonnet-equivalent units consumed
 *       pct            — totalWeight / planCap × 100  (× calibration)
 *       msgCount       — raw message count
 *       byModel        — per-model breakdown
 *       projectedExhaust — when we hit 100% at current burn rate
 *       earliestReset  — when the oldest window entry ages out
 *   - Self-corrects via calibration: when Claude's red banner fires, we
 *     compare our estimated pct to 100% and update a multiplier
 */
const ClairSession = {
  _stats: null,
  _interval: null,
  _plan: 'pro',
  _calibration: { multiplier: 1.0, samples: 0 },
  _lastBannerHandledAt: 0,

  async init() {
    const s = await ClairStorage.getSettings();
    this._plan = s.plan || 'pro';
    this._calibration = await ClairStorage.getCalibration();

    // Listen for completed messages from page-script interceptor
    window.addEventListener(CLAIR.EVENTS.MESSAGE_RECEIVED, (e) => this._onMessage(e.detail || {}));

    // Listen for the red limit banner — calibration + warning event
    window.addEventListener(CLAIR.EVENTS.LIMIT_BANNER, (e) => this._onLimitBanner(e.detail || {}));

    // Listen for plan changes
    window.addEventListener(CLAIR.EVENTS.SETTINGS_CHANGED, (e) => {
      if (e.detail?.plan) this._plan = e.detail.plan;
      this._recompute();
    });

    // Periodic refresh (so the timer-driven UI updates even with no new msgs)
    this._interval = setInterval(() => this._recompute(), CLAIR.SESSION.pollMs);

    // Initial compute
    await this._recompute();
    console.log('[Clair] Session tracker ready · plan=' + this._plan);
  },

  async _onMessage(detail) {
    const model = this._normalizeModel(detail.model);
    const isExtended = !!detail.isExtended; // currently we don't get this from API directly
    const modelInfo = CLAIR.MODELS[model] || CLAIR.MODELS.sonnet;
    const weight = isExtended ? modelInfo.weightExt : modelInfo.weight;

    await ClairStorage.appendSessionEntry({
      ts: Date.now(),
      convId: ClairDOM.getConversationId(),
      model,
      isExtended,
      weight,
      inputTokens: detail.inputTokens || 0,
      outputTokens: detail.outputTokens || 0,
      complexity: detail.complexity || 'light',
    });

    await this._recompute();
  },

  _normalizeModel(m) {
    if (!m) return 'sonnet';
    const s = m.toLowerCase();
    if (s.includes('opus'))   return 'opus';
    if (s.includes('haiku'))  return 'haiku';
    if (s.includes('sonnet')) return 'sonnet';
    return 'sonnet';
  },

  /**
   * Recompute rolling-window stats and emit SESSION_UPDATED.
   * Called on: new message, plan change, periodic tick, manual refresh.
   */
  async _recompute() {
    const log = await ClairStorage.getSessionLog();
    const now = Date.now();
    const cutoff = now - CLAIR.SESSION.windowMs;
    const inWindow = log.filter(e => e.ts >= cutoff);

    const plan = CLAIR.PLANS[this._plan] || CLAIR.PLANS.pro;

    // Aggregate
    let totalWeight = 0;
    let msgCount = inWindow.length;
    const byModel = { opus: 0, sonnet: 0, haiku: 0, unknown: 0 };
    const byModelMsgs = { opus: 0, sonnet: 0, haiku: 0, unknown: 0 };
    let extendedCount = 0;

    for (const e of inWindow) {
      totalWeight += e.weight;
      const k = byModel[e.model] !== undefined ? e.model : 'unknown';
      byModel[k] += e.weight;
      byModelMsgs[k] += 1;
      if (e.isExtended) extendedCount += 1;
    }

    // Apply calibration
    const calMult = this._calibration?.multiplier || 1.0;
    const calibratedWeight = totalWeight * calMult;
    const pct = Math.round((calibratedWeight / plan.msgPer5h) * 100);

    // Burn rate over the LAST hour (not the full window) for projection
    const oneHourAgo = now - 60 * 60 * 1000;
    const recent = inWindow.filter(e => e.ts >= oneHourAgo);
    const recentWeight = recent.reduce((s, e) => s + e.weight, 0) * calMult;
    const burnPerHour = recentWeight; // Sonnet-equivalent units / hour

    // Projection: how many minutes until we hit 100%?
    const remainingBudget = Math.max(0, plan.msgPer5h - calibratedWeight);
    const minutesToExhaust = burnPerHour > 0
      ? Math.round((remainingBudget / burnPerHour) * 60)
      : null;

    // Reset clock: when does the oldest entry in window age out?
    let earliestResetAt = null;
    let earliestResetMins = null;
    if (inWindow.length > 0) {
      const earliest = inWindow.reduce((min, e) => e.ts < min.ts ? e : min);
      earliestResetAt = earliest.ts + CLAIR.SESSION.windowMs;
      earliestResetMins = Math.max(0, Math.round((earliestResetAt - now) / 60000));
    }

    // Dominant model + recent dominant model
    const dominantModel = ['opus', 'sonnet', 'haiku']
      .filter(m => byModelMsgs[m] > 0)
      .sort((a, b) => byModel[b] - byModel[a])[0] || null;
    const recentByModel = { opus: 0, sonnet: 0, haiku: 0 };
    for (const e of recent) {
      if (recentByModel[e.model] !== undefined) recentByModel[e.model] += 1;
    }
    const recentDominantModel = ['opus', 'sonnet', 'haiku']
      .filter(m => recentByModel[m] > 0)
      .sort((a, b) => recentByModel[b] - recentByModel[a])[0] || null;

    // Severity level (plan-aware)
    let level = 'ok';
    if (pct >= plan.criticalPct) level = 'critical';
    else if (pct >= plan.alarmPct) level = 'alarm';
    else if (pct >= plan.warnPct) level = 'warn';

    this._stats = {
      now,
      plan: this._plan,
      planCap: plan.msgPer5h,
      msgCount,
      totalWeight: calibratedWeight,
      rawWeight: totalWeight,
      pct: Math.min(pct, 999),
      level,
      byModel,
      byModelMsgs,
      extendedCount,
      burnPerHour,
      minutesToExhaust,
      earliestResetAt,
      earliestResetMins,
      dominantModel,
      recentDominantModel,
      calibrationMult: calMult,
      windowEntries: inWindow.length,
    };

    window.dispatchEvent(new CustomEvent(CLAIR.EVENTS.SESSION_UPDATED, { detail: this._stats }));
    return this._stats;
  },

  /**
   * Calibration: when the real Claude limit banner fires, our estimated
   * pct at that moment SHOULD equal 100. If it's lower, we're underestimating
   * and need to bump the multiplier up. Throttled to once per 30 min so a
   * persistent banner doesn't repeatedly skew us.
   */
  async _onLimitBanner(detail) {
    const now = Date.now();
    if (now - this._lastBannerHandledAt < 30 * 60 * 1000) return;
    this._lastBannerHandledAt = now;

    if (!this._stats) await this._recompute();
    const observedPct = this._stats?.pct || 0;

    // Only calibrate if we have a meaningful baseline
    if (observedPct >= 20 && observedPct <= 200) {
      const updated = await ClairStorage.updateCalibration(observedPct);
      if (updated) {
        this._calibration = updated;
        console.log(`[Clair] Calibration updated: ${updated.multiplier.toFixed(2)}× (sample ${updated.samples})`);
        await this._recompute();
      }
    }
  },

  /**
   * Generate plan-aware advice based on current session state.
   * The TONE differs per plan:
   *   - Pro:    cautious, frequent nudges, aggressive Opus→Sonnet coaching
   *   - Max5x:  moderate, only nudge on heavy patterns
   *   - Max20x: relaxed, almost no nagging — focus on quality features
   */
  generateAdvice(opts = {}) {
    if (!this._stats) return { text: '', urgency: 'none', showCompress: false };
    const s = this._stats;
    const plan = CLAIR.PLANS[s.plan] || CLAIR.PLANS.pro;
    const tone = plan.tone;

    const recentOpus = (s.recentDominantModel === 'opus');
    const heavyOpusUse = recentOpus && (s.byModelMsgs.opus >= 3);

    let text = '';
    let urgency = 'none';
    let showCompress = false;

    // CRITICAL — about to hit the wall
    if (s.level === 'critical') {
      urgency = 'critical';
      const reset = s.earliestResetMins != null ? `· first credit frees in ${this._fmtMins(s.earliestResetMins)}` : '';
      text = `🔴 ${s.pct}% of your ${plan.name} 5h window used ${reset}.\n\n`;
      if (recentOpus) {
        text += `You're running Opus${s.extendedCount > 0 ? ' Extended' : ''} — that's the heaviest mode. Switch to Sonnet immediately or finish your current task and stop until reset.`;
      } else {
        text += `Wrap up gracefully — finish the current turn, then take a break.`;
      }
      showCompress = true;

    // ALARM — running hot
    } else if (s.level === 'alarm') {
      urgency = 'alarm';
      const proj = s.minutesToExhaust != null && s.minutesToExhaust < 120
        ? ` At your current pace you'll hit the limit in ~${this._fmtMins(s.minutesToExhaust)}.`
        : '';
      text = `⚡ ${s.pct}% used.${proj}\n\n`;
      if (recentOpus) {
        const ratio = s.extendedCount > 0 ? 10 : 5;
        text += `Recent messages are mostly Opus${s.extendedCount > 0 ? ' Extended' : ''} (~${ratio}× a Sonnet message). Switch to Sonnet for execution work — coding, edits, formatting — to stretch your remaining budget.`;
      } else if (tone === 'cautious') {
        text += `Pace yourself for the rest of the window.`;
      } else {
        text += `You have headroom but consider Sonnet for routine work.`;
      }
      showCompress = tone === 'cautious';

    // WARN — getting attention
    } else if (s.level === 'warn') {
      urgency = 'warn';
      text = `${s.pct}% of ${plan.name} window used (${s.msgCount} msgs across ${this._countConvs()} chats). `;
      if (heavyOpusUse && tone !== 'relaxed') {
        text += `\n\n💡 You've sent ${s.byModelMsgs.opus} Opus message${s.byModelMsgs.opus === 1 ? '' : 's'} this window. If you're now in execution mode (small edits, quick questions), Sonnet will save you ~5× the budget per message.`;
      } else if (tone === 'cautious') {
        text += `Steady pace — you have plenty of room left.`;
      }

    // OK — quiet feedback
    } else {
      urgency = 'ok';
      if (s.msgCount === 0) {
        text = `Fresh window · ${plan.msgPer5h} Sonnet-equivalent messages available over 5h.`;
      } else if (tone === 'relaxed') {
        // Max 20x — keep it dead quiet
        text = `${s.pct}% used · ${s.msgCount} msgs in window`;
      } else {
        text = `${s.pct}% used · ${s.msgCount} msgs across ${this._countConvs()} chat${this._countConvs() === 1 ? '' : 's'} this window.`;
        if (recentOpus && s.byModelMsgs.opus >= 5 && tone === 'cautious') {
          text += `\n\n💡 Tip: try Opus to plan, Sonnet to execute. Same outcome, ~5× cheaper.`;
        }
      }
    }

    // Calibration disclosure (subtle, only if it's notably off baseline)
    if (Math.abs((s.calibrationMult || 1) - 1) > 0.15 && s.calibrationMult) {
      text += `\n\n✦ Calibrated to your account: ${s.calibrationMult.toFixed(2)}×`;
    }

    return { text, urgency, showCompress };
  },

  /**
   * Pre-flight cost preview: "if you send this prompt right now on
   * <model>, it will cost ~X% of your remaining budget".
   * Returns null if not enough info.
   */
  estimatePromptCost(promptTokens, model, isExtended) {
    if (!this._stats) return null;
    const m = this._normalizeModel(model);
    const modelInfo = CLAIR.MODELS[m] || CLAIR.MODELS.sonnet;
    const weight = isExtended ? modelInfo.weightExt : modelInfo.weight;

    // A "message" weight is roughly 1 Sonnet-equivalent unit, but heavy
    // prompts (lots of input tokens) push up output and tool use, so we
    // scale by input token count above a baseline.
    const tokenScale = Math.max(1, promptTokens / 1500); // 1500 tok ≈ baseline message
    const effectiveWeight = weight * tokenScale * (this._calibration?.multiplier || 1.0);

    const plan = CLAIR.PLANS[this._stats.plan] || CLAIR.PLANS.pro;
    const remaining = Math.max(0.1, plan.msgPer5h - this._stats.totalWeight);
    const pctOfRemaining = Math.round((effectiveWeight / remaining) * 100);
    const pctOfTotal = Math.round((effectiveWeight / plan.msgPer5h) * 100);

    return {
      model: m,
      weight: effectiveWeight,
      pctOfRemaining,
      pctOfTotal,
      sonnetEquivalent: effectiveWeight,
      // suggestion: if Opus and >5% of remaining, suggest Sonnet
      suggestSonnet: m === 'opus' && pctOfRemaining > 5,
    };
  },

  getStats() { return this._stats; },

  _countConvs() {
    if (!this._stats) return 0;
    // We don't store the full inWindow array on stats — count via a fresh read
    // would be async. Use a synchronous approximation from byModelMsgs sum.
    // For accurate count we'd need to re-fetch. Caller can use getStatsAsync.
    return this._convCount || 0;
  },

  async getStatsAsync() {
    await this._recompute();
    const log = await ClairStorage.getSessionLog();
    const cutoff = Date.now() - CLAIR.SESSION.windowMs;
    const inWindow = log.filter(e => e.ts >= cutoff);
    this._convCount = new Set(inWindow.map(e => e.convId).filter(Boolean)).size;
    return this._stats;
  },

  _fmtMins(m) {
    if (m == null) return '?';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  },

  destroy() { if (this._interval) clearInterval(this._interval); },
};
