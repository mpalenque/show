# Configuración y datos persistidos

Contrato actual: **24 previa, 25 PLAY, 26 fluido libre por MIDI, audio desde la página**. [Contexto](CONTEXTO-ACTUAL.md) · [Sistemas](ARQUITECTURA-Y-SISTEMAS.md) · [Operación Fluids](integracion-radiance/OPERACION.md).

## Arranque desde el proyecto activo

Directorio: `C:/Users/mpale/OneDrive/Desktop/PARTE 1/particlesvideo/visuales`.

```powershell
npm ci
npm start
```

`npm ci` instala Visuales y, mediante `postinstall`, `vendor/radiance` desde su lockfile. `npm start` levanta Vite y el bridge OSC. Por separado: `npm run dev` y `npm run osc`.

Para servir el build en el mismo puerto habitual:

```powershell
npm run build
npm run preview -- --port 5173
```

Si se usa OSC con preview, ejecutar también `npm run osc`. Mantener una sola instancia del servidor que corresponda en ese puerto.

| Ventana / conexión | Dirección |
|---|---|
| Salida | `http://localhost:5173/`, nombre `vis-salida` |
| Escenas, mapeos y Learn | `http://localhost:5173/editor.html` |
| Timeline Fluids | `http://localhost:5173/fluids.html` |
| OSC de entrada | UDP 9000 por defecto |
| Bridge al navegador | `ws://localhost:8081` por defecto |

El puerto UDP se puede cambiar desde el editor y se conserva en `vis.oscPort`. El proceso Node también admite `OSC_PORT` y `WS_PORT`; cambiar WebSocket requiere que `OscClient` apunte al mismo puerto. El bus entre las ventanas del mismo origen se llama `vis-bus`.

## Ableton y MIDI

1. En Ableton, habilitar **Track** para la salida MIDI que llega a Visuales. El set documentado usa **RTX3090 (Port 2), canal 10** para escenas; no renombrar ni reemplazar puertos existentes por una sugerencia genérica del README antiguo.
2. En `editor.html`, habilitar la entrada MIDI correspondiente y observar el monitor al disparar el clip.
3. Verificar **Note On, canal 10, número de nota 24** para previa y **número 25** para PLAY. El parser usa canales **1–16**, no 0–15.
4. El clip que inicia la música en Ableton debe enviar el cue 25 en el punto de arranque visual. La web no reproduce otra copia del track.

**Usar el número MIDI en el monitor como referencia.** El nombre de nota y de octava mostrado por Ableton, otros editores o plugins puede usar otra convención. No transformar «nota 24» en un nombre tipo C0/C1 por suposición, ni correrla una octava para que coincida con una etiqueta.

| Fuente | Destino | Argumento | Resultado |
|---|---|---|---|
| Note On ch10 nota24 | `scene.goto` | `24` | Previa negra/línea blanca, tiempo 0 detenido. |
| Note On ch10 nota25 | `scene.goto` | `25` | PLAY completo desde cero al entrar. |

Las filas `sc24` y `sc25` están en `public/mappings.default.json`. Mapper v11 puede añadirlas si faltan en una configuración anterior, conservando filas personalizadas existentes. Revisar cualquier mapeo aprendido que use esas notas con otro fin; el monitor muestra qué destinos disparó. No agregar un segundo `fluids.play` a la nota 25: seleccionar la escena ya inicia la secuencia.

Las notas repetidas de la escena activa no reinician. Para ensayo: `fluids.standby` selecciona 24; `fluids.play` selecciona 25 o continúa su pausa; `fluids.restart` reinicia explícitamente 25 desde 0. `fluids.pause` y `fluids.seek` operan sobre la secuencia de 25. `fluids.arm` sólo prepara recursos. El loop se reserva para ensayo visual: entrar en 24 o 25 lo desactiva, y nunca modifica el transporte de Ableton.

`fluids.audioMode` admite **`web`** (por defecto: el track sale de la salida) y **`external`** (Ableton). Un ajuste o mensaje antiguo `local` cae en el valor por defecto. `fluids.volume` gobierna el nivel del track; `fluids.gain` la luz de Fluids y `fluids.supersample` la escala del buffer de dibujo. Los tres son ajustes de máquina: no los resetea el cambio de escena y sobreviven la recarga.

Los controles `fluids.live.*` son **la escena 26** y sí se resetean con la escena: su punto de partida está en `scenes/index.js` y su reposo en `scenes/base.js`. `fluids.live.emission` va de 0 a 0,25 a propósito, para que el recorrido de un CC caiga entero dentro del tramo que se ve.

## OSC

| Mensaje | Uso |
|---|---|
| `/scene 24` | Seleccionar previa. |
| `/scene 25` | Seleccionar PLAY. |
| `/a/fluids/restart` | Reiniciar explícitamente el timeline. |
| `/a/fluids/pause` | Pausar el reloj visual en 25. |
| `/a/fluids/seek 30` | Buscar 30 s para ensayo, sin mover Ableton. |
| `/p/<grupo>/<nombre>` | Escribir un parámetro en su rango nativo. |
| `/pn/<grupo>/<nombre>` | Escribir un valor normalizado 0–1. |

Los IDs y rangos completos se generan desde el registro en [REFERENCIA-MIDI-OSC.md](../REFERENCIA-MIDI-OSC.md) y `.csv`, o desde el editor. El bridge sólo entrega los mensajes a Visuales; no sincroniza por sí mismo el transporte de Ableton.

## Show, assets y almacenamiento

| Dato | Archivo / clave | Quién lo usa |
|---|---|---|
| Documento incluido | `public/radiance/show/fluids.show.json` | Base de ShowSession si no existe un guardado integrado. |
| Documento editado y revisión | `localStorage['vis.radiance.show.v1']` | Output; prioridad sobre el JSON incluido. |
| Track del show | `public/radiance/audio/fluids.wav` | Lo reproduce la salida; de su buffer sale también la onda del editor. |
| Análisis de audio | `public/radiance/show/fluids.analysis.json` | Onsets y curvas de referencia del editor. |
| Worker/JS/WASM y avisos | `public/radiance/fluid/` | Motor Fluids. |
| Otros assets conservados | `public/radiance/blocks`, `depth`, `voronoi` | Contenidos futuros, sin escena nueva asignada. |
| Mapeos incluidos | `public/mappings.default.json` | Mapper y migración de filas. |
| Mapeos aprendidos | `localStorage['vis.mappings']` | Mapper; exportables en el editor. |
| Ajustes persistentes | `localStorage['vis.settings']` | Settings; no reemplazan los presets que pertenecen a una escena. |
| Entradas MIDI habilitadas | `localStorage['vis.midiInputs']` | MidiInput. |
| Puerto OSC | `localStorage['vis.oscPort']` | OscClient. |
| Calidad Parte 1 | `localStorage['vis.quality']` | Preset de calidad del equipo. |

`localhost`, `127.0.0.1` y puertos diferentes tienen almacenamientos distintos. Para transportar el show, **EXPORTAR JSON** desde el timeline; para los mapeos, exportar desde `editor.html`. No limpiar storage como primer paso de diagnóstico: puede contener ediciones más recientes que las incluidas en Git.

Las claves originales `radiance-fluids-show-doc-v1`, `radiance-tres-masas-page-v2` y `radiance-live-show-state-v2` pertenecen al proyecto original y no se usan como destino de guardado integrado. El export recuperado de Downloads no se ha cotejado con la última sesión original; un JSON posterior se puede importar explícitamente.

## Grillas finas y disparos del piso en escena 7

Las grillas finas de 4–8 entran completas y cambian sus bloques por corte: selección de escena, `grid.visibilityRandom`, `grid.toggleAll` y toggles individuales no interpolan su visibilidad. La nota **0/ch1** conserva el cambio aleatorio de bloques; Note Off no lo repite. `grid.fadeTime` regula sólo las grillas gruesas; los corrimientos disparados por `grid.nudge*` conservan su suavidad. La escena 6 ya no carga la grilla progresivamente de arriba abajo.

Cada **Note On 7/ch10** despliega el piso de la escena 7 **desde cero durante 16 s** hacia el punto de fuga. La acción bloquea un único frame de la malla anterior antes de empezar, de modo que la primera entrada tampoco puede aparecer completa. También funciona al repetir esa nota con la escena activa: reinicia sólo el alcance y scroll del piso, sin reponer el estado de las grillas ni ejecutar otra entrada de escena. Note Off no reinicia. **Espacio en 7**, el botón `floor.reveal` y OSC `/a/floor/reveal` hacen el mismo despliegue en perspectiva. Repetirlo durante la animación la vuelve a empezar; el alcance base final es 60 m.

Pruebas: `node --test tools/grid-switch.test.mjs tools/floor-retrigger.test.mjs` (11 tests) y `node tools/check-grid-floor.mjs` (Chrome/WebGPU con MIDI/OSC externo aislados). El navegador comprueba cortes desde el primer frame en 4–8, el recorrido completo y los redisparos de 7 mediante el parser MIDI real. Capturas y reporte local: `performance-check/grid-floor/`.

## Línea autónoma de la escena 2

La escena 2 muestra una línea blanca vertical de 3 px, completa, que comienza en el centro útil y se mueve continuamente a 70 px/s desde que entra. La nota MIDI **36, canal 2**, dispara `line.flip`: invierte su dirección sin cambiar la posición, reiniciarla ni crear otra línea. **Note Off** no vuelve a invertir. Espacio y L permiten ensayar la misma acción desde la salida.

Al alcanzar un borde, la línea continúa por el opuesto con el mismo sentido. `line.wrap` queda fijado en true por la escena para evitar rebotes autónomos. La nota 2/ch10 selecciona la escena; repetirla mientras está activa no reinicia la línea. El mapeo `full-line` (33/ch4) conserva truenos en 3–6/9 y deja de dispararlos en 2. Mapper v12 migra su alcance conservando fuentes aprendidas; el renderer también ignora `line.strike` en modo loop para soportar exports antiguos.

Verificación: `node --test tools/moving-line.test.mjs tools/moving-line-mapping.test.mjs` y `node tools/check-scene2.mjs`. La última usa Chrome/WebGPU aislado de MIDI/OSC externo y guarda captura/reporte en `performance-check/scene2/`.

## Rays y torbellino de Parte 1

En las escenas 16–23, `ray.spawn` conserva su disparo MIDI/OSC y la interacción física. El ancho base es **0,042 m** (3× el anterior). En el grupo `rays` del editor, `rays.lightIntensity` controla la luz (base 8, 0 la apaga) y `rays.lightRange` su alcance en metros (base 2,6). La luz sigue el centro del rayo y decae con la onda del impacto; color y opacidad afectan también la luz. Estos parámetros pertenecen al show y vuelven al valor base al cambiar de escena.

**21 — Torbellino** activa `particles.raysOnly`: emisión propia y bloom de los palitos en cero, sin luces de ambiente, principal, relleno ni orbe. Sin rays activos, los palitos quedan oscuros; el piso conserva sus trazos blancos. El contraste de AO recibe un factor 1,3 con las mismas muestras y resolución. Al salir se recuperan las luces ajustadas en el editor y el look de la escena siguiente. Las escenas 22/23 mantienen su emisión y titileo anteriores.

Las 32 luces reutilizan los slots de los rays; no generan shadow maps. La oclusión de contacto usa el GTAO existente, no sombras proyectadas por cada luz. El shader omite las luces apagadas y los fragmentos fuera de alcance; no se baja la cantidad de palitos para compensar el cambio.

## Verificación antes de dar por probado un cambio

```powershell
npm run check:radiance
npm run build
```

Los tests e informes deben indicar qué asignación de escenas se probó. [Validación de cues 24/25](integracion-radiance/VALIDACION-CUES-24-25.md) registra las pruebas nuevas y su variabilidad de rendimiento. [RENDIMIENTO.md](integracion-radiance/RENDIMIENTO.md) conserva mediciones de la asignación anterior. El hardware de referencia es i7-12700 + RTX 3090; no hay garantía de 50 FPS mínimos ni de 50 Hz de física continuos.
