# Arquitectura del show

## Dos ventanas, una autoridad

`/control` conserva el estado del show, abre el micrófono y publica audio, parámetros y cues mediante un `BroadcastChannel` versionado. `/output` es una salida limpia: no contiene paneles ni solicita permisos y devuelve telemetría a Control. Su master de render es siempre **3360×1008** (10:3); en una ventana con otra proporción se previsualiza centrado y con bandas negras, sin cambiar el lienzo de las escenas. El protocolo actual es v3 y el estado persistido usa schema v2; la carga migra el schema anterior sin perder faders ni looks.

La salida posee el único `requestAnimationFrame`. Cada motor implementa el mismo contrato (`init`, `enter`, `frame`, `resize`, `suspend`, `telemetry`, `dispose`) y nunca inicia un loop propio.

## Escenas incluidas

1. **Radiance Fluid** — apertura predeterminada; conserva el solver y el renderer HRC de la demo original. `Original manual` reproduce sus controles de referencia. `Reactive original` porta la máquina completa de `/reactive`: momentos, transiciones, emisores, BPM, interacciones, física, grade y viñeta. Se suman Flotar, Agrupar, Mezclar, Caer, Viscoso, Estallido y Órbita como subescenas manuales.
2. **Depth Sorter** — sorter WebGPU y looks Radiance/Radiance 2 cargados bajo demanda.
3. **Bloques** — ImpulseMode 3 original: física Planck, render Three y transporte Amitabha HRC. Conserva cuerpos, emisores, paletas y acciones Q/W/E/R de la demo Piano en Vivo.
4. **Voronoi** — campo celular analítico con atlas de bosque, variantes Espectral y Monocromo.

Piano FFT, Polígonos, Laboratorio Óptico y los demás prototipos no se importan. Los repositorios anteriores se conservan como respaldo hasta confirmar paridad durante ensayos; no forman parte del bundle nuevo.

## Audio y control

El único AudioWorklet publica RMS, bandas gateadas por RMS, onset, flux, centroide, ataques de notas y el análisis armónico completo: centro tonal, confianza y apertura/entropía del acorde. `harmonic` se conserva como alias compatible del centro tonal. Cada parámetro elige:

- **Manual:** valor del fader.
- **Audio:** base del preset más modulación.
- **Híbrido:** fader más modulación.

La fuente, cantidad con signo, inversión y smoothing son configurables por parámetro. Sin micrófono, todas las escenas siguen operables manualmente.

Los controles discretos no pasan por la matriz de modulación: materiales y paletas usan selectores o swatches, los estados binarios usan toggles y reset/impulsos usan acciones. Fluid expone además masas y colores por material, emisión, física completa, Radiance, HSCB e interacciones; los macros de performance se aplican como trims y no reemplazan esos valores.

## Director AUTO / MANUAL

El botón global **AUTO REACTIVO** activa una capa efímera que vive únicamente en Output. El director puede recorrer Fluid → Bloques → Voronoi → Depth Sorter, decide looks en fronteras musicales y aplica targets continuos específicos de cada motor. Nunca escribe sobre los colores, faders, asignaciones de audio, looks ni acciones Q/W/E/R guardados por el operador.

Al pasar a **CONTROL MANUAL**, la capa automática se elimina en ese mismo frame y Output vuelve al estado persistido exacto. La intensidad, duración de escena, duración de look y el recorrido entre motores son configurables. Con el recorrido desactivado, AUTO permanece en la escena elegida y sólo dirige su look y sus parámetros. `Reactive original` sigue disponible como subescena Fluid independiente aun cuando el director global está apagado.

## Rendimiento

Los cambios entre WebGL y WebGPU usan un fundido a negro y destruyen el motor anterior antes de crear el siguiente. Esto evita mantener dos instancias HRC de alta calidad en memoria. El master de salida usa un buffer exacto de 3360×1008 a DPR 1; Bloques conserva su supersampling mínimo 1.5× sólo en previsualizaciones menores. La telemetría informa el tamaño y DPR efectivos del canvas.

## Aviso de distribución

Los binarios `pvfs2d_v2_7.js/.wasm` se conservan separados en `public/fluid`. No se identificó un permiso de redistribución para esos binarios: antes de publicar este repositorio o entregar un build a terceros hay que obtener autorización del autor o reemplazarlos por el solver limpio.
