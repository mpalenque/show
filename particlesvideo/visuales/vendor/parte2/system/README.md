# Parte 2 · Sistema WebGPU

Abrir **ABRIR PARTE 2.cmd**, o iniciar `node server.mjs` desde `milky-webgpu` y entrar en [Show MIDI vvvv](http://127.0.0.1:8787/system.html?mode=show). Esta entrada selecciona **loopMIDI Port**, pide acceso MIDI y queda esperando las notas originales, con las capas apagadas hasta sus cues. Para probar imágenes sin Ableton: [muestra manual de seis videos](http://127.0.0.1:8787/system.html?look=sixDDS). El laboratorio anterior continúa en `index.html`.

El sistema usa el mismo motor WebGPU y los mismos shaders de la demo Milky. Añade siete players DDS independientes, el banco de cuatro Milky A para los seis bloques, cuatro variantes Milky full, Milky FINAL, INK dripping independiente, composición, máscaras, desplazamiento global, controles MIDI/OSC, sesiones y escenas guardables. La salida predeterminada es **2688 × 1008**: **seis bloques de 448 × 1008**, de borde a borde y sin márgenes verticales. El preview, la captura PNG y la ventana de salida usan ese mismo raster.

Las sesiones guardadas antes de esta corrección migran una vez al nuevo tamaño y encuadre, incluidas sus escenas guardadas. Se conservan clips, efectos y mapeos MIDI. Los ajustes de pantalla que se hagan después se guardan normalmente.

## Operación

El lienzo muestra la composición final. Los botones **Milky FINAL**, **DDS completo**, **6 × DDS**, **6 × Milky** y **Mezcla** preparan combinaciones para probar el sistema; estas combinaciones manuales desactivan la automatización por escena. Los siete players conservan transportes separados: clip, reproducción, velocidad, rango, posición, loop, reversa y ping-pong. Cambiar de clip mantiene la fase, como en el selector del patch, salvo un reset o seek explícito.

Cada bloque tiene nivel DDS, nivel Milky y selector de preset. Los controles de la derecha incluyen los parámetros de los efectos, transforms, máscara, encuadre y salida. Todos pasan por un registro central: un cambio por MIDI, OSC, API o interfaz actualiza el mismo valor. Se pueden localizar por nombre o ID en el buscador. Los ajustes se conservan localmente; sesión y mapeos pueden exportarse e importarse en JSON.

**Salida** abre una ventana limpia, alimentada por el canvas mediante un MediaStream; comparte la simulación y no crea otra. La resolución de esa señal es la de salida, aunque el preview del editor sea pequeño. La captura PNG guarda la salida sin controles. La web no reproduce audio.

## MIDI

Como Parte 1, el sistema llama a `requestMIDIAccess` al arrancar, incluso si el permiso todavía está pendiente. Chrome puede pedir permitir MIDI para **este sitio**: el permiso de `localhost:5173` no se comparte con `127.0.0.1:8787`. En modo show selecciona por nombre **loopMIDI Port**, sin habilitar automáticamente APC/ZOOM/otros puertos. La barra superior muestra **Abierto · escuchando**, contador real de mensajes, canal, nota/CC y destinos activados. Seleccionado y abierto son estados distintos: un error de apertura se informa y puede reintentarse.

**Usar MIDI de vvvv** vuelve a elegir ese puerto y arma el estado original: escena inicial 0 (o última escena MIDI recibida), alpha de las capas 0, BOTON apagado, bucle de demostración FINAL apagado y automatización de escenas activa. La próxima nota original que llegue por el puerto toma el control si se estaba viendo una muestra manual. Los cues originales no cargan las escenas manuales guardadas de la web. No hace falta Learn para esas notas: ya están mapeadas.

En la pestaña MIDI se pueden habilitar otras entradas; la selección manual guarda nombres además de IDs para soportar reconexiones. Una selección manual vacía permanece vacía hasta elegir de nuevo un puerto o pulsar **Usar MIDI de vvvv**. Abrir con `?mode=manual` conserva esa selección; la entrada al show original vuelve a su puerto fijo. MIDI Learn y el perfil CC público siguen disponibles para los controles adicionales.

El perfil original procede de `MIDI SEQ PLAYER.v4p`, la instancia activa de `player maximus`:

| Canal humano | Notas | Función |
|---|---|---|
| 10 | 0–71 | Seleccionar escena con Note On |
| 13 | 0–5 | Seleccionar clip de cada bloque por velocity y activar DDS mientras se mantiene la nota, con cola de 20 ms |
| 13 | 6–11 | Seleccionar Milky de cada bloque por velocity y activarlo, con cola de 80 ms |
| 13 | 12 | Seleccionar y mostrar DDS full |
| 13 | 13 | Seleccionar y mostrar Milky full |
| 1 | 0 | BOTON de FINAL y evento Kick1 |
| 1 | 36, 41, 48, 50 | Kick all, flanco del OR de las notas sostenidas |
| 1 | 48, 50 | Gate de desplazamiento global |
| 1 | 37, 42 | Snare sostenido; actualiza las rotaciones/espejos y parámetros conectados |
| 2 | 36–53 | Publicar evento de percusión |
| 7 | 0 | INK: reset de Growth y rampa propia de tinta |
| 7 | 1–6 | Publicar los seis gates bOTON GRI; sin consumidor visible en el patch actual |

La selección DDS calcula `floor(velocity / 127 × 68) % 68`. Velocity 127 vuelve al primer clip por el wrap original de GetSlice. Milky de franjas utiliza `floor(velocity / 127 × 3)`. El orden full es **FULL1, FULL3, FULL2, SPLASH, FINAL**; la conversión del selector full a entero usa redondeo explícito, pendiente de comparación nativa. Al soltar la nota 13/ch13, el selector FULL vuelve a **FULL1**, porque esa señal nativa no está retenida; los selectores DDS y Milky de franjas sí conservan su selección. Un Note Off sin Note On previo también libera el gate, con las colas originales de 20/80 ms cuando corresponden.

Los controles también admiten **MIDI Learn**: elegir un destino y mover un CC o disparar una nota. Se pueden editar canal, número, modo, rango, curva, destino, filtro de escenas y activación; el JSON avanzado conserva todas esas opciones. Las filas originales conservan sus nodos de procedencia. [Contrato completo de MIDI y OSC](io-contract.md).

Además, cada parámetro público ya tiene un CC asignado en los canales **11, 12, 14, 15 y 16**, CC **0–119**; las acciones tienen notas del canal **16**. Esta ampliación web aparece identificada por separado del cableado original. **CSV de controles** descarga la tabla exacta de canal, nota/CC, destino, rango y fórmula; los mapeos siguen siendo editables y admiten Learn. El perfil usa canales distintos de los selectores originales. La versión entregada tiene **444 controles/acciones y 490 asignaciones** (el control agregado el 7/9/2026 es `media.fallback`, CC 58 del canal 12). También están guardados el [CSV inicial para configurar Ableton](parte2-controles-midi.csv) y el [perfil inicial en JSON](default-mappings.json).

Con **Reloj = MIDI**, el sistema interpreta 24 pulsos por negra, Start, Continue, Stop y Song Position Pointer. El tempo se estima desde los pulsos; **Seguir Start / Stop MIDI** permite desacoplar el transporte. Los DDS mantienen su velocidad propia de 30 fps nominales y los feedbacks su cadencia configurada: cambiar BPM no estira los clips ni resincroniza continuamente su fase. No se obtiene automáticamente el tiempo del arreglo de Ableton: hace falta enviar esas señales o los cues correspondientes.

## DDS y archivos disponibles

El catálogo conserva las **68 secuencias y 48.030 frames** del patch. El servidor escanea **varias carpetas a la vez** y toma cada clip de la primera que lo tenga completo: `PARTE2_DDS_ROOT` (una o varias rutas separadas por `;`), `media/dds` dentro del paquete (copia de la carpeta DDS2 original: clips 0–11), la carpeta original de OneDrive, y las carpetas del disco de backup `I:` encontradas el 7/9/2026: `I:\dds` (la carpeta `0001 SHOW NUEVO MATERIAL VIDEO\dds` que usaba el patch, 33.288 frames), `I:\dds2` (clips 32–44 con nombres cambiados) e `I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\resize` (clips 27–31 y 49). Con el disco `I:` conectado quedan **63 de 68 clips completos, 42.395 frames**; faltan sólo los clips 63–67 (INCENDIO00, bosqu, LOMBRIZ0, capulloalien0, mariposa: 5.635 frames), que no aparecen en ningún disco. La tinta se busca en `PARTE2_INK_ROOT` → `media/ink` → `../2D/ink`; el overlay en `PARTE2_OVERLAY` → `media/overlay/part2-overlay.png` → Descargas. Al arrancar imprime las rutas activas y la pestaña Medios muestra qué carpeta aporta cada cuántos clips ([detalle en media/README.md](../media/README.md)). Los seis clips de `resize` son 2046 × 1080: ese ancho no es múltiplo de 4, por lo que se decodifican a RGBA8 en CPU en vez de subirse comprimidos. La pestaña de medios permite reasignar carpetas dentro de las ubicaciones registradas.

**Sustitución temporal (`media.fallback`, activa por defecto, pestaña Medios).** El selector MIDI original produce índices 0–67 según la velocity (`floor(velocity/127 × 68) % 68`). Un clip sin medios completos dejaría su franja **negra con el gate abierto**; con la sustitución el deck reproduce `disponibles[índice % cantidadDisponibles]` y el mezclador lo marca **Sustituto** con el nombre del clip que se ve. El parámetro, la sesión y el monitor MIDI conservan el clip pedido. Sin el disco `I:` (sólo `media/dds`) esto afecta a las velocities 23–126; con el disco `I:` sólo a las velocities 118–126 (clips 63–67). Al restaurar los archivos faltantes cada deck vuelve a su propio clip sin cambiar nada más. Desactivarla devuelve el comportamiento estricto anterior (`Faltante`, sin imagen).

Los DDS BC1/BC2/BC3/BC7 se suben comprimidos cuando la GPU lo admite. Hay decodificación a RGBA8 para BC1/2/3 y formatos RGB compatibles. BC7 sin soporte de GPU requiere el JPG original. Los siete players comparten una caché limitada a 256 MiB y 128 texturas, con precarga y prioridad de frames visibles. Un frame pendiente pausa el avance de ese deck; la UI muestra su estado. Los 1.067 DDS de tinta sí están completos y usan su propia caché limitada.

El remapeo de carpetas dura mientras está activo el servidor; debe volver a aplicarse al reiniciarlo. Los controles y mapeos de la interfaz sí se guardan en el navegador. [Catálogo, formatos, transporte y variantes FULL](MEDIA_AND_FULL.md).

## Composición y efectos

El orden es Milky full → DDS full → seis Milky → seis DDS → INK → desplazamiento global → overlay. **Encuadre = Pantalla LED completa** distribuye seis bloques de 448 × 1008 sobre la salida 2688 × 1008; **reference** conserva la cámara y proporción del intermedio original 16:9. Las posiciones, escalas, rotaciones, UV, opacidades y mezclas permanecen editables. Las dimensiones internas de los efectos pueden ser distintas: se componen sobre el raster de pantalla completo.

NormalGlow usa el shader original para generar el control del desplazamiento global. La máscara tiene un modo de solapamiento correspondiente al cableado guardado y un modo explícito de seis franjas corregidas. La guía original `Group 1 (1).png` está disponible como capa opcional; es una imagen de calibración gris/roja, no contenido faltante del show. [Grafo, transforms y opciones de encuadre](composition-reference.md).

Con automatización original, las escenas 65–68 permiten el warp mientras el gate Kick WARP está activo; la 66 habilita INK; las 69–80 usan BOTON para Dither/Exclusion de FINAL. El DDS full tiene además el ataque de **brillo RGB** de 60 segundos desde la escena 67; su alpha sigue controlado por VID FULL. La caída nativa no está guardada explícitamente: se usa un segundo, visible y editable junto con el ataque. El rango 60–80 del patch original cambia su ventana; no apaga el render fuera de ese rango. Las escenas guardadas manualmente son una función del sistema web y no contienen una reconstrucción inventada del arreglo MIDI del show.

INK dripping tiene sus propios feedbacks, distintos de FINAL: cada nota INK mantiene la entrada cuatro segundos, con ataque de quince segundos sobre los frames 60–600. Resetea sólo Growth durante 100 ms y cambia HideBrush una vez por disparo. El tiempo de caída nativo no pudo recuperarse: el control usa un segundo como valor inicial, visible y editable. Las variantes FULL3/FULL2/SPLASH se recuperaron de los patches locales homónimos porque sus antiguas rutas Dropbox no existen. No son sustituciones por las variantes A.

## Integración y comprobación

La salida LED se comprueba con `npm run test:led`: verifica los 2.709.504 píxeles de seis bloques de 448 × 1008, la migración de sesiones anteriores y las dimensiones 2688 × 1008 del PNG y del stream de salida limpia. También captura los seis DDS reales. Resultado y capturas en `../captures/led-output-validation.json` y `../captures/led-dds-2688x1008.png`.

El controlador exporta `Parte2System`, independiente de la interfaz. `window.parte2` expone el sistema en el navegador. Sus entradas principales son `params.set(id,value)`, `params.trigger(id,arg)`, `dispatchMidi(message)`, `render(steps,dt)` y `output`. El adaptador de Parte 1 registra IDs bajo `parte2.*`, respeta la propiedad del estado del host y permite compartir el GPUDevice. [Integración concreta con Parte 1](../INTEGRACION_PARTE1.md).

Las pruebas de código están en `*.test.mjs`; las de navegador en `system-test.mjs`, `ui-test.mjs` y `live-system-test.mjs`. La evidencia se guarda en `../captures/`. Las pruebas del navegador usan Chrome y Playwright disponibles localmente; no son dependencias necesarias para abrir la aplicación. La comparación visual y de rendimiento contra vvvv ejecutando los mismos cues sigue pendiente. Los detalles de redondeo, rasterización, estado aleatorio y arranque de feedback pueden cambiar el resultado con el tiempo.

Medición local del 6/9/2026, Chrome headless con GPU NVIDIA Ampere, salida 3840 × 1200 y dos intervalos de diez segundos: FINAL solo avanzó **58,4 pasos/s**; con las siete fuentes DDS, seis capas Milky, FINAL, INK y warp, los cuatro estados A avanzaron **59,9 pasos/s**, FINAL **57,1** e INK **56,8**. La presentación estuvo alrededor de **59 callbacks/s**, con intervalo p95 **16,8 ms**. Los siete DDS avanzaron **22,7–24,8 frames/s**: el modo de espera de frames todavía impide asegurar 30 fps sostenidos con esa carga. La caché DDS quedó dentro de 128 texturas / 126,6 MiB, además de los intermedios de efectos y la caché INK. No hubo errores JS ni GPU. Son mediciones del port durante esa prueba, no una garantía de rendimiento ni timestamps aislados de GPU. [Informe completo](../captures/live-system-validation.json).

La interfaz se probó usando su `system/app.js` real: siete decks, controles manuales, CC públicos, Learn, páginas/filtros de mapeos, CSV, escenas, captura PNG, móvil y la ruta OSC UDP → SSE → parámetro. La prueba inicial de salida limpia verificó vídeo de 3840 × 1200; el formato actual de pantalla es 2688 × 1008. La prueba de regresión de la demo conservó los cinco hashes anteriores, incluido FINAL.

**Corrección MIDI comprobada:** Chrome enumeró los seis puertos reales de Windows y abrió exclusivamente `loopMIDI Port` durante ocho segundos; no llegaron mensajes externos durante ese intervalo. En otra prueba se enviaron 40 `MIDIMessageEvent` al listener del puerto abierto, sin emitir bytes al sistema ni modificar Ableton. Pasaron selección de escena, seis clips, seis Milky, FULL, BOTON, Note Off, kick/warp/snare/INK, Learn sin disparar el show y retorno de muestra manual a show. [Recepción nativa](../captures/midi-native-validation.json), [notas por el receptor real](../captures/midi-show-validation.json). `midi-native-probe.mjs` y `midi-show-test.mjs` conceden permisos sólo a su contexto de navegador de prueba; la página normal solicita su permiso al usuario.
