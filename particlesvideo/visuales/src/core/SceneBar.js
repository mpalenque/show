import { SCENES } from '../scenes/index.js';

// Botonera de escenas sobre la ventana de salida, para probar sin abrir el editor.
// Se muestra por defecto en desarrollo y se apaga con S (o abriendo la salida con ?clean,
// que es lo que hace launch-show.bat: en la LED no va ninguna UI encima).
export class SceneBar {
  constructor(ctx) {
    this.params = ctx.params;
    this.scenes = ctx.scenes;
    this.buttons = new Map();
    this.visible = !new URLSearchParams(location.search).has('clean');
  }

  init() {
    const bar = document.createElement('div');
    bar.id = 'scenebar';
    bar.hidden = !this.visible;

    const title = document.createElement('span');
    title.className = 'sb-title';
    title.textContent = 'Escenas';
    bar.appendChild(title);

    for (const scene of this.scenes.list()) {
      const b = document.createElement('button');
      b.innerHTML = `<b>${scene.id}</b><span>${scene.name ?? ''}</span>`;
      b.title = scene.name ?? scene.id;
      b.onclick = () => this.params.trigger('scene.goto', scene.id);
      bar.appendChild(b);
      this.buttons.set(scene.id, b);
    }

    const hint = document.createElement('span');
    hint.className = 'sb-hint';
    hint.textContent = 'S oculta · P vista 1:1 · , . cambia · Espacio dispara · F fps · E editor';
    bar.appendChild(hint);

    document.body.appendChild(bar);
    this.el = bar;

    this.scenes.onSceneChange((id) => this._highlight(id));
    this._highlight(this.scenes.current);
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  _highlight(id) {
    for (const [sceneId, b] of this.buttons) b.classList.toggle('active', sceneId === id);
  }
}
