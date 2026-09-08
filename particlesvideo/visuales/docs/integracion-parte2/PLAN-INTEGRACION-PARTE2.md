# Integración de Parte 2 — plan vigente y ejecución

Actualizado **2026-09-08**. Manuel pidió corregir el plan y ejecutarlo: **copiar el paquete salvo las secuencias**, que ya están reunidas en el disco rápido. La implementación está incorporada al principal; la validación final se registra en [VALIDACION.md](VALIDACION.md).

## 1. Ubicación, decisión cerrada

El proyecto continúa en `PARTE 1/particlesvideo/visuales`. Se copió el paquete de `H:\BACKUP\desktop\ultra backup\001Set tecnopolis\milky-webgpu` a `vendor/parte2`: **111 archivos, 27.468.652 bytes**, incluyendo código, shaders, herramientas, páginas, documentación, capturas y overlay. Los hashes de la copia inicial están en [copia-sin-secuencias.json](../origen-parte2/copia-sin-secuencias.json); las adaptaciones posteriores se versionan con el principal.

**No se copió ninguna secuencia DDS ni INK, ni sus JPG.** Tampoco se movieron, convirtieron o borraron. Permanecen en `E:\PARTE2-MEDIA\dds`, `dds2`, `resize` e `ink`. El servicio integrado sólo resuelve las raíces configuradas del disco rápido; H: e I: no son dependencias de ejecución. El overlay de 37.626 bytes se sirve desde la copia local.

Las secuencias están fuera de `public/` y excluidas de Git, por lo que el build tampoco las duplica. Esta decisión reemplaza las opciones de copia masiva o mudanza; no queda pendiente elegir ubicación. El [análisis inicial](ANALISIS-INICIAL-2026-09-07.md) se conserva como histórico.

## 2. Qué quedó integrado

Una salida **2688×1008** en `http://localhost:5173/`, con las escenas anteriores y los siete players DDS, Milky A, variantes FULL, FINAL, INK, máscaras, warp, composición, MIDI/OSC, Learn y sesiones de Parte 2.

El editor principal (`editor.html`) tiene una pestaña **Parte 2**, que monta el mezclador original como control remoto de la salida. `parte2.html` permite abrir el mismo panel por separado. Ninguna variante crea otra GPU, otro audio o otra entrada MIDI.

| Archivo / módulo | Responsabilidad |
|---|---|
| `vendor/parte2/` | Paquete copiado y adaptaciones de registro, URLs y modo hosted. |
| `vendor/parte2/system/registry.js` | Registro puro de los **444 controles/acciones**, incluyendo composición y FULL, antes de Settings y Bridge. |
| `src/parte2/Parte2Controller.js` | Preparación, canvas, selección, sincronización con Params, sesión, controles remotos, errores y suspensión. |
| `src/parte2/scenes.js` | Identidades globales `parte2:60`…`parte2:80`. |
| `src/io/ShowInputRouter.js` | Entrada única para MIDI físico, OSC y pruebas; selección y enrutamiento por parte. |
| `src/core/Engine.js` | Único bucle visual: principal, Radiance o Parte 2. |
| `src/parte2/editor.js`, `parte2.html` | Mezclador remoto, parámetros, MIDI, medios, snapshots y sesiones. |
| `tools/parte2-media-service.mjs` | Medios de E: por HTTP, en desarrollo y preview, dentro del mismo origen. |
| `config/parte2-media.example.json` | Rutas predeterminadas. `parte2-media.local.json` permite cambios locales sin versionarlos. |
| `tools/osc-bridge.mjs` | Bridge existente más la entrada histórica UDP1002. |

Se conserva `base:'./'`, las entradas main/editor/fluids y se añade parte2 al build. No hace falta ejecutar el servidor del origen ni el puerto 8787. Para servir producción se usa el proyecto con `npm run preview`; `dist/` solo no contiene el servicio Node ni las secuencias externas.

## 3. Contrato del show y MIDI

Las escenas **1–29 conservan su significado**: 24 previa de Fluids, 25 secuencia y audio, **26 final reactivo que hereda la 25**. Se mantienen línea, piso, grillas, rays y torbellino del [contexto vigente](../CONTEXTO-ACTUAL.md).

La pista `scene` del set consultado sale por **RTX3090 (Port 2), canal 10**; `VIDS` usa ese puerto y **canal 13**. Se conservan las entradas habilitadas del principal; no se cambia Ableton ni se fuerza `loopMIDI Port`.

| Nota ch10 | Destino |
|---|---|
| 1–29 | Escena correspondiente del principal. |
| 60–80 | `parte2:60`…`parte2:80`, incluyendo **72**. |
| 49 | Sin contenido identificado; no se inventó una equivalencia. |

La [lectura del set](ableton-cues-2026-09-07.json) identificó cues 26, 67, 72, 68, 69, 70, 60, 66 y 49. Sus índices de slots son base cero, no números de escena.

Se conserva el mapper de Parte 2 por sus fórmulas, OR de notas, flancos y colas. La fila heredada `vvvv.scene` (0–71) se adapta a 60–80 al iniciar hosted, respetando fuentes aprendidas. El router procesa esos cues una vez y admite fuentes de escena aprendidas desde el otro banco. Las notas 1–29/ch10 siguen volviendo al principal incluso al importar una tabla antigua.

Los mensajes artísticos llegan a la parte activa. Selección y controles globales siguen disponibles. Learn consume antes de seleccionar; armar Learn en un editor cancela el del otro. Las tablas mantienen sus formatos y almacenamiento propios, sin concatenar los JSON.

- DDS: `floor(velocity / 127 * 68) % 68`; **127 selecciona el clip 0**.
- A: `floor(velocity / 127 * 3)`; FULL: `round(velocity / 127 * 4)` y su orden original.
- Se preservan colas de video de 20 ms y Milky de 80 ms; Note Off, dispositivos, CC120/123 y desconexiones liberan el estado correcto.
- Clock, Start, Continue, Stop y SPP pasan por el parser principal, con dispositivo, timestamp y canales 1–16. El seguimiento se elige con `transport.sync` y `transport.followMidi` de Parte 2.
- Una nota de video inmediatamente anterior al cue puede acompañarlo. Los mensajes durante preparación tienen una cola limitada y se descartan si llega otro cue del principal.
- Repetir una escena de Parte 2 conserva tiempo, fases y feedbacks. El reset es explícito. La excepción de la 7, que vuelve a desplegar el piso, permanece intacta.

OSC usa el WebSocket existente 8081. El UDP principal sigue configurable, 9000 por defecto; Parte 2 agrega 1002 (`PARTE2_OSC_PORT`, 0 lo desactiva). Si coinciden se usa un receptor. No se abre otro SSE ni se mata un servicio que ocupe el puerto. `/fx1`, `/fx2` y `/fx4` conservan los destinos originales.

## 4. Render, estado y persistencia

Parte 2 usa un canvas propio dentro del mismo stage, siguiendo el patrón de Radiance. No comparte GPUTexture entre devices ni hace readback CPU para componer cada frame. Engine renderiza sólo el motor activo.

El controlador prepara shaders, efectos y primeras lecturas; usa tokens y `Engine.whenIdle()` para que una carga tardía no sobrescriba un cue nuevo. Al suspender conserva recursos para volver rápido, libera gates/colas y corta el avance. Las lecturas ya en curso terminan dentro de las cachés acotadas.

El render hosted limita a **dos envíos GPU pendientes**. El acumulador mantiene pasos fijos con tiempo real, independiente del clamp físico de Parte 1. Master y blackout globales se aplican en el pase final. El preview remoto es de 672×252 a 2 Hz, con una captura pendiente y codificación en Worker; deja de solicitarse al ocultar/cerrar la pestaña.

Parte 2 no produce audio. Entrar desde Fluids pausa su sesión web y suspende su runtime. Volver a 24/25/26 sigue el contrato actual; el restart remoto también pasa por la selección central.

Los controles `parte2.*` tienen `sceneReset:false`. El adaptador se probó contra **Params real**, incluyendo enums numéricos y seek repetido. Params conserva `transient` y `retrigger`; Settings excluye el estado de Parte 2.

Parte 2 usa `parte2.session.v1` y `parte2.mappings` en el origen del principal. No pisa `vis.mappings`, `vis.settings` ni `vis.radiance.show.v1`. Hay import/export de sesión, snapshots, tabla MIDI y CSV. La importación inválida se rechaza antes de mutar.

**Los datos del navegador de la web antigua no viajan con los archivos.** Si hay sesiones o ajustes posteriores al paquete, se exportan desde aquella web y se importan en Parte 2. Ese recorrido está implementado; no se afirmó recuperar almacenamiento de otro perfil/origen.

## 5. Medios y límites del contenido

Se verifican **63 clips completos de 68, 42.395 de 48.030 frames**, sólo en E: (44 de `dds`, 13 de `dds2`, 6 de `resize`). INK tiene 1.067 DDS y 1.067 JPG. Las carpetas completas sumaban 53.886.438.165 bytes en la auditoría; permanecen allí.

Se configuran mediante JSON local o `PARTE2_DDS_ROOT` (raíces separadas por `;`), `PARTE2_INK_ROOT` y `PARTE2_OVERLAY`. El panel muestra la fuente por clip. Remap se limita a raíces configuradas y es temporal, como en el port; las rutas persistentes se editan en el JSON local.

| Clip faltante | Frames |
|---|---:|
| 63 · INCENDIO00 | 222 |
| 64 · bosqu | 361 |
| 65 · LOMBRIZ0 | 1.319 |
| 66 · capulloalien0 | 1.664 |
| 67 · mariposa | 2.069 |

Se conserva el fallback y su indicación de sustituto; no se generaron contenidos. Recuperar los cinco clips y definir el cue 49 siguen siendo pendientes de contenido. No impiden ejecutar lo disponible, pero impiden certificar que se recuperó todo el original.

Los seis clips de 2046×1080 se decodifican en GPU con aritmética entera BC1: producen los mismos píxeles y alfa que el decodificador original, evitando el coste de hacerlo en CPU. Los DDS alineados mantienen su carga comprimida directa. No se convirtió ninguna secuencia ni se cambió la espera de frames a saltos de reloj. Las peticiones y respuestas DDS/INK integradas usan `no-store`, para no duplicar secuencias en la caché de disco del navegador; se conserva la caché acotada en memoria/GPU. La comparación de píxeles y el rendimiento sostenido están en la validación.

## 6. Fases ejecutadas y comprobación

| Fase corregida | Resultado |
|---|---|
| A · Copiar sin secuencias | Paquete y overlay locales, procedencia preservada; cero DDS/INK copiados. |
| B · Leer el disco rápido | Servicio dev/preview y rutas `/parte2/`, sin H:/I: ni servidor 8787. |
| C · Integrar motores | Registro previo, canvas, cancelación y suspensión, master/blackout y límite GPU. |
| D · Integrar MIDI/OSC | Router, 60–80, 72 corregida, gates, dispositivos, Learn, reloj y segundo UDP en el bridge. |
| E · Integrar editor | Pestaña Parte 2, mezclador completo, parámetros, MIDI, medios, sesiones y preview remoto. |
| F · Validar | Tests, Chrome/WebGPU, build/preview y ensayo sostenido: [VALIDACION.md](VALIDACION.md). |

Desde `particlesvideo/visuales`:

```text
npm start
npm run build
npm run preview
npm run test:parte2
npm run check:parte2
node tools/check-parte2.mjs --seconds=600
node tools/check-parte2.mjs --production
```

Las pruebas de navegador usan perfil temporal, MIDI simulado y no se conectan al bridge real. Leen E: sin copiar medios. Los artefactos están en `performance-check/parte2/`, fuera de Git. Las pruebas GPU se ejecutan secuencialmente.

El ensayo físico con Ableton y la pared LED sigue siendo la comprobación operativa: las pruebas de software no sustituyen la elección de la entrada correcta ni resuelven el contenido faltante.
