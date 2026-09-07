# Fluids: audio propio, imagen sin rayado y escena 26 — 2026-09-06

Alcance: supersampling y ganancia de luz de Fluids, reproducción del track desde la salida, final de secuencia que ya no congela, y escena 26 como motor libre por MIDI. [Decisión vigente](CONTEXTO-ACTUAL.md) · [Operación](integracion-radiance/OPERACION.md) · [Detalle de la vuelta](../NOTAS.md).

## Qué se cambió

| Área | Antes | Ahora |
|---|---|---|
| Imagen | Buffer 2688×1008 (DPR 1) | Buffer 5376×2016, `fluids.supersample` = 2 |
| Luz | Sólo lo que dice el documento | `fluids.gain` = 1,25 sobre la energía del transporte y la exposición |
| Audio | Siempre en Ableton, página muda | La salida reproduce `fluids.wav`; `fluids.audioMode` = `web` \| `external`, nivel en `fluids.volume` |
| Reloj de la secuencia | `performance.now()` desde el cue | Anclado a `AudioContext.currentTime` en cada frame; cae al reloj de pared si no hay track |
| Final de la secuencia | Cuadro congelado, sin render ni física | El reloj se detiene, **el fluido sigue corriendo** |
| Escena 26 | Libre; motor live sin escena | Motor libre, controlado por `fluids.live.*` |

## Evidencia del rayado

Fila de píxeles del gradiente, mismo instante del timeline, canal verde:

```
DPR 1    221 220 218 220 222 224 223 220 220 221 224 224 223 222 ...
DPR 1.5  217 215 214 214 217 218 218 216 216 218 221 221 220 218 ...
DPR 2    210 210 212 212 211 212 212 213 213 214 214 214 214 215 ...
original  84  84  84  84  83  83  83  83  83  83  83  82  82  82 ...
```

A 1× y 1,5× la fila tiene ruido de ±3 niveles con estructura —un damero de ~2 px más rayos radiales desde cada luz—; a 2× vuelve a ser monótona, como la página original, que renderiza a DPR 2. El tiempo de render medio fue 1,5 ms en los tres casos: el costo lo manda el campo de radiancia, que es de resolución fija.

## Evidencia del brillo

Contra la página original con el mismo documento (hash SHA-256 idéntico), el brillo medio ya era equivalente: **21,4 contra 21,9** a los 6 s y **19,7 contra 21,7** a los 13 s. No había una ganancia perdida; lo que apagaba la imagen era el tramado.

`fluids.gain` = 1,25, medido a mitad de secuencia sobre cuadros consecutivos: brillo medio **38 → 58**, fracción iluminada del cuadro **37 % → 62 %**, percentil 99 **244 → 242**. Sube la penumbra sin quemar lo que ya llegaba a blanco.

**Límite de la comparación:** el fluido es caótico y a partir de los 40 s las dos corridas divergen en contenido (a los 123 s el original muestra la masa roja como occluder oscuro y la integración la muestra emitiendo). La comparación cuadro a cuadro no es concluyente más allá del brillo agregado y la textura del gradiente.

## Qué se comprobó

- **224 tests de código**: 203 del paquete Radiance, 16 de sesión, 4 del preview y 1 de mapeos. TypeScript y build del paquete Radiance aprobados. Build de producción de la aplicación aprobado.
- **`check-radiance.mjs`, 8 comprobaciones**, en desarrollo y sobre el build de producción: cancelación de un cue pendiente, previa 24 detenida, **el track de la página sonando y siendo el reloj de la secuencia**, cue 25 alineado sin re-disparo por notas repetidas, 25→24, entrada directa en 25, **el final que detiene el reloj y deja el fluido corriendo**, y **la 26 emitiendo y respondiendo a sus controles**.
- **`walk-scenes.mjs`**: las 29 escenas a 60 fps, 0,6 a 1,6 ms por frame, sin errores de consola nuevos.
- **`smoke-settings.mjs`** y **`smoke-persist.mjs`** aprobados.

## Números medidos

| Medida | Producción | Desarrollo |
|---|---|---|
| Comprobaciones del navegador | 8 | 8 |
| WAV decodificado y listo | 331 ms | 472 ms |
| Desfase entre el cue MIDI y el reloj de la secuencia | 1 ms | — |
| Frames muestreados | 480 | 480 |
| FPS | 60,0 | 60,0 |
| Peor intervalo | 17,1 ms | 17,1 ms |
| Intervalos >20 ms | 0 | 0 |
| Arranque de la salida hasta `window.vis` | — | 3,1 s |

Todas estas mediciones son **con el supersampling 2× puesto**.

## Límites que siguen abiertos

- **El rendimiento no está garantizado sin caídas.** Estas corridas no tuvieron intervalos >20 ms, pero mediciones anteriores de esta misma integración sí los tuvieron con otras aplicaciones activas. El límite de 50 Hz del solver WASM tampoco quedó resuelto: se conservan los tres subpasos para no cambiar el show escrito.
- **El audio necesita un gesto.** Chrome no deja sonar nada hasta el primer clic o tecla en la ventana de salida. El panel lo avisa, pero es un paso manual antes de cada show.
- **En la 26 la luz depende de la población y del movimiento.** Es el comportamiento del motor original preservado: una masa grande y quieta se lee apagada por más que se suba `light`.

## Fallas preexistentes, de otras vueltas

- `tools/smoke-learn.mjs` reprueba «acción + nota → modo trigger». La prueba busca el primer mapeo de `particles.kick` y encuentra el `drum-vortex-kick-21` que trajo la vuelta de rayos con luz ([VALIDACION-RAYOS.md](VALIDACION-RAYOS.md)), no el que acaba de aprender. Sin tocar.
- `tools/smoke-io.mjs` sigue con sus 4 fallas viejas: espera escenas `testA`/`testB` que no existen.

## Artefactos

`radiance-check/cues-24-25/production/` y `.../smoke/` (reportes y capturas de las 8 comprobaciones), `radiance-check/contraste/final/` (la 25 a 13/42/81 s y la 26 a 8/22 s tal como quedan).
