# Referencia MIDI / OSC — Visuales LED

Generado 6/9/2026, 03:12:08 desde el registro de parámetros.

## Escenas

| id | nombre | fuente MIDI/OSC |
|---|---|---|
| 1 | Placa de advertencia | Nota 1 ch10 |
| 2 | Marco + línea móvil | Nota 2 ch10 |
| 3 | Grilla gruesa por bloque | Nota 3 ch10 |
| 4 | Grillas finas | Nota 4 ch10 |
| 5 | Grillas finas (negativa de la 4) | Nota 5 ch10 |
| 6 | Grillas + barridos | Nota 6 ch10 |
| 7 | Piso con fuga (+ grilla) | Nota 7 ch10 |
| 8 | Piso + barridos | Nota 8 ch10 |
| 9 | Piso rápido + grilla gruesa | Nota 9 ch10 |
| 10 | Caja + palitos blancos | Nota 10 ch10 |
| 11 | Piso + palitos rojos | Nota 11 ch10 |
| 12 | Flujo azul que sube | Nota 12 ch10 |
| 13 | Caja + rojos (turbulencia) | Nota 13 ch10 |
| 14 | Rueda azul (empuja a la izquierda) | Nota 14 ch10 |
| 15 | Rueda azul (empuja a la derecha) | Nota 15 ch10 |
| 16 | Caja + rayos | Nota 16 ch10 |
| 17 | Caja a la izquierda + rayos | Nota 17 ch10 |
| 18 | Caja a la derecha + rayos | Nota 18 ch10 |
| 19 | Caja frontal ancha | Nota 19 ch10 |
| 20 | Partículas libres + atractor | Nota 20 ch10 |
| 21 | Torbellino | Nota 21 ch10 |
| 22 | Torbellino en la caja | Nota 22 ch10 |
| 23 | A punto de explotar | Nota 23 ch10 |
| 24 | Fluids · previa | Nota 24 ch10 |
| 25 | Fluids · secuencia | Nota 25 ch10 |
| 26 | Fluids · live | Nota 26 ch10 |
| 27 | Libre 4 | Nota 27 ch10 |
| 28 | Libre 5 | Nota 28 ch10 |
| 29 | Libre 6 | Nota 29 ch10 |

## Parámetros y acciones

### master

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `master.brightness` | Brillo master | float | 0 .. 1 | `/p/master/brightness` | `/pn/master/brightness` |  |
| `master.blackout` | Blackout | bool | false \| true | `/p/master/blackout` | `/pn/master/blackout` |  |
| `master.bloomEnabled` | Bloom on | bool | false \| true | `/p/master/bloomEnabled` | `/pn/master/bloomEnabled` |  |
| `master.quality` | Calidad | enum | ultra \| high \| medium \| low | `/p/master/quality` | `/pn/master/quality` |  |

### bloom

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `bloom.strength` | Bloom fuerza | float | 0 .. 2 | `/p/bloom/strength` | `/pn/bloom/strength` |  |
| `bloom.radius` | Bloom radio | float | 0 .. 1 | `/p/bloom/radius` | `/pn/bloom/radius` |  |
| `bloom.threshold` | Bloom umbral | float | 0 .. 1 | `/p/bloom/threshold` | `/pn/bloom/threshold` |  |

### ao

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `ao.enabled` | Ambient occlusion | bool | false \| true | `/p/ao/enabled` | `/pn/ao/enabled` |  |
| `ao.amount` | Intensidad AO | float | 0 .. 1 | `/p/ao/amount` | `/pn/ao/amount` |  |
| `ao.distance` | Radio AO (m) | float | 0.01 .. 1 | `/p/ao/distance` | `/pn/ao/distance` |  |
| `ao.thickness` | Grosor AO | float | 0.05 .. 4 | `/p/ao/thickness` | `/pn/ao/thickness` |  |
| `ao.contrast` | Contraste AO | float | 0.25 .. 4 | `/p/ao/contrast` | `/pn/ao/contrast` |  |
| `ao.samples` | Muestras AO | int | 4 .. 32 | `/p/ao/samples` | `/pn/ao/samples` |  |
| `ao.resolutionScale` | Resolución AO | float | 0.25 .. 1 | `/p/ao/resolutionScale` | `/pn/ao/resolutionScale` |  |
| `ao.denoise` | Suavizado AO | float | 0 .. 12 | `/p/ao/denoise` | `/pn/ao/denoise` |  |

### render

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `render.msaa` | Antialiasing 3D (MSAA) | bool | false \| true | `/p/render/msaa` | `/pn/render/msaa` |  |

### scene

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `scene.current` | Escena actual | enum | 1 \| 2 \| 3 \| 4 \| 5 \| 6 \| 7 \| 8 \| 9 \| 10 \| 11 \| 12 \| 13 \| 14 \| 15 \| 16 \| 17 \| 18 \| 19 \| 20 \| 21 \| 22 \| 23 \| 24 \| 25 \| 26 \| 27 \| 28 \| 29 | `/p/scene/current` | `/pn/scene/current` |  |
| `scene.goto` | Ir a escena | acción | id de escena | `/a/scene/goto` |  | Nota 1 ch10, Nota 2 ch10, Nota 3 ch10, Nota 4 ch10, Nota 5 ch10, Nota 6 ch10, Nota 7 ch10, Nota 8 ch10, Nota 9 ch10, Nota 10 ch10, Nota 11 ch10, Nota 12 ch10, Nota 13 ch10, Nota 14 ch10, Nota 15 ch10, Nota 16 ch10, Nota 17 ch10, Nota 18 ch10, Nota 19 ch10, Nota 20 ch10, Nota 21 ch10, Nota 22 ch10, Nota 23 ch10, Nota 24 ch10, Nota 25 ch10, Nota 26 ch10, Nota 27 ch10, Nota 28 ch10, Nota 29 ch10 |
| `scene.next` | Escena siguiente | acción |  | `/a/scene/next` |  |  |
| `scene.prev` | Escena anterior | acción |  | `/a/scene/prev` |  |  |

### warning

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `warning.band` | Banda | float | 0 .. 1 | `/p/warning/band` | `/pn/warning/band` |  |
| `warning.bg` | Fondo (chevrones) | float | 0 .. 1 | `/p/warning/bg` | `/pn/warning/bg` |  |
| `warning.scroll` | Scroll texto (px/s) | float | -200 .. 200 | `/p/warning/scroll` | `/pn/warning/scroll` |  |
| `warning.pulseAttack` | Pulso ataque (s) | float | 0.1 .. 10 | `/p/warning/pulseAttack` | `/pn/warning/pulseAttack` |  |
| `warning.pulseRelease` | Pulso caída (s) | float | 0.1 .. 10 | `/p/warning/pulseRelease` | `/pn/warning/pulseRelease` |  |
| `warning.bgPulse` | Latido del fondo | float | 0 .. 1 | `/p/warning/bgPulse` | `/pn/warning/bgPulse` |  |
| `warning.bgPulseRate` | Latido (Hz) | float | 0.05 .. 6 | `/p/warning/bgPulseRate` | `/pn/warning/bgPulseRate` |  |
| `warning.pulse` | Pulso de fondo | acción |  | `/a/warning/pulse` |  |  |
| `warning.bgOff` | Apagar fondo (1b) | acción |  | `/a/warning/bgOff` |  |  |
| `warning.bgOn` | Prender fondo | acción |  | `/a/warning/bgOn` |  |  |

### grid

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `grid.opacity` | Grillas | float | 0 .. 1 | `/p/grid/opacity` | `/pn/grid/opacity` |  |
| `grid.lineWidth` | Grosor línea (px) | int | 1 .. 8 | `/p/grid/lineWidth` | `/pn/grid/lineWidth` |  |
| `grid.brightness` | Brillo | float | 0 .. 1 | `/p/grid/brightness` | `/pn/grid/brightness` |  |
| `grid.cellW` | Celda ancho (px) | int | 8 .. 1008 | `/p/grid/cellW` | `/pn/grid/cellW` |  |
| `grid.cellH` | Celda alto (px) | int | 8 .. 1008 | `/p/grid/cellH` | `/pn/grid/cellH` |  |
| `grid.coarse` | Celdas gruesas | bool | false \| true | `/p/grid/coarse` | `/pn/grid/coarse` |  |
| `grid.scrollSpeed` | Scroll (px/s) | float | 0 .. 400 | `/p/grid/scrollSpeed` | `/pn/grid/scrollSpeed` |  |
| `grid.pixelSnap` | Ajuste a píxel | bool | false \| true | `/p/grid/pixelSnap` | `/pn/grid/pixelSnap` |  |
| `grid.fadeTime` | Fade grilla gruesa (s) | float | 0 .. 2 | `/p/grid/fadeTime` | `/pn/grid/fadeTime` |  |
| `grid.offsetTime` | Corrimiento: duración (s) | float | 0 .. 3 | `/p/grid/offsetTime` | `/pn/grid/offsetTime` |  |
| `grid.offsetStep` | Corrimiento: paso (px) | float | 1 .. 1008 | `/p/grid/offsetStep` | `/pn/grid/offsetStep` |  |
| `grid.offsetEase` | Corrimiento: curva | enum | smooth \| out \| linear | `/p/grid/offsetEase` | `/pn/grid/offsetEase` |  |
| `grid.offsetAxis` | Corrimiento: eje | enum | vertical \| horizontal \| ambos \| random | `/p/grid/offsetAxis` | `/pn/grid/offsetAxis` |  |
| `grid.b1.enabled` | Bloque 1 | bool | false \| true | `/p/grid/b1/enabled` | `/pn/grid/b1/enabled` |  |
| `grid.b1.dir` | Bloque 1 sentido | int | -1 .. 1 | `/p/grid/b1/dir` | `/pn/grid/b1/dir` |  |
| `grid.b1.speedMul` | Bloque 1 vel. | float | 0 .. 3 | `/p/grid/b1/speedMul` | `/pn/grid/b1/speedMul` |  |
| `grid.b1.offsetY` | Bloque 1 offset Y | float | 0 .. 1008 | `/p/grid/b1/offsetY` | `/pn/grid/b1/offsetY` |  |
| `grid.b1.offsetX` | Bloque 1 offset X | float | -1008 .. 1008 | `/p/grid/b1/offsetX` | `/pn/grid/b1/offsetX` |  |
| `grid.b2.enabled` | Bloque 2 | bool | false \| true | `/p/grid/b2/enabled` | `/pn/grid/b2/enabled` |  |
| `grid.b2.dir` | Bloque 2 sentido | int | -1 .. 1 | `/p/grid/b2/dir` | `/pn/grid/b2/dir` |  |
| `grid.b2.speedMul` | Bloque 2 vel. | float | 0 .. 3 | `/p/grid/b2/speedMul` | `/pn/grid/b2/speedMul` |  |
| `grid.b2.offsetY` | Bloque 2 offset Y | float | 0 .. 1008 | `/p/grid/b2/offsetY` | `/pn/grid/b2/offsetY` |  |
| `grid.b2.offsetX` | Bloque 2 offset X | float | -1008 .. 1008 | `/p/grid/b2/offsetX` | `/pn/grid/b2/offsetX` |  |
| `grid.b3.enabled` | Bloque 3 | bool | false \| true | `/p/grid/b3/enabled` | `/pn/grid/b3/enabled` |  |
| `grid.b3.dir` | Bloque 3 sentido | int | -1 .. 1 | `/p/grid/b3/dir` | `/pn/grid/b3/dir` |  |
| `grid.b3.speedMul` | Bloque 3 vel. | float | 0 .. 3 | `/p/grid/b3/speedMul` | `/pn/grid/b3/speedMul` |  |
| `grid.b3.offsetY` | Bloque 3 offset Y | float | 0 .. 1008 | `/p/grid/b3/offsetY` | `/pn/grid/b3/offsetY` |  |
| `grid.b3.offsetX` | Bloque 3 offset X | float | -1008 .. 1008 | `/p/grid/b3/offsetX` | `/pn/grid/b3/offsetX` |  |
| `grid.b4.enabled` | Bloque 4 | bool | false \| true | `/p/grid/b4/enabled` | `/pn/grid/b4/enabled` |  |
| `grid.b4.dir` | Bloque 4 sentido | int | -1 .. 1 | `/p/grid/b4/dir` | `/pn/grid/b4/dir` |  |
| `grid.b4.speedMul` | Bloque 4 vel. | float | 0 .. 3 | `/p/grid/b4/speedMul` | `/pn/grid/b4/speedMul` |  |
| `grid.b4.offsetY` | Bloque 4 offset Y | float | 0 .. 1008 | `/p/grid/b4/offsetY` | `/pn/grid/b4/offsetY` |  |
| `grid.b4.offsetX` | Bloque 4 offset X | float | -1008 .. 1008 | `/p/grid/b4/offsetX` | `/pn/grid/b4/offsetX` |  |
| `grid.b5.enabled` | Bloque 5 | bool | false \| true | `/p/grid/b5/enabled` | `/pn/grid/b5/enabled` |  |
| `grid.b5.dir` | Bloque 5 sentido | int | -1 .. 1 | `/p/grid/b5/dir` | `/pn/grid/b5/dir` |  |
| `grid.b5.speedMul` | Bloque 5 vel. | float | 0 .. 3 | `/p/grid/b5/speedMul` | `/pn/grid/b5/speedMul` |  |
| `grid.b5.offsetY` | Bloque 5 offset Y | float | 0 .. 1008 | `/p/grid/b5/offsetY` | `/pn/grid/b5/offsetY` |  |
| `grid.b5.offsetX` | Bloque 5 offset X | float | -1008 .. 1008 | `/p/grid/b5/offsetX` | `/pn/grid/b5/offsetX` |  |
| `grid.b1.toggle` | Bloque 1 on/off | acción |  | `/a/grid/b1/toggle` |  |  |
| `grid.b1.flip` | Bloque 1 invertir | acción |  | `/a/grid/b1/flip` |  |  |
| `grid.b1.nudge` | Bloque 1 corrimiento | acción | v \| h \| ambos \| random \| px | `/a/grid/b1/nudge` |  |  |
| `grid.b2.toggle` | Bloque 2 on/off | acción |  | `/a/grid/b2/toggle` |  |  |
| `grid.b2.flip` | Bloque 2 invertir | acción |  | `/a/grid/b2/flip` |  |  |
| `grid.b2.nudge` | Bloque 2 corrimiento | acción | v \| h \| ambos \| random \| px | `/a/grid/b2/nudge` |  |  |
| `grid.b3.toggle` | Bloque 3 on/off | acción |  | `/a/grid/b3/toggle` |  |  |
| `grid.b3.flip` | Bloque 3 invertir | acción |  | `/a/grid/b3/flip` |  |  |
| `grid.b3.nudge` | Bloque 3 corrimiento | acción | v \| h \| ambos \| random \| px | `/a/grid/b3/nudge` |  |  |
| `grid.b4.toggle` | Bloque 4 on/off | acción |  | `/a/grid/b4/toggle` |  |  |
| `grid.b4.flip` | Bloque 4 invertir | acción |  | `/a/grid/b4/flip` |  |  |
| `grid.b4.nudge` | Bloque 4 corrimiento | acción | v \| h \| ambos \| random \| px | `/a/grid/b4/nudge` |  |  |
| `grid.b5.toggle` | Bloque 5 on/off | acción |  | `/a/grid/b5/toggle` |  |  |
| `grid.b5.flip` | Bloque 5 invertir | acción |  | `/a/grid/b5/flip` |  |  |
| `grid.b5.nudge` | Bloque 5 corrimiento | acción | v \| h \| ambos \| random \| px | `/a/grid/b5/nudge` |  |  |
| `grid.toggleAll` | Todas on/off | acción |  | `/a/grid/toggleAll` |  |  |
| `grid.visibilityRandom` | Cambiar bloques visibles al azar | acción |  | `/a/grid/visibilityRandom` |  | Nota 0 ch1 |
| `grid.nudge` | Corrimiento suave (todas) | acción | v \| h \| ambos \| random \| px | `/a/grid/nudge` |  |  |
| `grid.nudgeRandom` | Corrimiento aleatorio por bloques | acción |  | `/a/grid/nudgeRandom` |  | Cualquier nota ch6, Nota 41 ch2 |
| `grid.randomize` | Offsets al azar (suave) | acción |  | `/a/grid/randomize` |  |  |
| `grid.offsetReset` | Volver los offsets a cero | acción |  | `/a/grid/offsetReset` |  |  |
| `grid.reveal` | Cargar grilla | acción | duración en s (opcional) | `/a/grid/reveal` |  |  |
| `grid.reveal.cancel` | Completar carga de grilla | acción |  | `/a/grid/reveal/cancel` |  |  |

### sweep

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `sweep.enabled` | Barridos | bool | false \| true | `/p/sweep/enabled` | `/pn/sweep/enabled` |  |
| `sweep.opacity` | Opacidad | float | 0 .. 1 | `/p/sweep/opacity` | `/pn/sweep/opacity` |  |
| `sweep.duration` | Duración (s) | float | 0.1 .. 6 | `/p/sweep/duration` | `/pn/sweep/duration` |  |
| `sweep.length` | Largo (frac. alto) | float | 0.1 .. 1.5 | `/p/sweep/length` | `/pn/sweep/length` |  |
| `sweep.solidHeight` | Alto sólido (frac.) | float | 0.1 .. 1 | `/p/sweep/solidHeight` | `/pn/sweep/solidHeight` |  |
| `sweep.solidDuration` | Sólido: entrada (s) | float | 0.1 .. 6 | `/p/sweep/solidDuration` | `/pn/sweep/solidDuration` |  |
| `sweep.solidHold` | Sólido: se queda (s) | float | 0 .. 8 | `/p/sweep/solidHold` | `/pn/sweep/solidHold` |  |
| `sweep.solidFade` | Sólido: se apaga (s) | float | 0.05 .. 4 | `/p/sweep/solidFade` | `/pn/sweep/solidFade` |  |
| `sweep.dirBlue` | Sentido azul | enum | down \| up \| random | `/p/sweep/dirBlue` | `/pn/sweep/dirBlue` |  |
| `sweep.dirWhite` | Sentido blanco | enum | down \| up \| random | `/p/sweep/dirWhite` | `/pn/sweep/dirWhite` |  |
| `sweep.dirSolid` | Sentido sólido | enum | down \| up \| random | `/p/sweep/dirSolid` | `/pn/sweep/dirSolid` |  |
| `sweep.blueColor` | Azul | color | hex #RRGGBB | `/p/sweep/blueColor` | `/pn/sweep/blueColor` |  |
| `sweep.whiteColor` | Blanco | color | hex #RRGGBB | `/p/sweep/whiteColor` | `/pn/sweep/whiteColor` |  |
| `sweep.avoidRepeat` | No repetir bloque | bool | false \| true | `/p/sweep/avoidRepeat` | `/pn/sweep/avoidRepeat` |  |
| `sweep.blue` | Barrido azul (6) | acción | random \| 1..5 | `/a/sweep/blue` |  | Nota 48 ch8, Nota 44 ch2 |
| `sweep.white` | Barrido blanco (6b) | acción | random \| 1..5 | `/a/sweep/white` |  | Nota 51 ch8, Nota 39 ch2 |
| `sweep.solid` | Bloque sólido (6c) | acción | random \| 1..5 | `/a/sweep/solid` |  | Nota 24 ch4, Nota 36 ch7 |

### frame

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `frame.opacity` | Marco | float | 0 .. 1 | `/p/frame/opacity` | `/pn/frame/opacity` |  |
| `frame.thickness` | Grosor (px) | int | 1 .. 60 | `/p/frame/thickness` | `/pn/frame/thickness` |  |
| `frame.color` | Color | color | hex #RRGGBB | `/p/frame/color` | `/pn/frame/color` |  |

### line

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `line.opacity` | Línea | float | 0 .. 1 | `/p/line/opacity` | `/pn/line/opacity` |  |
| `line.mode` | Modo | enum | strike \| loop | `/p/line/mode` | `/pn/line/mode` |  |
| `line.width` | Ancho (px) | int | 1 .. 20 | `/p/line/width` | `/pn/line/width` |  |
| `line.speed` | Velocidad (px/s) | float | 0 .. 600 | `/p/line/speed` | `/pn/line/speed` |  |
| `line.direction` | Sentido | int | -1 .. 1 | `/p/line/direction` | `/pn/line/direction` |  |
| `line.orientation` | Orientación | enum | vertical \| horizontal | `/p/line/orientation` | `/pn/line/orientation` |  |
| `line.strikeTime` | Caída (s) | float | 0.02 .. 1 | `/p/line/strikeTime` | `/pn/line/strikeTime` |  |
| `line.fadeOut` | Apagado (s) | float | 0 .. 2 | `/p/line/fadeOut` | `/pn/line/fadeOut` |  |
| `line.maxLines` | Líneas simultáneas | int | 1 .. 8 | `/p/line/maxLines` | `/pn/line/maxLines` |  |
| `line.wrap` | Wrap (modo loop) | bool | false \| true | `/p/line/wrap` | `/pn/line/wrap` |  |
| `line.x` | Posición | float | 0 .. 2688 | `/p/line/x` | `/pn/line/x` |  |
| `line.strike` | Disparar línea | acción | edge \| center \| random \| px | `/a/line/strike` |  | Nota 33 ch4 |
| `line.flip` | Invertir sentido (2b) | acción |  | `/a/line/flip` |  | Nota 36 ch2 |
| `line.rotate` | Girar 90° | acción |  | `/a/line/rotate` |  |  |
| `line.hide` | Apagar línea | acción |  | `/a/line/hide` |  |  |

### layer3d

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `layer3d.opacity` | Capa 3D | float | 0 .. 1 | `/p/layer3d/opacity` | `/pn/layer3d/opacity` |  |

### camera

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `camera.eyeX` | Ojo X (m) | float | -4 .. 4 | `/p/camera/eyeX` | `/pn/camera/eyeX` |  |
| `camera.eyeY` | Ojo Y (m) | float | 0 .. 3 | `/p/camera/eyeY` | `/pn/camera/eyeY` |  |
| `camera.eyeZ` | Ojo Z (m) | float | 1 .. 10 | `/p/camera/eyeZ` | `/pn/camera/eyeZ` |  |

### light

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `light.ambient` | Ambiente | float | 0 .. 3 | `/p/light/ambient` | `/pn/light/ambient` |  |
| `light.ambientColor` | Color ambiente | color | hex #RRGGBB | `/p/light/ambientColor` | `/pn/light/ambientColor` |  |
| `light.key` | Luz principal | float | 0 .. 10 | `/p/light/key` | `/pn/light/key` |  |
| `light.keyColor` | Color principal | color | hex #RRGGBB | `/p/light/keyColor` | `/pn/light/keyColor` |  |
| `light.keyX` | Principal X (m) | float | -8 .. 8 | `/p/light/keyX` | `/pn/light/keyX` |  |
| `light.keyY` | Principal Y (m) | float | 0 .. 8 | `/p/light/keyY` | `/pn/light/keyY` |  |
| `light.keyZ` | Principal Z (m) | float | -8 .. 8 | `/p/light/keyZ` | `/pn/light/keyZ` |  |
| `light.fill` | Relleno | float | 0 .. 10 | `/p/light/fill` | `/pn/light/fill` |  |
| `light.fillColor` | Color relleno | color | hex #RRGGBB | `/p/light/fillColor` | `/pn/light/fillColor` |  |

### floor

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `floor.opacity` | Piso | float | 0 .. 1 | `/p/floor/opacity` | `/pn/floor/opacity` |  |
| `floor.brightness` | Brillo | float | 0 .. 1 | `/p/floor/brightness` | `/pn/floor/brightness` |  |
| `floor.laneSpacing` | Separación carriles (m) | float | 0.1 .. 3 | `/p/floor/laneSpacing` | `/pn/floor/laneSpacing` |  |
| `floor.dashLength` | Largo dash (m) | float | 0.05 .. 3 | `/p/floor/dashLength` | `/pn/floor/dashLength` |  |
| `floor.dashPeriod` | Período dash (m) | float | 0.1 .. 6 | `/p/floor/dashPeriod` | `/pn/floor/dashPeriod` |  |
| `floor.dashWidth` | Ancho dash (m) | float | 0.01 .. 0.5 | `/p/floor/dashWidth` | `/pn/floor/dashWidth` |  |
| `floor.dashHeight` | Alto dash (m) | float | 0.002 .. 0.3 | `/p/floor/dashHeight` | `/pn/floor/dashHeight` |  |
| `floor.scrollSpeed` | Avance (m/s) | float | -5 .. 5 | `/p/floor/scrollSpeed` | `/pn/floor/scrollSpeed` |  |
| `floor.revealDuration` | Duración aparición (s) | float | 0.1 .. 20 | `/p/floor/revealDuration` | `/pn/floor/revealDuration` |  |
| `floor.fadeFar` | Alcance (m) | float | 5 .. 120 | `/p/floor/fadeFar` | `/pn/floor/fadeFar` |  |
| `floor.revealDist` | Alcance actual (m) | float | 0 .. 120 | `/p/floor/revealDist` | `/pn/floor/revealDist` |  |
| `floor.reveal` | Extender piso | acción |  | `/a/floor/reveal` |  |  |
| `floor.hide` | Retraer piso | acción |  | `/a/floor/hide` |  |  |

### box

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `box.visible` | Aristas | float | 0 .. 1 | `/p/box/visible` | `/pn/box/visible` |  |
| `box.enabled` | Límite activo | bool | false \| true | `/p/box/enabled` | `/pn/box/enabled` |  |
| `box.preset` | Posición | enum | left \| center \| right | `/p/box/preset` | `/pn/box/preset` |  |
| `box.x` | X (m) | float | -6 .. 6 | `/p/box/x` | `/pn/box/x` |  |
| `box.y` | Y (m) | float | 0 .. 4 | `/p/box/y` | `/pn/box/y` |  |
| `box.z` | Z (m) | float | -5 .. 0 | `/p/box/z` | `/pn/box/z` |  |
| `box.width` | Ancho (m) | float | 0.5 .. 11 | `/p/box/width` | `/pn/box/width` |  |
| `box.height` | Alto (m) | float | 0.5 .. 8 | `/p/box/height` | `/pn/box/height` |  |
| `box.depth` | Profundidad (m) | float | 0.5 .. 8 | `/p/box/depth` | `/pn/box/depth` |  |
| `box.yaw` | Giro Y (°) | float | -180 .. 180 | `/p/box/yaw` | `/pn/box/yaw` |  |
| `box.yawSpeed` | Giro continuo (°/s) | float | -90 .. 90 | `/p/box/yawSpeed` | `/pn/box/yawSpeed` |  |
| `box.wallStiffness` | Rigidez pared | float | 0 .. 2 | `/p/box/wallStiffness` | `/pn/box/wallStiffness` |  |
| `box.wallMaxPush` | Empuje máximo | float | 0 .. 40 | `/p/box/wallMaxPush` | `/pn/box/wallMaxPush` |  |
| `box.hardClamp` | Clamp duro | bool | false \| true | `/p/box/hardClamp` | `/pn/box/hardClamp` |  |
| `box.wallBounce` | Rebote en la pared | float | 0 .. 1 | `/p/box/wallBounce` | `/pn/box/wallBounce` |  |
| `box.flicker` | Titileo | bool | false \| true | `/p/box/flicker` | `/pn/box/flicker` |  |
| `box.flickerRate` | Titileo (Hz) | float | 0.5 .. 30 | `/p/box/flickerRate` | `/pn/box/flickerRate` |  |
| `box.flickerDuty` | Titileo duty | float | 0 .. 1 | `/p/box/flickerDuty` | `/pn/box/flickerDuty` |  |
| `box.color` | Color | color | hex #RRGGBB | `/p/box/color` | `/pn/box/color` |  |
| `box.growDuration` | Crecer desde la base (s) | float | 0 .. 8 | `/p/box/growDuration` | `/pn/box/growDuration` |  |
| `box.grow` | Crecer desde la base | acción |  | `/a/box/grow` |  |  |

### redBlock

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `redBlock.opacity` | Bloque rojo | float | 0 .. 1 | `/p/redBlock/opacity` | `/pn/redBlock/opacity` |  |
| `redBlock.side` | Lado | enum | left \| right | `/p/redBlock/side` | `/pn/redBlock/side` |  |
| `redBlock.x` | X (m) | float | 0 .. 6 | `/p/redBlock/x` | `/pn/redBlock/x` |  |
| `redBlock.z` | Z (m) | float | -5 .. 0 | `/p/redBlock/z` | `/pn/redBlock/z` |  |
| `redBlock.width` | Ancho (m) | float | 0.2 .. 12 | `/p/redBlock/width` | `/pn/redBlock/width` |  |
| `redBlock.height` | Alto (m) | float | 0.2 .. 16 | `/p/redBlock/height` | `/pn/redBlock/height` |  |
| `redBlock.y` | Centro Y (m) | float | -4 .. 6 | `/p/redBlock/y` | `/pn/redBlock/y` |  |
| `redBlock.yaw` | Giro (°) | float | -90 .. 90 | `/p/redBlock/yaw` | `/pn/redBlock/yaw` |  |
| `redBlock.color` | Color | color | hex #RRGGBB | `/p/redBlock/color` | `/pn/redBlock/color` |  |
| `redBlock.attract` | Atracción | float | 0 .. 400 | `/p/redBlock/attract` | `/pn/redBlock/attract` |  |
| `redBlock.attractRadius` | Radio atracción (m) | float | 0.2 .. 12 | `/p/redBlock/attractRadius` | `/pn/redBlock/attractRadius` |  |
| `redBlock.attractDir` | Dirección vs. punto | float | 0 .. 1 | `/p/redBlock/attractDir` | `/pn/redBlock/attractDir` |  |
| `redBlock.attractPulse` | Pulso de la fuerza | float | 0 .. 2 | `/p/redBlock/attractPulse` | `/pn/redBlock/attractPulse` |  |
| `redBlock.attractPulseRate` | Pulso (Hz) | float | 0.2 .. 30 | `/p/redBlock/attractPulseRate` | `/pn/redBlock/attractPulseRate` |  |
| `redBlock.vibrate` | Vibración (m) | float | 0 .. 0.8 | `/p/redBlock/vibrate` | `/pn/redBlock/vibrate` |  |
| `redBlock.vibrateRate` | Vibración (Hz) | float | 0.5 .. 40 | `/p/redBlock/vibrateRate` | `/pn/redBlock/vibrateRate` |  |
| `redBlock.flicker` | Titileo del rojo | float | 0 .. 1 | `/p/redBlock/flicker` | `/pn/redBlock/flicker` |  |
| `redBlock.flickerRate` | Titileo (Hz) | float | 0.2 .. 30 | `/p/redBlock/flickerRate` | `/pn/redBlock/flickerRate` |  |

### orb

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `orb.opacity` | Orbe | float | 0 .. 1 | `/p/orb/opacity` | `/pn/orb/opacity` |  |
| `orb.color` | Color | color | hex #RRGGBB | `/p/orb/color` | `/pn/orb/color` |  |
| `orb.pull` | Atracción | float | 0 .. 300 | `/p/orb/pull` | `/pn/orb/pull` |  |
| `orb.radius` | Radio atracción (m) | float | 0.3 .. 8 | `/p/orb/radius` | `/pn/orb/radius` |  |
| `orb.light` | Luz | float | 0 .. 60 | `/p/orb/light` | `/pn/orb/light` |  |
| `orb.lightRange` | Alcance de la luz (m) | float | 0.5 .. 14 | `/p/orb/lightRange` | `/pn/orb/lightRange` |  |
| `orb.darken` | Apagado de los palitos | float | 0 .. 1 | `/p/orb/darken` | `/pn/orb/darken` |  |
| `orb.darkenRadius` | Radio del apagado (m) | float | 0.3 .. 8 | `/p/orb/darkenRadius` | `/pn/orb/darkenRadius` |  |
| `orb.darkenJitter` | Dispersión del apagado | float | 0 .. 1 | `/p/orb/darkenJitter` | `/pn/orb/darkenJitter` |  |
| `orb.core` | Núcleo visible | float | 0 .. 1 | `/p/orb/core` | `/pn/orb/core` |  |
| `orb.size` | Tamaño del núcleo (m) | float | 0.02 .. 1 | `/p/orb/size` | `/pn/orb/size` |  |
| `orb.bloom` | Bloom | float | 0 .. 1 | `/p/orb/bloom` | `/pn/orb/bloom` |  |
| `orb.x` | Centro X (m) | float | -5 .. 5 | `/p/orb/x` | `/pn/orb/x` |  |
| `orb.y` | Centro Y (m) | float | 0 .. 5 | `/p/orb/y` | `/pn/orb/y` |  |
| `orb.z` | Centro Z (m) | float | -5 .. 0 | `/p/orb/z` | `/pn/orb/z` |  |
| `orb.travelX` | Paseo X (m) | float | 0 .. 5 | `/p/orb/travelX` | `/pn/orb/travelX` |  |
| `orb.travelY` | Paseo Y (m) | float | 0 .. 3 | `/p/orb/travelY` | `/pn/orb/travelY` |  |
| `orb.travelZ` | Paseo Z (m) | float | 0 .. 3 | `/p/orb/travelZ` | `/pn/orb/travelZ` |  |
| `orb.travelRate` | Paseo (Hz) | float | 0.01 .. 1 | `/p/orb/travelRate` | `/pn/orb/travelRate` |  |
| `orb.attack` | Ataque (s) | float | 0 .. 1.5 | `/p/orb/attack` | `/pn/orb/attack` |  |
| `orb.decay` | Caída (s) | float | 0.1 .. 12 | `/p/orb/decay` | `/pn/orb/decay` |  |
| `orb.push` | Empujón al soltar | float | 0 .. 1.5 | `/p/orb/push` | `/pn/orb/push` |  |
| `orb.auto` | Automático (Hz) | float | 0 .. 2 | `/p/orb/auto` | `/pn/orb/auto` |  |
| `orb.flash` | Aparecer | acción |  | `/a/orb/flash` |  |  |

### debris

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `debris.opacity` | Esquirlas | float | 0 .. 1 | `/p/debris/opacity` | `/pn/debris/opacity` |  |
| `debris.count` | Por impacto | int | 0 .. 300 | `/p/debris/count` | `/pn/debris/count` |  |
| `debris.size` | Tamaño (m) | float | 0.01 .. 0.3 | `/p/debris/size` | `/pn/debris/size` |  |
| `debris.speed` | Velocidad (m/s) | float | 0 .. 40 | `/p/debris/speed` | `/pn/debris/speed` |  |
| `debris.lifetime` | Duración (s) | float | 0.05 .. 10 | `/p/debris/lifetime` | `/pn/debris/lifetime` |  |
| `debris.fadeFraction` | Fracción de fade | float | 0.05 .. 1 | `/p/debris/fadeFraction` | `/pn/debris/fadeFraction` |  |
| `debris.spread` | Apertura (0=vertical) | float | 0 .. 1 | `/p/debris/spread` | `/pn/debris/spread` |  |
| `debris.drag` | Frenado (1/s) | float | 0 .. 30 | `/p/debris/drag` | `/pn/debris/drag` |  |
| `debris.floorCollision` | Choca con el piso | bool | false \| true | `/p/debris/floorCollision` | `/pn/debris/floorCollision` |  |
| `debris.gravity` | Gravedad | float | 0 .. 20 | `/p/debris/gravity` | `/pn/debris/gravity` |  |
| `debris.bounce` | Rebote | float | 0 .. 1 | `/p/debris/bounce` | `/pn/debris/bounce` |  |
| `debris.friction` | Fricción | float | 0 .. 1 | `/p/debris/friction` | `/pn/debris/friction` |  |

### rays

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `rays.enabled` | Rayos | bool | false \| true | `/p/rays/enabled` | `/pn/rays/enabled` |  |
| `rays.opacity` | Opacidad | float | 0 .. 1 | `/p/rays/opacity` | `/pn/rays/opacity` |  |
| `rays.fallSpeed` | Velocidad (m/s) | float | 0.5 .. 30 | `/p/rays/fallSpeed` | `/pn/rays/fallSpeed` |  |
| `rays.length` | Largo (m) | float | 0.1 .. 4 | `/p/rays/length` | `/pn/rays/length` |  |
| `rays.width` | Ancho (m) | float | 0.002 .. 0.5 | `/p/rays/width` | `/pn/rays/width` |  |
| `rays.lightIntensity` | Luz del rayo | float | 0 .. 30 | `/p/rays/lightIntensity` | `/pn/rays/lightIntensity` |  |
| `rays.lightRange` | Alcance de luz (m) | float | 0.1 .. 6 | `/p/rays/lightRange` | `/pn/rays/lightRange` |  |
| `rays.startY` | Altura inicial (m) | float | 3 .. 8 | `/p/rays/startY` | `/pn/rays/startY` |  |
| `rays.zMin` | Z mínimo (m) | float | -5 .. 0 | `/p/rays/zMin` | `/pn/rays/zMin` |  |
| `rays.zMax` | Z máximo (m) | float | -5 .. 0 | `/p/rays/zMax` | `/pn/rays/zMax` |  |
| `rays.repelRadius` | Radio repulsión (m) | float | 0.1 .. 5 | `/p/rays/repelRadius` | `/pn/rays/repelRadius` |  |
| `rays.repelStrength` | Fuerza repulsión | float | 0 .. 400 | `/p/rays/repelStrength` | `/pn/rays/repelStrength` |  |
| `rays.impactRadius` | Radio impacto (m) | float | 0.1 .. 6 | `/p/rays/impactRadius` | `/pn/rays/impactRadius` |  |
| `rays.impactStrength` | Fuerza impacto | float | 0 .. 400 | `/p/rays/impactStrength` | `/pn/rays/impactStrength` |  |
| `rays.impactTime` | Duración del impacto (s) | float | 0.1 .. 1.5 | `/p/rays/impactTime` | `/pn/rays/impactTime` |  |
| `rays.bloom` | Bloom | float | 0 .. 4 | `/p/rays/bloom` | `/pn/rays/bloom` |  |
| `rays.color` | Color | color | hex #RRGGBB | `/p/rays/color` | `/pn/rays/color` |  |
| `ray.spawn` | Disparar rayo | acción | random \| left \| center \| right \| número | `/a/ray/spawn` |  | Nota 0 ch1 |

### particles

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `particles.opacity` | Partículas | float | 0 .. 1 | `/p/particles/opacity` | `/pn/particles/opacity` |  |
| `particles.count` | Cantidad | int | 4096 .. 524288 | `/p/particles/count` | `/pn/particles/count` |  |
| `particles.fraction` | Fracción de palitos | float | 0.02 .. 1 | `/p/particles/fraction` | `/pn/particles/fraction` |  |
| `particles.baseColor` | Color base | color | hex #RRGGBB | `/p/particles/baseColor` | `/pn/particles/baseColor` |  |
| `particles.altColor` | Color alterno | color | hex #RRGGBB | `/p/particles/altColor` | `/pn/particles/altColor` |  |
| `particles.blackChance` | Probabilidad mitad negra | float | 0 .. 1 | `/p/particles/blackChance` | `/pn/particles/blackChance` |  |
| `particles.blackHalf` | Mitad negra activa | bool | false \| true | `/p/particles/blackHalf` | `/pn/particles/blackHalf` |  |
| `particles.blackSeed` | Selección negra | int | 0 .. 65535 | `/p/particles/blackSeed` | `/pn/particles/blackSeed` |  |
| `particles.blackAllChance` | Probabilidad negro total | float | 0 .. 1 | `/p/particles/blackAllChance` | `/pn/particles/blackAllChance` |  |
| `particles.blackAll` | Negro total activo | bool | false \| true | `/p/particles/blackAll` | `/pn/particles/blackAll` |  |
| `particles.whiteEnabled` | Blanco por velocidad | bool | false \| true | `/p/particles/whiteEnabled` | `/pn/particles/whiteEnabled` |  |
| `particles.whiteSpeedMin` | Blanco desde | float | 0 .. 20 | `/p/particles/whiteSpeedMin` | `/pn/particles/whiteSpeedMin` |  |
| `particles.whiteSpeedMax` | Blanco hasta | float | 0 .. 40 | `/p/particles/whiteSpeedMax` | `/pn/particles/whiteSpeedMax` |  |
| `particles.size` | Tamaño | float | 0.5 .. 6 | `/p/particles/size` | `/pn/particles/size` |  |
| `particles.length` | Largo | float | 0.02 .. 4 | `/p/particles/length` | `/pn/particles/length` |  |
| `particles.speed` | Velocidad sim | float | 0 .. 2 | `/p/particles/speed` | `/pn/particles/speed` |  |
| `particles.turbulence` | Turbulencia | float | 0 .. 2 | `/p/particles/turbulence` | `/pn/particles/turbulence` |  |
| `particles.turbulenceScale` | Escala turbulencia | float | 0.005 .. 0.05 | `/p/particles/turbulenceScale` | `/pn/particles/turbulenceScale` |  |
| `particles.turbulenceSpeed` | Vel. turbulencia | float | 0 .. 2 | `/p/particles/turbulenceSpeed` | `/pn/particles/turbulenceSpeed` |  |
| `particles.density` | Densidad | float | 0.15 .. 2 | `/p/particles/density` | `/pn/particles/density` |  |
| `particles.stiffness` | Rigidez | float | 0.5 .. 10 | `/p/particles/stiffness` | `/pn/particles/stiffness` |  |
| `particles.viscosity` | Viscosidad | float | 0.01 .. 0.4 | `/p/particles/viscosity` | `/pn/particles/viscosity` |  |
| `particles.gravityY` | Gravedad Y | float | -1 .. 1 | `/p/particles/gravityY` | `/pn/particles/gravityY` |  |
| `particles.bloom` | Bloom | float | 0 .. 1 | `/p/particles/bloom` | `/pn/particles/bloom` |  |
| `particles.raysOnly` | Iluminar sólo con rayos | bool | false \| true | `/p/particles/raysOnly` | `/pn/particles/raysOnly` |  |
| `particles.ageGrow` | Crecer con la edad (s) | float | 0.05 .. 6 | `/p/particles/ageGrow` | `/pn/particles/ageGrow` |  |
| `particles.sizeJitter` | Variación de tamaño | float | 0 .. 1 | `/p/particles/sizeJitter` | `/pn/particles/sizeJitter` |  |
| `particles.taper` | Punta (cola más fina) | float | 0 .. 0.95 | `/p/particles/taper` | `/pn/particles/taper` |  |
| `particles.headTail` | Degradado cabeza/cola | float | 0 .. 1 | `/p/particles/headTail` | `/pn/particles/headTail` |  |
| `particles.whiteJitter` | Dispersión del blanco | float | 0 .. 2 | `/p/particles/whiteJitter` | `/pn/particles/whiteJitter` |  |
| `particles.roughness` | Rugosidad | float | 0 .. 1 | `/p/particles/roughness` | `/pn/particles/roughness` |  |
| `particles.metalness` | Metalicidad | float | 0 .. 1 | `/p/particles/metalness` | `/pn/particles/metalness` |  |
| `particles.emissive` | Emisión propia | float | 0 .. 2 | `/p/particles/emissive` | `/pn/particles/emissive` |  |
| `particles.speedSmooth` | Suavizado de velocidad (1/s) | float | 0.5 .. 40 | `/p/particles/speedSmooth` | `/pn/particles/speedSmooth` |  |
| `particles.turnRate` | Giro del palito (1/s) | float | 0.5 .. 40 | `/p/particles/turnRate` | `/pn/particles/turnRate` |  |
| `particles.flicker` | Titileo | float | 0 .. 1 | `/p/particles/flicker` | `/pn/particles/flicker` |  |
| `particles.flickerRate` | Titileo (Hz) | float | 0.1 .. 40 | `/p/particles/flickerRate` | `/pn/particles/flickerRate` |  |
| `particles.birthTime` | Nacimiento (s) | float | 0 .. 8 | `/p/particles/birthTime` | `/pn/particles/birthTime` |  |
| `particles.birthAxis` | Eje del nacimiento | enum | y \| x \| z \| radial | `/p/particles/birthAxis` | `/pn/particles/birthAxis` |  |
| `particles.birthSpread` | Desorden del frente | float | 0 .. 1 | `/p/particles/birthSpread` | `/pn/particles/birthSpread` |  |
| `particles.flowX` | Flujo X | float | -3 .. 3 | `/p/particles/flowX` | `/pn/particles/flowX` |  |
| `particles.flowY` | Flujo Y | float | -3 .. 3 | `/p/particles/flowY` | `/pn/particles/flowY` |  |
| `particles.flowZ` | Flujo Z | float | -3 .. 3 | `/p/particles/flowZ` | `/pn/particles/flowZ` |  |
| `particles.drag` | Rozamiento | float | 0 .. 1 | `/p/particles/drag` | `/pn/particles/drag` |  |
| `particles.wrapMode` | Emisión continua | enum | off \| vertical \| horizontal \| radial | `/p/particles/wrapMode` | `/pn/particles/wrapMode` |  |
| `particles.wrapTop` | Margen fuera de cuadro (m) | float | 0 .. 4 | `/p/particles/wrapTop` | `/pn/particles/wrapTop` |  |
| `particles.emitSpread` | Alto del emisor (m) | float | 0 .. 2 | `/p/particles/emitSpread` | `/pn/particles/emitSpread` |  |
| `particles.kickAmount` | Golpe | float | 0 .. 3 | `/p/particles/kickAmount` | `/pn/particles/kickAmount` |  |
| `particles.kickDecay` | Caída del golpe (s) | float | 0.05 .. 3 | `/p/particles/kickDecay` | `/pn/particles/kickDecay` |  |
| `particles.localPushAmount` | Empuje local | float | 0 .. 120 | `/p/particles/localPushAmount` | `/pn/particles/localPushAmount` |  |
| `particles.localPushRadiusMin` | Empuje radio mínimo (m) | float | 0.2 .. 3 | `/p/particles/localPushRadiusMin` | `/pn/particles/localPushRadiusMin` |  |
| `particles.localPushRadiusMax` | Empuje radio máximo (m) | float | 0.2 .. 4 | `/p/particles/localPushRadiusMax` | `/pn/particles/localPushRadiusMax` |  |
| `particles.localPushDecay` | Empuje caída (s) | float | 0.05 .. 2 | `/p/particles/localPushDecay` | `/pn/particles/localPushDecay` |  |
| `particles.colorFlip` | Alternar color | acción |  | `/a/particles/colorFlip` |  |  |
| `particles.colorKickRandom` | Kick rojo/azul/negro | acción |  | `/a/particles/colorKickRandom` |  | Nota 0 ch1 |
| `particles.resetInBox` | Reubicar en la caja | acción |  | `/a/particles/resetInBox` |  |  |
| `particles.fillColumn` | Llenar la columna de flujo | acción |  | `/a/particles/fillColumn` |  |  |
| `particles.kick` | Golpe de turbulencia | acción |  | `/a/particles/kick` |  | Nota 0 ch1 |
| `particles.localPush` | Empujar zona al azar | acción |  | `/a/particles/localPush` |  | Nota 43 ch2 |

### vortex

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `vortex.swirl` | Torbellino giro (− = al revés) | float | -30 .. 30 | `/p/vortex/swirl` | `/pn/vortex/swirl` |  |
| `vortex.pull` | Torbellino atracción (− = repele) | float | -60 .. 60 | `/p/vortex/pull` | `/pn/vortex/pull` |  |
| `vortex.lift` | Torbellino ascenso | float | -2 .. 2 | `/p/vortex/lift` | `/pn/vortex/lift` |  |
| `vortex.radius` | Torbellino radio (m) | float | 0.2 .. 6 | `/p/vortex/radius` | `/pn/vortex/radius` |  |
| `vortex.outwardDamping` | Cohesión radial | float | 0 .. 1 | `/p/vortex/outwardDamping` | `/pn/vortex/outwardDamping` |  |
| `vortex.response` | Transformación directa (1/s) | float | 0 .. 60 | `/p/vortex/response` | `/pn/vortex/response` |  |
| `vortex.cutoff` | Torbellino corte (× radio) | float | 0 .. 8 | `/p/vortex/cutoff` | `/pn/vortex/cutoff` |  |
| `vortex.x` | Torbellino X (m) | float | -4 .. 4 | `/p/vortex/x` | `/pn/vortex/x` |  |
| `vortex.z` | Torbellino Z (m) | float | -5 .. 0 | `/p/vortex/z` | `/pn/vortex/z` |  |
| `vortex.axis` | Eje del torbellino | enum | y \| x \| z | `/p/vortex/axis` | `/pn/vortex/axis` |  |
| `vortex.y` | Torbellino Y (m) | float | 0 .. 5 | `/p/vortex/y` | `/pn/vortex/y` |  |
| `vortex.travelX` | Paseo X (m) | float | 0 .. 4 | `/p/vortex/travelX` | `/pn/vortex/travelX` |  |
| `vortex.travelZ` | Paseo Z (m) | float | 0 .. 2 | `/p/vortex/travelZ` | `/pn/vortex/travelZ` |  |
| `vortex.travelRate` | Paseo (Hz) | float | 0 .. 0.5 | `/p/vortex/travelRate` | `/pn/vortex/travelRate` |  |
| `vortex.strobe` | Estrobo | float | 0 .. 1 | `/p/vortex/strobe` | `/pn/vortex/strobe` |  |
| `vortex.strobeRate` | Estrobo (Hz) | float | 0.2 .. 40 | `/p/vortex/strobeRate` | `/pn/vortex/strobeRate` |  |
| `vortex.strobeDuty` | Estrobo duty | float | 0.05 .. 0.95 | `/p/vortex/strobeDuty` | `/pn/vortex/strobeDuty` |  |
| `vortex.axisFlipXY` | Alternar eje Y/X | acción |  | `/a/vortex/axisFlipXY` |  | Nota 0 ch1 |

### field

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `field.amount` | Campo fuerza | float | 0 .. 6 | `/p/field/amount` | `/pn/field/amount` |  |
| `field.align` | Campo alineación (1/s) | float | 0 .. 12 | `/p/field/align` | `/pn/field/align` |  |
| `field.scale` | Campo escala | float | 0.002 .. 0.06 | `/p/field/scale` | `/pn/field/scale` |  |
| `field.speed` | Campo velocidad | float | 0 .. 3 | `/p/field/speed` | `/pn/field/speed` |  |
| `field.sectors` | Sectores | int | 1 .. 5 | `/p/field/sectors` | `/pn/field/sectors` |  |
| `field.variation` | Variación entre sectores | float | 0 .. 1 | `/p/field/variation` | `/pn/field/variation` |  |
| `field.speedSpread` | Dif. de velocidad | float | 0 .. 1 | `/p/field/speedSpread` | `/pn/field/speedSpread` |  |

### fluids

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `fluids.audioMode` | Audio del show (web = desde la página) | enum | web \| external | `/p/fluids/audioMode` | `/pn/fluids/audioMode` |  |
| `fluids.volume` | Volumen del track | float | 0 .. 1 | `/p/fluids/volume` | `/pn/fluids/volume` |  |
| `fluids.gain` | Ganancia de luz · Fluids | float | 0.4 .. 2.5 | `/p/fluids/gain` | `/pn/fluids/gain` |  |
| `fluids.supersample` | Supersampling (2 = sin rayado) | float | 1 .. 2 | `/p/fluids/supersample` | `/pn/fluids/supersample` |  |
| `fluids.arm` | Preparar motor Fluids | acción |  | `/a/fluids/arm` |  |  |
| `fluids.standby` | Previa · escena 24 | acción |  | `/a/fluids/standby` |  |  |
| `fluids.play` | Play · escena 25 | acción |  | `/a/fluids/play` |  |  |
| `fluids.pause` | Pausa · escena 25 | acción |  | `/a/fluids/pause` |  |  |
| `fluids.restart` | Reiniciar · escena 25 | acción |  | `/a/fluids/restart` |  |  |
| `fluids.seek` | Buscar · escena 25 | acción | segundos | `/a/fluids/seek` |  |  |
| `fluids.live` | Fluids live · escena 26 | acción |  | `/a/fluids/live` |  |  |

### fluids.live

| id | etiqueta | tipo | rango | OSC | OSC 0..1 | fuente MIDI/OSC |
|---|---|---|---|---|---|---|
| `fluids.live.emission` | Emisión · Fluids live (escena 26) | float | 0 .. 0.25 | `/p/fluids/live/emission` | `/pn/fluids/live/emission` |  |
| `fluids.live.x` | Emisor X · Fluids live (escena 26) | float | 0 .. 1 | `/p/fluids/live/x` | `/pn/fluids/live/x` |  |
| `fluids.live.y` | Emisor Y · Fluids live (escena 26) | float | 0 .. 1 | `/p/fluids/live/y` | `/pn/fluids/live/y` |  |
| `fluids.live.hue` | Color del emisor · Fluids live (escena 26) | float | 0 .. 1 | `/p/fluids/live/hue` | `/pn/fluids/live/hue` |  |
| `fluids.live.gravity` | Gravedad · Fluids live (escena 26) | float | -1 .. 1 | `/p/fluids/live/gravity` | `/pn/fluids/live/gravity` |  |
| `fluids.live.viscosity` | Viscosidad · Fluids live (escena 26) | float | 0 .. 1 | `/p/fluids/live/viscosity` | `/pn/fluids/live/viscosity` |  |
| `fluids.live.cohesion` | Cohesión · Fluids live (escena 26) | float | 0 .. 1 | `/p/fluids/live/cohesion` | `/pn/fluids/live/cohesion` |  |
| `fluids.live.light` | Luz · Fluids live (escena 26) | float | 0 .. 3 | `/p/fluids/live/light` | `/pn/fluids/live/light` |  |
| `fluids.live.forceX` | Fuerza X · Fluids live (escena 26) | float | -1 .. 1 | `/p/fluids/live/forceX` | `/pn/fluids/live/forceX` |  |
| `fluids.live.forceY` | Fuerza Y · Fluids live (escena 26) | float | -1 .. 1 | `/p/fluids/live/forceY` | `/pn/fluids/live/forceY` |  |
| `fluids.live.burst` | Ráfaga · escena 26 | acción | cantidad de partículas | `/a/fluids/live/burst` |  |  |
| `fluids.live.attractor` | Atractor · escena 26 | acción |  | `/a/fluids/live/attractor` |  |  |
| `fluids.live.reset` | Reiniciar fluido · escena 26 | acción |  | `/a/fluids/live/reset` |  |  |

## Rutas OSC automáticas (sin mapear nada)

| Dirección | Efecto |
|---|---|
| `/p/<grupo>/<nombre>` f | valor en rango nativo |
| `/pn/<grupo>/<nombre>` f 0..1 | valor normalizado |
| `/a/<grupo>/<nombre>` [arg] | dispara la acción |
| `/scene` s\|i | cambia de escena |
