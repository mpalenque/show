# Integración de Radiance desde la escena 24

## Decisión vigente — reemplaza la asignación de la primera integración

**2026-09-06: escena 24 = previa negra con sólo una línea blanca; timeline 0 detenido, física vacía/preparada. Escena 25 = PLAY del timeline completo desde cero. Audio siempre desde Ableton: la web nunca reproduce el WAV.**

Las notas existentes del canal 10 son 24 para previa y 25 para PLAY. Las notas repetidas no reinician; `fluids.restart` es explícito. Entrar en 24 o 25 desactiva el loop de ensayo. El motor live queda conservado sin escena asignada; **26–29 siguen libres**. El WAV queda para waveform/referencia y el reloj visual arranca con el cue, sin seguimiento automático de posición externa.

**Estado actual: implementado y funcionalmente verificado, con 217 tests, TypeScript y build aprobados.** Flujo, MIDI, previa blanca/vacía, ausencia de audio web, editor y subruta de producción aprobados. El rendimiento varió: primera producción con 45 intervalos >20 ms y máximo 83,6 ms; repetición sin cambios a ~60 FPS y máximo 17,5 ms. No está cumplida una garantía permanente de 50 FPS ni de 50 Hz físicos. [Validación nueva](VALIDACION-CUES-24-25.md).

La documentación canónica está en [contexto actual](../CONTEXTO-ACTUAL.md), [sistemas](../ARQUITECTURA-Y-SISTEMAS.md) y [configuración](../CONFIGURACION.md). El [plan original de Fluids](../origen-radiance/INDICE.md) está copiado y verificado por SHA-256.

**El registro de abajo conserva el plan y los resultados de la primera integración.** Sus indicaciones «24 PLAY / 25 live», audio local o armado de reproducción están reemplazadas. Sus pruebas no validan la nueva asignación; consultar el contexto actual para resultados de esta entrega.

---

## Registro histórico de la primera integración

Fecha: 2026-09-06. Estado: **integración funcional, presentación de producción y preview verificados; presupuesto estricto de física no cumplido durante toda la pieza**.

[Guía de operación vigente: previa 24, PLAY 25, audio externo y editor](OPERACION.md).

El contenido principal a integrar es **Fluids, el show con timeline propio**, dentro de la salida y los controles de `particlesvideo/visuales`. Se conserva el proyecto Radiance completo para poder incorporar después Tres Masas, Depth Sorter, Bloques y Voronoi. Las escenas 1–23 deben conservar su funcionamiento y aspecto, incluidos los últimos ajustes de piso, rayos y torbellino.

**Asignación confirmada por Manuel:** entrar en **escena 24 da PLAY a la escena completa ya escrita en el timeline**; la **escena 25 usa el mismo motor de fluidos 2D para control en vivo por MIDI**, cuyos comportamientos se definirán después. El timeline conserva su editor, curvas y eventos como una unidad dentro de la 24. Sus secciones internas no ocupan las escenas 25 en adelante.

### Estado de ejecución

Ya existen el runtime compartido, el transporte/documento bajo autoridad de Output, la conmutación de motores, los controles live y el editor remoto `fluids.html`. Se conserva el ancho de rayos de Parte 1 en **0,014 m**, y las notas existentes de escenas **24/25 en canal MIDI 10**. No se agregó una coreografía musical a la 25 ni se asignó contenido a 26–29.

Respaldos previos: **`17ff81a` en el repositorio `particlesvideo`**, y **`e91ec3b` en la copia `radiance-live-show`**, con el export recuperado. El proyecto original de `heidi` permanece sin modificaciones.

| Validación | Estado actual |
|---|---|
| Código del paquete Radiance | 198 tests aprobados. |
| Transporte/documento integrado | 8 tests aprobados; igualdad completa del JSON publicado comprobada. |
| Preview, tipos y compilación | 4 tests del preview aprobados; total 210. TypeScript y build de producción aprobados. |
| Tres pasadas completas de producción | 9.156 / 9.156 / 9.155 frames activos a 60,001 FPS; p99 17,1 ms; máximo global 17,9 ms; ningún intervalo >20 ms. |
| Física en las tres pasadas | Promedios 58,52 / 57,13 / 57,94 Hz; menores ventanas de 1 s 50,95 / 42,45 / 45,49 Hz. No cumple el mínimo estricto de 50 Hz durante toda la pieza. |
| Regresión de 1–23 y cambios entre motores | Aprobados. 20/21 con y sin rayos: cuatro casos de 601 frames a ~60 FPS, máximo global 18,5 ms y ninguno >20 ms. |
| Editor de producción | Siete pruebas funcionales aprobadas: documento/lanes, transporte, edición/ACK/deshacer, ruta MIDI, cancelación durante drenaje, preview y DPR. |
| Rendimiento del preview | Corregido: 427 frames a 60,001 FPS, p99 17,2 ms, máximo 18,6 ms y ningún intervalo >20 ms. 15/15 capturas completadas; máximo CPU de captura 0,3 ms tras preparación. |

La presentación cumplió el presupuesto medido; eso no basta para declarar resuelto el requisito de cero retrasos: el solver WASM registra pasos de hasta 36,4 ms y snapshots de hasta 38,2 ms. Se mantienen los tres subpasos y la física del show escrito. La fase de rendimiento sigue abierta por ese límite físico. [Resultados detallados](RENDIMIENTO.md). La última sesión original de navegador sigue sin compararse; se puede importar un export posterior sin resembrar el snapshot recuperado.

## 1. Lo que ya quedó conservado

| Elemento | Estado |
|---|---|
| Proyecto de origen | `C:/Users/mpale/OneDrive/Desktop/heidi/radiance-live-show` |
| Copia completa en este workspace | [radiance-live-show](../../../../radiance-live-show/) |
| Revisión de origen | `18998e4bd48558b88013c2242194001ed33923dc`; árbol limpio al inspeccionarlo |
| Archivos copiados | 6.254; 270.335.588 bytes; incluye `.git`, `.github`, código, recursos, documentación, herramientas, dependencias y `dist` |
| Verificación | SHA-256 de cada archivo de origen contra la copia: ninguna diferencia |
| Export encontrado | `C:/Users/mpale/Downloads/fluids.show.json`, fecha local de modificación 06/09/2026 01:19:47 |
| Export recuperado en la copia | [public/show/fluids.show.json](../../../../radiance-live-show/public/show/fluids.show.json) |
| Contenido del export | 152,694 segundos; 256 eventos; 400 claves en curvas; 0 clips de gesto |
| Validación del export | Parseado con `parseShowDoc` del proyecto; copia verificada por SHA-256 |

El JSON recuperado es una **adición explícita a la copia**: no existía en `public/show` del origen. La copia del repositorio conserva sus 6.254 archivos originales y suma este documento. El proyecto de `heidi` permanece como origen separado.

Registro de procedencia: [integracion-radiance/estado-copia.json](estado-copia.json).

### Estado que puede seguir solamente en el navegador

El export recuperado permite empezar con contenido escrito, pero todavía hay que compararlo con la última sesión del editor original. El almacenamiento depende del origen del navegador: cambiar de puerto o de `localhost` a `127.0.0.1` puede mostrar otro estado.

| Contenido | Clave de almacenamiento original |
|---|---|
| Timeline Fluids | `radiance-fluids-show-doc-v1` |
| Ajustes por cue de Tres Masas | `radiance-tres-masas-page-v2` |
| Faders, looks y modulación del catálogo live | `radiance-live-show-state-v2`, con migración de v1 |

Antes de fijar la versión del show integrado, comparar el export con la sesión original y guardar cualquier versión posterior como otro snapshot. Conservar también los ajustes de los otros contenidos cuando se puedan exportar. **No volver a sembrar desde el análisis para reemplazar las ediciones del usuario.** El seed es una referencia, no una copia de seguridad de la sesión.

## 2. Hallazgos que determinan la integración

| Aspecto | Parte 1 actual | Fluids que se incorpora |
|---|---|---|
| Salida del show | 2688×1008 | 2688×1008 en la página `/fluids` |
| Render | Three 0.176.0, WebGPU | Render WebGL/HRC; versión de Three separada según lockfile Radiance |
| Simulación | MLS-MPM en GPU | Solver WASM en Worker |
| Control principal | `Params`, `SceneManager`, MIDI/OSC | Documento de curvas, eventos y gestos evaluado por tiempo |
| Reloj actual | `Engine.time` con delta limitado para física | `AudioTransport` usa `AudioContext.currentTime` |
| Interfaz | Salida limpia + editor separado | `/fluids` reúne timeline, preview, audio y perform |

El README genérico de Radiance describe una salida **3360×1008**. Ese tamaño corresponde al catálogo `/output`; **el show seleccionado ya trabaja a 2688×1008**. No hace falta deformarlo ni adaptarlo a 3360.

Piezas reutilizables, ya separadas de React:

- [FluidScene.ts](../../../../radiance-live-show/src/scenes/fluid/FluidScene.ts): ciclo de vida del motor, documento, gestos y render de Fluids.
- [FluidsShowDirector.ts](../../../../radiance-live-show/src/scenes/fluid/FluidsShowDirector.ts): evaluación del documento por tiempo absoluto.
- [show-doc.ts](../../../../radiance-live-show/src/fluids-show/show-doc.ts): formato JSON y muestreo de curvas/eventos.
- [audio-transport.ts](../../../../radiance-live-show/src/fluids-show/audio-transport.ts): reproducción y reloj del audio.
- [FluidsEditorApp.tsx](../../../../radiance-live-show/src/fluids-show/FluidsEditorApp.tsx) y sus lanes: edición, undo/redo, importación y exportación.

Seleccionar solamente el look `fluids-show` no reproduce el show guardado: el adaptador también debe inyectar `setFluidsShowDoc(doc)`, tiempo y estado de reproducción.

## 3. Arquitectura implementada

**Una salida, una autoridad de control y un único motor visual trabajando por frame.**

`MIDI / OSC / editor → selector de escena → Parte 1 / Fluids con timeline (24) / Fluids en vivo (25)`

### Runtime de Fluids

Implementado `vendor/radiance/src/integration/FluidRuntime.ts`: un solver WASM, un renderer HRC y un canvas de 2688×1008, sin bucle, audio ni persistencia propios. Reutiliza el director, geometría, solver y renderer de Fluids. `RadianceController` prepara el runtime, coordina la entrada en 24/25 y recibe órdenes de MIDI/OSC/editor. `ShowSession` es dueña del documento, revisión, audio y tiempo absoluto.

La 24 recibe el documento y usa el `FluidsShowDirector` original. La 25 quita ese director y sus geometrías/gestos para recibir controles live. La transferencia espera el trabajo despachado al Worker antes de cambiar de modo. Se conserva la población al pasar 24→25; una entrada directa en 25 comienza vacía.

Enviar el documento sólo cuando cambia su revisión. `setDoc()` prepara integrales sobre toda la duración; no debe ejecutarse por frame.

En modo MIDI, los parámetros y acciones llegan desde `Params` y `Mapper` al mismo solver/render 2D. Desconectar la evaluación del director de timeline, sus eventos y sus gestos; pausar el reloj por sí solo no evita que un evento sostenido siga imponiendo valores. El cambio de controlador debe ocurrir antes de ejecutar el siguiente frame. No montar un segundo FluidScene para la 25.

### Convivencia con el motor actual

- El bucle de `Engine` continúa siendo el único que solicita frames visuales. Cuando está activo Fluids, omite actualización de capas, simulación MLS-MPM y compositor de Parte 1.
- Conservar inicialmente el renderer de Parte 1 suspendido. Hoy es dueño de `setAnimationLoop`; destruirlo también detendría el scheduler. Si la memoria exige liberarlo, primero mover el scheduler a un host independiente.
- Fluids dibuja directamente en su canvas: ya contiene HRC, composición y postproceso. No añadirle nuevamente AO y bloom del compositor actual.
- Aplicar brillo, blackout y encuadre del show a la superficie activa. Ocultar el canvas anterior no basta: se debe detener su trabajo real.
- La previsualización del editor usa telemetría/capturas de la salida activa con frecuencia acotada; no crea otro solver ni otro renderer.

### Cargas y cambios asíncronos

`SceneManager.goto()` sigue siendo síncrono. `RadianceController` intercepta 24/25 antes de modificar presets, prepara el runtime y confirma la entrada con una cola de cambios y un identificador de solicitud. Maneja:

- Estados `preparing / ready / active / suspended / error`.
- Solicitudes repetidas a la escena actual o pendiente sin redisparar el show.
- Un identificador de solicitud para descartar una carga que terminó después de pedir otra escena.
- Vuelta a una escena de Parte 1 sin que aparezca tardíamente el canvas de Fluids.
- Preparación de WASM, Worker, recursos y shaders antes del cue crítico, idealmente durante el armado inicial del show.

Al entrar en 24, el coordinador espera que termine el frame anterior, reinicia explícitamente el solver/director/radiancia y empieza el transporte en cero antes de mostrar el primer frame. Si falta activar audio local, conserva la solicitud pendiente. Un cambio posterior a otra escena invalida esa solicitud. El modo sin audio también comienza en cero con el cue; no interpreta posición externa de Ableton.

### Dependencias y recursos

La copia completa permanece como referencia. El destino contiene todo `src`, lockfile y configuración de Radiance en `vendor/radiance`, y sus recursos públicos bajo `public/radiance`. La resolución local mantiene separadas sus dependencias y Three 0.176.0 de Parte 1. `npm ci` en Visuales ejecuta `npm ci --prefix vendor/radiance` mediante `postinstall`; el build no necesita el repositorio original ni el servidor 4180.

Vite actual consume el TypeScript del adaptador; Radiance conserva su comprobación de tipos y herramientas en su configuración separada. El origen declara Node 22 y usa Vite 7. Su `package.json` no reemplaza al de Parte 1. La instalación reproduce ambos lockfiles y `npm run check:radiance` ejecuta las comprobaciones del paquete y del transporte integrado.

Servir recursos bajo un prefijo, por ejemplo `/radiance/`, y sustituir rutas absolutas del origen mediante un resolvedor de assets. Incluir Worker, JS/WASM del solver, audio, análisis, documento, texturas y avisos de procedencia. Verificar también el build de producción: que el Worker encuentre el WASM no puede depender del servidor 4180 ni del directorio `heidi`.

No se incorpora `/fluids` entero en un iframe como solución final: esa página posee su propio render, audio, controles y almacenamiento. Se reutilizan motor y editor separando esas responsabilidades.

## 4. Escenas 24 y 25: asignación definitiva

| Escena | Contenido | Quién gobierna el motor |
|---|---|---|
| **24 — Fluids / timeline** | PLAY de toda la escena pregrabada, con el timeline original de 152,694 s | Documento, director y transporte de Fluids |
| **25 — Fluids / MIDI** | Motor de fluidos 2D para desarrollar comportamiento reactivo en vivo | Parámetros y acciones MIDI/OSC del sistema actual |
| 26–29 | Reservadas, contenido pendiente | A definir por Manuel |

Las notas de escena ya existen en canal 10: nota 24 selecciona la 24 y nota 25 selecciona la 25. Conservar IDs y mapeos aprendidos. Los futuros mapeos de performance de la 25 se añaden mediante la migración existente y quedan filtrados por escena. Los hitos del timeline permanecen dentro de la 24 y no crean nuevos IDs globales.

### Escena 24: reproducir lo ya escrito

- Entrar desde otra escena prepara/reinicia el show y da PLAY desde `t=0`. No requiere después otro mensaje de play. La preparación previa debe permitir que empiece en el cue, según la política de audio definida en §5.
- Conservar completo el timeline, incluyendo sus curvas, eventos, colores, gestos disponibles, editor y navegación de ensayo. Es automatización del motor en tiempo real, no un video que reemplace al solver.
- Reiniciar debe rearmar explícitamente director, población del solver, estado temporal del render y transporte. `seek(0)` conserva historia física, y repetir `enter('fluids-show')` no garantiza un reset del mismo look. Adaptar y comprobar `resetFluidsShow()` para esta operación.
- El runtime integrado hace ese reset antes de comenzar: el arranque genérico original podía crear 20.000 partículas y depender de un evento en 0,05 s que el primer salto de tiempo podía omitir. Se conservó el evento del documento y se agregó el reset explícito de entrada.
- Una nota repetida mientras la 24 ya está activa no vuelve a iniciar la pieza. `fluids.restart` queda como acción explícita de ensayo.
- Las acciones MIDI de performance preparadas para la 25 no alteran el contenido escrito de la 24. Los controles globales de escena, master y blackout siguen disponibles.
- Al terminar el timeline, detener su transporte y conservar el cierre previsto. No entrar automáticamente en la 25: la 25 se selecciona como las demás escenas del show.

### Escena 25: el mismo motor, dirigido por MIDI

- Mantener el solver, el renderer y el canvas de fluidos 2D; cambiar la fuente de control a `Params`/`Mapper`.
- Al entrar, detener el transporte local y desacoplar director, automatizaciones, eventos pendientes y gestos del timeline. Con reloj externo, dejar de aplicarlo al visual sin detener Ableton.
- Una pausa en el último tiempo de la 24 no constituye modo MIDI: también hay que quitar las fuerzas/emisores/luces temporales que el director dejó activos y establecer la base del modo en vivo.
- Continuidad implementada: 24→25 conserva las partículas existentes mientras entrega el control a MIDI. Entrar directamente desde Parte 1 comienza vacío; una ráfaga `fluids.live.burst` o el parámetro `fluids.live.emission` generan partículas. Los efectos por nota se definirán después; no se escribió una coreografía nueva.
- El cambio de look actual llama a `stopFluidsShow()` y resetea partículas, materiales y radiancia. Implementar una transferencia de control específica si se conserva la continuidad; no asumir que llamar al modo manual existente deja intacta la simulación.
- Vaciar interacciones y pasos pendientes del Worker al cambiar de controlador. `cancelQueuedStep()` no cancela un paso ya enviado: cerrar ese paso y su respuesta antes de iniciar el primer paso MIDI, evitando que una respuesta tardía reactive órdenes del timeline. Mantener un único Worker.
- Preparar controles mapeables de emisión, posición y color de emisores, fuerzas, gravedad, viscosidad, luz e impulsos que el motor permita. Las notas/CC y sus comportamientos concretos se asignarán después; no convertir este objetivo en reactividad obligatoria por micrófono ni reutilizar arbitrariamente los golpes del show actual.
- Los cambios MIDI y ajustes en vivo no modifican el documento ni el autosave del timeline de la 24. Guardar la configuración live por separado.

### Salidas y vuelta a la 24

Volver de la 25 a la 24 restaura el documento de referencia, rearma la escena escrita y reproduce desde el principio. No debe heredar fuerzas, gestos, colores o parámetros temporales del modo MIDI. Al volver de cualquiera de las dos a Parte 1, suspender el Worker y detener el transporte local; el motor inactivo no sigue consumiendo GPU/CPU.

Los marcadores y seeks quedan como herramientas internas del timeline para ensayo. El muestreo por tiempo absoluto reconstruye controles, no la historia física completa de las partículas. Conservar y documentar esa semántica del original; no añadir reconstrucción costosa por cada marcador ni confundir esos accesos con las escenas 25 en adelante.

## 5. Transporte, edición y MIDI/OSC

La salida actual continúa siendo dueña del estado. `Params` contiene controles y acciones live; el documento complejo vive en un almacén versionado separado, también bajo autoridad de la salida. `vis-bus` se amplía para edición y estado del timeline. La escena selecciona un único controlador del motor: timeline en 24, MIDI en 25.

Operaciones implementadas:

| Operación | Propósito |
|---|---|
| `fluids.arm` | Preparar recursos y transporte antes del show |
| Entrada en escena 24 | Reiniciar y dar PLAY a la pieza completa; conservar protección contra notas repetidas |
| Entrada en escena 25 | Desacoplar timeline y habilitar control MIDI del mismo motor |
| `fluids.play`, `fluids.pause`, `fluids.restart` | Transporte y ensayo de la 24; reiniciar es distinto de recibir la nota de la escena activa |
| `fluids.seek` con segundos y loop del editor | Navegación interna del timeline de la 24, sin cambiar la escena global; no hay una acción `fluids.cue` |
| `fluids.document` + revisión, por bridge | Enviar un documento editado/importado sin convertirlo en cientos de mensajes por frame |
| Telemetría de tiempo, sección, duración y preparación | Playhead y diagnóstico del editor |
| Controles de ganancia/calidad necesarios | Integración con master y presupuesto de rendimiento |
| Parámetros/acciones live de fluidos 2D | Emisión, fuerzas, materiales e impulsos por MIDI/OSC, filtrados a la 25; mapeos concretos pendientes |

La selección de escena resuelve la precedencia: las curvas gobiernan la 24 y los controles live gobiernan la 25. Si más adelante se pide intervenir MIDI sobre la pieza escrita, añadir trims explícitos como una función nueva. Conservar ahora el documento de la 24 intacto y persistir por separado los ajustes y mapeos de la 25.

El editor remoto `fluids.html`, enlazado desde `editor.html`, conserva lanes, waveform, edición, undo/redo, gestos e import/export. No crea otro motor visual ni reproduce audio. La salida se identifica como `vis-salida` y publica estado/revisiones; un reemplazo basado en una revisión vieja se rechaza. El documento se guarda en `vis.radiance.show.v1`; los valores live y mapeos se conservan por Settings/Mapper, separados del timeline y de las claves originales del navegador.

La pausa musical mantiene el comportamiento del original: detiene reloj/emisión temporal, pero puede continuar la física. El final natural sí congela el cierre y mantiene la escena 24 seleccionada. Master y blackout controlan sólo la imagen, sin silenciar el audio.

### Modos de reloj implementados

- **Local, por defecto:** `ShowSession` precarga/decodifica `fluids.wav` y prepara waveform sin esperar `AudioContext.resume()`. El operador arma audio con un clic real en la salida; después la 24 reproduce siguiendo `AudioContext.currentTime`.
- **Silent, explícito:** no reproduce el WAV. Usa tiempo absoluto de `performance.now()` desde el cue de inicio para acompañar audio externo. No recibe posición de Ableton, no sigue sus seeks/pausas y no corrige deriva. La sincronización externa absoluta queda como trabajo futuro, no como una capacidad ya implementada.

Cambiar de modo pausa el transporte. Ninguno usa `Engine.time` limitado como reloj musical. La elección operativa para el show final sigue disponible en el selector del editor y en `fluids.audioMode`.

## 6. Fases y criterios de aceptación

| Fase | Trabajo | Debe quedar comprobado |
|---|---|---|
| 0 — Conservación | Copia, hashes y export recuperado completos; backups `17ff81a`/`e91ec3b` | Última sesión de navegador original todavía no comparada; se puede importar un export posterior. |
| 1 — Referencia | Snapshot publicado validado; identidad completa comprobada por test | Tres pasadas completas medidas y capturas de referencia conservadas; posible sesión original posterior sin comparar. |
| 2 — Runtime aislado | Implementado con código/lockfile/assets locales y un solo solver/render | Arranque de producción y funcionamiento sin motor duplicado comprobados. |
| 3 — Entrada en 24 | Coordinador, preparación, espera de audio y cancelación implementados | Cambios entre motores, notas repetidas y cancelación durante drenaje aprobados. |
| 4 — Timeline completo en 24 | Documento, relojes, editor, revisiones, persistencia e import/export implementados | Tres pasadas, pruebas funcionales del editor y rendimiento del preview aprobados. |
| 5 — Motor MIDI en 25 | Cambio de controlador, continuidad de población y controles live implementados | Transferencia, entrada directa y ráfaga por Mapper aprobadas sin editar documento; coreografía artística futura por definir. |
| 6 — Rendimiento y regresión | Presentación, preview y regresión 1–23 aprobados; 210 tests, TypeScript y build aprobados | Física por debajo de 50 Hz en algunas ventanas. El criterio completo no se cumplió; fase abierta por esa limitación. |

La implementación de ambas escenas y las verificaciones funcionales ya están completas. El límite de rendimiento que permanece es la frecuencia de actualización de la física densa; el preview corregido ya fue medido y aprobado. El diseño detallado de las reacciones MIDI de la 25 se realizará con las próximas indicaciones de Manuel.

## 7. Presupuesto de rendimiento

Objetivo: 60 FPS y **presupuesto máximo de 20 ms por frame** para cumplir el mínimo solicitado de 50 FPS. Medido en i7-12700 + RTX 3090, salida 2688×1008 nativa 1×, calidad high/HRC 1024: las tres pasadas presentaron a 60,001 FPS, máximo 17,9 ms y ningún intervalo >20 ms. Se excluyeron del análisis los frames posteriores a 152,694 s, cuando el cierre queda congelado.

La física promedió 58,52 / 57,13 / 57,94 actualizaciones/s, pero bajó a 50,95 / 42,45 / 45,49 en sus peores ventanas de 1 s. p95 de paso Worker: 20,1 / 22,0 / 20,8 ms; máximos 32,7 / 36,4 / 33,3 ms; edad máxima de snapshot 31,4 / 38,2 / 32,2 ms. **No se cumplió el mínimo de 50 Hz de física durante toda la pieza.** El render puede reutilizar respuestas mientras llega un nuevo paso; por eso 60 FPS no demuestra ausencia de atraso de simulación.

Los buffers se reciclan y se conservan tres subpasos para preservar el show escrito. No se atribuye este resultado exclusivamente a aplicaciones externas ni se promete una solución transparente cambiando población o física. El preview inicial superó 20 ms; corregido, presentó 427 frames a 60,001 FPS con máximo 18,6 ms y ninguno >20 ms. Usa ImageBitmap y JPEG 672×252 a 2 Hz codificado en Worker con OffscreenCanvas, sin otro solver. Las lanes se redibujan sólo al cambiar sus datos visuales, sin repintar por cada actualización de tiempo/estadísticas.

- Medir a 2688×1008 sobre la RTX 3090, con la carga de aplicaciones prevista para el show.
- Comenzar por render nativo 1× y comprobar paridad; la página original usa supersampling adaptable desde 2×. Activarlo en la salida sólo si la medición deja margen. Una reducción visual debe quedar identificada y comparada.
- Fluids permite habitualmente unas 14.000 partículas y ráfagas de hasta 36.000; el solver tiene capacidad para 40.000. Medir especialmente esos eventos del documento.
- HRC trabaja con perfiles de resolución distintos. Primero eliminar trabajo duplicado y medir; después ajustar calidad si hace falta, comparando luces y composición con la referencia.
- El Worker admite trabajo en vuelo y coalescencia: verificar duración de física, antigüedad del último snapshot y progreso real. Un canvas a 60 FPS mostrando una simulación retrasada no cumple el requisito.
- No cargar motores alternativos ni todos sus assets en GPU por haber conservado el repositorio completo.

Pruebas de aceptación:

1. Tres pasadas completas del track, incluyendo arranque frío preparado y repetición en caliente.
2. Medir intervalos reales entre frames y render efectivo, media, p95, p99, máximo y cantidad de intervalos >20 ms. Separar envío CPU, trabajo GPU cuando sea medible y tiempos del Worker.
3. Cambiar 23→24→25→24→20 repetidamente sin acumulación de Workers, listeners, contextos o memoria. Confirmar también entrada directa en 25.
4. Durante las explosiones y estrobos de la 24, inyectar notas mapeadas a la 25 y comprobar que no alteran ni reinician la pieza. Cambiar a 25 en medio de un atractor, una fractura y un gesto de prueba, incluyendo un paso del Worker en vuelo; verificar que el nuevo modo no sigue emitiendo órdenes del timeline y que sus ráfagas MIDI funcionan. Usar un documento de prueba separado si hace falta un gesto, sin modificar el show guardado.
5. Comparar eventos ancla al principio y al final del track para detectar deriva. Tras una pausa o un seek, medir recuperación temporal y continuidad física por separado.
6. Repetir las verificaciones de escenas 7, 20 y 21 de Parte 1 y una pasada de escenas 1–23.
7. Ejecutar build de producción y las pruebas relevantes existentes de documento, director y persistencia; añadir pruebas de transporte, cambio timeline/live, handoff, cancelación y propiedad del estado. Comparar el documento antes y después de una sesión MIDI: debe permanecer idéntico si no se editó explícitamente.

Si un caso supera 20 ms, registrar dónde ocurre y corregirlo antes de dar la integración por validada. No sustituir esa comprobación por los FPS del editor genérico de Radiance: algunas de sus métricas cuentan llamadas o tiempo CPU, no presentación real.

## 8. Otros contenidos conservados para después

| Contenido | Qué se conserva | Incorporación futura |
|---|---|---|
| Tres Masas | 18 cues, directores, geometría y editor dedicado | Puede reutilizar el mismo motor Fluid con sus ajustes por cue; requiere decidir ubicación después de Fluids |
| Fluid live | 11 looks y aperturas/directores existentes | Recursos para desarrollar la 25 y escenas live posteriores; conservarlos no activa sus directores automáticos en el modo MIDI |
| Depth Sorter | WebGPU, shaders, texturas y variantes Radiance | Adaptador propio; medir su WebGPU más overlay WebGL y corregir límites de tamaño antes de activarlo |
| Bloques | Planck, Three, HRC, paletas y acciones Q/W/E/R | Traducir acciones al Mapper y revisar encuadre 8:3 |
| Voronoi | Shader, atlas de bosque y variantes | Adaptador y validación del encuadre 2688×1008 |

Guardar estos contenidos no les asigna números definitivos ni los pone a renderizar. Su incorporación se hará usando el mismo contrato de runtime y los recursos ya copiados.

## Resultado esperado

Una única salida operable desde el editor y MIDI/OSC actuales: Parte 1 conserva sus escenas 1–23; **la 24 da PLAY al show completo de Fluids con su timeline conservado, y la 25 entrega ese mismo motor de fluidos 2D al control MIDI en vivo**. El resto de Radiance queda conservado localmente y disponible para ampliaciones, sin añadir carga al show activo.
