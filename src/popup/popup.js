document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isClaude = tab?.url?.includes('claude.ai');
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');

  if (isClaude) { dot.classList.add('active'); text.textContent = 'Active on Claude.ai'; }
  else { dot.classList.add('inactive'); text.textContent = 'Open claude.ai to use Clair'; }

  // Plan selector
  const result = await chrome.storage.local.get('clair_settings');
  const settings = result.clair_settings || {};
  const currentPlan = settings.plan || 'pro';

  const planBtns = document.querySelectorAll('.plan-opt');
  const highlightPlan = (plan) => {
    planBtns.forEach(b => b.classList.toggle('plan-opt--active', b.dataset.plan === plan));
  };
  highlightPlan(currentPlan);

  planBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const plan = btn.dataset.plan;
      highlightPlan(plan);
      const r = await chrome.storage.local.get('clair_settings');
      await chrome.storage.local.set({ clair_settings: { ...(r.clair_settings || {}), plan } });
      if (isClaude && tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'planChanged', plan }).catch(() => {});
      }
    });
  });

  // Action buttons
  const send = (action) => {
    if (!isClaude || !tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { action }).catch(() => {});
    window.close();
  };

  document.getElementById('btn-export-md').addEventListener('click', () => send('exportMarkdown'));
  document.getElementById('btn-export-json').addEventListener('click', () => send('exportJSON'));
  document.getElementById('btn-export-txt').addEventListener('click', () => send('exportText'));
  document.getElementById('btn-compress').addEventListener('click', () => send('compressAndCopy'));
  document.getElementById('link-options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

  // Disable if not on Claude
  if (!isClaude) {
    document.querySelectorAll('.action, .compress-btn').forEach(b => {
      b.disabled = true; b.style.opacity = '0.4'; b.style.cursor = 'not-allowed';
    });
  }
});
