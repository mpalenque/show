# Operación de Fluids — previa 24, PLAY 25 y final reactivo 26

**Decisión vigente, 2026-09-07: 24 prepara; 25 reproduce la secuencia; 26 es el final de la 25 —el mismo fluido— reaccionando a las notas y faders de Ableton. El audio de la 25 sale de la página; en la 26 la música es la de Ableton.** Esta guía reemplaza tanto la operación «24 PLAY / 25 live / WAV local» como la de audio siempre externo. [Contexto actual](../CONTEXTO-ACTUAL.md) · [Configuración completa](../CONFIGURACION.md) · [Sistemas](../ARQUITECTURA-Y-SISTEMAS.md).

## Abrir el programa y el timeline

Desde `particlesvideo/visuales`:

```powershell
npm ci
npm start
```

`npm ci` instala también las dependencias aisladas de Radiance desde su lockfile. Para producción: `npm run build`, después `npm run preview -- --port 5173`; ejecutar además `npm run osc` si se usa OSC.

| Ventana | URL |
|---|---|
| Salida, nombre `vis-salida` | `http://localhost:5173/` |
| Escenas, parámetros, MIDI/OSC y Learn | `http://localhost:5173/editor.html` |
| Timeline de Fluids | `http://localhost:5173/fluids.html` |

El editor general tiene enlace al timeline. **ABRIR SALIDA** en el timeline reutiliza la ventana `vis-salida`. Mantener la salida visible en la pantalla del show.

## Secuencia operativa

1. Enviar **Note On canal 10, nota 24**: aparece la **previa negra con sólo una línea blanca**. El motor queda preparado, sin partículas ni eventos de emisión; timeline en 0, detenido. La línea usa posición/tamaño iniciales del documento, blanca e intacta, con rotación 0.
2. Iniciar el audio desde Ableton y enviar **Note On canal 10, nota 25** en el punto de arranque: comienza desde cero la **secuencia completa del timeline**, de 152,694 s en el documento incluido.
3. Para repetir, usar **REINICIAR** / `fluids.restart`, o volver a la previa y entrar nuevamente en 25. Las notas repetidas de la misma escena activa no reinician.
4. Al final se mantiene la escena 25: el reloj del timeline se detiene, **el fluido sigue corriendo** y no avanza a otra escena automáticamente.
5. **Note On canal 10, nota 26** (el clip "26" del slot JEJE FLUID del track "scene" la manda solo al disparar esa escena de Session): **el mismo fluido sigue**, el timeline deja de mandar y mandan las notas de los canales 1 y 2 y los faders `fluids.seq.*`. El track de la página queda pausado.

La previa deja el estado de comienzo listo. El paso 24→25 usa ese estado preparado para iniciar el reloj sin un nuevo reset o espera del Worker en el cue. La entrada directa en 25 tiene su propia preparación y arranque desde cero. Si se pide otra escena mientras hay una preparación pendiente, esa solicitud anterior se cancela.

Las escenas **27–29 siguen libres**.

## Final reactivo — escena 26

**Es la 25 que sigue viva.** No se reinicia nada: mismo solver, mismas partículas, mismo director con una copia mutable del documento y el reloj siguiendo desde donde quedó. Lo que cambia es quién manda: las notas de JEJE FLUID y los faders, no el timeline. Al entrar, la lámpara pasa a los materiales que de verdad quedaron, la masa toma cuerpo (`bodies` 0,15) y la paleta funde a blanco y negro en 3 s.

Las notas ya vienen mapeadas (`mappings.default.json` v13, sólo activas en la 26):

| Nota | Sonido en JEJE FLUID | Acción | Qué se ve |
|---|---|---|---|
| Ch1 n0 | **primer kick** ("deep dark kick", cada negra) | `fluids.seq.pulse` | flash de exposición y empujón desde el centro de masa; cada cuarto kick tira para adentro (respiración). **Todas las losetas dan su paso** por su eje (pistones hacia la masa, patrullas que doblan para esquivar; nunca se pisan) y las lámparas pulsan; cada cuatro kicks se sortea si las partículas blancas emiten quietas o sólo en movimiento. Con la viscosidad del documento el fluido está clavado y **salta** con cada golpe; el primer kick abre la masa del cierre en un anillo |
| Ch1 n2 | **segundo kick** ("Instrument Rack" → Cymatics Kick, en el contratiempo) | `fluids.seq.strobe` + `fluids.seq.step` | el relámpago (sortea cuántas, 1 a 3, y cuáles losetas de 50 cm emiten, y las hace destellar ×2 durante 120 ms; las de 1 m nunca emiten) **y otro paso de todas las losetas, cruzado**: con los dos kicks avanzan en corcheas |
| Ch1 n4 | 808 (cada 2 negras) | `fluids.seq.tile` | una loseta nueva (50 cm o 1 m según la serie). Nace negra; las lámparas las elige el sorteo. **Es un obstáculo**: el fluido choca contra sus lados y rebota, lo que tenía adentro sale expulsado y en marcha arrastra el fluido |
| Ch2 n38 | alarm keypad | `fluids.seq.sweep` + `fluids.seq.flip` | una banda de 1 m cruza la pared en 0,8 s **invirtiendo la iluminación** de todo lo que pasa por debajo (blanco ↔ negro, azul → rojo), y otro sorteo de lámparas |
| Ch2 n39 · n49 | alarm keypad · fx_powered | `fluids.seq.crack` | fractura en el centro de masa |
| Ch2 n47 | waaaeey | `fluids.seq.dark` | apagón 0,3 s |
| Ch2 n45 | sci-fi button | `fluids.seq.freeze` | stutter: el fluido y las losetas quedan como foto fija `tileLife` negras y se sueltan |
| **Ch11 cualquier nota** | **amb 1** (por la pista de envío AMB1) | `fluids.seq.amb` (gate) | mientras hay una nota sostenida, un cuarto de las partículas sube desde su mínimo hasta el doble de potencia en azul, aunque esté quieto, en 0,7 s y temblando; al soltar vuelve al mínimo en 1 s. En JEJE FLUID la nota dura 32 negras: mientras ese clip suene, el azul está casi siempre arriba |
| **Ch3 cualquier nota** | **atractor** (la pista de envío de las otras escenas) | `fluids.seq.attract` (gate) | mientras la nota está apretada, un atractor tira del fluido (una nota) o lo hace girar (la siguiente) desde un punto del centro; al soltar se apaga en 0,3 s |
| Ch2 n40 | bowl ride | `fluids.seq.tileBig` | loseta de 1 m |
| — | — | `fluids.seq.clear` / `fluids.seq.reset` | borrar losetas / vaciar el fluido (sin mapeo: asignarlos desde el editor si hacen falta) |

Los faders, pensados para CCs libres (todos estado vivo, no se resetean con la escena):

| Control | Para qué |
|---|---|
| `fluids.seq.gravity` / `.cohesion` / `.viscosity` / `.light` / `.exposure` / `.bodies` | **Son las curvas del documento**: mover uno escribe una key en el instante actual y el director la sigue. Arrancan donde la 25 las dejó (gravedad 0, cohesión 0,62, viscosidad 1, luz 1, exposición 1,2) salvo `bodies` (0,15). **Viscosidad 1 = fluido quieto que salta con el kick; 0,5 = agua que fluye sola y el kick deja de leerse.** |
| `fluids.seq.tileLife` | Unidad de vida de las losetas y del stutter, en negras a 140 (4 por defecto). **Crece sola con la cuenta**: la loseta 24 vive el doble, la 48 el triple; así la pared se llena de cuadrados sin tocar nada. `clear` vuelve la cuenta a cero. |
| `fluids.seq.grid` | Por encima de 0,5 todas las losetas nuevas son de 50 cm. |
| `fluids.seq.mono` | Cuánto se va al monocromo. Arranca en 1. |
| `fluids.seq.amb` | La compuerta de amb 1 (0/1). La mueve el MIDI del canal 11; desde el editor sirve para probar el glow sin Ableton. |
| `fluids.seq.attract` | La compuerta del atractor (0/1). La mueve el MIDI del canal 3; desde el editor sirve para probar sin Ableton. |

`fluids.gain` sigue por encima de todo. La escena 26 en `scenes/index.js` no lista params: la barra espaciadora dispara el pulso. **En Ableton**, la pista **AMB1** (la última) toma el MIDI de "amb 1" (Post FX, monitor In) y lo saca por RTX3090 Port 2, canal 11, igual que DRUM (Ch 1) y PERC (Ch 2) sacan el de sus instrumentos. Si se agrega otro envío, el canal 11 ya está tomado. La 26 acepta la nota **antes** de que la 25 termine: el timeline se detiene ahí y la 26 toma el fluido como está. Para volver a la secuencia, nota 24 y después 25. El motor libre anterior (`fluids.live.*`) sigue existiendo como capacidad sin escena.

## Audio desde la página

**La salida reproduce `fluids.wav`.** Con la música por Ableton, imagen y track corrían con relojes distintos y se separaban a lo largo del tema; ahora el tiempo de la secuencia sale de `AudioContext.currentTime` y los dos no se pueden despegar. En Ableton hay que **silenciar la pista del track de Fluids** y dejarle sólo las notas de escena.

**Hacer un clic en la ventana de salida antes del show.** Chrome no deja sonar nada hasta que hubo un gesto; hasta entonces el panel de la salida avisa que falta el clic. Cualquier clic o tecla sirve.

`fluids.volume` gobierna el nivel. `fluids.audioMode` en `external` vuelve al comportamiento anterior —página muda, reloj de pared desde el cue— para ensayar con la música por Ableton; cambiar de modo no corta la secuencia en curso.

El armado del audio **no demora el arranque**: se hace en segundo plano. Si el cue 25 llega antes de que el WAV termine de decodificar, la imagen arranca con el reloj de pared y el track entra solo, en la posición en la que va la secuencia. `fluids.arm` prepara motor y audio.

## Transporte y controles

| Acción | Comportamiento actual |
|---|---|
| `fluids.standby` | Selecciona la previa 24. |
| `fluids.play` | Selecciona 25 y empieza, o continúa si su transporte estaba pausado. |
| `fluids.pause` | Pausa el reloj visual y el track mientras está en 25. La física conserva la semántica del motor original y sigue moviéndose. |
| `fluids.restart` / reinicio del editor | Reinicia explícitamente la secuencia 25 desde cero, incluso si ya estaba seleccionada. |
| `fluids.seek` con segundos | Busca dentro del timeline de 25 para ensayo; el track salta con él. |
| `fluids.live` | Selecciona la 26, el final reactivo (el nombre de la acción es histórico). |
| Loop del editor | Sólo para ensayo visual. Entrar en 24 o 25 lo desactiva para ejecutar la secuencia completa. El audio externo no recibe ese loop automáticamente. |
| Master / blackout | Modifican la imagen; no silencian el track. Para bajar el sonido, `fluids.volume`. |
| `fluids.gain` | Ganancia de luz de todo Fluids, sin tocar el documento. Arranca en 1,25. |
| `fluids.supersample` | Escala del buffer de dibujo. En 2 (por defecto) desaparece el rayado del campo de radiancia; bajarlo sólo si hace falta rendimiento. |

Un seek cambia el tiempo de evaluación de curvas y eventos, **no reconstruye toda la historia física de las partículas**. Para repetir la evolución desde una población limpia, usar la previa y el inicio o el reinicio explícito.

Los mapeos de escenas son `scene.goto` con argumentos `24`, `25` y `26`. No agregar otro `fluids.play` a la misma nota de entrada. Usar los números MIDI del monitor: las etiquetas de octava de Ableton y otras aplicaciones pueden variar. [Puertos, canales y mapeos](../CONFIGURACION.md).

## Editar y conservar el show

`fluids.html` mantiene lanes de curvas, eventos, gestos, waveform, zoom, deshacer/rehacer e importación/exportación. La salida posee el documento, su revisión y el motor; el editor sólo envía órdenes y ediciones. El preview opcional es JPEG 672×252 a 2 Hz, sin segundo solver.

Para grabar gestos, armar REC y operar sobre la superficie del editor durante la secuencia de 25. El export conserva curvas, eventos, colores y gestos. Undo/redo pertenecen a la sesión del editor y no sobreviven a una recarga.

Las ediciones llevan su revisión de base. Una revisión desactualizada se rechaza; exportar el borrador antes de elegir **CARGAR VERSIÓN DE SALIDA** si se quiere conservar. Los botones de sembrado reconstruyen contenido desde el análisis y no deben usarse para recuperar una edición escrita del usuario.

| Dato | Ubicación |
|---|---|
| Documento incluido | `public/radiance/show/fluids.show.json` |
| Documento editado y revisión | `localStorage['vis.radiance.show.v1']`, propiedad de Output |
| WAV de referencia | `public/radiance/audio/fluids.wav` |
| Waveform/análisis | Decodificación offline y `public/radiance/show/fluids.analysis.json` |
| Mapeos aprendidos / ajustes | `vis.mappings` y `vis.settings`, separados del documento |
| Plan original y explicación del show | [Documentación original preservada](../origen-radiance/INDICE.md) |

El export incluido fue recuperado de `C:/Users/mpale/Downloads/fluids.show.json`: **152,694 s, 256 eventos, 400 claves, 0 clips de gesto**. No se comprobó si el navegador original conserva una edición posterior; se puede importar un JSON más reciente sin resembrar. [Procedencia del export](estado-copia.json).

Cambiar de puerto o de `localhost` a `127.0.0.1` cambia el almacenamiento del navegador. **EXPORTAR** crea una copia trasladable. Las claves originales `radiance-fluids-show-doc-v1`, `radiance-tres-masas-page-v2` y `radiance-live-show-state-v2` permanecen separadas.

## Qué está comprobado

Para la decisión nueva hay **217 tests de código aprobados**: 203 del paquete Radiance, 9 de sesión, 4 de preview y 1 de mapeos, junto con TypeScript y build. Están aprobados el flujo 24/25, MIDI sin reinicio por notas repetidas, previa blanca y vacía, ausencia de audio web, editor remoto y recursos/cues bajo `/show/`. El último ensayo de desarrollo también comprueba desactivar el loop al entrar. [Evidencia nueva](VALIDACION-CUES-24-25.md).

El rendimiento no permite garantizar que nunca habrá caídas: la primera prueba nueva de producción registró un máximo de 83,6 ms y 45 intervalos >20 ms; su repetición sin cambios de código dio máximo 17,5 ms y ninguno >20 ms. El último ensayo de desarrollo dio máximo 17,8 ms y ninguno >20 ms. Las aplicaciones observadas activas después de la primera medición pueden competir por recursos; no se aisló una causa única.

El [informe de rendimiento anterior](RENDIMIENTO.md) conserva las tres pasadas de la asignación previa. No validan este cambio. En esas mediciones el solver bajó de 50 Hz en algunas ventanas, aunque la presentación se mantuvo a ~60 FPS; no se declara resuelto el requisito estricto de física ni ausencia de retrasos.

Se mantiene el ancho de rayos de Parte 1 en **0,014 m**. Respaldos de la primera integración: `17ff81a` en `particlesvideo` y `e91ec3b` en la copia completa de Radiance. El origen de `heidi` permanece separado y la copia documental original está verificada archivo por archivo con SHA-256.
