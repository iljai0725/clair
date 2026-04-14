/**
 * Clair — Claude.ai Internal API
 *
 * Confirmed API format (from unofficial-claude-api repos):
 *   GET /api/organizations/{orgId}/chat_conversations/{convId}
 *   Response: { uuid, name, model, chat_messages: [{ uuid, text, sender, index, content?, ... }] }
 *
 * Message fields:
 *   sender: "human" | "assistant"
 *   text: string (primary content field — may be empty for newer assistant responses)
 *   content: array of {type, text} blocks (newer format, same as public API)
 */

const ClairAPI = {
  _orgId: null,
  _cache: new Map(),

  async getOrgId() {
    if (this._orgId) return this._orgId;
    // Method 1: Cookie
    try {
      const m = document.cookie.match(/lastActiveOrg=([0-9a-f-]{36})/i);
      if (m) { this._orgId = m[1]; return this._orgId; }
    } catch {}
    // Method 2: Extract from page URL or links
    try {
      const links = document.querySelectorAll('a[href*="/organizations/"]');
      for (const link of links) {
        const m = link.href.match(/\/organizations\/([0-9a-f-]{36})/);
        if (m) { this._orgId = m[1]; return this._orgId; }
      }
    } catch {}
    // Method 3: Fetch organizations endpoint
    try {
      const r = await fetch('/api/organizations', { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        const orgs = Array.isArray(data) ? data : (data.organizations || []);
        if (orgs[0]) { this._orgId = orgs[0].uuid || orgs[0].id; return this._orgId; }
      }
    } catch (e) { console.warn('[Clair] Org ID fetch failed:', e); }
    return null;
  },

  async getConversation(convId) {
    if (!convId) return null;
    const c = this._cache.get(convId);
    if (c && Date.now() - c.ts < 30000) return c.data;

    const orgId = await this.getOrgId();
    if (!orgId) { console.warn('[Clair] No org ID'); return null; }

    try {
      const r = await fetch(`/api/organizations/${orgId}/chat_conversations/${convId}`, { credentials: 'include' });
      if (!r.ok) { console.warn(`[Clair] API ${r.status}`); return null; }
      const data = await r.json();

      // Debug: log structure once per page load
      if (!this._loggedOnce) {
        this._loggedOnce = true;
        const msgs = data.chat_messages || [];
        console.log('[Clair] ═══ API RESPONSE ═══');
        console.log('[Clair] Top keys:', Object.keys(data));
        console.log('[Clair] Messages count:', msgs.length);
        if (msgs[0]) {
          console.log('[Clair] msg[0] keys:', Object.keys(msgs[0]));
          console.log('[Clair] msg[0] sender:', msgs[0].sender, '| text length:', (msgs[0].text || '').length);
          if (msgs[0].content) console.log('[Clair] msg[0] content type:', typeof msgs[0].content, Array.isArray(msgs[0].content) ? `(array of ${msgs[0].content.length})` : '');
        }
        if (msgs[1]) {
          console.log('[Clair] msg[1] keys:', Object.keys(msgs[1]));
          console.log('[Clair] msg[1] sender:', msgs[1].sender, '| text length:', (msgs[1].text || '').length);
          if (msgs[1].content) console.log('[Clair] msg[1] content type:', typeof msgs[1].content, Array.isArray(msgs[1].content) ? `(array of ${msgs[1].content.length})` : '');
        }
        console.log('[Clair] ═══ END DEBUG ═══');
      }

      this._cache.set(convId, { data, ts: Date.now() });
      return data;
    } catch (e) { console.warn('[Clair] Fetch failed:', e); return null; }
  },

  /**
   * Extract ordered messages. Handles tree structure (branching) by following current branch.
   */
  extractMessages(data) {
    if (!data) return [];
    const msgs = data.chat_messages || data.messages || [];
    if (!msgs.length) return [];

    // Check if tree structure exists
    const hasTree = msgs.some(m => m.parent_message_uuid != null);
    const ordered = hasTree ? this._walkTree(msgs) : msgs;

    const result = [];
    for (const msg of ordered) {
      const role = this._role(msg);
      if (role === 'system') continue;
      const content = this._content(msg);
      if (!content) continue;
      result.push({
        role,
        content,
        timestamp: msg.created_at || null,
        uuid: msg.uuid || null,
        index: msg.index ?? null,
      });
    }
    return result;
  },

  _role(msg) {
    const s = (msg.sender || msg.role || '').toLowerCase();
    if (s === 'human' || s === 'user') return 'human';
    if (s === 'assistant') return 'assistant';
    return 'system';
  },

  /**
   * Extract text content from a message. Handles both old and new formats.
   */
  _content(msg) {
    // 1. Direct text field (confirmed primary field)
    if (typeof msg.text === 'string' && msg.text.length > 0) return msg.text;

    // 2. Content as array of blocks (newer Claude format)
    if (Array.isArray(msg.content)) {
      const parts = [];
      for (const block of msg.content) {
        if (!block) continue;
        if (block.type === 'text' && block.text) parts.push(block.text);
        else if (block.type === 'tool_use') parts.push(`[Tool: ${block.name || 'unknown'}]`);
        else if (block.type === 'tool_result') {
          const txt = typeof block.content === 'string' ? block.content :
            Array.isArray(block.content) ? block.content.filter(c => c.type === 'text').map(c => c.text).join('\n') : '';
          if (txt) parts.push(txt);
        }
        else if (typeof block.text === 'string') parts.push(block.text);
        else if (typeof block === 'string') parts.push(block);
      }
      if (parts.length > 0) return parts.join('\n');
    }

    // 3. Content as string
    if (typeof msg.content === 'string' && msg.content.length > 0) return msg.content;

    // 4. Other possible fields
    for (const field of ['body', 'message', 'completion']) {
      if (typeof msg[field] === 'string' && msg[field].length > 0) return msg[field];
    }

    return '';
  },

  _walkTree(msgs) {
    const byParent = new Map();
    for (const m of msgs) {
      const pid = m.parent_message_uuid || null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(m);
    }
    const result = [];
    const walk = (pid) => {
      const children = byParent.get(pid);
      if (!children?.length) return;
      const child = children[children.length - 1]; // current branch = last child
      result.push(child);
      walk(child.uuid);
    };
    walk(null);
    // Fallback if tree walk found too few
    if (result.length < msgs.length * 0.3) return msgs;
    return result;
  },

  getTitle(data) { return data?.name || data?.title || 'Untitled'; },
  getModel(data) { return data?.model || 'unknown'; },

  /**
   * Estimate tokens from messages. Uses ~3.8 chars/token ratio
   * plus overhead for system prompts, formatting, and metadata.
   */
  estimateTokens(messages) {
    let chars = 0;
    for (const m of messages) chars += (m.content || '').length;
    return Math.ceil(chars / 3.8) + messages.length * 200 + 2000;
  },

  /**
   * Detect mission complexity from conversation content.
   * Returns: 'light' | 'moderate' | 'heavy' | 'extreme'
   */
  detectComplexity(messages) {
    if (!messages.length) return 'light';

    const signals = CLAIR.MISSION_COMPLEXITY.heavySignals;
    let heavyCount = 0;
    let totalHumanLength = 0;
    let totalAssistantLength = 0;
    let longMessages = 0; // messages > 2000 chars

    for (const msg of messages) {
      const len = (msg.content || '').length;
      if (msg.role === 'human') {
        totalHumanLength += len;
        const lower = msg.content.toLowerCase();
        for (const sig of signals) {
          if (lower.includes(sig)) { heavyCount++; break; }
        }
      } else {
        totalAssistantLength += len;
      }
      if (len > 2000) longMessages++;
    }

    const avgAssistant = totalAssistantLength / Math.max(1, messages.filter(m => m.role === 'assistant').length);

    // Extreme: many heavy signals + very long assistant responses
    if (heavyCount >= 3 && avgAssistant > 3000) return 'extreme';
    // Heavy: multiple signals or very long responses
    if (heavyCount >= 2 || avgAssistant > 2500 || longMessages >= messages.length * 0.5) return 'heavy';
    // Moderate: some signals or moderately long
    if (heavyCount >= 1 || avgAssistant > 1000) return 'moderate';
    return 'light';
  },

  /**
   * Estimate effective limit cost of this conversation.
   * Heavy conversations consume limits faster because each message
   * triggers more processing, tool calls, and longer outputs.
   */
  estimateLimitCost(messages) {
    const complexity = this.detectComplexity(messages);
    const mc = CLAIR.MISSION_COMPLEXITY;
    const multiplier = complexity === 'extreme' ? mc.extremeMultiplier :
                       complexity === 'heavy' ? mc.heavyMultiplier :
                       complexity === 'moderate' ? mc.moderateMultiplier :
                       mc.lightMultiplier;

    const msgCount = messages.length;
    // Each turn = 1 human + 1 assistant = roughly 1 "message" against limits
    const turns = Math.ceil(msgCount / 2);
    return { complexity, multiplier, turns, effectiveCost: Math.round(turns * multiplier) };
  },

  clearCache() { this._cache.clear(); this._loggedOnce = false; },
};
