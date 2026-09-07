# Arquitectura y entradas de los sistemas

La operación vigente está en [CONTEXTO-ACTUAL.md](CONTEXTO-ACTUAL.md): **24 previa, 25 PLAY, 26 fluido libre por MIDI, audio desde la página**. Este mapa identifica dónde trabajar sin duplicar motores, relojes o almacenamiento.

## Una salida con dos motores visuales

```text
Ableton → MIDI → MidiInput → Mapper → Params / SceneManager
OSC UDP → bridge Node → WebSocket → OscClient → Mapper ─┘
editor.html / fluids.html → BroadcastChannel vis-bus → Output

Output: Engine → Parte 1 (capas 2D/3D + MLS-MPM + compositor)
             └→ RadianceController → FluidRuntime → Worker WASM + HRC
                                  └→ ShowSession → documento + reloj visual
```

`Engine` es el único bucle visual. Cuando Fluids posee el frame, las capas, MLS-MPM y compositor de Parte 1 no trabajan. El renderer anterior se conserva preparado; no se suman sus luces/postproceso al render HRC. El audio corre en su propio reloj (`AudioContext`) y es el que manda sobre el tiempo de la secuencia: el bucle visual lo lee, no lo gobierna.

| Sistema | Entrada en el repo activo | Responsabilidad |
|---|---|---|
| Arranque | `src/main.js` | Crea y conecta registro, motores, coordinador, IO y editores. Identifica la salida como `vis-salida`. |
| Render/encuadre | `src/render/Renderer.js`, `src/config/stage.js` | Buffer 2688×1008, ajuste CSS/DPR y dimensiones físicas de Parte 1. |
| Registro | `src/core/Params.js` | Parámetros, acciones, tipos y rangos. Alimenta editor y referencia MIDI/OSC. |
| Escenas | `src/core/SceneManager.js`, `src/scenes/index.js`, `src/scenes/base.js` | Presets y acciones; protección frente a notas repetidas. Intercepta 24/25/26 mediante el coordinador. |
| Bucle | `src/core/Engine.js` | Orden de frame, exclusión de trabajo simultáneo y barrera `whenIdle()`. |
| Parte 1 | `src/layers2d`, `src/layers3d`, `src/layers3d/particles` | Elementos del show previo, fuerzas y simulación MLS-MPM. |
| Coordinación Fluids | `src/radiance/RadianceController.js` | Preparación, solicitudes cancelables, 24 previa, 25 timeline, 26 live, ganancia y supersampling, comandos y publicación de estado/documento. |
| Documento y tiempo | `src/radiance/ShowSession.js` | Valida y guarda ShowDoc, rechaza revisiones viejas, controla el reloj de la secuencia y la onda del editor. Cuando el track suena, el reloj se ancla a él en cada frame. |
| Audio del show | `src/radiance/AudioTransport.js` | Reproduce `fluids.wav` en la salida y expone su posición como reloj maestro. Portado del transporte de la página original. |
| Motor Fluids | `vendor/radiance/src/integration/FluidRuntime.ts` | Solver, render HRC y geometría; entrada previa/timeline/live, supersampling, ganancia de luz, limpieza y suspensión. |
| Guion escrito | `vendor/radiance/src/scenes/fluid/FluidsShowDirector.ts` | Evalúa curvas, eventos, materiales y gestos por tiempo absoluto. |
| Modelo del documento | `vendor/radiance/src/fluids-show/show-doc.ts` | ShowDoc, serialización y muestreo; compartido con el editor. |
| Física Fluids | `vendor/radiance/src/scenes/fluid/KotFluidWorkerClient.js`, `public/radiance/fluid` | Cola/intercambio de buffers y solver WASM. Tres subpasos conservados. |
| Render Fluids | `vendor/radiance/src/scenes/fluid/FluidRadianceRenderer.ts` | Transporte de luz HRC, materiales, sombras y composición propia. |
| Editor general | `editor.html`, `src/editor/main.js` | Escenas, valores, Learn, mapeos y monitor de mensajes. |
| Editor Fluids | `fluids.html`, `vendor/radiance/src/integration/editor/entry.tsx` | Punto de entrada React del editor remoto y sus lanes. |
| Edición remota | `vendor/radiance/src/integration/editor/FluidsRemoteEditor.tsx`, `RemoteTransport.ts` | Playhead, curvas, eventos, gestos, undo/redo e import/export; órdenes a Output. |
| Preview remoto | `src/radiance/PreviewCapture.js`, `src/radiance/preview.worker.js` | ImageBitmap y JPEG 672×252 a 2 Hz en Worker; no monta otro FluidRuntime. |
| Bus de ventanas | `src/io/Bridge.js` | `BroadcastChannel('vis-bus')`; enrutamiento de mensajes generales y `fluids:*`. |
| MIDI | `src/io/MidiInput.js`, `src/io/Mapper.js` | Lectura Web MIDI, canales 1–16, traducción de notas/CC a acciones y valores. |
| OSC | `tools/osc-bridge.mjs`, `src/io/OscClient.js` | UDP 9000 → WebSocket 8081 → Mapper; puertos configurables. |
| Persistencia general | `src/core/Settings.js` y `Mapper.save()` | Ajustes del editor y mapeos; separados del documento Fluids. |

## Cambio de escena y contrato de control

`SceneManager` conserva la protección contra entradas repetidas. Una escena puede declarar `onRetrigger` para responder sin reaplicar presets ni acciones de entrada: sólo la **7** lo usa, para volver a desplegar el piso al repetir su cue MIDI/OSC. `Floor` publica alcance y scroll cero y omite el primer frame de la malla antes de su tween de 16 s, por lo que no puede enseñar la extensión anterior al entrar. La visibilidad fina de `GridBlocks` usa el estado destino y cambia por corte; los tweens de offsets siguen siendo independientes.

`RadianceController` prepara el runtime, espera que termine el frame anterior y el trabajo ya despachado al Worker, y sólo confirma la solicitud vigente. Una solicitud cancelada no debe mostrar tarde el canvas ni reactivar audio o física.

En 24, `enterStandby` deja población vacía, tiempo 0 y una línea blanca de referencia: no evalúa emisiones, fracturas ni eventos del show. Desde esa previa, la entrada 25 usa `startTimeline()` síncrono y el estado ya preparado, sin nuevo reset ni viaje de ida y vuelta al Worker en el cue. Una entrada directa en 25 usa `enterTimeline` para prepararse y comenzar desde cero. La 26 usa `enterLive`, que desengancha el director: sin documento no hay curvas, colisionadores ni lámparas del show colgando de un reloj detenido. Las notas repetidas de la misma escena no vuelven a entrar. `fluids.restart` fuerza la repetición explícita de la 25.

La pausa detiene el reloj de la secuencia y el track; la historia física sigue la semántica del motor original. Un seek cambia el tiempo de evaluación y mueve el track, pero no reconstruye toda la historia del fluido. **El final natural ya no congela**: el reloj se detiene en la duración del documento y el solver sigue avanzando. Master y blackout afectan imagen; el nivel del track es `fluids.volume`.

El runtime live y `fluids.live.*` son **la escena 26**. Sus params se resetean con la escena: punto de partida en `scenes/index.js`, reposo en `scenes/base.js`. Las escenas 27–29 siguen libres.

## Autoridad y persistencia

Output posee la única versión activa del documento y su revisión. El editor envía una edición basada en una revisión conocida; si quedó vieja, la salida la rechaza. El identificador de propietario ayuda a reconocer otra sesión de Output. Las ventanas del editor no deben sembrar ni guardar su copia como si fueran la autoridad.

`ShowSession` ancla su reloj al `AudioContext` mientras el track suena y cae en `performance.now()` cuando no hay audio (modo `external`, WAV que falla o todavía decodificando). El `OfflineAudioContext` sólo se usa para la onda cuando el track no está disponible: con audio web, los picos salen del mismo buffer que se reproduce.

Parte 1 usa Three **0.176.0**. Radiance mantiene su paquete y dependencias por separado en `vendor/radiance`; `npm ci` instala ambos lockfiles mediante `postinstall`. Los recursos se resuelven bajo el base de la aplicación más `radiance/`, por lo que el build no depende del servidor original ni de la carpeta `heidi`.

## Documentación histórica que acompaña al código

El [índice original](origen-radiance/INDICE.md) conserva el plan del show y sus explicaciones sin modificar sus bytes. Describen el proyecto original, que reproducía el audio en su propia página; su `AudioTransport` es la base del que hoy usa la salida. Los planes históricos de integración conservan la antigua asignación de escenas y la regla de audio siempre externo, ambas reemplazadas por [el contexto vigente](CONTEXTO-ACTUAL.md).
