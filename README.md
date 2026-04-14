# Clair ✦

**See Claude clearly.** The missing power-up for Claude AI.

Clair is a free, open-source Chrome extension that enhances your [claude.ai](https://claude.ai) experience with conversation health tracking, smart context compression, multi-format export, a scrollbar navigator, layout controls, and more.

---

## Why Clair?

Claude is the best AI assistant out there — but its web interface hasn't kept up. Users lose conversations, hit usage limits without warning, waste screen space, and struggle to continue work across sessions. Clair fixes all of that.

**The name:** Claude is French. *Clair* is French for "clear" and "bright." Where Claude sometimes feels cloudy, Clair brings clarity.

---

## Features

### Conversation Health Monitor

A smart health pill at the bottom-right shows the real-time burden of your conversation on Claude's context window.

- **Token estimation** — Counts all messages via Claude's internal API
- **Mission complexity detection** — Detects heavy tasks (debugging, refactoring, rewrites) that consume 4-8× more limit budget per message
- **Effective limit cost** — Shows how much of your plan's window this conversation has consumed
- **Plan-aware advice** — Select your plan (Pro / Max 5× / Max 20×) for calibrated guidance
- **Input cost preview** — See how many tokens your next prompt will cost as you type
- **Model switching tips** — Suggests when to switch models based on task + context weight

### Conversation Navigator

A vertical scrollbar rail on the right edge showing each prompt as a summarized label. Inspired by Gemini Voyager, but improved:

- **Summarized prompts** — Long prompts are truncated to ~40 chars (Voyager shows full-length)
- **Numbered turns** with click-to-jump
- **Hover to expand** — Collapsed by default, expands to show labels on hover
- **Alt+J/K** keyboard navigation

### Smart Compress & Continue

Press Alt+C to generate a compressed context summary optimized for your target model (Opus, Sonnet, Haiku, or balanced). Paste into a new chat and continue seamlessly.

### Multi-Format Export

Export any conversation as Markdown, JSON, or plain text via Claude's internal API.

### Layout Controls & Keyboard Shortcuts

Adjustable chat width (40-95%). Shortcuts: Alt+E (export), Alt+C (compress), Alt+S (sidebar), Alt+J/K (navigate), Alt+N (new chat).

---

## Install

1. Download or clone this repo
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `clair/` folder
5. Navigate to [claude.ai](https://claude.ai) — Clair activates automatically

---

## How It Works

### API-First Architecture

Clair uses Claude's internal API (`/api/organizations/{orgId}/chat_conversations/{convId}`) instead of fragile DOM scraping. This returns structured JSON with all messages, roles, and metadata.

### Mission Complexity Detection

Analyzes conversation content to estimate limit cost: Light (1×), Moderate (2×), Heavy (4×), Extreme (8×). Heavy missions drain limits faster because Claude uses more reasoning and produces longer outputs.

---

## Privacy

- All data stays in your browser (`chrome.storage.local`)
- No external servers, no data collection, no analytics
- 100% open source

---

## Architecture

```
clair/
├── manifest.json
├── src/
│   ├── utils/         — constants, storage, DOM helpers, Claude API wrapper
│   ├── content/       — API interceptor, injector, page-script, main entry
│   │   └── modules/   — layout, exporter, compressor, health-monitor, navigator, shortcuts
│   ├── popup/         — Extension popup UI
│   ├── options/       — Settings page
│   ├── styles/        — Injected CSS (Claude.ai design language)
│   └── background/    — Service worker
├── icons/
└── _locales/
```

**Design decisions:** Vanilla JS (zero deps), API-first data, Claude.ai design language (warm cream, terracotta #C96442), feature flags per module, plan-aware UX.

---

## Acknowledgments

Inspired by [Gemini Voyager](https://github.com/Nagi-ovo/gemini-voyager). Built for the Claude community. Not affiliated with Anthropic.

Maintained by [@iljai0725](https://github.com/iljai0725).

## License

[MIT](LICENSE)
