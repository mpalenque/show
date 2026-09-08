# PARTE 2 en la web — port WebGPU del patch vvvv · paquete `milky-webgpu`

Actualizado: **7 de septiembre de 2026**. Este archivo es el punto de entrada del paquete: qué es, qué carpeta copiar, dónde están los medios, cómo se arranca, qué está verificado y qué falta.

## En una página

**Qué es.** La reproducción en JavaScript + WebGPU del sistema visual de **PARTE 2** del show (vvvv beta, `PARTE 2.v4p` → `player maximus.v4p`): siete players de secuencias DDS (uno completo y seis bloques), los cuatro Milky A de las franjas, las cuatro variantes Milky FULL, el efecto FINAL con tinta (Growth, feedbacks, anillo), INK dripping, la composición por capas con desplazamiento global y overlay, y el control MIDI/OSC con el mapa original del patch. Los efectos corren en la GPU; los videos se leen como imágenes DDS consecutivas de los archivos originales.

**Qué carpeta copiar.** Toda la carpeta **`milky-webgpu`** (este archivo está en su raíz). El nombre es histórico, del laboratorio inicial de los efectos Milky; contiene todo PARTE 2 web y nada dentro depende de ese nombre, así que en el repositorio destino puede llamarse por ejemplo `parte2-webgpu`. Copiar sólo `system/` no sirve: el motor y los shaders están en la raíz. La subcarpeta **`media/`** lleva la tinta, el overlay y la parte del catálogo DDS que estaba en OneDrive (6,7 GB, ignorada por git; ver [media/README.md](media/README.md)).

**Estado.** La aplicación independiente funciona con interfaz, parámetros públicos, mapeos MIDI/OSC, sesiones, escenas manuales y salida limpia a **2688 × 1008** (seis bloques de 448 × 1008). **No está montada dentro de PARTE 1**: existe el adaptador (`system/host-adapter.js`) pero falta conectarlo al renderer Three/WebGPU, al routing de entradas y al ciclo de vida del proyecto principal. No se confirmó equivalencia visual exacta ni la misma performance que vvvv.

**Medios.** El catálogo del patch tiene **68 clips y 48.030 frames**. Con el disco de backup `I:` conectado el servidor encuentra **63 clips completos (42.395 frames)**; sin ese disco, sólo los 12 clips copiados dentro del paquete. Faltan en todos los discos los clips **63–67** (INCENDIO00, bosqu, LOMBRIZ0, capulloalien0, mariposa). Mientras falte material, una **sustitución temporal** (`media.fallback`) evita franjas negras: el deck reproduce otro clip disponible, elegido de forma fija por el número pedido, y la interfaz lo marca como Sustituto.

## Por qué algunas notas dejaban la franja en negro y qué se hizo

El patch elige la secuencia con la velocity: `floor(velocity / 127 × 68) % 68` (canal 13, notas 0–5 para los bloques y 12 para el video completo). Ese índice recorre los 68 clips del catálogo, pero en esta máquina no todos tienen archivos. Cuando el índice caía en un clip sin medios, el deck quedaba en estado «Faltante» sin textura mientras el gate de video abría igual: **franja negra con la nota sonando**. Confirmado en el código (`SequenceDeck.ensure` → `missing`, y el compositor omite capas sin textura) y reproducido en el navegador con el receptor MIDI real (`captures/midi-show-validation.json`, sección `fallback`).

| Situación | Velocities con imagen | Velocities que caían en clips sin medios |
|---|---|---|
| Sólo el paquete (`media/dds`, clips 0–11) | 1–22 y 127 (127 vuelve al clip 0 por el wrap original) | **23–126** (clips 12–67) |
| Paquete + disco `I:` (63 clips) | 1–117 y 127 | **118–126** (clips 63–67) |

Se hicieron dos cosas, en este orden de importancia:

1. **Se encontró el material.** La carpeta que usaba el patch, `0001 SHOW NUEVO MATERIAL VIDEO\dds`, existe en el disco `I:` (`I:\dds`, 33.288 frames), junto con `I:\dds2` (clips 32–44 con nombres cambiados) y `…\resize` (clips 27–31 y 49). El servidor ahora escanea **todas** las carpetas conocidas y toma cada clip de la primera que lo tenga completo; los nombres se emparejan con la regla del patch (quitar cuatro caracteres al principio y cuatro al final) y, para las carpetas renombradas, por final del nombre más cantidad exacta de frames. Nada de esto se copió al paquete todavía (45 GB): el comando está en `media/README.md`.
2. **Sustitución temporal (`media.fallback`, activa por defecto).** Si el clip pedido no tiene todos sus frames, el deck reproduce `disponibles[índice % cantidadDisponibles]`; con 63 disponibles, clip 63 → 0, 64 → 1, 65 → 2, 66 → 3, 67 → 4. El parámetro `players.N.clip` / `player.full.clip`, el monitor MIDI, las escenas y la sesión conservan **el clip pedido**; sólo cambia lo que el deck dibuja, y el mezclador muestra «Sustituto → NN · nombre». Al restaurar los archivos, cada deck vuelve a su clip sin tocar nada más. Se apaga desde la pestaña Medios (checkbox), por el parámetro `media.fallback`, o por su CC público (canal 12, CC 58). Apagado, vuelve el comportamiento estricto anterior. El sustituto no es el contenido original del clip ausente: sólo evita el negro.

Los clips parciales también se sustituyen: el transporte se congelaría en el primer frame faltante. Hoy no hay parciales con el disco `I:` conectado.

### Dónde pide el show las cinco secuencias que faltan

Leído el 7/9/2026 del set de Ableton abierto, por MCP y sólo de lectura. La pista **VIDS** sale por **canal 13** y la pista **scene** por **canal 10**; los cues viven en Session view, no en el arreglo. Nota 12 = video a pantalla completa, notas 0–5 = las seis franjas. Sólo se listan las notas que efectivamente disparan (las que empiezan después del largo de su clip nunca suenan).

| Clip | Dónde lo pide | Detalle |
|---|---|---|
| **63 · INCENDIO00** | Slots 61/62/63 (escena 68), nota 12 | Cuatro golpes de 62 y 42 ms alternando con el bosque. También slots 64–67 y 70 (nota 12) y slots 44/45 (nota 4). |
| **64 · bosqu** | Slots 61/62/63 (escena 68), nota 12 | Cinco tramos: 4 s, 2,08 s, 2,08 s, 0,96 s, 0,96 s. También slot 64 (nota 12), 48/49 (nota 4) y 50 (notas 0, 1, 3, 4, 5). |
| **65 · LOMBRIZ0** | Slot 50 (escena 68), nota 2 | Una sola nota de 0,125 beats. Uso mínimo. |
| **66 · capulloalien0** | Slots 42, 43, 44, 45 (escena 72), notas 2 y 3 | 86 notas: es el más usado de los cinco. |
| **67 · mariposa** | Slot 50 (escena 68), notas 0–5 | 37 notas, tres de ellas silenciadas. También slot 40 (nota 12). |

**El momento del bosque y el incendio** son los slots 61/62/63, idénticos entre sí, de 30,5 beats: a 180 BPM son **10,17 segundos** en la escena 68, con el video a pantalla completa alternando bosque y golpes de fuego, y el warp habilitado por el gate de kick (escenas 65–68). La nota 12 se sostiene todo el tramo y sólo cambia su velocity, así que el gate de video no se cierra: lo que cambia es la secuencia seleccionada.

Dos detalles que conviene tener presentes: los slots 42–45 mandan **escena 72** por canal 10, y el receptor original sólo escucha notas 0–71, así que ese cue de escena no llega (ya documentado en `system/io-contract.md`). Y **velocity exactamente 127 vuelve al clip 0** por el wrap del GetSlice original: 141 de las notas altas del set caen ahí, no en el clip 67.

### Agregar una secuencia nueva

`tools/import-sequence.mjs` convierte material nuevo en frames DDS del formato original (DXT1, sin mipmaps) y los nombra para que el servidor los reconozca solo, sin remapear nada:

```text
node tools/import-sequence.mjs --list
node tools/import-sequence.mjs --clip 64 --input "D:\bosque.mp4"
node tools/import-sequence.mjs --clip 63 --input "D:\incendio" --frames all --update-catalog
```

Acepta un video en cualquier formato que lea ffmpeg o una carpeta con una secuencia de imágenes numeradas. Por defecto escala a 1920 × 1080 recortando para no dejar bandas negras (`--fit contain|stretch` cambia eso), toma los frames a 30 fps y escribe exactamente los que el catálogo espera. Si el material tiene otra cantidad, lo avisa; con `--update-catalog` ajusta `frameCount` y deja registrado el cambio en `catalog.json`. Verifica el primer frame con el propio parser de la aplicación e informa su PSNR. No borra nada: pisa frames existentes sólo con `--force`.

## Ubicaciones y arranque

```text
Paquete:              H:\BACKUP\desktop\ultra backup\001Set tecnopolis\milky-webgpu
Patches vvvv (ref.):  H:\BACKUP\desktop\ultra backup\001Set tecnopolis\*.v4p, 2D\, Milky\
Proyecto principal:   C:\Users\mpale\OneDrive\Desktop\PARTE 1
Medios fuera del paquete: I:\dds, I:\dds2, I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\resize
```

Desde `milky-webgpu`, ejecutar `node server.mjs` o `npm start` (Node 24 probado; sin build ni dependencias npm). Abrir por HTTP local, nunca `file://`. El servidor imprime al arrancar las rutas de medios que quedaron activas.

| Entrada | Uso |
|---|---|
| `ABRIR PARTE 2.cmd` | Inicia el servidor si hace falta y abre el sistema en modo show. |
| `http://127.0.0.1:8787/system.html?mode=show` | Show armado para recibir los cues MIDI originales por `loopMIDI Port`. |
| `http://127.0.0.1:8787/system.html?look=sixDDS` | Prueba manual de los seis videos DDS. |
| `http://127.0.0.1:8787/system.html?look=final` | Prueba manual de FINAL dentro del sistema completo. |
| `http://127.0.0.1:8787/?preset=final` | Laboratorio inicial de Milky FINAL, con su propia interfaz. |
| Botón «Abrir salida» | Abre `output.html` con el stream del canvas, sin controles. |

En modo show los gates empiezan en cero: **una pantalla negra sin notas es el estado correcto**. Los botones de composición fuerzan contenido visible para inspección; al recibir una nota original, la aplicación vuelve al modo show. `MILKY_PORT` cambia el puerto (los lanzadores usan 8787). Variables de medios: `PARTE2_DDS_ROOT` (una o varias carpetas separadas por `;`), `PARTE2_INK_ROOT`, `PARTE2_OVERLAY`.

## Archivos que componen el sistema

| Archivo o grupo | Responsabilidad |
|---|---|
| `system.html`, `system/app.js`, `system/ui.js`, `system/system.css`, `system/midi-status.css` | Arranque real, interfaz, mezclador de decks, medios, escenas y monitor MIDI. |
| `system/controller.js` | `Parte2System`: motores, decks, entradas, parámetros, automatización, composición, persistencia y la resolución clip pedido → clip reproducido (`applyDeckClip`). |
| `engine.js`, `shaders.js`, `presets.js` | Motor WebGPU y los cuatro presets A de las franjas. |
| `final-engine.js`, `final-shaders.js`, `ink-player.js` | FINAL, sus feedbacks, anillo, Growth y lectura de tinta. |
| `system/full-presets.js` | Variantes FULL1, FULL3, FULL2 y FULLSPLASH. |
| `system/dds-player.js`, `system/dds-format.js` | Biblioteca de texturas DDS (caché, decodificación, `isPlayable`/`substitute`) y transporte de cada secuencia. |
| `system/catalog.json`, `system/media-paths.mjs`, `system/media-server.mjs` | Catálogo original de 68 clips; carpetas candidatas y variables de entorno; escaneo multi-carpeta, emparejamiento de nombres, disponibilidad y remapeo. |
| `system/compositor.js`, `system/composition-shaders.js` | Capas, rectángulos, mezcla, máscara, transforms, warp y presentación. |
| `system/parameters.js` | Registro tipado de parámetros y acciones (incluye `media.fallback`). |
| `system/midi.js`, `system/mappings.js`, `system/show-midi.js` | Puerto MIDI, normalización, dispatch, gates, clock y armado del show. |
| `system/parameter-midi.js`, `system/default-mappings.json`, `system/parte2-controles-midi.csv` | CC públicos para todos los controles y su tabla exportada. |
| `system/session.js`, `system/display-profile.js` | Validación de sesiones y migración al LED 2688 × 1008. |
| `system/host-adapter.js` | Integración explícita con Params, reloj, entradas y GPU del proyecto principal. |
| `server.mjs`, `system/osc-server.mjs` | HTTP local, medios y puente OSC UDP → eventos del navegador. |
| `output.html` | Ventana de salida limpia. |
| `media/` | Tinta, overlay y copia parcial del catálogo DDS. Ver `media/README.md`. |
| `system/bc1-encoder.mjs`, `tools/import-sequence.mjs` | Codificador DXT1 y conversor de material nuevo a frames DDS del catálogo. |
| `tools/media-benchmark.mjs` | Mide si el disco donde están los DDS aguanta los siete decks a 30 fps. |
| `*.test.mjs`, `*-test.mjs`, `system/test-browser.mjs` | Pruebas unitarias (Node) y de navegador (Playwright + Chrome, configurables por `MILKY_PLAYWRIGHT` / `MILKY_BROWSER`). |
| `captures/` | Evidencia de pruebas; no hace falta para renderizar. |

Los `.v4p` de la carpeta padre son las fuentes de referencia del port, no dependencias del navegador.

## Cómo reproduce los DDS

Hay **siete decks independientes**: `player.full` y `players.0` a `players.5`. Cada uno mantiene clip, fase, frame, reproducción, velocidad y rango; `DDSLibrary` comparte las texturas entre decks. El período nominal es `(frameCount − 1) / 30 + masLento` y se conserva la fase al cambiar de clip, como en `Selector frames.v4p`. Reversa, rango y ping-pong son controles añadidos en la web.

**El disco importa más que la GPU.** Siete decks a 30 fps piden unos 210 frames por segundo. Medido el 7/9/2026 con `node tools/media-benchmark.mjs`: el M.2 de `E:` entrega entre 20 y 31 decks de margen, mientras que la copia del paquete en `H:` (USB mecánico) aguantaba **1,2 decks** y `I:\dds` unos 5. Con los medios en los discos mecánicos los decks se quedaban esperando frames en pleno cue, que es lo que se veía como cortes y secuencias que no arrancaban. Por eso los medios del show viven en `E:\PARTE2-MEDIA` y el código busca ahí primero ([media/README.md](media/README.md)).

El servidor lee el DDS pedido; el cliente interpreta la cabecera y sube el bloque BC1 comprimido cuando la GPU tiene `texture-compression-bc` y las dimensiones son múltiplos de 4. Los seis clips de `resize` miden 2046 × 1080 y por eso se decodifican a RGBA8 en CPU (unos 80 ms por frame en Node; en el navegador ocupa el hilo principal). La caché admite 128 texturas y 256 MiB de frames, con ocho lecturas simultáneas. **Si el siguiente frame todavía se está cargando, ese deck pausa su avance**: evita frames inexistentes, pero puede retrasar el video respecto del tiempo musical. La medición más reciente da 18–20 frames/s por deck con todas las capas activas frente a los 30 nominales; la optimización de carga sigue pendiente.

### Medios: dónde están y qué falta

| Material | Situación |
|---|---|
| Catálogo del patch | 68 clips, 48.030 frames, todos BC1. |
| **`E:\PARTE2-MEDIA`** | **Ubicación del show.** Copia en el M.2 de las tres carpetas del catálogo y de la tinta, 50,19 GB. Sirve los 63 clips completos: 44 desde `dds`, 13 desde `dds2`, 6 desde `resize`. |
| `media/dds` (en el paquete) | Copia de `C:\Users\mpale\OneDrive\Desktop\DDS2`: clips 0–11 completos y 5 frames del 12 (4.895 frames, 5,7 GB). Queda como respaldo; está en un disco lento. |
| `I:\dds` | Origen de la copia: carpeta original del patch, 33.288 frames, clips 0–26, 45–48 y 50–62. Duplicada en `I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\dds` e `I:\content\dds`. |
| `I:\dds2` | 8.905 frames, clips 32–44 con nombres cambiados (`NY 1 001.DDS`, `autopista circular dia 0001.DDS`). |
| `I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\resize` | 3.777 frames, clips 27–31 y 49, en 2046 × 1080. |
| **Faltantes** | Clips 63–67: INCENDIO00 (222), bosqu (361), LOMBRIZ0 (1.319), capulloalien0 (1.664), mariposa (2.069): 5.635 frames. Buscados por nombre en todos los discos, sin resultado. |
| Tinta | `media/ink/DDS/INK000000.DDS … INK001066.DDS` (1.067 frames BC7 1280 × 720) y sus JPG. Copia de `2D/ink`. |
| Overlay | `media/overlay/part2-overlay.png`, copia de `C:\Users\mpale\Downloads\Group 1 (1).png` (calibración gris/roja 3840 × 2160). |

`GET /api/catalog` informa por clip `availableFrames`, `rootId` y `mapping`, y por carpeta si existe y cuántos clips aporta. `POST /api/media/remap` acepta `{clipId, rootId}` o `{clipId, directory}`; sin `clipId` da prioridad a esa carpeta para todo el catálogo. El remapeo dura mientras vive el servidor.

## Milky, FINAL y composición

Los Milky generan su movimiento con **feedback de frames anteriores**, semillas geométricas, dither, desplazamiento, normal maps, mezcla y unsharp; no es una textura de noise animada.

| Preset | Cadena implementada |
|---|---|
| `1a` | Dither, Glow, DistortFlow, NormalMap, Displace, Exclusion con semilla y Unsharp. |
| `3a` | Doble feedback independiente, desplazamientos y cambios de dirección vinculados a kick/snare. |
| `2a` | Semilla de grilla roja, DistortFlow, Dither, NormalMap/Displace, Add, Unsharp y salida HSCB. |
| `splash` | Reflect, doble feedback, Displace y Exclusion. |
| `full1`, `full3`, `full2`, `fullsplash` | Cuatro variantes FULL con sus propias semillas y conexiones; no son alias de los presets A. |
| `final` | Quinto selector FULL («bomba nuclear»): tinta, Growth, desplazamientos y anillo auxiliar. |
| `inkdripping` | Efecto de tinta con estado propio, independiente de FINAL. |

Las seis franjas eligen entre **cuatro estados A compartidos**: dos franjas con el mismo preset muestran el mismo estado con sus transforms. El orden de composición es **Milky full → DDS full → seis Milky → seis DDS → INK → desplazamiento global → overlay**. Automatización recuperada: escenas 65–68 permiten warp mientras se sostiene el gate de kick; la 66 habilita INK; las 69–80 usan BOTON en FINAL; desde la 67 el DDS full tiene un ataque de brillo de 60 s. Los tiempos de caída que no pudieron recuperarse valen 1 s, editables.

### Geometría del LED

`composition.view.mode = 'show-strip'`: cada franja ocupa `[i × 448, (i + 1) × 448)` horizontal y `[0, 1008)` vertical, sin márgenes. El raster de salida, el PNG y el stream son 2688 × 1008; los buffers internos conservan otras dimensiones (FINAL 2688 × 840, presets A desde 560 × 896). El perfil `led-2688x1008-v1` migra una vez las sesiones anteriores.

## MIDI: puerto y mapa original

Puerto del patch: **`loopMIDI Port`**. La aplicación pide Web MIDI al iniciar y selecciona ese nombre; no activa APC MINI ni ZOOM. Canales **1–16**, notas **0–127**; no restar uno a los canales al reenviar mensajes ya normalizados.

| Canal | Notas | Efecto |
|---|---|---|
| 10 | 0–71 | Escena interna de Parte 2 (Note On). |
| 13 | 0–5 | Clip (por velocity) y gate de video de los bloques 0–5; cola de 20 ms al soltar. |
| 13 | 6–11 | Preset (por velocity) y gate Milky de los bloques 0–5; cola de 80 ms. |
| 13 | 12 | Clip y gate del video completo. |
| 13 | 13 | Selector Milky FULL y gate del Milky completo; Note Off vuelve a FULL1. |
| 1 | 0 | BOTON sostenido para FINAL; Kick1 en flanco. |
| 1 | 36, 41, 48, 50 | Kick por flanco del OR. |
| 1 | 48, 50 | Gate sostenido de kick WARP. |
| 1 | 37, 42 | Snare sostenido y evento de flanco. |
| 2 | 36–53 | Eventos de percusión publicados, sin consumidor gráfico. |
| 7 | 0 | Disparo INK. |
| 7 | 1–6 | Seis gates publicados, sin consumidor gráfico. |

Selección DDS: `floor(velocity / 127 × 68) % 68` (127 → clip 0). Selección A: `floor(velocity / 127 × 3)` con orden `1a, 3a, 2a, splash`. Selección FULL: `round(velocity / 127 × 4)` con orden `full1, full3, full2, fullsplash, final` (el redondeo del IOBox nativo sigue sin verificar). El sistema inicializa **444 controles/acciones y 490 asignaciones**: el mapa original más un perfil web con CC 0–119 en canales 11, 12, 14, 15 y 16 y acciones por notas del canal 16 (`system/parte2-controles-midi.csv`, `system/default-mappings.json`). Esos CC son una extensión web, no estaban en el patch. MIDI Learn consume el mensaje sin disparar el show.

### OSC y reloj

El servidor escucha OSC UDP **127.0.0.1:1002** y publica eventos en `/api/osc/events`: `/fx1 → final.fx1`, `/fx2 → final.fx2`, `/fx4 → final.fx4`, número crudo. `/fx3` no tiene consumidor. MIDI clock: 24 pulsos por negra, Start/Continue/Stop y Song Position Pointer si `transport.sync = 'midi'`. No convierte los DDS en clips sincronizados al tempo.

## Integración con PARTE 1

Contexto principal: `PARTE 1/particlesvideo/visuales/docs/CONTEXTO-ACTUAL.md` (escenas 1–23 existentes, 24 previa, 25 PLAY Fluids, 26 Fluids live, 27–29 reservadas). El audio lo reproduce PARTE 1. `system/host-adapter.js` exporta `createParte2HostAdapter`, `Parte2HostAdapter` y `createParte2ViteProxy`; registra los controles bajo `parte2.*` y la escena interna es `parte2.scene.current` / `parte2.scene.goto`.

```js
import { createParte2HostAdapter } from '@parte2/system/host-adapter.js';

const parte2 = await createParte2HostAdapter(ctx, {
  canvas: canvasIntermedio, device: gpuDeviceHost, adapter: gpuAdapterHost,
  systemOptions: { restore: false, storage: null },
});
parte2.system.armMidiShow();          // el modo hosted no arma el show solo
await parte2.system.prepare();

function recibirMensajeNormalizado(message) {
  if (parteActiva === 2) parte2.dispatch(message); else mapperParte1.dispatch(message);
}
function frameHost(dtSegundos) {
  if (parteActiva !== 2) return;
  presentarEnHost(parte2.render(dtSegundos)); // { texture, view, device, width, height, format, canvas }
}
function salirDeParte2() { parte2.system.mapper.releaseAll(); }
```

Puntos firmes: un único receptor MIDI, un único reloj y la autoridad de la salida quedan en el host; un `GPUTexture` sólo sirve en el `GPUDevice` que lo creó (pedir `texture-compression-bc` al crearlo); el enlace de esa textura con el backend Three/WebGPU **todavía falta**; `dispose()` no destruye el device compartido. Vite: alias `@parte2` a la carpeta copiada y `createParte2ViteProxy('http://127.0.0.1:8787')` en `server.proxy` para `/api/catalog`, `/api/media/remap`, `/api/osc/*`, `/media/*`, `/ink/*` y `/assets/part2-overlay.png`. Detalle y ownership en [INTEGRACION_PARTE1.md](INTEGRACION_PARTE1.md).

## Sesiones

La aplicación guarda parámetros y snapshots en `parte2.session.v1`, mapeos en `parte2.mappings` y puertos en `parte2.midiInputs`; no escribe las claves `vis.*` de PARTE 1. Los snapshots manuales son una función web; los cues del show conservan su automatización sin cargarlos. `127.0.0.1:8787` y `localhost:5173` no comparten localStorage ni permisos MIDI.

## Validación realizada

Todas las pruebas se corrieron el 7/9/2026 en esta máquina (RTX 3090, Chrome headless con WebGPU, Node 24) contra el servidor con las carpetas de `I:` conectadas.

| Prueba | Comando | Resultado |
|---|---|---|
| Unitarias: MIDI, clock, mapeos, DDS, catálogo, nombres de carpetas, fallback, rutas, sesión, host adapter, codificador DXT1 | `npm test` | 63 / 63 |
| Importación de una secuencia nueva de punta a punta: video → 222 frames DDS → catálogo completo → frames servidos por HTTP | `node tools/import-sequence.mjs` sobre un video de prueba | PASS (1920 × 1080, 1.036.928 bytes por frame como los originales) |
| Composición y automatización por escenas | `node system/composition-test.mjs` | PASS |
| Interfaz real: 7 decks, CC públicos, Learn, CSV, OSC UDP → parámetro, móvil | `npm run test:ui` | PASS (444 parámetros, 490 asignaciones) |
| Salida LED 2688 × 1008, migración de sesiones, PNG y stream | `npm run test:led` | PASS |
| Receptor Web MIDI real (`loopMIDI Port`) con eventos inyectados: escenas, clips, presets, FULL, BOTON, kick/warp/snare/INK, Learn, **sustituto** | `npm run test:midi-show` | PASS |
| Integración GPU: siete DDS, clock, Learn, clip faltante estricto y con sustituto, INK independiente, FULL, presets A, máscara/warp, FINAL nativo | `npm run test:system` | PASS |
| Rendimiento con todas las capas (10 s × 2, 2688 × 1008) | `npm run test:live` | PASS; ver tabla siguiente |
| Demo Milky: compilación WGSL, hashes de los cinco presets, controles de FINAL, FINAL en vivo 10 s (59,9 pasos/s a 3840 × 1200), galería completa | `npm run test:milky`, `node final-ui-test.mjs`, `node final-live-test.mjs`, `node live-test.mjs` | PASS (4 / 4) |

| Medición 7/9/2026 (Chrome headless, RTX 3090, medios en H: e I:) | FINAL como efecto activo | Todas las capas: 7 decks + 4 A + FINAL + INK |
|---|---:|---:|
| Callbacks de refresco por segundo | 60,0 | 59,5 |
| Intervalo de refresco p95 | 16,8 ms | 16,8 ms |
| Pasos de efectos por segundo | FINAL 59,9 | FINAL 59,6 · INK 59,4 · presets A 60,1 |
| Avance de cada deck DDS por segundo | 29,5–29,9 frames | 28,2–29,0 frames |

Evidencia: `captures/live-system-validation.json`. El 6/9, con los DDS leídos desde la carpeta de OneDrive, los decks avanzaban 17,7–23 frames/s; con los archivos en `media/dds` y en `I:` se acercan a los 30 nominales. Son mediciones del port en esta máquina, no una comparación con vvvv. **Queda pendiente el ensayo de punta a punta con los cues reales de Ableton y vvvv.** Las pruebas de navegador usan Playwright y Chrome locales, resueltos por `system/test-browser.mjs` (`MILKY_PLAYWRIGHT`, `MILKY_BROWSER`). No ejecutar varias pruebas WebGPU a la vez.

## Trabajo que queda

1. **Medios.** Hecho el 7/9/2026: las tres carpetas del catálogo y la tinta están en el M.2 (`E:\PARTE2-MEDIA`) y el servidor las toma primero. Quedan por regenerar los cinco clips faltantes (63–67), que entran con `tools/import-sequence.mjs`; con los cinco presentes, desactivar `media.fallback`. Antes de cada show, `node tools/media-benchmark.mjs` confirma que el disco aguanta.
2. **Carga DDS.** Precarga y avance real a 30 fps con FINAL/INK activos; decidir si se saltan frames en lugar de pausar; considerar re-exportar los seis clips de 2046 × 1080 a un ancho múltiplo de 4 para subirlos comprimidos.
3. **Montaje en PARTE 1.** Adapter en la salida principal, textura en el backend Three/WebGPU, selector de parte activa, reenvío único de MIDI/OSC/clock, `armMidiShow()`, liberación de gates al salir, persistencia y desmontaje.
4. **Ensayo.** Salida LED con audio y notas reales; comparar los mismos cues contra vvvv, en especial selección FULL, estados aleatorios, feedbacks y el efecto final.

## Referencias dentro del paquete

- [system/README.md](system/README.md): operación del sistema completo.
- [media/README.md](media/README.md): medios, carpetas del disco `I:`, variables de entorno, comando de copia.
- [INTEGRACION_PARTE1.md](INTEGRACION_PARTE1.md): adapter, Vite, ownership.
- [system/io-contract.md](system/io-contract.md): mapa MIDI completo, fórmulas, OSC, Learn.
- [system/composition-reference.md](system/composition-reference.md): transformaciones originales y adaptación al LED.
- [system/MEDIA_AND_FULL.md](system/MEDIA_AND_FULL.md): catálogo, emparejamiento de nombres, sustitución, variantes FULL.
- [captures/](captures/): reportes y capturas de validación.
- Análisis estático del patch original: `../ANALISIS_PARTE_2.md` (fuera del paquete).
