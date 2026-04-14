/**
 * Clair v0.5.0 — Constants
 *
 * NEW in v0.5.0:
 * - Cross-conversation 5h session tracking (sessionLog storage key)
 * - Per-conversation bookmarks
 * - Per-user calibration multiplier (self-correcting weight)
 * - Plan-tiered alert thresholds and tone (Pro is loud, Max20x is quiet)
 * - Refined model weights including Extended Thinking variants
 */
const CLAIR = {
  VERSION: '0.5.0',
  FEATURES: {
    layout: true, exporter: true, compressor: true,
    navigator: true, shortcuts: true, healthMonitor: true,
    sessionTracker: true, bookmarks: true,
  },
  DEFAULTS: {
    chatWidth: 70,
    showHealthMonitor: true,
    showNavigator: true,
    navigatorMode: 'rail',          // 'rail' | 'list'
    exportFormat: 'markdown',
    plan: 'pro',
    showPreflight: true,
    autoCompressOnLimitNear: false,
    shortcuts: {
      toggleSidebar: 'Alt+S',
      exportChat:    'Alt+E',
      compressChat:  'Alt+C',
      newChat:       'Alt+N',
      prevMessage:   'Alt+K',
      nextMessage:   'Alt+J',
      bookmark:      'Alt+B',
      toggleNavList: 'Alt+L',
    },
  },

  STORAGE_KEYS: {
    settings:     'clair_settings',
    usageHistory: 'clair_usage_history',
    sessionLog:   'clair_session_log',   // rolling 5h log of {ts, model, weight, ...}
    bookmarks:    'clair_bookmarks',     // { [convId]: [{turnIdx, label, ts}] }
    calibration:  'clair_calibration',   // { multiplier, samples, lastBannerAt }
  },

  EVENTS: {
    API_REQUEST:      'clair:api-request',
    API_RESPONSE:     'clair:api-response',
    MESSAGE_SENT:     'clair:message-sent',
    MESSAGE_RECEIVED: 'clair:message-received',
    SESSION_UPDATED:  'clair:session-updated',
    SETTINGS_CHANGED: 'clair:settings-changed',
    LIMIT_BANNER:     'clair:limit-banner',
  },

  // Anthropic-stated baselines (Sonnet-equivalent messages per 5h window).
  // Tone drives messaging volume/aggressiveness in advice.
  PLANS: {
    pro:    { name: 'Pro',     msgPer5h: 45,  tone: 'cautious', warnPct: 50, alarmPct: 75, criticalPct: 90 },
    max5x:  { name: 'Max 5×',  msgPer5h: 225, tone: 'moderate', warnPct: 60, alarmPct: 80, criticalPct: 92 },
    max20x: { name: 'Max 20×', msgPer5h: 900, tone: 'relaxed',  warnPct: 75, alarmPct: 90, criticalPct: 95 },
  },

  // Community-observed cost ratios. Extended Thinking ~ 2× the base.
  // Calibration self-corrects against the real banner.
  MODELS: {
    opus:   { name: 'Opus',   window: 200000, weight: 5,   weightExt: 10,  strength: 'Deep reasoning, planning' },
    sonnet: { name: 'Sonnet', window: 200000, weight: 1,   weightExt: 2,   strength: 'Balanced reasoning + execution' },
    haiku:  { name: 'Haiku',  window: 200000, weight: 0.3, weightExt: 0.6, strength: 'Quick tasks, formatting' },
  },

  HEALTH: {
    light:    { max: 30000,  label: 'Light',         color: '#2D8A56' },
    moderate: { max: 60000,  label: 'Moderate',      color: '#2D8A56' },
    heavy:    { max: 100000, label: 'Getting heavy', color: '#C4841D' },
    strain:   { max: 140000, label: 'Under strain',  color: '#D97306' },
    critical: { max: 200000, label: 'Critical',      color: '#C93B3B' },
  },

  MISSION_COMPLEXITY: {
    heavySignals: [
      'debug', 'fix', 'refactor', 'rewrite', 'rebuild', 'redesign',
      'full code', 'complete implementation', 'from scratch', 'entire',
      'optimize', 'migrate', 'convert', 'analyze', 'review all',
      'step by step', 'think carefully', 'use 100', 'maximum effort',
      'extended thinking', 'deep analysis', 'comprehensive',
    ],
    planningSignals: [
      'should i', 'tradeoff', 'trade-off', 'compare', 'pros and cons',
      'architecture', 'design', 'strategy', 'approach', 'options',
      'which is better', 'recommend', 'advise', 'plan',
    ],
    executionSignals: [
      'fix this', 'change', 'rename', 'move', 'add', 'remove',
      'format', 'translate', 'convert', 'extract', 'list', 'paste',
      'apply', 'run', 'test it',
    ],
    lightMultiplier: 1, moderateMultiplier: 2, heavyMultiplier: 4, extremeMultiplier: 8,
  },

  SESSION: {
    windowMs: 5 * 60 * 60 * 1000,  // 5 hours rolling
    maxLogEntries: 500,
    pollMs: 15000,
  },

  NAV: {
    maxSummaryLength: 48,
    listMaxHeight: 0.7,
  },

  // Phrases stripped when generating navigator labels
  SUMMARIZER: {
    greetings: [
      'hey claude', 'hi claude', 'hello claude', 'hey there',
      'good morning', 'good afternoon', 'good evening',
      'thanks claude', 'thank you claude', 'thanks', 'thank you',
    ],
    hedges: [
      "i was wondering", "i wonder", "i'm wondering",
      "could you please", "can you please", "would you please",
      "could you", "can you", "would you", "will you",
      "i think maybe", "i think", "i believe", "i feel like", "i guess",
      "if you don't mind", "if possible", "if you can",
      "i need you to", "i want you to", "i'd like you to",
      "let me", "let's",
      "actually", "basically", "honestly", "literally",
    ],
    intentVerbs: [
      'fix', 'debug', 'explain', 'write', 'create', 'build', 'make',
      'compare', 'analyze', 'review', 'summarize', 'translate',
      'refactor', 'rewrite', 'optimize', 'design', 'plan',
      'add', 'remove', 'change', 'update', 'rename', 'convert',
      'find', 'search', 'show', 'list', 'count', 'check',
      'help', 'tell', 'teach', 'draft', 'continue', 'extract',
      'generate', 'produce', 'give', 'suggest', 'recommend',
    ],
  },
};
Object.freeze(CLAIR);
