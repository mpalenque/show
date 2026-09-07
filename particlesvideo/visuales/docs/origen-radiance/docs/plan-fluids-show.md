# Plan — Show "Fluids": línea emisora + editor de timeline sincronizado a `fluids.wav`

> Plan para ejecutar con Opus. Leer entero antes de tocar código. El análisis de audio
> **ya está hecho** (ver §2): no rehacerlo, consumirlo.

## 0. Objetivo

Un nuevo show basado en la escena de fluidos, manejado por una **línea de tiempo
sincronizada al audio** (`fluids.wav`, 152.69 s):

- La imagen base: **una línea que gira lentamente** (como la subescena **1C · RELOJ DE SOL**
  de Tres Masas, pero un poco más chica) desde la cual **se emiten las partículas de fluido**
  (mecánica de emisión de **3B · PORTAL BLANCO**).
- Un **editor de timeline en una página web local propia** con: playback del audio,
  scrubbing/skipping, waveform con onsets del análisis, **curvas de automatización
  editables a mano** y **cues/eventos** (strobes, flashes, sombras) — todo tiene que
  coincidir con el sonido.
- Parámetros automatizables v1 (pedido explícito del usuario):
  1. emisión de partículas, 2. color de partículas, 3. emisión de luz de las partículas,
  4. gravedad, 5. sensibilidad a la gravedad, 6. "fuerza/atasco" (el tema de que a veces
  se atasquen todas y parezca orgánico, a veces fluya lento).
- **Eventos violentos** de luz/sombra: líneas estroboscópicas, flashes, barridos de
  sombra que alteran la escena, alineados a golpes de la música.
- **Modo grabación de gestos**: con el track sonando, grabar los movimientos del mouse
  (agarrar/frenar la dinámica de las partículas), reproducirlos en el playback, y poder
  **sobreescribirlos** (punch-in sobre el rango regrabado).

## 1. Referencias exactas en el código existente (leer primero)

| Qué | Dónde |
|---|---|
| Patrón director de show (salida `{physics, render, interactions, geometry, resetParticles}`) | `src/scenes/fluid/TresMasasDirector.ts` |
| **1C** línea corta girando: `len 0.16`, `angularVelocity 0.14` | `TresMasasDirector.faroTargetFor`, `case 2` |
| **3B** emisión desde la línea: pulso cada `0.32 s`, 7 partículas a lo largo del blade, empuje por la normal (`beamPush`), cap de población | `TresMasasDirector.updatePortal` (cues 7/8) |
| Cómo un look engancha su director en la escena (branch de frame, interacciones → `solver.applyPointer`, render map → `renderer.render`, reset, HUD, datasets del canvas) | `src/scenes/fluid/FluidScene.ts` → `frameTresMasas` (línea ~608) |
| Overlay de geometría instanciada (línea/faro, strobes, oclusores; capacidad 160 instancias) | `src/scenes/fluid/TresMasasGeometry.ts` |
| Página dedicada: crea la escena, frame lógico fijo **2688×1008**, escalera SSAA, params por frame, StrictMode-safe, stats vía `canvas.dataset` | `src/tresmasas/TresMasasApp.tsx` |
| Ruteo de vistas | `src/main.tsx` |
| Looks registrados | `src/scenes/fluid/looks.ts` |
| Modos de interacción del solver: `drag, emit, attract, repel, vortex, vortex-reverse, delete, lock, unlock, collide` | `parameter-specs.ts` → `FLUID_INTERACTION_MODES`; worker: `KotFluidWorkerClient.js` |
| Puntero del canvas: **solo hace `drag`** (`applyCanvasPointerInteractions`, línea ~1658) — por eso los gestos del show van a nivel página, no canvas | `FluidScene.ts` |
| DSP puro reutilizable (FFT, bandas, flux, onsets) | `src/audio/dsp.ts` |
| Tests de referencia (estilo y determinismo de directores) | `TresMasasDirector.test.ts`, `OpeningFluidDirector.test.ts` |

Reglas duras:
- **No tocar el comportamiento de Tres Masas ni de los looks existentes.** El nuevo show
  es un branch aislado nuevo, igual que `frameTresMasas`.
- Seguir el estilo del repo (comentarios que explican el porqué, español en labels de UI).
- `npm run check` (tests + build) verde al final de cada milestone.

## 2. Ya hecho — análisis de audio (no rehacer)

- `tools/analyze-fluids.mjs` — script offline (Node, sin deps): STFT 2048/hop 512,
  envolventes de bandas, flux espectral por banda, onsets tímbricos con umbral adaptativo
  (mediana móvil ±0.5 s), secciones por novelty espectral, tempo por autocorrelación.
  Regenerar con: `node tools/analyze-fluids.mjs` (lee `public/audio/fluids.wav`).
- `public/show/fluids.analysis.json` (~390 KB) — lo que consume el editor:
  - `envelopes` a 43.07 Hz: `rms, bass, mid, high, air, flux, centroid` (normalizados 0..~1).
  - `onsets`: **874** eventos `{t, strength 0..1, band: 'low'|'mid'|'high', shares}`
    (587 low · 193 mid · 94 high).
  - `sections`: fronteras en `t = 0, 41.45, 52.43, 61.92, 74.40, 83.88, 94.87, 118.33`.
  - `tempo`: 191.4 BPM (leerlo como **~95.7 BPM** en doble subdivisión).
  - Forma del track: crece hasta el pico en 1:23–1:34, cae a la sección más tranquila
    1:34–1:58, y cierra 1:58–2:32 a media energía con menos densidad de golpes.

## 3. Archivos a crear / modificar

```
NUEVO  src/fluids-show/show-doc.ts            modelo del documento + sampleo (puro, testeable)
NUEVO  src/fluids-show/show-doc.test.ts
NUEVO  src/fluids-show/seed.ts                siembra inicial del doc desde el análisis
NUEVO  src/fluids-show/audio-transport.ts     wrapper de AudioContext (play/pause/seek/clock)
NUEVO  src/fluids-show/FluidsEditorApp.tsx    página editor + preview + perform
NUEVO  src/fluids-show/fluids-editor.css
NUEVO  src/fluids-show/lanes/*.tsx            WaveformLane, CurveLane, EventLane, GestureLane, Transport (canvas 2D)
NUEVO  src/scenes/fluid/FluidsShowDirector.ts + .test.ts
MOD    src/scenes/fluid/looks.ts              look id 'fluids-show' (valores neutros, como 'tres-masas')
MOD    src/scenes/fluid/FluidScene.ts         branch frameFluidsShow + setFluidsShowDoc()/setFluidsLiveGesture()
MOD    src/main.tsx                           ruta /fluids y ?view=fluids
HECHO  public/audio/fluids.wav                (ya movido; Vite lo sirve como /audio/fluids.wav)
HECHO  tools/analyze-fluids.mjs, public/show/fluids.analysis.json
```

## 4. Modelo del documento de show (`show-doc.ts`)

Todo el estado editable vive en un JSON serializable. Tipos exactos:

```ts
export type KeyShape = 'linear' | 'smooth' | 'hold';
export interface CurveKey { t: number; v: number; shape: KeyShape }
export interface Curve { keys: CurveKey[] }            // ordenadas por t

export type CurveId =
  | 'emission'        // 0..1  tasa de emisión desde la línea
  | 'emitHue'         // 0..1  matiz del material emisor (wrap)
  | 'emitSat'         // 0..1  saturación (0 = blanco)
  | 'lightEmission'   // 0..1  cuánta luz emiten las partículas
  | 'exposure'        // 0..2  master de exposición
  | 'bodies'          // 0..1  0 = sólo luz / 1 = se ven los cuerpos sin emitir
  | 'gravity'         // -1..1 gravedad global (negativo = sube)
  | 'gravitySense'    // 0..1  sensibilidad a la gravedad (masa)
  | 'cohesion'        // 0..1  0 = fluye suelto · 1 = se atasca en blobs orgánicos
  | 'viscosity'       // 0..1  0 = ágil · 1 = lento/viscoso
  | 'lineX'           // 0..1  posición horizontal del emisor
  | 'lineY'           // 0..1  posición vertical del emisor
  | 'lineEmit'        // 0..1  brillo del blade (0 = la línea desaparece)
  | 'lineSize'        // 0..1  largo de la línea
  | 'lineSpin';       // -1..1 velocidad de giro

export type ShowEventType =
  | 'strobe-lines' | 'flash' | 'blackout' | 'shadow-bar' | 'burst'
  | 'set-material' | 'set-lamp' | 'reset-fluid';

export interface ShowEvent {
  id: string; t: number; dur: number; type: ShowEventType;
  intensity: number;                    // 0..1, significado por tipo
  params: Record<string, number>;       // ver §6.3
}

export interface GestureSample { t: number; x: number; y: number }   // t relativo a t0, coords 0..1
export interface GestureClip {
  id: string; t0: number; t1: number;
  mode: 'drag' | 'attract' | 'repel' | 'vortex';
  radius: number; strength: number;     // fracciones de escena / fuerza solver
  samples: GestureSample[];             // ~60 Hz
}

export interface ShowDoc {
  version: 1;
  audioPath: string;                    // '/audio/fluids.wav'
  duration: number;                     // 152.69
  curves: Record<CurveId, Curve>;
  events: ShowEvent[];                  // ordenados por t
  gestures: GestureClip[];
}
```

Funciones puras (con tests):
- `sampleCurve(curve, t, fallback)` — búsqueda binaria; `hold` mantiene, `linear`
  interpola, `smooth` usa smoothstep entre keys. Antes de la primera key devuelve la
  primera; después de la última, la última. `emitHue` interpola con wrap.
- `eventsAt(doc, t)` — eventos con `t ≤ time < t + dur` (+ helper `eventPhase(e, t)`).
- `gesturesAt(doc, t)` y `sampleGesture(clip, t)` — interpola posición y deriva
  velocidad (dx/dt) de las muestras vecinas.
- `punchGestures(doc, t0, t1, clips)` — **sobreescritura**: recorta/elimina clips
  existentes que se solapen con `[t0, t1]` (partiendo un clip que cruce el borde) e
  inserta los nuevos. Test obligatorio: solape parcial izquierdo, derecho, contenido
  total, sin solape.
- `emptyDoc(duration)` y validación defensiva `parseShowDoc(json)` (nunca romper el
  show por un JSON dañado — mismo criterio que `load()` de TresMasasApp).

## 5. `FluidsShowDirector` — determinismo primero

Mismo contrato de salida que `TresMasasOutput`. Entrada:

```ts
interface FluidsShowContext {
  time: number;        // tiempo de timeline en segundos (reloj del audio)
  dt: number;
  playing: boolean;
  aspect: number;
  particleCount: number;
}
// El doc llega por referencia vía director.setDoc(doc) — no por frame.
```

**Regla de oro (scrubbing):** todo estado propio del director se deriva del **tiempo
absoluto**, nunca acumulado frame a frame:
- Ángulo de la línea: `angle = ∫spin` cerrada en forma analítica ⇒ con `lineSpin`
  constante basta `angle0 + spinRadS * time`; si la curva `lineSpin` tiene keys, integrar
  la polilínea de la curva analíticamente por tramos (es lineal a trozos: la integral es
  exacta y barata). Así, al saltar a `t`, la línea aparece exactamente donde corresponde.
- Fase de strobes: `phase = (time - event.t) * freqHz` — nunca un timer acumulado.
- Emisión: acumulador `emitAcc += pps(t) * dt` **solo mientras `playing`**; al hacer seek
  se limpia. (Las partículas son estatales por naturaleza — ver §10.)

### 5.1 La línea (faro chico)

Base igual a 1C pero más chica y con emisión estilo 3B:
- Posición: curvas `lineX`/`lineY` (def 0.5, 0.5 = el centro);
  `len = mix(0.06, 0.22, sampleCurve(lineSize, t, def 0.375))`
  → default = **0.12** (1C usa 0.16: "un poco más chica"). El plan decía `def 0.55`,
  que da 0.148: manda el resultado visible, 0.12.
- Giro: `spinRadS = sampleCurve(lineSpin) * 0.35` → default 0.10 rad/s (lento, como 1C).
- Render: mismos dos `GeoInstance` que `pushFaro` (blade emisivo `wideFeather` + oclusor
  de respaldo que hace la emisión unilateral). Copiar esa función, no importarla de
  TresMasasDirector (los directores no se conocen entre sí).

### 5.2 Emisión de partículas desde la línea

- `pps = emission² * ritmo`, cuadrático: fino abajo, denso arriba. El **ritmo no es
  una constante**: se deriva del documento (`rateForDoc`) integrando el cuadrado de la
  curva de emisión sobre todo el track, de modo que la curva entera escupa el techo de
  población **menos lo que se reservan los `emit-burst`**. Así, dibuje el operador el
  chorro que dibuje y donde lo dibuje, **todas** las partículas del show salen dentro de
  lo que él marcó, y cuando la curva se apaga no queda nada por emitir. La reserva es lo
  que hace que un chorro de evento salga siempre: si la curva se quedara con el techo
  entero, el chorro llegaría tarde y no nacería ni una partícula. No rompe la regla de
  oro: es una constante derivada del documento, no un acumulado.
  Batch de a 6:
  cuando `emitAcc ≥ 6`, emitir interacción `mode:'emit'` con `emitCount 6` en un punto
  aleatorio-determinista del blade (`hash(floor(time*37) + n)` como hace `updatePortal`),
  con offset lateral `0.03 * beamSign` y una interacción `drag` de empuje por la normal
  (`beamPush ≈ 0.005`), exactamente el patrón de 3B.
- Cap de población: `particleLimit` 20 000 (solver inicializa `maxParticles` 40 000). Si
  `particleCount ≥ cap`, no emitir (documentar en HUD "CAP").

### 5.3 Mapeo curvas → motor (valores concretos, no inventar otros)

| Curva | Destino | Mapeo |
|---|---|---|
| `emission` | interacciones `emit` | §5.2 |
| `emitHue`/`emitSat` | `render.materialColor{N}` del material emisor activo | HSV→RGB, V=1. **Sólo si la curva tiene keys**: vacías, el material usa su color de la paleta del documento (`ShowDoc.materialColors`, cuatro colores libres editables en la página). Antes las curvas vacías pintaban blanco al emisor, así que elegir material rojo o azul daba blanco igual. |
| `lightEmission` | `render.radiance` y el mapeo de emisión por velocidad | `radiance = 0.4 + v*1.2`. El emisivo tiene que **respirar con la velocidad**, no quedarse plano: el piso sube poco (`mix(0.05, 0.18, v)`) y lo que sube fuerte son el techo (`mix(1.6, 3.2, v)`) y la sensibilidad (`mix(3, 7, v)`). Con el mapeo viejo —piso 0.45, techo 2.2— el rango era de 5× y el rojo emisivo quedaba clavado arriba sin cambiar al moverse; ahora es de 17×, y un fluido lento igual recorre el rango en vez de quedarse pegado al piso. `velocityEmission: 1` siempre. |
| `bodies` | `render.lightOnly` + `render.bodyAmbient` | Cuánto pigmento propio muestra un cuerpo al que no le llega luz: `lightOnly = bodies <= 0.02 ? 1 : 0` y `bodyAmbient = bodies * 0.12`. En 0 desaparece lo no iluminado; en 0.12 (lo que usa el guion hasta 1:20) el ambiente queda en ~0.014 — **negros, opacos y haciendo sombra**, con color sólo donde les pega la luz; en 1 se ve el pigmento pleno. Hizo falta un uniform nuevo `uBodyAmbient` en `FluidRadianceRenderer` porque el 0.12 estaba hardcodeado y los dos valores de `lightOnly` daban o color plano o invisibilidad, nunca negro opaco. |
| `exposure` | `render.radianceExposure` | `0.38 * v` (0..2 ⇒ 0..0.76); los eventos flash/blackout multiplican encima |
| `gravity` | `physics.gravity` | `v < 0 ? v*0.3 : v*1.2` (negativa suave: cue 7 de TM usa −0.05) |
| `gravitySense` | masa de materiales | multiplicador `0.35 + v*2.15` (def 0.302 ⇒ 1.00×) sobre masas base `[0.45, 0.45, 0.45, 0.45]` — **las cuatro iguales a propósito**: con masas distintas el rojo se hundía y el blanco flotaba, y un mismo chorro se separaba en capas por color en vez de mezclarse. El color es una decisión de luz, no de física vía `solver.setMaterialMass`, **throttled a 10 Hz** y solo si cambió >1%. ✅ VERIFICADO: el worker sólo guarda la masa en una variable y `advance()` vuelca las cuatro en `_pvfs_set_parameters` en cada paso — cambiarla en caliente no resetea ni realoca nada, cuesta lo mismo que mover cualquier otro parámetro. El fallback no hizo falta. |
| `cohesion` | `physics.same/cross/nearStiffness/stiffness` | lerp entre **suelto** `{same 3.2, cross 5.5, near 0.08, stiff 0.20}` y **atascado orgánico** `{same 11.2, cross 1.3, near 1.45, stiff 0.30}` (extremos tomados de los looks `float/mix` y `cluster`) |
| `viscosity` | `physics.drag` + escala de fuerzas | `drag = 0.014 + v*0.12` — el freno de base va bien arriba del 0.002 original: el gradiente de emisión por velocidad sólo se ve si las partículas FRENAN (el tirón las enciende, el freno las apaga en degradé; sin esto deslizaban a velocidad casi constante, siempre igual de prendidas). Multiplicar `strength` de gestos e impulsos por `(1 − 0.45v)` para que "lento" se sienta en la mano también |

La física se aplica como en `frameTresMasas`: `approach()` hacia el target con
velocidad 2.6 (los saltos de seek convergen en <1 s) y `solver.setParameters`
throttled a 20 Hz (patrón existente de `physicsElapsed`).

### 5.4 Eventos (cambios violentos de luz y sombra)

Todos derivan su fase del tiempo absoluto. `intensity` escala el efecto.

Dos de ellos no son de luz sino de materia, y por eso viven acá y no en una curva:

- **`emit-burst` (CHORRO)** — un chorro de partículas que **no pasa por la curva de
  emisión**: nace de la misma boca de la línea, del material y en la cantidad que pide
  el evento (`material`, `count`), repartido a lo largo de su duración. Existe porque
  hay chorros que el show necesita sí o sí —el blanco de 0:50, que es el único que
  emite luz— y la curva de emisión se dibuja a mano: si el chorro viviera en la curva,
  redibujarla lo borraría. `rateForDoc` le reserva su cuota del techo de población.
- **`attractor` (ATRACTOR)** — un punto que atrae, repele o revuelve (`mode` 0..3 →
  `attract`/`repel`/`vortex`/`vortex-reverse`) en `x`,`y` con `radius` y `force`
  durante lo que dure el evento. La fuerza entra y sale con una campana sobre la fase,
  para que no aparezca de golpe; la viscosidad lo frena igual que a un gesto.

| Tipo | Params (`params`) | Efecto |
|---|---|---|
| `strobe-lines` | `count 1..12, freqHz 1..30, orient 0=h/1=v/2=sigue-la-línea, hue, thickness 0.002..0.02, duty 0.1..0.6, kick 0..1` | `count` GeoInstances línea full-frame repartidas; `emit = on ? 2.5*intensity : 0` con onda cuadrada `frac(phase) < duty`; `kick` suma un pico a `radianceExposure` en cada ON. Son las "líneas bien estroboscópicas". |
| `flash` | `decay 0.1..1.5, gain 1..4` | multiplica `radianceExposure` por `1 + (gain−1)*intensity*exp(−(t−e.t)/decay)` |
| `blackout` | `attack, release` | lleva exposure a 0 con esas rampas; `blackOutput 1` si intensity = 1 |
| `shadow-bar` | `x0, x1, angle, width` | quad oclusor (`absorb 1.05`, como el monolito) que barre de x0 a x1 durante `dur` con ease — sombras violentas que cruzan la escena |
| `burst` | `x, y, radius 0.1..0.6` | pulso `repel` de `strength 0.4 + intensity*0.9` los primeros 90 ms del evento |
| `set-material` | `material 0..3` | cambia de qué material NACEN las partículas nuevas |
| `set-lamp` | `primary 0..3, secondary 0..4 (4 = ninguno), mix 0..0.85` | cambia qué material ILUMINA. Son dos cosas distintas: el motor enciende un material a la vez (`emissiveMaterial`) más un segundo por el emisor secundario, así que "emitir rojo y azul y ver los dos" se resuelve acá y no con el material de nacimiento. Sin ningún `set-lamp`, la lámpara sigue al material que nace. |
| `reset-fluid` | — | `resetParticles = [0,0,0,0]` + `resetRadiance` (punto de sincronización duro; también útil para ensayar) |

### 5.5 Gestos (reproducción)

Por cada clip activo en `t`: `sampleGesture` → interacción `{mode, x, y, vx, vy, radius: clip.radius * minDim, strength: clip.strength * (1 − 0.45*viscosity)}`.
`vx/vy` en unidades del solver: multiplicar por `height` como hace `frameTresMasas` con
las interacciones del director.

### 5.6 Integración en `FluidScene`

- `looks.ts`: agregar `'fluids-show'` al union + entrada neutra (copiar `tres-masas`) +
  opción `{ id: 'fluids-show', name: 'Fluids (show)' }`.
- `FluidScene`:
  - `enter('fluids-show')` → `startFluidsShow()` (instancia director + reutiliza
    `TresMasasGeometry` para el overlay — es genérico, sirven las mismas instancias).
  - `frame` → si look es `fluids-show`, `frameFluidsShow(frame)` (clonar la estructura de
    `frameTresMasas`: params → director.update → física throttled → interacciones →
    `solver.step(3)` → `geometry.setInstances` → `renderer.render` → datasets).
  - Params numéricos que la página pasa cada frame: `fluidsShowTime` (segundos),
    `fluidsShowPlaying` (0/1), y los trims de la página si se quieren (reusar los
    `tresMasas*Scale` NO: definir `fluidsShow*` propios solo si hacen falta; v1 puede
    salir sin trims).
  - Métodos nuevos en la instancia (la página tiene el objeto de `createScene`):
    `setFluidsShowDoc(doc: ShowDoc): void` y
    `setFluidsLiveGesture(g: {mode, x, y, vx, vy, radius, strength} | null): void`.
    Tipar con un cast local en la página (`scene as FluidSceneWithShow`) para no ensanchar
    `VisualScene`.
  - En el branch del show **no** llamar `applyCanvasPointerInteractions` (los gestos
    entran por overlay de página, §7).
- `main.tsx`: `view === 'fluids'` o pathname `/fluids` → `FluidsEditorApp`.

## 6. Página editor (`/fluids`)

### 6.1 Layout

```
┌────────────────────────────────────────────────┐
│ STAGE (preview del show, 2688×1008 lógico)      │  ← patrón TresMasasApp: SSAA ladder,
│  overlay captura de gestos + HUD (t, fps, REC) │    DPR, StrictMode-safe, fullscreen
├────────────────────────────────────────────────┤
│ TRANSPORT  ▶ ⏸ ⏹  0:00.00/2:32  🔁loop 🧲snap  │
├────────────────────────────────────────────────┤
│ WAVEFORM + onsets (rojo=low, blanco=mid,       │
│ azul=high) + secciones + regla + loop region   │
├─ EMISIÓN      curva ───────────────────────────┤
├─ COLOR (hue)  curva  ┈ COLOR (sat) curva ──────┤
├─ LUZ          curva ───────────────────────────┤
├─ EXPOSICIÓN   curva ───────────────────────────┤
├─ GRAVEDAD     curva ───────────────────────────┤
├─ SENSIB.GRAV  curva ───────────────────────────┤
├─ ATASCO       curva ───────────────────────────┤
├─ VISCOSIDAD   curva ───────────────────────────┤
├─ EVENTOS      bloques [strobe][flash][sombra]… ┤
├─ GESTOS       clips  [drag──][vortex─]  ● REC  ┤
└─ (líneas: tamaño/giro — lanes colapsadas) ─────┘
```

Todas las lanes comparten el mismo mapeo tiempo→px (zoom con rueda anclado al cursor,
pan con arrastre del ruler o shift+rueda) y un playhead único. Dibujar en **canvas 2D**
(nunca DOM por keyframe): a 6 574 puntos de envolvente y 874 onsets el redraw completo
tiene que ser < 4 ms. Redibujar lanes solo en edit/zoom/pan; el playhead va en un canvas
overlay propio actualizado por rAF.

### 6.2 Transporte de audio (`audio-transport.ts`)

- `fetch('/audio/fluids.wav')` → `decodeAudioData` una sola vez.
- Play: nuevo `AudioBufferSourceNode` con `start(0, offset)`; el **reloj maestro** es
  `ctx.currentTime − startedAt + offset`. Pause = `stop()` + recordar offset. Seek en
  play = stop + start en el nuevo offset.
- La página, en su rAF, pasa ese reloj como `fluidsShowTime` a la escena. Con el audio
  pausado el tiempo queda congelado (y el director sigue renderizando la pose de ese t).
- Scrub: arrastrar el playhead actualiza el tiempo en vivo (fluido responde al instante);
  opcional v2: sonar rebanadas de 80 ms durante el arrastre.
- Autoplay policy: el `AudioContext` se crea/resume en el primer gesto del usuario
  (botón ▶). Mostrar "CLICK PARA ARMAR AUDIO" hasta entonces.

### 6.3 Edición

- **Curvas**: click agrega key (con snap a onsets si 🧲 activo — umbral de imán 8 px);
  drag mueve; `Supr`/`Backspace` o doble-click borra; `Tab` sobre una key selecciona
  shape (linear→smooth→hold). Tooltip con `t` y `v`. Rango vertical etiquetado.
- **Eventos**: doble-click en la lane crea (menú de tipo); drag mueve; drag del borde
  derecho estira `dur`; panel lateral con los params del tipo (§5.4) al seleccionar;
  `Supr` borra.
- **Snap**: a onsets del análisis (por defecto) y a grilla de beat opcional usando
  95.7 BPM (mostrar como opción "grilla 96 BPM", desactivada por defecto porque la
  estimación puede no ser exacta).
- **Undo/redo** (Ctrl+Z/Y): pila de snapshots del doc (JSON.stringify; el doc es chico).
- **SEMBRAR DESDE AUDIO** (botón, `seed.ts`): genera un doc inicial **editable**:
  - `emission`: **por impulsos**, no por envolvente. La envolvente `rms` suavizada emitía
    parejo y no dejaba reconocer los golpes; ahora cada golpe audible escupe su chorro y
    la línea vuelve a un chorrito de base. Los golpes salen de los onsets con supresión
    de no-máximos (0.18 s) y umbral **relativo** al vecindario (30% del pico ±5 s, piso
    0.12): un umbral fijo dejaba 1:40–2:20 casi sin impulsos. Da ~136 impulsos repartidos
    (12–24 por cada 20 s) y ~29 en los primeros 0:35, que es donde se piden sueltos.
  - `lightEmission`: ídem desde `flux`, 0.2..0.9.
  - `flash` en onsets `low` con `strength > 0.6` (dur 0.4, decay 0.35, gain 2.4) y
    `strobe-lines` en `high > 0.55` (dur 0.25, freq 14 Hz, count 3), **sólo de 1:25 en
    adelante** (`FLASHES_FROM = 84`): los dos son blancos, y hasta el chorro la única
    luz blanca permitida es el propio chorro. El primer flash cae en el golpe de 1:26.
  - Un `reset-fluid` en t=0.05: arrancar el show desde el principio limpia el cuadro.
    Sin esto la segunda pasada empezaba con las 20 000 partículas de la anterior, el
    techo ya estaba gastado y no se emitía nada — ni las blancas del chorro.
  - **Guion por tramos** (`SHOW_SCRIPT` en `seed.ts`), cada uno arrancando en el golpe
    más cercano a su hora para que el cambio caiga sobre un impulso y no en el aire:
    Dos reglas atraviesan el guion. **Nadie emite luz hasta que aparece el blanco**:
    antes de eso el rojo y el azul se ven sólo por lo que la línea les tira encima —
    `bodies` 0.12 (negros, opacos, con sombra) y la lámpara apuntada al hueco
    (`LAMP_NONE`, el material 3, del que nunca nace nada). Y **toda la emisión del show
    pasa antes de 0:50**: ahí sale el chorro blanco, se apaga la línea y no nace nada
    más — lo que queda por ver es lo que ya está en el cuadro.
    La altura de cada golpe usa la fuerza **relativa a su vecindario** (±5 s), no la
    absoluta: en un pasaje suave el golpe más fuerte del pasaje tira el chorro grande
    igual. Con la absoluta, el primer golpe del track salía tímido.
    - **0:00 ROJO Y AZUL** — nacen alternando rojo y azul (nunca blanco: hay un
      `set-material` en t=0, porque antes del primer golpe el material caía en el
      default y el show arrancaba escupiendo justo el color que no va). Emisión al 70%
      de cada impulso, callando entre golpe y golpe. Nadie emite luz.
    - **0:13 CHORRO ROJO** — emisión al 100%: el mismo golpe escupe el doble de flujo
      que en el tramo anterior. Domina el rojo con **un azul cada cuatro golpes**: los
      azules son los cuerpos que después tapan la luz roja — sin ellos, cuando el rojo
      se prende no hay sombras. `cohesion` 0.12 y `viscosity` 0.18, para que corra y no
      se cierre en blobs. Nadie emite luz.
    - **0:50 EL BLANCO** — el chorro se engancha al **boom audible** del pasaje
      (`loudestImpulseAround`: el impulso grave/medio más fuerte a ±2 s, que es el de
      0:49.85), no al onset que caiga más cerca del reloj — caía en un golpecito de
      0.375 a 0:50.14 y se sentía fuera de sincro. Ese golpe escupe el chorro blanco:
      un evento `emit-burst`
      de 4 200 partículas en 1.2 s, y la curva de emisión queda en cero desde ahí para
      siempre (`closeEmissionAt`). Es un evento y no un tramo de la curva **a
      propósito**: la curva de emisión se dibuja a mano y el chorro tiene que salir
      igual — si viviera en la curva, redibujarla lo borraría, que es exactamente lo
      que pasó. Las blancas son **las únicas que emiten luz** y son las que iluminan de
      acá a 1:20. Para cuando termina el chorro ya salieron las 20 000 del show.
    - **0:51.5 SE APAGA LA LÍNEA** — apenas termina el chorro, `lineEmit` 0. La línea
      se apaga y no se emite más.
    - **1:20 SÓLO LO ROJO** — la lámpara pasa a rojo (primera vez que el rojo emite) y
      el blanco deja de emitir, con `light` 0.95 para que arda de verdad: ahí la
      envolvente del track está baja y el brillo lo manda el guion. `bodies` 0, así que
      lo que no recibe luz desaparece y sólo queda lo rojo. `cohesion` 0.9 para que las
      rojas se atraigan entre ellas; exposición 1.35 porque ahí se va la luz principal.
    - Se deja un `set-material` sólo cuando el material cambia: repetirlo en cada
      impulso dejaría la lane con 136 bloques iguales.
  - Marcadores visuales en las `sections` (no editables, solo guía).
  - Confirmar antes de pisar un doc con ediciones.
- **Persistencia**: autosave (debounce 500 ms) a `localStorage['radiance-fluids-show-doc-v1']`;
  botones **EXPORTAR** (descarga `fluids.show.json`) e **IMPORTAR** (file input). Carga
  inicial: localStorage → `public/show/fluids.show.json` (si existe) → doc vacío.
  Cuando el show esté maduro, commitear el JSON exportado como `public/show/fluids.show.json`.

### 6.4 Atajos

`Espacio` play/pause · `Home` a 0 · `←/→` ±1 s (`Shift` ±5 s) · `L` prende/apaga el loop
· `S` toggle snap · `R` armar REC · `F` fullscreen del stage · `Esc` salir de
perform/fullscreen · `Ctrl+Z/Y` undo/redo.

La región de loop se marca con `Shift`+arrastre sobre la onda (no hay concepto de
"selección" en el editor); `L` sólo la activa y desactiva.

### 6.5 Modo SHOW (perform)

Botón "SHOW": oculta todo el editor (queda stage + una barra mínima: play, tiempo,
master fader, BLACKOUT como en TresMasasApp). `Esc` vuelve al editor. El estado de
blackout nunca se persiste (misma regla que TresMasasApp).

## 7. Grabación de gestos

- **Captura a nivel página**: un div overlay transparente sobre el stage captura
  pointerdown/move/up (`setPointerCapture`), convierte a coords 0..1 del frame lógico
  (mismo cálculo que `makeCanvasPointer` pero contra el rect del stage).
- Toolbar de gesto: modo (`AGARRAR`=drag · `ATRAER` · `REPELER` · `VÓRTICE`), radio
  (0.02..0.25) y fuerza (0.1..2). El puntero activo se manda cada frame a la escena vía
  `setFluidsLiveGesture(...)` → el director lo aplica igual que un clip (misma ruta =
  lo que grabás es exactamente lo que después suena).
- **REC**: con REC armado y el transporte en play, cada stroke (down→up) acumula
  muestras `{t: time−t0, x, y}` a ~60 Hz (decimar si el mouse reporta más). Al soltar,
  se crea el `GestureClip`. Al **parar la grabación** (pausa o desarmar REC) se ejecuta
  `punchGestures(doc, tArmado, tParado, clipsNuevos)`: **todo lo que había en ese rango
  se sobreescribe**, incluso si el operador no tocó el mouse en parte del rango (así
  "grabar encima con silencio" borra, como en un DAW). Mostrar el rango de punch en rojo
  sobre la lane mientras se graba.
- Clips en la lane: bloques con el modo como etiqueta; se pueden arrastrar (mover t0/t1
  en bloque), borrar, y editar radio/fuerza en el panel.

## 8. Orden de trabajo (milestones con criterio de aceptación)

1. **M1 — Modelo**: `show-doc.ts` + `seed.ts` + tests (sampleo de curvas con los 3
   shapes, wrap de hue, eventsAt/gesturesAt, punchGestures con los 4 casos de solape,
   parseShowDoc con JSON roto). ✅ `npm run test` verde.
2. **M2 — Look + director mínimo + página esqueleto**: look `fluids-show`, branch
   `frameFluidsShow`, director con línea girando + emisión constante hardcodeada; página
   `/fluids` con stage (patrón TresMasasApp) + transporte de audio funcionando
   (play/pause/seek, reloj → `fluidsShowTime`). ✅ Se ve la línea chica girando emitiendo
   partículas mientras suena el tema; el seek mueve la fase de la línea coherentemente.
3. **M3 — Director completo**: los 11 mapeos de curvas (§5.3), eventos (§5.4), gestos
   playback (§5.5), test de determinismo (dos directores nuevos, mismo doc, update a
   los mismos tiempos ⇒ misma salida de render/geometry; y saltar directo a t=60 da la
   misma pose de línea que llegar reproduciendo). ✅ tests verdes.
4. **M4 — Timeline editor**: waveform + onsets + secciones + ruler + zoom/pan/loop/snap,
   lanes de curvas y eventos con toda la edición (§6.3), undo. ✅ editar una curva se
   refleja en vivo en el preview sin reiniciar.
5. **M5 — Siembra + persistencia**: SEMBRAR DESDE AUDIO, autosave, export/import.
   ✅ recargar la página conserva el doc; exportar/importar round-trip idéntico.
6. **M6 — Gestos**: captura live + REC + punch overwrite + lane de clips. ✅ grabar,
   rebobinar, ver el gesto reproducirse igual; regrabar encima reemplaza el rango.
7. **M7 — Perform + pulido**: modo SHOW, atajos completos, HUD, `npm run check` verde,
   probar fullscreen en la resolución del show.

## 9. Verificación manual (checklist final)

- `npm run dev` → `http://localhost:5173/fluids`.
- Audio y visual arrancan sincronizados; skipping a cualquier punto deja línea/strobes/
  curvas coherentes con ese tiempo.
- Los 6 parámetros pedidos se editan a mano y se escuchan/ven alineados a los onsets.
- Strobes castigan en los golpes (probar sembrado + ajuste manual).
- Grabar gestos con el tema sonando, reproducir, sobreescribir un pedazo.
- Modo SHOW limpio en fullscreen; blackout instantáneo; nada de Tres Masas regresionado
  (`/tresmasas` sigue igual).

## 10. Riesgos y decisiones ya tomadas

- **Las partículas arrastran su historia y ESTÁ BIEN** (decisión del operador): la
  emisión es puramente por cue/curva — se emite cuando el timeline lo dice y lo emitido
  queda flotando. Al saltar en el timeline, línea/strobes/curvas caen exactos y la masa
  existente simplemente sigue donde estaba. NO implementar pre-roll ni fast-forward.
  El botón "RESET FLUIDO" y el evento `reset-fluid` quedan solo como utilidad opcional
  de ensayo, no como mecanismo de sincronización.
- **`setMaterialMass` en caliente**: verificado y en uso (§5.3). El worker escribe la
  masa en `materialMasses[i]` y `advance()` la manda con el resto de los parámetros en
  cada paso; no hay reset ni realocación. El fallback quedó sin usar.
- **Overlay reutilizado**: `TresMasasGeometry` (160 instancias) alcanza para línea +
  strobes + sombras; no crear otro sistema de instancias.
- **Página = editor + preview + show**: una sola vista (pedido: "otra página web local");
  no integrar con ControlApp/OutputApp en v1 (el look queda registrado y da la puerta
  para hacerlo después).
- **`fluids.wav` en `public/audio/`**: se sirve tal cual; commitearlo (27 MB, repo local
  de show). El nombre del archivo queda referenciado en `ShowDoc.audioPath`.
- **StrictMode**: la página monta la escena una vez con flag `destroyed` (copiar el
  patrón exacto de TresMasasApp, incluida la escalera SSAA y el manejo de DPR).

## 11. Correcciones sobre el show corriendo (2026-09-04)

Lo pedido después de ver el show andando, ya aplicado. Se deja acá porque son
decisiones de guion, no de código, y es de donde se ajustan.

1. **La emisión sigue los impulsos del sonido, no emite parejo.** El `sustain` por
   tramo que se había agregado para el "chorro" hacía que emitiera constante desde
   t=0. Se fue: `floor` 0.02 (entre golpe y golpe la línea calla), `decay` 0.45 y el
   caudal derivado del documento (§5.2), así que cada golpe tira un chorro grande sin
   que la emisión sea nunca continua.

2. **Toda la población sale antes de 0:50.** La curva de emisión se corta ahí y el
   caudal se calcula para que la curva entera escupa el techo: al apagarse la línea
   ya salieron las 20 000. En la siembra son ~16 000 rojas y azules y ~3 900 blancas.

3. **El golpe de 0:50 es el que escupe las blancas, y son las únicas que emiten luz.**
   `closeWithWhiteBurst` reemplaza la cola de la curva por una meseta en 1 de 1.2 s
   con bajada de 0.35 s, y de ahí en adelante la curva queda en cero para siempre.
   El tramo `SE APAGA LA LÍNEA` entra apenas termina esa bajada: `lineEmit` 0.

4. **Menos partículas, más grandes.** El techo bajó de 20 000 a 14 000 y el punto
   de 3.4 a 4.2: con menos cuerpos y más grandes, cada uno recibe y tapa más luz, y
   el cuadro gana luces y sombras en vez de ser una masa pareja.

5. **Un chorro de evento sale siempre.** `emit-burst` se frena contra un techo duro
   propio (36 000, la capacidad real del solver menos margen), no contra el blando de
   20 000: si una curva dibujada a mano ya gastó el techo, o quedó población de una
   pasada anterior, las blancas salen igual.

5. **El rojo emisivo de 1:20 arde de verdad.** `lightEmission` viene del flux del
   track, que ahí está bajo. `SeedStage.light` pisa la curva con una key sostenida
   (0.85 desde el blanco, 0.95 desde 1:20) y recorta las del flux desde ese punto.

5. **Las cuatro masas son iguales** (§5.3): las distintas partículas pesan lo mismo.

6. **Al principio se ven negros, no de sus colores.** `bodies` 0.12 hasta 1:20 y 0
   después, con el `uBodyAmbient` nuevo del shader (§5.3).

7. **`SEMBRAR SIN TOCAR EMISIÓN`**, botón nuevo al lado del de sembrar: resiembra
   todo el guion pero deja la curva de emisión como está. Es la curva que más se
   dibuja a mano —dónde escupe la línea y dónde calla— y resembrar el resto no
   tiene por qué costarla. Como el caudal se adapta a la curva que haya, una
   emisión dibujada a mano sigue soltando todas las partículas del show.

### El guion sembrado, tramo por tramo

| Desde | Nombre | Emite | Material | Ilumina | Cuerpos | Línea |
|---|---|---|---|---|---|---|
| 0:00 | ROJO Y AZUL | impulsos ×0.7 | rojo y azul alternados | nadie | 0.12 (negros) | encendida |
| 0:13 | CHORRO ROJO | impulsos ×1 | rojo, con un azul cada 4 | nadie | 0.12 (negros) | encendida |
| 0:42 | PRIMER BLANCO | impulsos ×0.8 + chorro de **150 blancas** | azul y rojo | el blanco | 0.12 (negros) | **luz apagada, sigue emitiendo** |
| 0:50 | EL BLANCO | chorro de **600 blancas**; la curva muere acá | — | el blanco | 0.12 (negros) | apagada |
| 0:59 | EXPLOSIÓN | chorro de **250 blancas** | — | el blanco | 0.12 (negros) | apagada |
| 1:20 | SÓLO LO ROJO | nada | — | el rojo | 0 (invisibles) | apagada |

El guion blanco completo: en **0:42 justo** (el golpe más cercano al reloj —
`nearestImpulse`, no el más fuerte del pasaje, que caería un segundo tarde) salen unos
pocos blanquitos —los primeros que emiten luz— y ese primer blob es **enseguida un
atractor fuerte** (fuerza 2.4, paseo apenas) que junta al resto alrededor de la primera
luz. La línea apaga su brillo ahí pero **sigue emitiendo** azules y rojos desde una
boca invisible hasta 0:50. En 0:50 sale el chorro grande, que sigue atrayendo mientras
pasea (`wander` 0.09). En 0:59 el sonido explota: un `attractor` en modo repeler lo
revienta todo y salen los últimos blancos. Pocos blancos (2 000 en total) ardiendo por
movimiento: radiancia tope 1.9 —no lava el cuadro— y el brillo grande lo pone la
emisión por velocidad, no la luz de base.

**Los atractores pegan en el golpe**: ataque de 70 ms y caída cuadrática durante el
evento (la campana anterior llegaba al pico recién a mitad del evento — un atractor de
dos segundos tironeaba un segundo tarde y se sentía fuera de sincro). `sustain`
levanta la cola para los largos, con fundido de 0.3 s al final. **Los cambios caen
donde el sonido empieza, no en su pico** (`anchorToRise`): el detector de onsets marca
el pico, pero un pasaje que crece —el de 1:06, que sube desde 66.3 y picaba en 67.8—
se escucha desde que la envolvente arranca; se camina el flujo hacia atrás hasta donde
cruzó el 35 % del nivel del pico (máx. 2 s), y un golpe seco no se mueve. En la
segunda mitad (≥ 1:00) **se alternan tirones secos con atractores largos** (4.2–6 s,
`sustain` 0.55, paseando): sin ellos, entre golpe y golpe no pasaba nada. La fuerza
de los cortos escala con la del golpe. Los **cortes de sector**
del análisis también se ven: entre el chorro y el rojo cada sector ajusta la exposición
(alternando 1.32/1.18), y todo corte de sector sin atractor cerca recibe un tirón corto
y fuerte. Los juegos cortos corren desde 0:52 (muerta la emisión), no sólo desde 1:25.
El emisivo respira todavía más con el movimiento: piso fijo 0.05 (quieto siempre es
tenue, pida lo que pida el guion), techo 3.4, sensibilidad 10 — 68× de rango — y
`radianceSpread` baja de 0.95 a 0.86: con menos rebote interno la luz cae con la
distancia, y los pulsos y las sombras se leen.

**El latido**: entre el chorro y el rojo (0:52–1:19) la luz emitida no es una meseta —
respira con el flujo del track, entre el 80 % de la base del guion y el máximo; de
1:20 en adelante el rojo queda firme. (Los barridos de sombra se probaron y se
sacaron: no interactúan con el fluido, sólo lo tapan.)

**La sensibilidad de la emisión por velocidad va BAJA a propósito** (2.2 → 1.4 con la
luz, no 10): el rango del motor es `2.8 px/frame · alto/1008 / sensibilidad`, así que
con 10 el rango quedaba en 0.28 px/frame y cualquier deriva lo saturaba — brillo
constante al máximo, que es justo "no cambia con la velocidad". Con ~1.4 el rango son
~2 px/frame: la deriva lenta queda a mitad de curva, lo quieto cae al piso 0.05 y el
tirón de un atractor llega al techo. El contraste lo ponen piso y techo (0.05 → 3.4),
no la sensibilidad. Y **todo atractor pasea** (`wander` ≥ 0.03, óvalo a 0.24 Hz — el
0.07 anterior no llegaba a moverse en un evento corto): barriendo cruza fluido sí o
sí, en vez de quedarse clavado donde quizás no hay nada.

### La línea respira con la emisión

El largo de la línea acusa cada chorro: **se encoge rápido (hasta 50 %) al emitir y
vuelve a su tamaño suavemente** en ~0.9 s. Es del director, no de la siembra, y sale
del tiempo absoluto: el encogido en `t` es el máximo de la curva de emisión del último
segundo, pesado por una recuperación cuadrática — nada que acumular, nada que se rompa
al saltar. La curva `lineSize` ya no salta con los golpes (los saltos de tamaño del
principio se sacaron): queda para el operador, y el baile de la línea es sólo el giro.

### Los gestos grandes de la segunda mitad

- **0:50, el apagón violento** — mientras dura su bloque de sonido (~3 s, el flux cae
  recién en 0:53): atracción brutal (2.7) más un remolino encima (2.2), revolviendo lo
  que el chorro acaba de escupir. Después afloja a la atracción suave paseando, hasta
  la explosión de 0:59.
- **1:10, la unión de la luz** — todo se une rápidamente alrededor de la luz: ataque
  inmediato, fuerza 2.3, radio 0.5, y la atracción pierde fuerza hasta soltar en 1:20
  (sostén 0.45). Adentro no corre ningún otro tirón: es un solo gesto. (El solver no
  sabe atraer a un solo material, así que junta a todos — las blancas van adentro y la
  luz se concentra igual.)
- **1:35, el parpadeo** — ese sonido distinto se ve distinto: la luz roja se corta a
  negro (0.45 s) y por un instante vuelven a arder las blancas (1.35 s), antes de
  devolverle el cuadro al rojo.
- **Los redobles emiten como redobles** — la supresión de no-máximos baja a 0.1 s
  (umbral relativo 0.26): la ráfaga de 0:29 (golpes cada ~0.11 s) sobrevive entera y
  0:25–0:35 emite con lo que se escucha; las caídas encadenan la ráfaga en un chorro
  sostenido. Da ~197 impulsos (eran 136).
- **Golpes blandos, no piso continuo** — el piso que seguía al volumen se probó y
  emitía parejo desde el segundo cero hasta gastar el techo: AFUERA. Los pasajes que
  suenan sin onsets (0:02–0:13, 0:34–0:37) entran como `swellImpulses`: máximos
  locales del flujo suavizado (prominencia ≥1.25× sobre su piso ±1.4 s, lejos de los
  impulsos reales), sumados como impulsos de fuerza ≤0.55. Puffs sueltos donde suena
  algo, silencio entre medio: en 0–40 s la línea calla el ~64 % del tiempo y escupe
  fuerte el ~23 %.
- **GRUMOS DE LUZ (1:01)** — pasada la onda expansiva, cohesión 0.78: mismo material
  se pega, distinto se aparta. Los blancos se juntan entre ellos en vez de disolverse
  en la mezcla —que iluminaba TODO demasiado— y la luz queda en focos (base 0.8,
  exposición 1.15) hasta que la unión de 1:10 los junta del todo.
- **Apagones repartidos** — el "todo más oscuro" del 1:35, también en 1:06, 1:26 y
  2:02: la luz se corta a negro 0.4 s y vuelve, pegada al atractor de ese golpe.
- **El rojo cae JUSTO en 1:21** (`RED_AT = 81`, corregido del 1:20 inicial) — el tramo
  final se engancha al primer golpe DESDE su hora (`nextImpulseFrom`, cae en 81.37),
  nunca antes, y el crossfade del material emisor baja de 0.8 a 0.35 s para que el
  cambio no se funda. La unión de la luz suelta justo ahí.
- **La línea escupe y se rearma** — el achique por emisión sube al 78% (queda a un
  cuarto), instantáneo; la vuelta es larga y suave (1.7 s).
- **Vórtice y repel mandan en los juegos** (modos 2/1/3/2): el jugueteo es revolver y
  empujar; lo de juntar ya lo hacen los blobs y la respiración. En la calma se
  alternan atracción y remolino suave.

### La calma (1:35 → final)

Desde `CALM_FROM = 95` el show entra en otra respiración. La **viscosidad tiene piso
0.55** (los blobs se alentan: el freno es lo que deja leer el cambio de intensidad de
la luz — moviéndose demasiado, el brillo por velocidad queda clavado arriba). Todos
los atractores del tramo son **suaves** (`soft: 1`, un parámetro nuevo del evento: la
fuerza entra y sale en una campana lenta en vez de pegar), en modo atraer, fuerza ≤ 1,
largos (3–7 s) y paseando; el espejado y los tirones secos no corren acá. Y por encima
va **la respiración**: un pulso cada 9 s en el centro —radio 0.45, fuerza 0.75, 5.5 s—
que junta a todos y los suelta, como respirar despacio.

El cierre tiene dos horas fijas. **1:52 (`GATHER_FROM`)**: los golpes dejan de mandar
y arranca la juntada — una sola atracción larga, suave y amplia (radio 0.5, 10.6 s)
que pega a todos entre sí antes del minuto 2, con la cohesión en 0.95 y la viscosidad
ya en 0.75. **2:03 (`STICK_FROM`)**: quedan así. Nada que tironee —ni respiración, ni
juegos, ni cortes de sector—, cohesión clavada en 1 y viscosidad 1 (drag 0.199, el
tope: `0.014 + v*0.185`): pegados y casi quietos, rápido y no de a poco.

**La programación del final: los agarres.** Desde 2:06, cada 9.5 s, un `attractor` en
modo **4 = AGARRAR** (`drag` del solver, nuevo): agarra un círculo de radio 0.3 de la
masa roja y lo lleva despacio por un óvalo (paseo 0.13 a 0.12 Hz, la mitad de la
velocidad de los demás), con envolvente de respiración — agarra, lleva, suelta sin
tirón. La parte agarrada se despega suave del resto y, moviéndose apenas con la masa
casi quieta, se ve más oscura que lo que vibra alrededor. El agarre lleva la velocidad
del paseo (derivada analítica del óvalo, tiempo absoluto): es `_pvfs_drag_particles`,
no una fuerza. Los flashes y estrobos siguen, porque son luz y no movimiento.

El piso de la emisión por velocidad es **0.12 fijo**: una emisora completamente quieta
conserva un toquecito mínimo (con 0.05 desaparecía en negro), y el techo queda a 28×.
La paleta sembrada pinta el "azul" **casi negro** (`0x07080d`, un dejo azul): cuerpos
oscuros que ocluyen y hacen sombra, no color pleno pintado sin luz — desde la PALETA
se cambia. Además **se mide transporte, no agitación** (`velocityEmissionSmoothing` 0.16, nuevo en
el renderer, default 1 = comportamiento histórico): la "posición previa" pasa a ser un
ancla suavizada y el delta contra ella, escalado por k, estima el viaje real — exacto
para una partícula que se traslada, y ~amplitud·k para una que vibra en el lugar. Sin
esto, el jitter de presión dentro de un blob denso contaba como velocidad y el blob se
iluminaba a full estando quieto: era lo que mataba la sutileza.

La **gravedad nunca queda prendida**: sólo existe como pulso de 1.6 s cuando un golpe
fuerte cae en un régimen que la pide, y vuelve a cero (≈10 % del track con gravedad).
La **línea rebota**: una fila de círculos de colisión a lo largo del blade mientras se
ve; apagada deja de ser un objeto. Y de 1:25 en adelante hay **juegos**: golpes que no
llegan a cambiar el régimen sueltan tirones cortos (atractores chicos de 1.3 s,
alternando modo) además de los flashes (umbral 0.5).

Cada `at` se engancha al golpe más cercano, así el corte cae sobre un impulso y no
en el aire; `SE APAGA LA LÍNEA` va corrida sobre el mismo golpe que el blanco, justo
después de que termine el chorro.

### Comportamientos por golpe fuerte, de 0:30 en adelante

El track no sólo dispara partículas: en sus golpes más fuertes cambia **lo que las
partículas hacen**. `pickStrongMoments` toma los onsets que superan el umbral relativo al pico global de
0:30 en adelante, y en cada uno el show pasa al siguiente **régimen** de
`SHOW_REGIMES`:

| Régimen | Cohesión | Viscosidad | Gravedad | Masa | Atractor |
|---|---|---|---|---|---|
| DISPERSA | 0.08 | 0.04 | 0 | 1.0× | repele, radio 0.24 |
| REMOLINO | 0.34 | 0.14 | 0 | 0.8× | remolino, radio 0.32 |
| PEGOTE | 1.00 | 0.38 | +0.05 | 2.2× | atrae fuerte (2.6), radio 0.34 — el que pega los cuerpos entre ellos |
| GRUMOS | 0.88 | 0.30 | +0.18 | 1.3× | atrae, radio 0.16 |
| LÁTIGO | 0.05 | 0.02 | 0 | 0.7× | remolino rápido (2.4), radio 0.42 |
| FLOTA | 0.50 | 0.55 | −0.30 | 0.5× | remolino al revés, radio 0.28 |
| CAE | 0.22 | 0.07 | +0.55 | 1.6× | atrae, radio 0.20 |

`pickStrongMoments` corre con separación 4 s y umbral 50 % del pico global (da 16
golpes en el track), y en los que revientan (fuerza ≥ 0.85) sale un **segundo atractor
espejado** 0.12 s después: dos puntos tirando a la vez parten el fluido en dos
comportamientos visibles. La línea además **baila desde el arranque**: en cada golpe
fuerte cambia su giro y su largo (keys sostenidas en `lineSpin`/`lineSize`, ciclando
entre cinco valores), hasta que el chorro blanco la apaga.

Cada golpe escribe sus keys en `cohesion`, `viscosity`, `gravity` y `gravitySense`, y
suelta un evento `attractor` del tipo de su régimen en una posición determinista
(hash del tiempo, lejos de los bordes, donde un atractor sólo aplasta el fluido contra
la pared). Las propiedades quedan sostenidas hasta el golpe siguiente, así que el
comportamiento sigue cambiado aunque el atractor ya se haya ido.

Dentro del último tramo (1:20 en adelante) sólo se usan los regímenes con cohesión
≥ 0.45: ahí lo pedido es que las rojas se atraigan entre ellas, así que cambia cómo se
mueven, no que dejen de juntarse.
