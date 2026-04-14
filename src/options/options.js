/**
 * Clair v0.5.0 — Options page logic
 *
 * Externalised to satisfy MV3's no-inline-script CSP and to keep the
 * permission-request handlers simple.
 *
 * Custom domains flow:
 *   1. User types "https://example.com/*" and clicks Add
 *   2. We validate the pattern locally
 *   3. chrome.permissions.request({origins:[pattern]}) — must run inside
 *      a user-gesture handler, hence the direct click listener
 *   4. On grant, we ask the background worker to syncDynamicScripts(),
 *      which re-registers a single dynamic content script matching all
 *      currently-granted origins
 *   5. Re-render the list
 */

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

const flash = () => {
  const s = document.getElementById('saved');
  s.classList.add('show');
  setTimeout(() => s.classList.remove('show'), 1500);
};

const save = async (partial) => {
  const r = await chrome.storage.local.get('clair_settings');
  await chrome.storage.local.set({ clair_settings: { ...(r.clair_settings || {}), ...partial } });
  flash();
};

// ─── Plan + layout (existing) ───────────────────────────
(async () => {
  const r = await chrome.storage.local.get('clair_settings');
  const s = r.clair_settings || {};

  const planEl = document.getElementById('plan');
  planEl.value = s.plan || 'pro';
  planEl.addEventListener('change', (e) => save({ plan: e.target.value }));

  const cw = document.getElementById('chatWidth');
  cw.value = s.chatWidth || 70;
  document.getElementById('chatWidthVal').textContent = cw.value + '%';
  cw.addEventListener('input', (e) => {
    document.getElementById('chatWidthVal').textContent = e.target.value + '%';
  });
  cw.addEventListener('change', (e) => save({ chatWidth: parseInt(e.target.value) }));

  const sh = document.getElementById('showHealth');
  sh.checked = s.showHealthMonitor !== false;
  sh.addEventListener('change', (e) => save({ showHealthMonitor: e.target.checked }));

  const sn = document.getElementById('showNav');
  sn.checked = s.showNavigator !== false;
  sn.addEventListener('change', (e) => save({ showNavigator: e.target.checked }));

  // Initial render of custom domains
  await renderDomainList();
})();

// ─── Data buttons ───────────────────────────────────────
document.getElementById('exportSettings').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'clair-settings.json';
  a.click();
});

document.getElementById('clearUsage').addEventListener('click', async () => {
  if (confirm('Clear daily usage history? This does not affect the live session window.')) {
    await chrome.storage.local.remove('clair_usage_history');
    flash();
  }
});

document.getElementById('clearSession').addEventListener('click', async () => {
  if (confirm('Clear the rolling 5h session log? This will reset the session % counter to 0.')) {
    await chrome.storage.local.remove('clair_session_log');
    flash();
  }
});

document.getElementById('resetAll').addEventListener('click', async () => {
  if (confirm('Reset all settings AND clear all data? This cannot be undone.')) {
    await chrome.storage.local.clear();
    location.reload();
  }
});

// ─── Custom domains ─────────────────────────────────────

/**
 * Validate a match pattern. Accepts:
 *   - https://example.com/*
 *   - https://*.example.com/*
 *   - http://localhost:3000/*
 * Rejects: bare domains, missing scheme, missing /*, file://, javascript:, etc.
 *
 * If user types "example.com" we coerce it to "https://example.com/*".
 */
function normalisePattern(input) {
  let s = (input || '').trim();
  if (!s) return null;
  // Reject any non-http scheme up front (file://, ftp://, javascript:, etc.)
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null;
  // Coerce bare domain → https + /*
  if (!/^https?:\/\//i.test(s)) {
    s = 'https://' + s;
  }
  // Ensure ends with /*
  if (!s.endsWith('/*')) {
    if (s.endsWith('/')) s += '*';
    else if (!s.includes('/', 8)) s += '/*'; // no path at all
    else s += '/*';
  }
  // Validate via URL parse on the pattern with * replaced
  try {
    const test = s.replace('*.', 'wildcard.').replace('/*', '/');
    const u = new URL(test);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (!u.hostname || u.hostname.length < 3) return null;
  } catch {
    return null;
  }
  return s;
}

function showError(msg) {
  const el = document.getElementById('domainErr');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

async function renderDomainList() {
  const listEl = document.getElementById('domainList');
  // Always start with the locked claude.ai entry
  listEl.innerHTML = `
    <div class="domain-item">
      <span class="domain-item__url">https://claude.ai/*</span>
      <span class="domain-item__locked">always on · default</span>
    </div>
  `;

  // Ask background for currently-granted custom origins
  let origins = [];
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'getCustomDomains' });
    origins = (resp && resp.origins) || [];
  } catch {}

  if (origins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'domain-empty';
    empty.textContent = 'No custom sites yet. Add one above if you access Claude through a different URL.';
    listEl.appendChild(empty);
    return;
  }

  for (const origin of origins) {
    const row = document.createElement('div');
    row.className = 'domain-item';

    const url = document.createElement('span');
    url.className = 'domain-item__url';
    url.textContent = origin;
    row.appendChild(url);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn--small btn--danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', async () => {
      const ok = await chrome.permissions.remove({ origins: [origin] });
      if (ok) {
        await chrome.runtime.sendMessage({ action: 'syncDynamicScripts' });
        await renderDomainList();
        flash();
      } else {
        showError('Could not remove permission');
      }
    });
    row.appendChild(removeBtn);

    listEl.appendChild(row);
  }
}

// Add-domain handler — MUST be a direct user gesture (click) for
// chrome.permissions.request to be allowed.
document.getElementById('addDomain').addEventListener('click', async () => {
  const input = document.getElementById('domainInput');
  const pattern = normalisePattern(input.value);

  if (!pattern) {
    showError('Invalid URL pattern. Try: https://example.com/*');
    return;
  }
  if (pattern === 'https://claude.ai/*') {
    showError('claude.ai is already enabled by default');
    return;
  }

  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      showError('Permission denied');
      return;
    }
    // Tell background to re-register dynamic content scripts
    await chrome.runtime.sendMessage({ action: 'syncDynamicScripts' });
    input.value = '';
    await renderDomainList();
    flash();
  } catch (e) {
    showError('Failed to request permission: ' + (e?.message || e));
  }
});

// Pressing Enter in the input also adds
document.getElementById('domainInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addDomain').click();
  }
});
