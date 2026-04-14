# Contributing to Clair

Thanks for your interest! Here's how to get started:

1. Fork & clone the repo
2. Load as unpacked extension (see README)
3. Make changes — reload extension at chrome://extensions
4. Submit a PR

## Key architecture notes

- `src/utils/claude-api.js` — Wrapper for Claude.ai internal API. All data comes through here.
- `src/utils/constants.js` — All configuration, thresholds, and feature flags.
- `src/content/modules/` — Each feature is a self-contained module with an `init()` method.
- `src/styles/inject.css` — All injected CSS. Uses CSS custom properties for theming.

## Adding a new module

1. Create `src/content/modules/yourmodule.js`
2. Define `const ClairYourModule = { async init() { ... } }`
3. Add to `manifest.json` content_scripts
4. Add to `main.js` module list
5. Add feature flag in `constants.js`
