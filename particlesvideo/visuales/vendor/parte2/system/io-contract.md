# Parte 2 — contrato de entrada e integración

Las entradas llegan a `Mapper.dispatch(message)`. El mapper no conoce texturas, renderers ni escenas gráficas: escribe únicamente mediante `onControl(path, value, metadata)` y `onAction(action, value, metadata)`. `MidiInput` es el único adaptador que solicita acceso a Web MIDI. El output debe ser dueño de ambas instancias; un editor remoto envía órdenes y observa su estado.

## Fuentes inspeccionadas

- `MIDI SEQ PLAYER.v4p`, instanciado por `player maximus.v4p` y `ROOT PLAYER.v4p`: perfil activo de Parte 2.
- `MIDI.v4p`: sólo referenciado por las variantes `escena/esena 3d*.v4p`, sin instancia dentro de `player maximus`.
- `BOTON MIDI.v4p`: ninguna referencia desde otro `.v4p` del árbol. No es el emisor de `BOTON` usado por Milky.
- Ayudas instaladas `MidiNote (Devices)`, `MonoFlop (Animation)` y `GetSlice (Spreads)` de vvvv beta 42. MidiNote maneja NoteOn y NoteOff; MonoFlop se puede redisparar; GetSlice documenta explícitamente índices módulo cantidad de bins.
- PARTE 1, sólo lectura: `AGENTS.md`, `CONTEXTO.md`, `particlesvideo/visuales/docs/CONTEXTO-ACTUAL.md`, `public/mappings.default.json`, `src/io/MidiInput.js`, `Mapper.js`, `Bridge.js`, `OscClient.js`.

Los canales de las tablas son humanos, **1–16**. Los pins Channel del patch están guardados en 0–15. Las notas y CC conservan sus números MIDI 0–127. `MidiNote.Output` normaliza la velocidad por **127**, comprobado también en valores guardados (100 → 0.78740157480315).

## Tabla activa exacta

Todos estos emisores son globales: el patch MIDI no les aplica un filtro de escena. Los consumidores gráficos deciden si son visibles. El rango 60–80 cambia la ventana/ESTE PATCH; no apaga el quad de salida fuera de ese rango ni cambia las notas que escucha el receptor de escenas.

| Canal | Nota | Señal vvvv y transformación | Destino web |
|---|---|---|---|
| 10 | 0–71 | `Esccena` = número de nota. `I[0,72)` → OnData/Select → S+H → Frac. | Acción `scene.goto`, valor string. |
| 13 | 0–5 | `SeqX6[i]` = `floor(v/127 × 68)`, latched con velocidad positiva; selector de archivo GetSlice cicla módulo68. | `players.0..5.clip`, fórmula final `%68`. Con `media.fallback` activo, un clip sin medios completos se reproduce con el sustituto `disponibles[índice % disponibles]`; el parámetro conserva el índice pedido. |
| 13 | 0–5 | `VIDX6[i]`: `v>0` → MonoFlop de 0.02s. | `mix.stripes.0..5.video`, gate con cola20ms. |
| 13 | 6–11 | `MILKYX6 select[i]` = `floor(v/127 × 3)`, latched; índices0,1,2,3. | `milky.stripes.0..5.preset`. |
| 13 | 6–11 | `MILKYX6[i]`: `v>0` → MonoFlop de0.08s. | `mix.stripes.0..5.milky`, gate con cola80ms. |
| 13 | 12 | `SeqSOLO` = `floor(v/127 ×68)`, latched. `VID FULL` = `v>0`. | `player.full.clip` módulo68 (misma sustitución temporal que las franjas) y `mix.fullVideo` gate. |
| 13 | 13 | `MILKY FULL` = `v/127`; consumidor Map×4 → IOBox Integer → selector. Su visibilidad usa `v>0`. | `milky.full.preset` y `mix.fullMilky` gate. |
| 1 | 0 | `BOTON` = gate; `Kick1` = flanco ascendente. | `final.button` boolean; acción `kick1`. |
| 1 | 36,41,48,50 | `Kick all` = flanco ascendente del OR agregado. Una segunda nota mientras la primera está sostenida no produce otro flanco. | Acción `kick`. |
| 1 | 48,50 | `kick WARP` = OR sostenido. | `events.kickWarp` boolean. |
| 1 | 37,42 | `SNARE ALL` = OR sostenido, sin TogEdge. | `events.snareHeld` boolean. Acción adicional `snare` notifica el primer flanco para consumidores que lo requieran. |
| 2 | 36–53 | `Perc any` = OR de flancos individuales, no flanco del OR. | Acción `percussion`. |
| 7 | 0 | `INK` = flanco ascendente. | Acción `ink.trigger`. |
| 7 | 1–6 | `bOTON GRI` = seis gates. | `graphics.blocks.0..5`; señal publicada, no implica que exista un consumidor en la composición activa. |

Puerto original: **`loopMIDI Port`**. La aplicación solicita acceso MIDI al arrancar, como Parte 1, y el modo show lo selecciona por nombre; no activa otros puertos automáticamente. `Usar MIDI de vvvv` vuelve a armar el puerto y los gates en reposo. La selección manual también es editable y conserva nombres e IDs; una selección manual vacía permanece vacía hasta una acción explícita. No hay ningún CC en el patch MIDI original activo; el perfil público web siguiente agrega sus propios bindings.

OSC activo: `player maximus` recibe UDP1002 (QueueDiscard) y decodifica `/fx1`, `/fx2`, `/fx3`, `/fx4` mediante `osc send.v4p`. Este módulo convierte argumentos a números y conserva el último dato con S+H. Los defaults editables conectan `/fx1 → final.fx1`, `/fx2 → final.fx2`, `/fx4 → final.fx4`, pasando el número crudo sin normalizar ni limitar. `/fx3` está publicado pero no tiene consumidor gráfico activo; no se inventa uno. `/BOTON` no existe como entrada OSC original.

Milky completo: índice0=`rootmilky1`; 1,2,3 corresponden a antiguas variantes milky3/milky2/milkySPLASH; índice4=`rootmilkyfinal`. IDs del contrato: `full1`, `full3`, `full2`, `fullsplash`, `final`. Las referencias absolutas antiguas de1–3 faltan; los homónimos locales son fuentes recuperadas, no una prueba de que esos archivos sean idénticos. No se sustituyen silenciosamente por los presets A.

Dos detalles de fidelidad quedan explícitos en los metadatos de las filas:

- La rama de escena usa `OnData` sin el comparador de velocidad conectado. La ayuda no confirma si OnData también dispara con release. El default web actúa en note-on; una fila con `edge:'both'` permite ambos. Escenas72–80 no tienen nota en ese receptor: requieren otro control.
- La selección FULL atraviesa un IOBox Integer sin `Frac`, a diferencia de las franjas. La conversión nativa exacta float→integer no fue verificada. El JSON declara `transform.quantize:'round'`; se puede modificar y no se presenta como certeza del runtime original.

MonoFlop recibe una señal alta cada frame mientras la nota está sostenida. Web conserva el gate hasta release y agrega una cola20/80ms; un nuevo note-on cancela la liberación pendiente. El instante exacto nativo queda cuantizado al frame de vvvv; la cola web usa temporizador del navegador. Desconectar/deshabilitar un dispositivo, CC120/123, cambiar mapeos o destruir el mapper libera los gates.

## Otros patches, no activados como defaults

| Archivo | Entrada | Señal |
|---|---|---|
| `MIDI.v4p` | ch10 notas0–71 | `Esccena`. |
| `MIDI.v4p` | ch1 nota0 | `Kick1`. |
| `MIDI.v4p` | ch2 notas36–53 | `Perc any`; nota43=`BEEP COOL`, nota36=`BEEP INIT`, por flanco. |
| `MIDI.v4p` | ch3 notas70,67 | `ATRACTOR BASS`, dos gates. |
| `MIDI.v4p` | ch6 notas0–76 | `FOLEY1`, OR de flancos. |
| `MIDI.v4p` | ch7 nota0 / notas1–6 | `INK` / `bOTON GRI`. |
| `MIDI.v4p` | ch7 notas36–53 | `sub1`, OR de flancos. |
| `MIDI.v4p` | ch8 notas36–53 | `PAD ALL`, OR sostenido. |
| `MIDI.v4p` | ch7 CC11–20 | `MIDI RAYMARCH`, LinearFilter tiempos `[.2,.2,.2,.2,0,0,0,.2,.2,.2]`s. |
| `MIDI.v4p` | ch7 CC21–23 | `MIDI RAYMARCH2`, LinearFilter .04s; CC22 crudo también publica `POSICION LIQUIDO`. |
| `MIDI.v4p` | OSC UDP1001, `/grid` | primer argumento convertido a número, publica `GRID`. |
| `BOTON MIDI.v4p` | `SparkFun Pro Micro`, controllers0,1 | Sólo primera componente publica `X`; NetSend puerto5555 envía X y constante .988441558441558. Channel sin valor guardado; default nativo no verificado. |

MIDI Learn permite usar esos CC u otros sin agregar una ruta gráfica inventada al show.

## Perfil público web — todos los controles

`parameter-midi.js` genera un binding MIDI para cada parámetro y acción públicos del registro. Es una **extensión web nueva**, distinguida de los cables originales mediante `origin:'webextension'` y `profile:'parte2-public-v1'`.

| Uso | Canales humanos | Fuentes | Conversión |
|---|---|---|---|
| Todos los parámetros | 11,12,14,15,16, en ese orden | CC0–119 por banco, hasta600 destinos | CC/127 al rango del registro; bool umbral64, enums por bins, ints redondeados por registro. |
| Todas las acciones | 16 | Notas0–127 en orden de ID de acción | Note-on. `scene.goto` lleva la escena default del registro; `transport.position` lleva0; otras llevan `true` o su `defaultArg`. |

Los IDs se ordenan al generar la tabla, sin depender del orden de inicialización del registro. El CSV exportado es la tabla concreta de asignaciones; no hay que adivinar qué CC corresponde a un control. Notas de acciones ch16 no chocan con ninguna nota del patch original. Se reservan CC120–127 para mensajes de canal como all-notes-off. Los gates publicados también son parámetros públicos y reciben binding, aunque su consumo gráfico continúa limitado al cableado implementado.

API: `createParameterMappings(params.list(),{previous?})`, `mappingsToCSV(mapper.list())` (alias `exportParameterMappingsCSV`); nombre sugerido `PUBLIC_MIDI_CSV_FILENAME='parte2-controles-midi.csv'`. Se concatena el resultado con `DEFAULT_MAPPINGS` al crear el mapper. `previous` conserva asignaciones existentes y ocupa sus fuentes antes de asignar controles nuevos. La edición y MIDI Learn usan el mismo mecanismo para ambos perfiles.

Persistencia del mapper versión3: conserva la migración de v1 que agrega los controles públicos ausentes. Corrige la fila FULL heredada sin editar para que procese Note Off y vuelva a FULL1; las filas modificadas o aprendidas y las eliminaciones manuales se conservan. Import/export JSON sigue disponible para guardar la tabla exacta; el CSV es una hoja legible de fuentes/destinos, no un formato de importación.

## API de módulos

```js
const mapper = new Mapper({
  onControl(path, value, meta) { /* ParamStore.set, o setNormalized si meta.normalized */ },
  onAction(action, value, meta) { /* ParamStore.trigger */ },
  getValue(path) { /* valor actual/objetivo */ },
  getScene() { /* id actual */ },
  getDefinition(path) { /* {type,min,max,...}, útil para Learn */ },
  hasAction(path) { /* boolean, útil para filas Parte1 sin output explícito */ },
  onEvent(type, payload) { /* mappings, monitor, learn, clock, warning */ },
});
await mapper.init();
const midi = new MidiInput({
  preferredName: 'loopMIDI Port',
  onMessage: (message) => mapper.dispatch(message),
  onDevices(inputs) { /* [{id,name,manufacturer,state,connection,enabled}] */ },
  onEvent(type, payload) { /* devices, message, clock, warning, error */ },
});
await midi.init();
```

`MidiInput`: `listInputs()`, `status()`, `usePreferredInput(name)`, `setEnabled(ids)` (alias `setEnabledInputs`), `refresh()`, `dispose()`. `init()` comparte la petición pendiente y reintenta aperturas fallidas. Estado distingue permiso pendiente, conexión, escucha efectiva y error. Device disable/disconnect emite `{kind:'device',action:'disconnected',deviceId}`. `Mapper`: `list()`, `setMappings(rows,{persist})`, `save()`, `exportJson()`, `importJson(json)`, `resetToDefault()`, `learn(rowId,{deviceSpecific})`, `learnTarget(target,options)`, `cancelLearn()`, `onSceneChange(id)`, `releaseAll()`, `releaseDevice(id,channel?)`, `dispose()`. `on(type,callback)` devuelve función para desuscribirse.

MIDI Learn consume el primer note-on positivo, CC u OSC; no lo ejecuta en el show. Release y clock no completan Learn. `source.deviceId` es opcional; por defecto la asignación funciona con cualquier dispositivo habilitado. Import valida todas las filas antes de modificar el estado; restaurar defaults también persiste.

Formato compatible con Parte1:

```js
{kind:'note', channel:10, note:25, velocity:100, on:true}
{kind:'cc', channel:7, cc:11, value:64}
{kind:'osc', address:'/p/final/fx2', args:[0.35]}
```

Metadatos MIDI adicionales: `deviceId`, `deviceName`, `timestamp` (milisegundos en reloj monotónico de Web MIDI), `raw` (bytes), `releaseVelocity` en NoteOff explícito. NoteOn con velocidad0 se normaliza como off, velocidad0. Se exponen además pitchbend, aftertouch, polyaftertouch y program para monitor/mapeos avanzados; no tienen defaults.

Filas: `{id,source,mode,target,arg/value,min,max,scenes}`. Extensiones: `output:'control'|'action'`, `source.notes`, `source.noteRange:[inclusive,inclusive]`, `source.deviceId`, `edge:'aggregate'|'perNote'|'both'`, `binary`, `onValue`, `offValue`, `releaseMs`, `transform:{quantize,modulo,values}`, `valueFrom:'note'|'argument'`, `enabled`, `label`, `sourcePatch`, `sourceNodes`, `formula`, `fidelity`. `set` con `valueFrom:'argument'` pasa el primer argumento OSC numérico sin normalizar. Scene IDs se comparan como strings. Modos heredados: trigger, toggle, gate, velocity, set, range; range admite curvas linear/exp/log e intervalo OSC `in:[min,max]`.

Clock: `{kind:'transport',command:'clock'|'start'|'continue'|'stop'|'position',position?}`. `MidiClock` usa24ticks/quarter; SongPositionPointer usa6ticks/unidad. Emite estado `{playing,ticks,beat,position,bpm,deviceId,ppq:24}`. El mapper monitorea siempre y controla el show sólo si `getValue('transport.sync')==='midi'`. `transport.followMidi=false` desactiva Start/Continue/Stop/SPP mientras permite actualizar BPM. Acciones `transport.start/continue/stop`; `transport.position` recibe beats (quarter notes). Parámetros `transport.playing` y `transport.bpm`. Relojes de dos dispositivos no se mezclan para estimar tempo. Elegir un solo emisor de clock en producción evita alternar fuentes.

## OSC y Parte 1

El mapper acepta OSC normalizado de cualquier adaptador; no abre UDP/WebSocket ni reconfigura otro servidor. Rutas automáticas compatibles: `/p/<path>` valor nativo, `/pn/<path>` valor0–1 con `meta.normalized`, `/a/<action>`, `/scene`. Los paths pueden usar puntos o barras. Los callbacks del registro siguen siendo la autoridad para aceptar un destino.

Parte1 usa WebSocket `ws://localhost:8081`: servidor `{t:'osc',address,args}`, `{t:'status',udpPort}`, `{t:'error',message}`. Cliente solicita `{t:'rebind',port}`. **Un cliente Parte2 que se conecte a ese bridge no debe enviar rebind automáticamente**: cambiaría el puerto del show Parte1. El bridge propio de Parte2 puede suministrar mensajes normalizados al mismo `dispatch`. La conexión al bridge existente debe ser explícita.

Parte1 usa BroadcastChannel `vis-bus`; Parte2 independiente reserva `parte2-bus`. No crear un segundo receptor de `vis-bus` ni cambiar el estado del show Parte1 automáticamente. El contrato público de Parte1 incluye hello, set, trigger, scene, mappings, learn, midiInputs, oscPort y fakeMidi. Una futura integración debe agregar routing explícito entre partes, con un único dueño de MIDI, clock, estado y salida.

`attachToHost(ctx, options)` devuelve `{mapper,ready,dispatch,onSceneChange,dispose}` y adapta a `ctx.params.set/setNormalized/trigger/target/def/hasAction`. **No abre dispositivos ni crea un BroadcastChannel.** El host le reenvía cada mensaje normalizado una vez. Si ambos mappers están conectados, el host selecciona la parte activa; no duplicar la ejecución de `scene.goto`.

Persistencia aislada: `parte2.midiInputs`, `parte2.mappings`; no modifica `vis.midiInputs`, `vis.mappings`, `vis.oscPort`. PARTE1 permanece sin modificaciones. Su contexto vigente asigna 24 a previa, 25 a PLAY Fluidos y 26 a Fluidos live; 27–29 siguen libres. El perfil Parte2 conserva sus números originales; la futura unión requiere un selector explícito de parte, no reasignarlos silenciosamente. Parte2 no reproduce audio; Parte1 tiene su propio audio web según el contexto actualizado.

## Validación

`node --test system/*.test.mjs` comprueba MIDI, clock/SPP, selectores, OR, colas, Note Off sin Note On previo, Learn, migración, persistencia, selección/reconexión del puerto, cobertura de controles, OSC y host adapter. `midi-native-probe.mjs` abrió el puerto real `loopMIDI Port`; no llegaron mensajes externos durante los ocho segundos observados. `midi-show-test.mjs` comprueba eventos MIDI en el listener de ese puerto: notas, escenas, capas, efectos y transición demo→show, sin emitir MIDI al resto del sistema. Evidencia en `captures/midi-*-validation.json`.
