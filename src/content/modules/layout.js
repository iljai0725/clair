const ClairLayout = {
  _width: 70,
  async init() {
    const s = await ClairStorage.getSettings();
    this._width = s.chatWidth || 70;
    this._apply(this._width);
    console.log('[Clair] Layout ready');
  },
  _apply(pct) {
    ClairDOM.injectStyle(
      `main .mx-auto, main [class*="max-w-"] { max-width: ${pct}% !important; }
       main footer .mx-auto { max-width: ${pct}% !important; }`,
      'clair-layout-css'
    );
    this._width = pct;
  },
  setWidth(pct) { this._apply(pct); ClairStorage.updateSettings({ chatWidth: pct }); },
  getWidth() { return this._width; },
};
