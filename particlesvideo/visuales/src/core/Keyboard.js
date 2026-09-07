// Atajos de desarrollo en la ventana de salida (§7.4). No hay UI sobre la LED.
export class Keyboard {
  constructor(ctx, { onToggleFps, onToggleSceneBar, onToggleNativeView } = {}) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.scenes = ctx.scenes;
    this.onToggleFps = onToggleFps;
    this.onToggleSceneBar = onToggleSceneBar;
    this.onToggleNativeView = onToggleNativeView;
  }

  init() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const sceneIds = this.scenes.list().map((s) => s.id);

      switch (e.key) {
        case 'e': case 'E': window.open('/editor.html', 'vis-editor'); break;
        case 'f': case 'F': this.onToggleFps?.(); break;
        case 's': case 'S': this.onToggleSceneBar?.(); break;
        case 'p': case 'P': this.onToggleNativeView?.(); break;   // 1:1, para juzgar nitidez
        case ',': this.params.trigger('scene.prev'); break;
        case '.': this.params.trigger('scene.next'); break;
        case ' ': {
          const main = this.scenes.mainAction;
          if (main) {
            const [id, arg] = Array.isArray(main) ? main : [main, undefined];
            this.params.trigger(id, arg);
          }
          e.preventDefault();
          break;
        }
        case 'l': case 'L': this._maybe('line.flip'); break;
        case 'r': case 'R': this._maybe('ray.spawn', 'random'); break;
        case 'g': case 'G': this._maybe('grid.toggleAll'); break;
        case 'w': case 'W': this._maybe('warning.pulse'); break;
        case 'b': case 'B':
          if (this.params.has('box.visible')) {
            this.params.set('box.visible', this.params.target('box.visible') > 0.5 ? 0 : 1);
          }
          break;
        default:
          if (e.key >= '1' && e.key <= '9') {
            const id = sceneIds[Number(e.key) - 1];
            if (id) this.params.trigger('scene.goto', id);
          }
      }
    });
  }

  // Las acciones aparecen recién en fases posteriores; ignorar mientras no existan.
  _maybe(actionId, arg) {
    if (this.params.hasAction(actionId)) this.params.trigger(actionId, arg);
  }
}
