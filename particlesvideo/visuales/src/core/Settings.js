const KEY = 'vis.settings';
const FORMATO = 2;

// Params que son ESTADO vivo, no configuración: guardarlos no tiene sentido y además
// pelearían con quien los maneja (la escena actual, la posición de la línea, el alcance
// del piso que anima `floor.reveal`).
const NO_GUARDAR = new Set(['scene.current', 'line.x', 'floor.revealDist']);

// Ajustes guardados con el formato 1 (una tabla plana id → valor, sin saber contra qué default
// se habían tocado) de estos params. Todos cambiaron de valor de fábrica al recalibrar los
// palitos, y `particles.wrapTop` además cambió de SIGNIFICADO (era un techo absoluto en metros,
// ahora es el margen por encima del borde de pantalla), así que un valor viejo ahí no es un
// gusto de Manuel: es un número que ya no quiere decir lo mismo.
const OBSOLETOS_V1 = new Set([
  'particles.count', 'particles.emissive', 'particles.wrapTop',
  'light.ambient', 'light.fill',
  'ao.amount', 'ao.distance', 'ao.thickness',
]);

// Persiste los ajustes que Manuel hace en el editor, apenas los hace.
//
// Guarda el valor como **default** del param, no solo como valor actual: `SceneManager.goto`
// cae en el default cuando ni la escena ni BASE listan el param, así que pisar el default es
// lo que hace que el ajuste sobreviva al próximo cambio de escena. Si la escena SÍ lista el
// param (por ejemplo `particles.baseColor` en la 12), la escena sigue ganando — que es lo
// correcto: el look de esa escena está definido en `scenes/index.js`.
//
// Solo se registra lo que viene del editor. Lo que cambian las escenas, el MIDI/OSC o la
// propia simulación (por ejemplo `box.yaw` girando con `box.yawSpeed`) no se guarda, si no
// el archivo crecería con estado que cambia 60 veces por segundo.
//
// **Cada ajuste guarda contra qué valor de fábrica se hizo.** Si después el código cambia ese
// valor de fábrica, el ajuste guardado se descarta solo al arrancar. Sin esto, retocar un
// default en el código no tenía ningún efecto en la máquina donde ese param se había tocado
// alguna vez en el editor: el valor viejo le ganaba en silencio y había que acordarse de ir a
// borrar los ajustes a mano. Nadie se acuerda de eso a las tres de la mañana antes de un show.
export class Settings {
  constructor(params, deEscenas = new Set()) {
    this.params = params;
    // Ids que alguna escena (o el BASE) lista. Ver `esDeEscena`.
    this.deEscenas = deEscenas;
    this.overrides = {};
    this._timer = null;
    // Los valores de fábrica ANTES de que `load` empiece a pisarlos con `setDefault`.
    this.fabrica = new Map(params.list().filter((p) => !p.isAction).map((p) => [p.id, p.default]));
  }

  // Un param que alguna escena lista es ESTADO DEL SHOW, no configuración, y guardarlo rompe
  // las escenas: `SceneManager.goto` cae en el `default` para todo lo que la escena no lista,
  // así que pisar ese default hace que el ajuste se cuele en TODAS las demás escenas. Tocabas
  // la atracción del bloque rojo en la 14 y la escena 7 —que solo tiene que mostrar el piso—
  // se quedaba con partículas, el bloque y el atractor colgados, incluso tras recargar.
  // El resto (luces, AO, bloom, piso, cámara: lo que ninguna escena escribe) se sigue guardando.
  esDeEscena(id) { return this.deEscenas.has(id); }

  load() {
    let stored;
    try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}'); }
    catch { console.error('[vis] ajustes guardados ilegibles, se ignoran'); return; }

    const esV1 = stored.__formato !== FORMATO;
    const entradas = esV1 ? stored : (stored.overrides ?? {});

    let aplicados = 0;
    const viejos = [];        // el código cambió su valor de fábrica
    const deEscena = [];      // los maneja la escena, nunca debieron guardarse
    for (const [id, guardado] of Object.entries(entradas)) {
      if (id === '__formato') continue;
      if (!this.params.has(id) || NO_GUARDAR.has(id) || id.startsWith('parte2.') || this.params.def(id)?.transient) continue;
      if (this.esDeEscena(id)) { deEscena.push(id); continue; }   // lo maneja la escena

      const fabrica = this.fabrica.get(id);
      let value;
      if (esV1) {
        if (OBSOLETOS_V1.has(id)) { viejos.push(id); continue; }
        value = guardado;
      } else {
        // El código movió el valor de fábrica desde que se guardó esto: el ajuste es viejo.
        if (guardado.d !== fabrica) { viejos.push(id); continue; }
        value = guardado.v;
      }

      this.overrides[id] = { v: value, d: fabrica };
      this.params.setDefault(id, value);
      this.params.set(id, value, { immediate: true });
      aplicados++;
    }

    if (aplicados) console.info(`[vis] ${aplicados} ajustes restaurados del editor`);
    if (viejos.length) console.info(`[vis] ${viejos.length} ajustes viejos descartados (cambió su valor de fábrica): ${viejos.join(', ')}`);
    if (deEscena.length) console.info(`[vis] ${deEscena.length} ajustes descartados porque los manda la escena: ${deEscena.join(', ')}`);
    // Se reescribe si hubo migración o descarte, para no volver a evaluarlo en cada arranque.
    // Ojo con el `entradas.length`: sin eso, una instalación limpia (sin nada guardado) entraba
    // igual por acá y escribía un registro vacío 250 ms después de arrancar — o sea pisaba
    // cualquier cosa que se hubiera guardado en ese ratito.
    const huboMigracion = esV1 && Object.keys(entradas).length > 0;
    if (huboMigracion || viejos.length || deEscena.length) this._scheduleSave();
  }

  record(id, value) {
    if (!this.params.has(id) || NO_GUARDAR.has(id) || id.startsWith('parte2.') || this.params.def(id)?.transient) return;
    // El valor ya se aplicó en vivo (Bridge hace `set` antes de llamar acá); lo único que no
    // pasa es que sobreviva al cambio de escena, porque de eso manda la escena.
    if (this.esDeEscena(id)) return;
    this.overrides[id] = { v: value, d: this.fabrica.get(id) };
    this.params.setDefault(id, value);
    this._scheduleSave();
  }

  clear() {
    this.overrides = {};
    localStorage.removeItem(KEY);
    console.info('[vis] ajustes del editor borrados (recargar para volver a los valores de fábrica)');
  }

  // Agrupa la escritura: arrastrar un slider dispara decenas de cambios por segundo.
  _scheduleSave() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      try { localStorage.setItem(KEY, JSON.stringify({ __formato: FORMATO, overrides: this.overrides })); }
      catch (err) { console.error('[vis] no se pudieron guardar los ajustes', err); }
    }, 250);
  }
}
