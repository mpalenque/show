# Archivo hist?rico del an?lisis inicial

Las opciones de copiar secuencias o mudar el proyecto quedaron anuladas por Manuel el 2026-09-08. Leer PLAN-INTEGRACION-PARTE2.md para el contrato vigente.

# Plan de integración de Parte 2 en Visuales LED

## Decisión vigente — 2026-09-08

Manuel autoriza ejecutar la integración y corrige la ubicación: **copiar todo el paquete salvo las secuencias**. El código, shaders, controles, herramientas, documentación, capturas y overlay se incorporan al proyecto actual. **DDS e INK (DDS/JPG) permanecen en `E:\PARTE2-MEDIA`; no se copian, mueven, convierten ni duplican en este proyecto ni en el build.** El servicio integrado lee sólo las raíces configuradas del disco rápido. Quedan anuladas las alternativas anteriores de traslado del show o copia masiva de medios y la pregunta pendiente de ubicación. Los pasos de copia/verificación de secuencias de este documento se sustituyen por comprobación de catálogo y lectura desde E:. Estado: implementación en curso.

Fecha: **2026-09-07**, hora de Buenos Aires. Estado: **análisis y plan; la integración todavía no está implementada**. Pedido de Manuel: reunir la web de la segunda parte con el show principal y conservar su control desde Ableton. Este plan se apoya en el código y los archivos disponibles, además de una lectura del set abierto; no modifica el show ni Ableton.

## 1. Resultado propuesto

Una aplicación en `particlesvideo/visuales`, un arranque, la salida habitual `localhost:5173/` a **2688 × 1008**, y un editor que permita operar las dos partes. Ableton selecciona contenido del show completo sin abrir otra web ni reenviar notas dos veces. Se incorporan **los siete players DDS, los cuatro Milky A, las cuatro variantes FULL, FINAL, INK, máscaras, warp, composición, controles, Learn y sesiones** del paquete existente.

El contexto vigente del principal es [CONTEXTO-ACTUAL.md](../CONTEXTO-ACTUAL.md), actualizado el 7/9: 1–23 existentes; 24 previa; 25 secuencia Fluids; **26 final reactivo que hereda la 25**; 27–29 reservadas. Los documentos de Parte 2 todavía describen la 26 como motor libre: esa descripción quedó vieja y no se usará como contrato.

La integración técnica puede terminar con los 63 clips disponibles y sustituciones señalizadas para los otros cinco. La reproducción de **todo el contenido original** no puede declararse completa mientras falten esos medios.

## 2. Lo que se comprobó

| Hallazgo | Evidencia y consecuencia |
|---|---|
| El paquete real es `H:\BACKUP\desktop\ultra backup\001Set tecnopolis\milky-webgpu` | Se leyeron `ANALISIS_PARTE_2.md`, `ENTREGA_PARTE2_WEBGPU.md`, `INTEGRACION_PARTE1.md`, el contrato MIDI y los módulos. Copiar solamente `system/` perdería motores y shaders de la raíz. |
| El código es JavaScript/WGSL, sin dependencias npm de runtime | No exige mezclar versiones de Three ni rehacer los efectos. `system/controller.js` ya admite `hosted:true`. |
| El inventario inicial del paquete suma 7.163.689.425 bytes | Incluye 4.895 DDS, 2.134 archivos de tinta y 35 capturas. Código/documentación sin medios ni capturas: 74 archivos, 1.057.996 bytes. La entrega escrita cambió durante el análisis; el informe final conserva sus nuevos hashes. |
| El catálogo resuelto tiene 63 clips completos | 42.395 de 48.030 frames; 49.313.584.000 bytes de DDS seleccionados. Con tinta, código y capturas, la entrega disponible ronda **50,4 GB** decimales, sin contar el principal. |
| El código más reciente prioriza `E:\PARTE2-MEDIA` | La comprobación final, usando **sólo E: para los DDS**, resuelve los 63 clips: 44 de `dds`, 13 de `dds2`, 6 de `resize`. También están los 1.067 DDS y 1.067 JPG de INK. Las cuatro carpetas completas suman **53.886.438.165 bytes (53,9 GB)**; incluyen frames adicionales a los seleccionados por el catálogo. |
| C: tenía 12.283.346.944 bytes libres | No alcanza para copiar todos los medios a la carpeta actual. E: tenía aproximadamente **226,7 GB libres** al cierre. No se borró ni movió contenido para liberar espacio. |
| El paquete aún no está registrado en Git en el origen | `milky-webgpu/` y `ANALISIS_PARTE_2.md` figuran como archivos sin seguimiento. Hay que copiar el estado del filesystem; un checkout del commit de ese repositorio perdería la web. |
| El adaptador ya registra `parte2.*` y ofrece tick externo | Falta conectarlo al host real, a la selección de parte, al editor, a medios, persistencia y ciclo de vida. Sus pruebas de host usan un doble de `Params`. |
| El host usa un canvas separado para Radiance | La unión visual puede seguir ese patrón: un canvas de Parte 2 dentro de la misma salida y sólo un motor activo por frame. No hace falta importar una textura WebGPU dentro de Three para este alcance. |
| Se ejecutaron los tests de la fuente | **63/63 aprobados** con Node 24. Son pruebas de la Parte 2 independiente y su adaptador, no una validación de la integración propuesta. |

El [inventario inicial](inventario-2026-09-07.json) conserva catálogo, tamaños, rutas, nombres y SHA-256 del código/documentación; capturó la copia de E: todavía en curso. La [comprobación final exclusiva de E:](medios-e-2026-09-07.json), posterior, confirma los 63 clips y la continuidad de nombres de INK, guarda los tamaños de las cuatro carpetas y los hashes actuales del código. Se leyeron cabeceras representativas DDS para resolver formatos. **Esta tarea no copió ni hasheó los medios completos**, ni midió rendimiento integrado: se verificó la copia realizada en paralelo en el origen, con nombres, cantidades, tamaños y cabeceras. El overlay de 37.626 bytes sigue en H: y se copiará junto con el código. No son snapshots transaccionales de discos que siguen en uso.

## 3. Dónde guardar y cómo copiar

**Propuesta de trabajo:** mantener el código principal en la ubicación actual y configurar los medios que ya están en E:, sin otra copia masiva. Sigue siendo una aplicación y un comando de arranque, con un archivo de configuración que identifica sus medios. Esto conserva una dependencia física de E:. Si se quiere también una sola carpeta transportable, ubicar **el show completo** en una carpeta nueva de E:, con medios en una subcarpeta relativa. Se consultó esta preferencia; no se presupone una respuesta ni se ejecuta una mudanza en este plan. Para copiar las carpetas completas de medios reservar al menos 53,9 GB más el principal, el código, las configuraciones y espacio de trabajo; 50,4 GB es la estimación de una selección depurada por catálogo, no el tamaño de esas carpetas completas.

Estructura del proyecto integrado:

```text
particlesvideo/visuales/
  vendor/parte2/                 paquete completo de código, shaders, demo y herramientas
  src/parte2/                    controlador del host, adaptación de registro y estado
  src/core/ShowCoordinator.js    selección y ciclo de vida de los motores
  src/io/ShowInputRouter.js      entrada única y routing de cues, MIDI y OSC
  src/editor/                    controles remotos de las dos partes
  config/parte2-media.local.json rutas del equipo; ignorado por Git
  config/parte2-media.example.json
  tools/parte2-media-service.mjs servicio local reutilizable desde dev y preview
  docs/integracion-parte2/       plan, inventario, contratos y validaciones nuevas
  docs/origen-parte2/            documentación y evidencia original, con hashes
```

Para una entrega en una carpeta, agregar `media/parte2/` **fuera de `public/`**. Así Vite no duplica decenas de GB en cada `dist/`. El servidor entrega los medios por rutas HTTP del mismo origen. Código, catálogo y manifiestos quedan en Git; DDS y tinta se transportan con un comando de empaquetado/verificación, no por Git normal. Conservar un manifiesto de medios versionado hace que un clone incompleto pueda diagnosticarse.

La copia se hará en este orden:

1. Registrar el estado del principal y guardar/exportar configuraciones de salida y editores. El árbol de trabajo tiene cambios previos en Fluids, MIDI, rayos, piso y línea; el punto de retorno debe incluirlos, no sólo el último commit.
2. Copiar a un directorio nuevo `vendor/parte2/` todos los archivos de código, shaders, herramientas y páginas del paquete, más `media/overlay/part2-overlay.png`. Mantener la estructura relativa. Excluir `.git`, logs y medios voluminosos; trasladar la evidencia original a `docs/origen-parte2/`. No ejecutar los lanzadores del origen como parte del principal.
3. Resolver **por clip completo** cuál es la fuente final. Reutilizar las cuatro carpetas de E:, verificadas al cierre con los 63 clips y la tinta. H:/I: quedan como fuentes de recuperación si una nueva verificación detecta pérdidas, no como dependencias de ejecución. Conservar las carpetas de procedencia cuando haya nombres coincidentes; no aplanar carpetas a ciegas ni renumerar el catálogo. Reutilizar `matchClipFiles` y su regla de nombres, sufijos y cantidad de frames.
4. Antes de copiar: producir manifiesto por archivo con origen, destino, bytes y SHA-256; comprobar espacio y que los destinos resueltos pertenecen al directorio elegido. Copia reanudable sin borrar origen, sin `/MIR`, sin mover ni reemplazar contenido distinto por nombre. Usar archivo temporal y rename al terminar cada archivo.
5. Verificar hashes del destino, cantidad exacta por clip, tinta BC7/JPG y overlay. Resolver otra vez el catálogo **con las rutas de destino exclusivamente**, sin fallback silencioso a H:/I:. La auditoría final ya confirma las cantidades en E:; la validación de copia por hash sigue pendiente.
6. Registrar la procedencia en el manifiesto. Una copia fiel del código no demuestra que también se hayan trasladado sesiones guardadas en el navegador.

No hacen falta vvvv, las DLL, la instalación DX11 ni los patches para ejecutar el port. Preservar `ANALISIS_PARTE_2.md` y las referencias originales como documentación; no importar toda la carpeta histórica `001Set tecnopolis` como dependencia del show.

## 4. Cues comprobados en Ableton

Consulta sólo de lectura del set abierto: 47 pistas, 90 slots de escena, tempo 180 BPM en ese momento. `scene` (índice 31) sale por **RTX3090 (Port 2), canal 10**; `VIDS` (índice 30) por **el mismo puerto, canal 13**. El port autónomo pide `loopMIDI Port`, pero el host integrado debe usar las entradas habilitadas del principal, sin cambiar el routing de Ableton.

Los índices de slots siguientes son **base cero**, como la API; no son los números de nota ni el orden artístico de escenas. Se leyeron las notas de 48 clips de `scene`, no se dedujeron por sus nombres vacíos. [Evidencia](ableton-cues-2026-09-07.json).

| Slots de `scene` | Nota real ch10 | Tratamiento propuesto |
|---|---:|---|
| 37 | 26 | Final reactivo de Fluids actual. |
| 40–41 | 67 | Entrar a Parte 2, escena interna 67. |
| 42–45 | **72** | Entrar a Parte 2, escena interna 72. **Corregir el rango 0–71 del receptor heredado.** |
| 46–70 | 68 | Parte 2, escena 68; repetir el cue conserva feedbacks y fases. |
| 71 / 72 / 73 | 69 / 70 / 69 | Parte 2, respectivas escenas internas. |
| 81–88 / 89 | 60 / 66 | Parte 2, respectivas escenas internas. |
| 39 y 78–80 | **49** | Cue existente sin contenido identificado en el host 1–29. No inventar que inicia FINAL o que equivale a 60. Su intención queda por resolver para el recorrido completo. |

Propuesta de identidad: conservar `scene.goto('1'…'29')` para el principal; añadir IDs globales **`parte2:60`…`parte2:80`**, con `parte2.scene.current` numérico dentro del port. La nota ch10 67 se resuelve a `parte2:67`; ch10 26 vuelve a la 26 actual. Los números internos de Parte 2 no pasan directamente al `SceneManager` original. El editor muestra bancos **Parte 1 / Fluids / Parte 2** y la escena seleccionada; las reservas 27–29 permanecen disponibles.

Los cues numéricos 60–80 se pueden mantener en Ableton. El router del host los consume una vez; la fila interna `vvvv.scene` no vuelve a procesar esa misma nota. El módulo integrado debe ofrecer una entrada de **cue de show**, distinta de `recallScene` manual: hoy `controller.action('scene.goto')` distingue ambos por `meta.mappingId === 'vvvv.scene'`. Llamar al adaptador sin ese contexto podría cargar un snapshot manual y cambiar el contenido del show.

## 5. Entrada única, Learn y reloj

Flujo: **Web MIDI / OSC / editor de pruebas → ShowInputRouter → controles globales o mapper de la parte activa → Params / acciones → motor activo**.

- La selección global, master, blackout y Learn funcionan en cualquier parte. Los mapeos artísticos de la parte inactiva no reciben disparos. Lo aprendido por el usuario tiene una política explícita de prioridad; un mensaje consumido por Learn no selecciona una escena.
- Conservar el mapper de Parte 2: el del principal no soporta todas sus extensiones (`source.notes`, `noteRange`, flanco agregado, `releaseMs`, transformación por velocity). No basta concatenar los dos JSON.
- Exponer ambas tablas en el editor con su banco, monitor, import/export y Learn. Los destinos integrados llevan prefijo `parte2.*`; IDs y metadatos originales se conservan para round-trip. El perfil público contiene CC en ch11/12/14/15/16 y acciones en ch16. No se dispara a la vez con los controles de Fluids.
- Preservar las fórmulas del selector: DDS `floor(v/127*68)%68` (**127 vuelve a 0**); A `floor(v/127*3)`; FULL `round(v/127*4)` con la incertidumbre histórica del redondeo documentada. Preservar colas 20/80 ms, Note Off, OR de notas y fases al cambiar clips.
- Ampliar `src/io/MidiInput.js`: hoy descarta clock, Start, Continue, Stop y SPP, y no publica identidad de dispositivo. Agregar esos mensajes sin alterar la convención de canales 1–16. Desconexión, deshabilitar puerto y CC120/123 liberan las notas del dueño correcto.
- Añadir liberación explícita al mapper principal: conserva `_held`, pero no ofrece todavía el `releaseAll` del port. Liberar gates y temporizadores al salir de un banco evita que un Note Off tardío deje estados encendidos al volver.
- `Bridge.fakeMidi`, OSC y entradas físicas deben pasar por el mismo router. Hoy `fakeMidi` va directo al mapper principal; dejarlo así produciría pruebas distintas del show real.
- El **único bucle visual sigue siendo Engine**. Parte 2 recibe delta real acotado y usa el acumulador fijo del adaptador; el clamp físico de MLS-MPM no debe convertirse sin decisión en el reloj de los DDS. Mantener inicialmente la política original de pausar un deck si falta su frame; cualquier cambio a saltar frames se valida como cambio visible y temporal.

## 6. Salida, cambio de motor y rendimiento

**Ruta elegida para la primera integración:** canvas WebGPU exclusivo de Parte 2 en `#stage`, bajo el mismo ajuste CSS/DPR y el coordinador del principal. Su GPUDevice puede ser propio. Como sólo se presenta un motor, no se intercambian texturas entre devices ni se hace readback CPU por frame. Es el patrón que el proyecto ya usa para Radiance.

Compartir una textura con Three es una alternativa posterior si se necesitan mezclas simultáneas. Three 0.176 instalado acepta inyectar un device y pide BC cuando la GPU lo soporta; aun así, importar una textura ajena al backend y garantizar su lifetime requiere trabajo específico. No es requisito para unir este show secuencial.

`ShowCoordinator` será dueño de preparación, parte solicitada, parte activa, errores y visibilidad. La preparación usa tokens de generación y la barrera `Engine.whenIdle()`; los cues nuevos cancelan la activación tardía de los anteriores. El estado debe distinguir `preparing`, `ready`, `active`, `suspended` y `error`.

Al entrar a Parte 2: preparar GPU/catálogo, armar modo show explícitamente, aplicar el cue una sola vez, suspender Radiance/MLS-MPM, pausar el audio web y mostrar el canvas al disponer del primer frame válido. Precargar antes del tramo los shaders/estados necesarios y primeros frames: las notas VIDS muy cortas se perderían si se empieza a cargar todo en su Note On. Si llegan entradas durante una preparación fría, almacenarlas ordenadas y ligadas a la generación, incluidos los releases, con límite visible de cola.

Entre escenas de Parte 2 se mantienen feedbacks, fase DDS y controles latched. No llamar `armMidiShow`, `reset` ni reaplicar `BASE` en cada cue interno. El reinicio queda como acción explícita. Al salir: detener avance y nuevas precargas, cancelar colas y gates, ocultar la salida y conservar sólo los recursos necesarios para un regreso rápido. Las escrituras GPU pendientes deben terminar o cancelarse de manera segura. El adapter hosted actual no tiene el límite de dos envíos pendientes del bucle standalone: incorporar un límite de trabajo GPU en vuelo y medirlo.

Master y blackout se aplican **una sola vez**, sobre la salida final de cada motor. El master local de Parte 2 puede multiplicar el global; ninguno debe anular un blackout del host. La salida sigue en 2688×1008, franjas de 448×1008, sin doble corrección de gamma ni overlay de controles en `?clean`.

La Parte 2 no reproduce audio propio. Su música queda en Ableton. Entrar desde 25 pausa el transporte web; volver a 25 sigue su contrato actual de entrada/restart. No arrancar dos copias de audio.

## 7. Registro, editor y almacenamiento

El registro completo debe existir **antes de `Settings.load()` y del primer `Bridge.hello()`**, sin depender de que una descarga o la GPU ya estén listas. Extraer del port una función de definiciones puras compartida con su controller, incluyendo las definiciones FULL que hoy agrega dentro de `init()`. Registrar `parte2.*` una vez y adaptar `host-adapter.js` para enlazar definiciones preexistentes cuya identidad le pertenece. Suspender/destruir el runtime no debe borrar los controles del editor.

El adaptador actual copia `sceneReset:false`, pero `Params.define()` del principal descarta metadatos `transient`/`retrigger` y no notifica un `set` repetido al mismo valor. Revisar particularmente **seek repetido**, enums numéricos de `transport.rate`, acciones con argumento, límites y eventos derivados. Validar contra `Params` real, no sólo el doble de los tests del paquete.

La salida conserva la autoridad sobre sesión, snapshots y tabla de mapeos de Parte 2. El editor remoto manda órdenes; no crea otro `Parte2System`, otro lector MIDI ni otro bucle. Integrar una pestaña de decks/medios/snapshots en `editor.html`, reutilizando la lógica del mezclador mediante una fachada remota. Preview limitado como el de Fluids, sin segundo renderer.

Las claves autónomas `parte2.session.v1` y `parte2.mappings` de `127.0.0.1:8787` no viajan al copiar archivos. Exportarlas antes de la migración y ofrecer una importación validada al estado integrado (`vis.parte2.*`, nombres propuestos). No sobrescribir `vis.mappings`, `vis.settings` ni el documento `vis.radiance.show.v1`. Settings del host excluye el estado transitorio de Parte 2; la sesión de Parte 2 guarda sus propios ajustes. La migración de mapeos parte de la versión actual **16**, respeta filas aprendidas/editadas/eliminadas y no regenera CC desplazando sus asignaciones.

## 8. HTTP, OSC y arranque unificado

Reutilizar `createMediaServer` como módulo desde un servicio del proyecto. La URL de medios será inyectable (`/parte2/api/catalog`, `/parte2/media/…`, `/parte2/ink/…`, `/parte2/assets/…`). Actualizar los fetch absolutos de controller, DDSLibrary, InkPlayer y compositor. Resolver correctamente el prefijo cuando Vite sirva bajo un subdirectorio.

Montar ese servicio tanto en **Vite desarrollo como en preview/producción**. `createParte2ViteProxy` del port sólo configura `server.proxy`: copiarlo tal cual no resuelve la distribución completa ni la política de origen de `media/remap`. Preservar `base:'./'` y las entradas actuales main/editor/fluids. Servir DDS por streaming con caché y límites; remap sólo dentro de raíces configuradas. Persistir la configuración de raíces y mostrar qué disco aporta cada clip.

El comando habitual inicia web, medios y el bridge necesario. El servidor standalone de H: deja de ser una dependencia. HTTP no importa ni arranca `server.mjs`, porque ese archivo abre además su OSC en 1002.

Conservar el UDP configurable del principal (9000 por defecto) y su WS 8081. Si hace falta la entrada histórica **UDP1002**, agregar un segundo receptor en el mismo bridge, con origen identificado, sin rebind del puerto principal ni un segundo stream SSE al navegador. `/fx1`, `/fx2`, `/fx4` llegan una vez al mapper activo; `/fx3` sigue sin consumidor gráfico. Detectar un puerto ocupado y mostrar el proceso/servicio pendiente de resolver, sin matar servidores ajenos.

## 9. Medios faltantes y cuellos de botella

| Clip | Nombre del catálogo | Frames faltantes |
|---|---|---:|
| 63 | INCENDIO00 | 222 |
| 64 | bosqu | 361 |
| 65 | LOMBRIZ0 | 1.319 |
| 66 | capulloalien0 | 1.664 |
| 67 | mariposa | 2.069 |

Total: **5.635 frames** ausentes de las fuentes que resuelve el sistema. Se conserva `media.fallback` y su indicación de Sustituto en el editor; el clip solicitado no cambia. No generar reemplazos ni afirmar equivalencia sin material nuevo. El importador existente permite incorporar los originales o reemplazos elegidos posteriormente.

Los clips 27–31 y 49 tienen **2046×1080**: el port los decodifica en CPU porque no usa la subida BC directa con ese ancho. Para el show integrado, medir primero ese caso. Si afecta los cues, mover la decodificación a Worker o generar una copia compatible conservando originales y validando encuadre/calidad. No convertir todo el catálogo preventivamente.

Las mediciones guardadas del port describen pruebas cortas cercanas a 60 callbacks/s y 28–29 frames DDS/s con todas las capas; otra sección de su entrega conserva cifras anteriores de 18–20. Ninguna es una medición de la aplicación integrada ni una garantía de 30 fps de video o 60 fps sostenidos. Mantener separadas frecuencia de presentación, pasos de efectos y avance de cada deck.

La actualización de `ENTREGA_PARTE2_WEBGPU.md` del 7/9 registra además un benchmark de lectura secuencial: E: supera el caudal de siete decks y H:/I: no. Es evidencia del origen, no una medición nueva de esta tarea ni una simulación completa de siete lectores simultáneos. Refuerza la elección de E: para el show; no sustituye los ensayos de reproducción y latencia MIDI de la fase F.

## 10. Fases y criterio de cierre

| Fase | Trabajo concreto | Se considera terminada cuando… |
|---|---|---|
| A · Copia y medios | Snapshot del principal, vendor de la web, export de sesiones, configurar ubicación elegida y manifiestos | Código coincide con los hashes; catálogo de destino exclusivo tiene los 63 clips completos + tinta y overlay; cinco faltantes identificados. |
| B · Servicio integrado | Rutas configurables, middleware dev/preview, arranque y OSC unificado | El build sirve catálogo, remap y medios sin H: ni I:, sin servidor 8787 y desde la ubicación elegida; no se duplican medios en dist. |
| C · Motor hosted | Registro puro, adapter contra Params real, canvas, coordinador, warmup y suspensión | Se alterna Parte 1/Fluids/Parte 2 en la misma salida, con master/blackout, un solo bucle y cancelación correcta de entradas pendientes. |
| D · MIDI completo | Router global, cues 60–80, extensión 72, bank de mappings, clock, gates y Learn | Cada entrada llega una vez; notas 67/68/72/69/70/60/66 funcionan; una nota de regreso selecciona el principal; releases y Learn no provocan cues extra. |
| E · Editor y persistencia | Pestaña Parte 2, siete decks, medios, snapshots, monitor, import/export y preview remoto | Todos los controles del registro son editables, las sesiones sobreviven recarga y no se alteran las claves ni los mapeos existentes. |
| F · Ensayo y entrega | Cues reales, pruebas largas, portabilidad y documentación | Se cumple la matriz siguiente y se registra qué falta para el contenido original. |

Matriz mínima de validación:

- Regresiones de escenas 2 y 7, grillas, rays/torbellino, 24/25/26 y mapeos versión 16. Mantener separada la falla conocida de `smoke-learn` al evaluar resultados.
- Cues 26→Parte2:67→72→68→69→70→Parte1, repetidos, Note Off, cambios rápidos y cancelación durante preparación. Probar entradas cortas del canal 13 en el mismo instante que el cue de escena y en ambos órdenes de llegada.
- Los siete DDS independientes, todas las variantes A/FULL, FINAL e INK independiente; seed, warp, máscara, orden de composición y selección por velocity, incluido 127.
- Gates con acordes, dispositivos, desconexión, CC120/123; colas sin reapariciones tardías; Start/Continue/Stop/SPP; Learn por nota/CC/OSC sin ejecutar el contenido aprendido.
- Sesión real exportada de 8787, importación inválida atómica, reload, seek repetido, enums numéricos, nuevos CC sin desplazar los aprendidos y preset manual distinto del cue original.
- Desarrollo y build servido: mismo URL operativo, rutas bajo base, output 2688×1008 y DPR, master/blackout, sin audio duplicado y sin trabajo periódico del motor inactivo.
- Ensayos GPU **secuenciales**, al menos 10 minutos con todas las capas y reproducción de los tramos del set. Reportar p50/p95/p99 de frame, latencia desde MIDI a presentación, avance DDS por deck, fallos de lectura, recursos y memoria tras alternar repetidamente. Incluir caché fría y los seis clips 2046×1080. Objetivo de presentación 60 fps y DDS nominal 30 fps, pendiente de medición.
- Verificación final con H:/I: fuera de las raíces disponibles. Para la variante de una sola carpeta, verificar además todas las rutas relativas tras copiar a otra ubicación. No desconectar discos ni modificar el transporte de Ableton durante el análisis.

## 11. Pendientes que requieren una decisión de contenido o ubicación

**Ubicación física:** proyecto en C: con medios en E:, o una copia completa del show en una carpeta de E:. El espacio disponible descarta copiar todos los medios en C: tal como está hoy. La escritura/mudanza elegida será una fase de implementación posterior.

**Cue 49:** establecer qué debe mostrar en los slots identificados. No bloquea el montaje de las escenas 60–80, pero sí la certificación de todo el recorrido del set.

**Cinco clips:** obtener originales o elegir sus sustitutos definitivos. El fallback temporal permite ensayo e integración; no equivale a recuperar esas escenas.

**Cadencia DDS:** conservar por ahora la espera de frame del port. Cambiarla a reloj musical con saltos requiere una validación visual y temporal específica si las mediciones demuestran que hace falta.

Este plan deja definidas la estructura, los dueños de estado, las entradas, las dependencias y los criterios de aceptación. La copia masiva y los cambios de runtime quedan como trabajo de implementación; los únicos archivos nuevos de esta etapa son el plan y su evidencia de auditoría.
