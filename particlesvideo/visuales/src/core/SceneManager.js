// Las escenas son datos: un preset de params + acciones a disparar al entrar.
// Todo lo que hace el manager es escribir en Params.
export class SceneManager {
  constructor(ctx, scenes, base) {
    this.ctx = ctx;
    this.params = ctx.params;
    this.scenes = scenes;
    this.base = base;
    this.byId = new Map(scenes.map((s) => [s.id, s]));
    this.current = null;
    this._listeners = [];
  }

  // Params que son PROPIEDAD de las escenas: los lista alguna escena o el BASE. `goto` los
  // reescribe en cada cambio de escena, así que su `default` es el valor al que caen las
  // escenas que NO los listan — y por eso nadie más puede pisarlo. Settings lo usa para no
  // guardar como default algo que en realidad es estado del show.
  static ownedParams(scenes, base) {
    const ids = new Set(Object.keys(base));
    for (const scene of scenes) for (const id of Object.keys(scene.params ?? {})) ids.add(id);
    return ids;
  }

  static defineParams(params, scenes) {
    const ids = scenes.map((s) => s.id);
    params.define({
      id: 'scene.current', type: 'enum', options: ids, default: ids[0],
      label: 'Escena actual', group: 'scene', sceneReset: false,
    });
    params.defineAction({ id: 'scene.goto', label: 'Ir a escena', group: 'scene', argHint: 'id de escena' });
    params.defineAction({ id: 'scene.next', label: 'Escena siguiente', group: 'scene' });
    params.defineAction({ id: 'scene.prev', label: 'Escena anterior', group: 'scene' });
  }

  init() {
    this.params.onAction('scene.goto', (arg) => this.goto(String(arg)));
    this.params.onAction('scene.next', () => this.step(+1));
    this.params.onAction('scene.prev', () => this.step(-1));
  }

  onSceneChange(fn) { this._listeners.push(fn); }

  step(delta) {
    const i = this.scenes.findIndex((s) => s.id === this.current);
    const next = this.scenes[(i + delta + this.scenes.length) % this.scenes.length];
    this.goto(next.id);
  }

  // `force` re-entra a la escena aunque ya sea la actual. Nadie lo usa en el show; está para
  // poder pedir un re-disparo a mano desde la consola (`vis.scenes.goto('10', {force:true})`).
  goto(id, { transition, force = false, radianceReady = false, parte2Ready = false, parte2Manual = false } = {}) {
    const scene = this.byId.get(id);
    if (!scene) { console.error(`[vis] escena desconocida: ${id}`); return; }
    if (this.ctx.parte2?.requestScene(id, { transition, force, parte2Ready, parte2Manual })) return;
    if (this.ctx.radiance?.requestScene(id, { transition, force, radianceReady })) return;

    // UNA NOTA DE LA ESCENA EN CURSO NO LA REINICIA (pedido de Manuel: *"si llega una
    // nota para controlar la escena, hasta que no cambie de escena tiene que seguir en esa
    // escena y no volver a triggerearla, porque quizás llegan varias notas de la escena juntas,
    // pero es por seguridad"*).
    //
    // Sin esto, una nota repetida es un CORTE VISIBLE y no un no-op: `goto` vuelve a disparar las
    // `actions` de entrada, y varias de ellas reubican la masa entera (`particles.resetInBox` en
    // la 10, `fillColumn` en la 12). O sea que un doble disparo en Ableton —o una nota sostenida
    // que se retriggerea— borraría de golpe el estado del fluido en mitad de la escena.
    //
    // Va acá y no en el Mapper a propósito: así vale para TODO lo que pueda pedir una escena
    // (MIDI, OSC, la barra de escenas, el teclado), no solo para las notas.
    if (id === this.current && !force) {
      // Excepción explícita por escena: la 7 vuelve a desplegar sólo el piso. No vuelve
      // a aplicar presets ni acciones de entrada, ni reinicia las grillas o los motores.
      scene.onRetrigger?.(this.ctx);
      return;
    }

    const prev = this.byId.get(this.current);
    if (prev?.onExit) prev.onExit(this.ctx);

    const secs = transition ?? scene.transition ?? 0;
    const wanted = scene.params ?? {};
    // `transitions` (opcional, por escena): tiempo propio para algunos params. Existe porque no
    // todo tiene que entrar al mismo ritmo — el cambio de color de las partículas tiene que ser
    // un corte aunque el resto de la escena entre en un fundido de un segundo y medio.
    // Se aplica también a los params que la escena NO lista y que vuelven a su default.
    const propios = scene.transitions ?? {};

    for (const def of this.params.defs.values()) {
      const listed = Object.prototype.hasOwnProperty.call(wanted, def.id);
      // Los params sceneReset:false (cámara, master, estado vivo) solo cambian si la escena los lista.
      if (!listed && !def.sceneReset) continue;
      const value = listed ? wanted[def.id] : (this.base[def.id] ?? def.default);
      if (def.type === 'bool' || def.type === 'enum') this.params.set(def.id, value);
      else this.params.tween(def.id, value, propios[def.id] ?? secs);
    }

    this.current = id;
    this.params.set('scene.current', id);

    for (const a of scene.actions ?? []) {
      const [actionId, arg] = Array.isArray(a) ? a : [a, undefined];
      this.params.trigger(actionId, arg);
    }
    if (scene.onEnter) scene.onEnter(this.ctx);

    for (const fn of this._listeners) fn(id);
    console.info(`[vis] escena ${id} (${scene.name ?? ''}) transición ${secs}s`);
  }

  update(dt) {
    const scene = this.byId.get(this.current);
    if (scene?.update) scene.update(this.ctx, dt);
  }

  get mainAction() {
    return this.byId.get(this.current)?.mainAction ?? null;
  }

  list() {
    return this.scenes.map((s) => ({ id: s.id, name: s.name ?? '' }));
  }
}
