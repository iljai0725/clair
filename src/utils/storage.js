/**
 * Clair v0.5.0 — Storage
 *
 * Adds:
 *   - Rolling 5h session log (cross-conversation)
 *   - Per-conversation bookmarks
 *   - Self-correcting calibration multiplier
 */
const ClairStorage = {
  async get(key, fallback = null) {
    try {
      const r = await chrome.storage.local.get(key);
      return r[key] !== undefined
        ? (fallback && typeof fallback === 'object' && typeof r[key] === 'object' && !Array.isArray(r[key])
          ? { ...fallback, ...r[key] } : r[key])
        : fallback;
    } catch { return fallback; }
  },

  async set(key, value) {
    try { await chrome.storage.local.set({ [key]: value }); return true; }
    catch { return false; }
  },

  async getSettings() {
    return this.get(CLAIR.STORAGE_KEYS.settings, { ...CLAIR.DEFAULTS });
  },

  async updateSettings(partial) {
    const current = await this.getSettings();
    const updated = { ...current, ...partial };
    await this.set(CLAIR.STORAGE_KEYS.settings, updated);
    window.dispatchEvent(new CustomEvent(CLAIR.EVENTS.SETTINGS_CHANGED, { detail: updated }));
    return updated;
  },

  // ── Daily usage history (existing) ───────────────────
  async recordUsage(inputTokens = 0, outputTokens = 0) {
    const today = new Date().toISOString().split('T')[0];
    const history = await this.get(CLAIR.STORAGE_KEYS.usageHistory, {});
    if (!history[today]) history[today] = { messages: 0, inputTokens: 0, outputTokens: 0 };
    history[today].messages += 1;
    history[today].inputTokens += inputTokens;
    history[today].outputTokens += outputTokens;
    const keys = Object.keys(history).sort();
    while (keys.length > 30) delete history[keys.shift()];
    await this.set(CLAIR.STORAGE_KEYS.usageHistory, history);
    return history[today];
  },

  async getUsageToday() {
    const today = new Date().toISOString().split('T')[0];
    const history = await this.get(CLAIR.STORAGE_KEYS.usageHistory, {});
    return history[today] || { messages: 0, inputTokens: 0, outputTokens: 0 };
  },

  // ── Session log (NEW) ────────────────────────────────
  /**
   * Append a single message record to the rolling session log.
   * Auto-prunes anything older than the 5h window + a small grace
   * period, and caps total entries to keep storage tiny.
   */
  async appendSessionEntry(entry) {
    const log = await this.get(CLAIR.STORAGE_KEYS.sessionLog, []);
    const arr = Array.isArray(log) ? log : [];
    arr.push({
      ts: entry.ts || Date.now(),
      convId: entry.convId || null,
      model: entry.model || 'unknown',
      isExtended: !!entry.isExtended,
      weight: typeof entry.weight === 'number' ? entry.weight : 1,
      inputTokens: entry.inputTokens || 0,
      outputTokens: entry.outputTokens || 0,
      complexity: entry.complexity || 'light',
    });
    // Prune: keep last windowMs * 1.2 worth, capped to maxLogEntries
    const cutoff = Date.now() - CLAIR.SESSION.windowMs * 1.2;
    const pruned = arr.filter(e => e.ts >= cutoff);
    while (pruned.length > CLAIR.SESSION.maxLogEntries) pruned.shift();
    await this.set(CLAIR.STORAGE_KEYS.sessionLog, pruned);
    return pruned;
  },

  async getSessionLog() {
    const log = await this.get(CLAIR.STORAGE_KEYS.sessionLog, []);
    return Array.isArray(log) ? log : [];
  },

  async clearSessionLog() {
    await this.set(CLAIR.STORAGE_KEYS.sessionLog, []);
  },

  // ── Bookmarks (NEW) ──────────────────────────────────
  async getBookmarks(convId) {
    const all = await this.get(CLAIR.STORAGE_KEYS.bookmarks, {});
    return (all && all[convId]) || [];
  },

  async addBookmark(convId, bookmark) {
    if (!convId) return [];
    const all = await this.get(CLAIR.STORAGE_KEYS.bookmarks, {});
    const list = (all && all[convId]) || [];
    // Dedupe on turnIdx
    const filtered = list.filter(b => b.turnIdx !== bookmark.turnIdx);
    filtered.push({
      turnIdx: bookmark.turnIdx,
      label: bookmark.label || '',
      ts: Date.now(),
    });
    filtered.sort((a, b) => a.turnIdx - b.turnIdx);
    all[convId] = filtered;
    await this.set(CLAIR.STORAGE_KEYS.bookmarks, all);
    return filtered;
  },

  async removeBookmark(convId, turnIdx) {
    const all = await this.get(CLAIR.STORAGE_KEYS.bookmarks, {});
    if (!all[convId]) return [];
    all[convId] = all[convId].filter(b => b.turnIdx !== turnIdx);
    if (!all[convId].length) delete all[convId];
    await this.set(CLAIR.STORAGE_KEYS.bookmarks, all);
    return all[convId] || [];
  },

  // ── Calibration (NEW) ────────────────────────────────
  /**
   * Stores a self-correcting multiplier. When the real Claude limit
   * banner fires, we compare our estimated session % at that moment
   * against 100% and update the multiplier toward truth.
   */
  async getCalibration() {
    return this.get(CLAIR.STORAGE_KEYS.calibration, {
      multiplier: 1.0,
      samples: 0,
      lastBannerAt: null,
    });
  },

  async updateCalibration(observedPct) {
    if (!observedPct || observedPct < 10) return null;
    const cal = await this.getCalibration();
    // Aim: when banner fires, our pct should equal 100.
    // If observed = 73, we were 27% low → bump multiplier by (100/73).
    const correction = 100 / observedPct;
    // Smooth toward correction with simple weighted average
    const newMult = (cal.multiplier * cal.samples + correction) / (cal.samples + 1);
    const updated = {
      multiplier: Math.max(0.5, Math.min(3.0, newMult)),
      samples: cal.samples + 1,
      lastBannerAt: Date.now(),
    };
    await this.set(CLAIR.STORAGE_KEYS.calibration, updated);
    return updated;
  },
};
