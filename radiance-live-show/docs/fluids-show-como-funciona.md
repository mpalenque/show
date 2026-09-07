# Fluids — cómo funciona todo (para el próximo agente)

Este documento explica el show "Fluids" (`/fluids`) de punta a punta: la
arquitectura, cada decisión que costó pelearse, y las trampas en las que ya
caímos para que no vuelvas a caer. El plan original con el detalle fino está en
`docs/plan-fluids-show.md`; esto es el mapa.

## Qué es

Un show visual sincronizado a `public/audio/fluids.wav` (152.694 s). Una línea
blanca gira lenta en el centro y escupe partículas de fluido (SPH real, corre
en un worker WASM). Las partículas reciben y tapan luz dentro de un transporte
de radiancia (Amitabha HRC): hay UNA fuente de luz por vez y todo lo demás se
ve sólo por lo que esa luz le tira encima. El operador edita el show en una
página con timeline (curvas, eventos, gestos) sincronizada al audio.

**El operador es Manuel. Itera mirando y pidiendo a los gritos; los pedidos
nuevos pisan a los viejos. La sincronía audio-visual manda sobre todo.**

## Arquitectura (quién habla con quién)

```
public/audio/fluids.wav ──(offline)──> tools/analyze-fluids.mjs
                                            │
                              public/show/fluids.analysis.json
                                            │  (onsets, envolventes, secciones)
                                            ▼
src/fluids-show/seed.ts ────seedShowDoc()──> ShowDoc (documento del show)
                                            │
        ┌─── src/fluids-show/FluidsEditorApp.tsx (la página /fluids: edita el doc)
        │                                   │
        ▼                                   ▼
localStorage                 src/scenes/fluid/FluidsShowDirector.ts
(persistence.ts)             (doc + tiempo ──> física, render, interacciones)
                                            │
                             src/scenes/fluid/FluidScene.ts (frameFluidsShow)
                                            │
                      ┌─────────────────────┴──────────────────┐
                      ▼                                        ▼
     public/fluid/kot-fluid.worker.js          src/scenes/fluid/FluidRadianceRenderer.ts
     (solver SPH en WASM: partículas)          (transporte de radiancia + pantalla)
```

- **`src/fluids-show/show-doc.ts`** — el modelo puro y serializable: curvas
  (`emission`, `lightEmission`, `cohesion`, `viscosity`, `gravity`,
  `gravitySense`, `bodies`, `exposure`, `lineX/Y/Emit/Size/Spin`, `emitHue/Sat`),
  eventos, gestos, paleta. Sampleo con binary search (`sampleCurve`),
  integral analítica (`integrateCurve`), estado de lámpara (`lampAt`),
  material emisor (`emitMaterialAt`). Lo comparten director y editor.
- **`src/fluids-show/seed.ts`** — la siembra: análisis → documento inicial.
  Acá vive TODO el guion del show. Es un punto de partida editable, no la
  última palabra: sale como keys y eventos normales.
- **`src/scenes/fluid/FluidsShowDirector.ts`** — el director: (doc, tiempo) →
  salida por frame. No conoce al solver ni al renderer.
- **`src/scenes/fluid/FluidScene.ts`** (`frameFluidsShow`) — pega el director
  con el solver y el renderer. Convierte unidades y aplica throttles.
- **`src/fluids-show/FluidsEditorApp.tsx`** — la página: stage, transporte,
  lanes de timeline (canvas 2D, nunca DOM por keyframe), inspectores, REC de
  gestos, paleta, modo SHOW.

## La regla de oro

**Todo lo visible se deriva del tiempo absoluto de la timeline, nunca de un
acumulador frame a frame.** Así el scrub cae exacto. Excepciones declaradas:
el acumulador de emisión (se limpia en cada seek), los acumuladores de los
chorros de evento (ídem) y el `approach()` de la física (converge en <1 s).
Ejemplos de cómo se respeta:

- El ángulo de la línea es la **integral analítica** de `lineSpin` (`integrateCurve`).
- El encogido de la línea por emisión mira la curva del último segundo, no
  acumula nada.
- El paseo de un atractor (`wander`) es un óvalo función de `time - event.t`.

## La emisión (la parte más peleada)

1. **Por impulsos, NUNCA continua.** `pickImpulses` (NMS 0.1 s + umbral
   relativo 0.26 del pico local ±5 s, piso 0.12) elige ~197 golpes audibles.
   `emissionImpulseCurve` arma subida (0.02 s), pico y caída (0.45 s) por
   golpe; entre golpes queda un piso casi nulo (0.02). Un redoble encadena
   porque la caída se recorta contra el ataque siguiente.
1a. **DE 0:00 A 0:35 MANDA LA LISTA, NO LA REGLA.** Manuel dibujó esa parte a
   mano sobre la timeline y mandó la captura: **diez chorros grandes y
   silencio entre medio**. Las horas están escritas en `FIRST_PART_HITS`
   (seed.ts) y cada una se engancha al golpe más fuerte a menos de 0.9 s — la
   lectura de la captura puede errar medio segundo, el golpe no. **No se
   regeneran con ninguna heurística**: se midió y cualquier regla automática
   metía 24 chorros ahí (los diez suyos y catorce de más), y NINGÚN corte por
   altura los separa — su chorro de 0:01.5 mide 0.36 y un intruso de 0:12 mide
   0.65. El test `la primera parte son los DIEZ chorros que dibujó Manuel` es
   lo que impide volver a pisárselas. De 0:35 al chorro blanco sigue mandando
   la regla automática de abajo.
1b. **MANDA EL VOLUMEN, no el ataque** (de 0:35 en adelante). Es el pedido que más veces se
   repitió (a los gritos, tres rondas): *si suena fuerte, la línea tiene que
   estar escupiendo* — de 0:00 a 0:35 sobre todo. Tres pasadas antes de
   dibujar la curva:
   - `loudImpulses` — los LOMOS del volumen: máximos locales del rms suavizado
     por encima del percentil 60 del tramo, separados 0.8 s, parados en el
     ataque más cercano si hay uno a menos de 0.3 s. **El detector de onsets
     mide ATAQUES**, y hay pasajes que pegan fuerte sin ninguno: en 0:12 el
     rms llega al percentil 88 y entre 0:07 y 0:14 no había un solo impulso
     elegido. Sin esto la línea se queda muda con la música arriba.
   - `thinImpulses(0.6)` — un chorro cada 0.6 s como mucho, el más fuerte de
     su ventana. Había **74 picos entre 0:00 y 0:50**: una cerca de estacas
     donde no se distingue un golpe de otro y donde cada golpecito se lleva su
     cuota de población. Quedan **34**.
   - `weighImpulses` — la fuerza de cada impulso se multiplica por el volumen
     del pasaje (rms suavizado, normalizado entre el percentil 10 y el 90 del
     tramo que emite), con piso 0.3. El detector mide ATAQUES: un golpe seco
     en un pasaje callado puntúa igual que el mismo golpe en el medio del
     quilombo.
   La fórmula final es `loudness * (0.55 + 0.45 * ataque)`: **el volumen
   manda y el ataque sólo modula.** Y `peakBase` bajó de 0.5 a **0.15**
   (`peakScale` 0.85): como el caudal es cuadrático, con 0.5 el golpe más
   débil ya se llevaba un cuarto de lo que se lleva uno pleno. Esto reemplaza
   a la altura relativa al vecindario ±5 s, que hacía lo contrario de lo
   buscado.
   **Y la escala de los tramos que emiten va en 1, plana.** La crecida NO la
   dibuja una rampa de escalas por reloj: la dibuja el track. Con 0.42/0.6 los
   pasajes bien fuertes del arranque (0:07 tiene tanto rms como 0:24) salían a
   media altura por decisión del guion — y eso es exactamente lo que se
   rechazó. Medido: todos los lomos por encima del percentil 85 del rms entre
   0:00 y 0:35 tienen un chorro de 0.35+ a menos de un segundo, y los del
   percentil 95, uno de 0.8+. Población acumulada: 8 % a los 5 s, 27 % a los
   15, 37 % a los 20, 58 % a los 30, **71 % a los 35**, 94 % a los 50.
2. **Golpes blandos** (`swellImpulses`): pasajes que suenan sin onsets
   (0:02–0:13, 0:34–0:37) entran como máximos locales del flujo suavizado
   (prominencia ≥1.25× sobre su piso ±1.4 s, lejos de impulsos reales), como
   impulsos de fuerza ≤0.55. **NO es un piso continuo: eso se probó DOS veces
   y las dos veces emitió parejo desde el segundo cero — Manuel lo detestó.**
2b. **Golpes rescatados** (`gapImpulses`, 0:19.5 → chorro blanco): el umbral
   relativo de `pickImpulses` (0.26 del pico ±5 s) deja mudos los pasajes que
   suenan al lado de un bombazo — había huecos de **4.4 s** con la línea
   girando sin emitir, y Manuel lo gritó. El rescate **no filtra por fuerza,
   filtra por HUECO**: espacios de más de 1.4 s sin impulso reciben puffs cada
   ~0.9 s, cada uno parado en el máximo de flujo de su ventana, con fuerza
   ≤0.45 y sólo si el rms del instante llega al percentil 20 del pasaje (un
   silencio real sigue mudo). Hueco mayor después: 1.9 s. Sirve para las dos
   causas del problema: los golpes que el umbral se comió Y los tramos que
   directamente no tienen ataques (0:34–0:40, onsets de 0.02).
3. **El caudal se deriva del documento** (`rateForDoc` en el director): se
   integra el CUADRADO de la curva de emisión (el pps es cuadrático) y se
   calcula el ritmo para que la curva entera escupa el techo de población
   **menos lo que se reservan los `emit-burst`**. Dibuje el operador lo que
   dibuje, salen todas las partículas dentro de su curva, y al apagarse la
   curva no queda nada por emitir.
4. Techo de población 14 000 (`FLUIDS_SHOW_PARTICLE_CAP`); los `emit-burst`
   se frenan contra un techo duro aparte (36 000) para salir SIEMPRE, aunque
   una curva a mano haya gastado el blando o quede población de otra pasada.
5. La siembra planta un `reset-fluid` en t=0.05: reproducir desde el arranque
   limpia el cuadro (sin esto, la segunda pasada arrancaba con el techo
   gastado y no emitía nada).

## La luz (motor y reglas)

- **Sólo un material emite luz por vez** (`uEmissiveMaterial`). El evento
  `set-lamp` la apunta; `LAMP_NONE = 3` es "nadie" (el material 3 nunca nace).
  Hay un secundario reactivo si hicieran falta dos.
- **El cruce de emisor nunca dura más que el cambio**: `emitterCrossfadeSeconds`
  sale de `lampGapAt(doc, t) * 0.4` (tope 0.35, piso 0.02). Un `set-lamp`
  suelto se funde como siempre; dos pegados se ven como un CORTE, y una
  ráfaga a 9 Hz se ve como un ESTROBO. Con el 0.35 fijo, un estrobo de
  lámpara se fundía en un gris parejo y no se veía nada.
  **Salvo que el cambio pida su propio fundido**: `set-lamp` tiene un param
  `fade` (0 = automático, hasta 5 s) que lee `lampFadeAt` y pisa la regla. Lo
  usa el cruce del cierre (2 s). Está en el inspector de eventos como FUNDIDO,
  así que se afina en vivo. `fade` va aparte de `LampState` a propósito: tres
  tests comparan la lámpara entera con `toEqual({primary, secondary, mix})`.
- `bodies` (curva): cuánto pigmento propio muestra un cuerpo sin luz.
  `lightOnly = bodies <= 0.02`, `bodyAmbient = bodies * 0.12` (uniform
  `uBodyAmbient`, agregado a `FluidRadianceRenderer`). En 0.12 los cuerpos se
  ven **negros, opacos y haciendo sombra**, con color sólo donde los ilumina
  algo. En 0 desaparecen si no les llega luz.
- **Emisión por velocidad**: el brillo de los emisores respira con el
  movimiento. Mapeos del director: piso 0.12 (quieto = toquecito mínimo),
  techo `mix(1.6, 3.4, light)`, sensibilidad `mix(2.2, 1.4, light)` — **BAJA a
  propósito**: el rango del motor es `2.8 px/frame · alto/1008 / sensibilidad`;
  con sensibilidad alta cualquier deriva satura y el brillo queda constante
  (pasó, con 10). `radiance = 0.4 + light*1.9... ver renderAt` y
  `radianceSpread 0.86` (menos rebote interno = se leen pulsos y sombras).
- **`velocityEmissionSmoothing` 0.16** (nuevo en el renderer, default 1 =
  comportamiento histórico): se mide TRANSPORTE, no agitación. La "posición
  previa" es un ancla suavizada; una partícula que viaja mide exacto, una que
  vibra en el lugar (el hervor de presión dentro de un blob) queda suprimida
  ~6×. Sin esto los blobs quietos se iluminaban a full.
- **El degradé sólo se ve si las partículas FRENAN.** Ojo: **`drag` NUNCA
  llegó al solver** — el worker lo recibía en `set-parameters` y no lo usaba
  en ningún lado; lo único que frenaba era la relajación de presión del SPH.
  El freno de verdad es **`brake`**: el worker llama `_pvfs_dampen_sim(sim,
  1 - brake)` una vez por subpaso, **antes** de las interacciones (lo que
  empujás sale entero; lo que quedó rodando se apaga). `dampen_sim` multiplica
  la velocidad por el factor que recibe — medido contra el wasm, no adivinado.
  El director lo enciende sólo donde el guion pide quietud
  (`max(0, viscosity - 0.8) * 0.06`, o sea 0.012 en el cierre ≈ 0.46 s de vida
  para un empujón); en todo el resto del show va en 0 y nada cambió. Hay un
  knob "Freno" en la escena manual, por defecto 0.
- La paleta sembrada: blanco `0xffffff`, rojo `0xff0000`, "azul" **casi negro**
  (`0x07080d` — cuerpos oscuros que ocluyen; el azul pleno pintaba color sin
  luz), extra `0x8a8894`. Se cambia desde PALETA en la página.

## El guion sembrado (la historia del show)

Regla: **nadie emite luz hasta el primer blanco (0:42)**. Antes, la única luz
es la línea; los cuerpos se ven negros (`bodies` 0.12).

| Hora | Qué pasa |
|---|---|
| 0:00 | ROJO Y AZUL: nacen alternados (`set-material` en t=0 para que el default blanco no se cuele). Emisión ×1 — la altura la manda el volumen del track, no el tramo. La línea baila el giro con los golpes fuertes (`lineSpin` hold keys; el TAMAÑO no salta — ver línea). |
| 0:13 | CHORRO ROJO: emisión ×1, rojo con un azul cada 4 (los azules son las sombras de después). |
| 0:42 | PRIMER BLANCO: chorro de **150 blancas** (evento `emit-burst`), primera luz. La línea APAGA su brillo pero SIGUE EMITIENDO (curva viva hasta 0:50). El blob es enseguida un atractor fuerte. Se engancha con `nearestImpulse` (justo en 0:42, pedido explícito). |
| 0:50 | EL BLANCO: chorro de **600**, la curva de emisión muere acá (`closeEmissionAt`). Bloque VIOLENTO ~3 s (atracción 2.7 + remolino 2.2), después atracción suave paseando. Anclado al boom audible (`loudestImpulseAround`, 49.85). |
| 0:59 | EXPLOSIÓN: repel fuerte + chorro de **250**. Total blancas: 1 000, mitad de lo que hubo antes — iluminan por potencia, no cantidad. |
| 1:01 | GRUMOS DE LUZ: cohesión 0.78 (mismo material se pega, distinto se aparta) — los blancos se juntan entre ellos, la luz queda en focos y no lava todo. Luz base 0.8. |
| 1:10 | LA UNIÓN: atracción inmediata fuerza 2.3 radio 0.5 — todo se une, la luz se concentra. Pierde fuerza hasta soltar donde se prende el rojo. Adentro no corre ningún otro tirón. (El solver NO atrae por material.) |
| 1:11–1:14 | ESTROBO DE ILUMINACIÓN (`LAMP_STROBES`): la lámpara blanca prende y apaga durante **3 s** y vuelve al blanco (el rojo todavía no existe). No son `strobe-lines`: lo que estrobea es la LUZ. **Y va CON EL SONIDO**: cada chispa cae en un ataque del track dentro de la ventana (destello ≤75 ms, nunca dos a menos de 0.1 s), no a un ritmo fijo — a 9 Hz de metrónomo era una luz de discoteca corriendo por su cuenta al lado de la música. |
| 1:20.90 | SÓLO LO ROJO (`RED_AT = 80.9`, **hora exacta, `snap: false`**): el rojo emite por primera vez, el blanco deja, `bodies` 0, cohesión 0.9, luz 0.95 firme. **Se pidió esta hora dos veces; engancharla a un golpe la corría (el anterior cae en 80.78, el siguiente en 81.37).** |
| 1:23.09 | LA CHISPA (`HIGH_TICK_AT`): la lámpara pasa al blanco 70 ms y vuelve al rojo. Marca un tick de **23 ms** — el ÚNICO onset de banda alta en un hueco de 11.6 s, encima de un bajón de volumen. Ahí no pasaba nada: tres segundos sin una sola fuerza y las quince curvas planas. |
| 1:31 | ESTROBO DE ILUMINACIÓN: igual que el de 1:11 pero corto (0.9 s), y al terminar la luz cae en el ROJO. |
| 1:35 | EL PARPADEO (`BLINK_AT` 94.9): luz a negro 0.45 s, blancas un instante, y el rojo vuelve **en 1:36.27 exacto** (`BLINK_WHITE_UNTIL`, hora pedida; antes eran 1.8 s de blanco y se estiraba a 1:37). Arranca LA CALMA. |
| 0:14–0:34 | **LAS FRACTURAS** (`FRACTURES`, tipo de evento `fracture`): el sonido de ese tramo es un árbol quebrándose. Una cuña DURA (`collide`, lo mismo con lo que rebota la línea) recorre una recta partiendo la masa mientras dos empujones abren el corte a los costados. La punta avanza a SALTOS (`crackle` por segundo), no lisa. Cada una medida contra su golpe: 0:14 crujido seco (el rms se muere a los 15.0), 0:19 grieta larga y lenta (cola de 1.05 s), 0:24 astillado chico con 6 astillas, **0:29 el quiebre grande** (10 ataques, 4 plenos, máximos de flujo/agudo/aire, y son CINCO crestas separadas), 0:32.7 un chasquido flojo. **Y LA LÍNEA SE QUIEBRA CON ELLAS Y QUEDA QUEBRADA**: cada fractura siembra sus CRUJIDOS —sub-eventos de fuerza cero, uno por onset real ≥0.12 del track— y en cada crujido las 4-8 astillas vuelven a apuntar a CUALQUIER LADO (360°), tumban, vibran a saltos de 47 Hz, twitchean al `crackle`, arden cada una distinto Y UN TIRÓN corto junta el fluido hacia la rajadura y lo suelta al pasar el ruido. En el silencio (la nota grave) NADA vibra ni tira: la rama queda quieta, asentándose. No se rearma hasta que la línea se apaga, y mientras está quebrada deja de achicarse con la emisión. |
| 0:14–0:34 | LOS GESTOS DE LA PRIMERA PARTE: uno por cada chorro de Manuel (`FIRST_PART_MODES`) — el fluido se abre, se revuelve para un lado, para el otro, o se junta. Pegados (sin `soft`), en el golpe. Sin esto, en ese tramo sonaban los chorros y el fluido no hacía NADA: los cambios por golpe fuerte recién arrancan en 0:30. |
| 1:52 | LA JUNTADA (`GATHER_FROM` 112): una sola atracción suave que pega a todos antes del minuto 2. Viscosidad 0.75. **Radio 1.3 = CUADRO ENTERO** (`GATHER_RADIUS`), no 0.5. |
| 2:27.9 | LA ÚLTIMA EMISIÓN DE BLANCAS: **+15 %** (190 pedidas, 186 reales) en el golpe pleno con el que el track cierra. |
| 2:03–final | **EL MALACATE** (`unite`, modo `herd` del worker): la garantía de que las blancas quedan SÍ O SÍ unidas — pedido: 80 % de 2:10 en adelante, sin resetear. Junta SOLO las blancas (lo único de todo el motor que filtra por material) escribiendo posiciones: riel a 0.14 de alto/s hacia el centro con radio casa 0.36, y PURGA del núcleo (el 55 % del radio) por PERMUTA — un ajeno de adentro y una blanca de afuera se cambian de lugar, la ocupación del espacio no cambia y la presión ni se entera. Medido contra el solver con la cadena real: racimo conexo 100 % desde 2:07, 99 % en el último cuadro (~330 px de diámetro); los agarres lo muerden y el canje lo repone en un segundo. El precio: la masa unida respira con cada gesto (mediana ~1.0-1.5 donde antes había 0.2) — es física: un disco emisivo único se enciende entero con cualquier fuerza. |
| 1:52–final | **EL AGARRE PERMANENTE** (`STILL_HOLD_RADIUS` 2, fuerza 0.2, `sustain` 1 con `soft` 0): cuando la juntada de 1:52 termina, NO se suelta. Un atractor de cuadro entero, débil y constante, clavado en el centro, corre hasta el último cuadro. No junta (ya están juntas): impide el REBOTE. Ver trampa 9nonies. |
| 2:03+ | EL CIERRE RESPIRA: **quieto no es congelado.** Encima de la masa corren la RESPIRACIÓN (radio 0.45, fuerza **0.15**: de juntar se encarga el agarre permanente, esto es un latido encima) y los TOQUECITOS. **La respiración es 6 × 2.6 s cada 5 s**: más
INTENTOS que las 4 originales, pero NO más fuerza. Subirla a 0.95 y alargarla a
3.4 s dio vibración de más y las blancas encendidas con estela todo el cierre
— lo que importa es que quede silencio limpio entre inhalación e inhalación
(al menos tres constantes del freno, 0.46 s cada una) para que el brillo
vuelva al piso. **Esta parte es la que Manuel aprobó y pidió MÁS**: son ~18 tirones chiquitos del tamaño del pincel del operador (radio 0.05-0.12, fuerza 1.0-2.4) que van CON EL SONIDO —uno por golpe, con separación mínima de 0.9 s y relleno donde el track calla más de 2.2 s— y recorren todo el repertorio (`POKE_MODES`): click (0), empujón (1), remolino para los dos lados (2, 3) y AGARRE (4, 1.2 s con paseo: se lleva un puñado y deja un reguero encendido). El tamaño y la fuerza los pone el golpe, así que el final —donde el track revienta— tiene los grandes. Medido replayando los eventos reales contra el solver: la mediana y el p75 del brillo se quedan clavados en el piso (0.12-0.20) los treinta segundos, y el p95 sube al techo con cada toque y vuelve a 0.2 entre uno y otro. |
| 2:02 | REFUERZO DE BLANCAS (`WHITE_TOPUP_AT`): un cuarto `emit-burst` de **+22 %** (225 pedidas, 222 reales) sobre las ~996 que hay. Nace con el rojo prendido y no se ve hasta que la luz cruza; está para que el cierre tenga con qué trabajar. Sale porque el `emit-burst` se frena contra el techo DURO (36 000), no contra el blando (14 000) donde la población ya está clavada. |
| 2:03 | EL CIERRE BLANCO Y QUIETO (`WHITE_STILL_FROM` = `STICK_FROM` 123, `snap: false` — va en su hora exacta, no busca golpe). **Cruce lento de dos segundos** desde el rojo (`fade: 2` en su `set-lamp`) y **vuelve el blanco emisivo** con la intensidad del arranque (`light` 1, exposición 1.2, `bodies` 0) sobre un fluido que ya no se mueve solo. Doce segundos (`STILL_SECONDS`) sin un atractor, sin un flash y sin un estrobo: es el lienzo para tocar en vivo. El material que nace vuelve a ser blanco, para que lo que se le tire a mano a la masa se encienda al moverse. |
| 2:15 | LOS AGARRES: eventos `attractor` modo 4 cada 9.5 s — agarran **un puñado** (radio 0.13) y lo llevan despacio por un óvalo, despegándolo suave. Con 0.3 se llevaban la masa entera, que ahora mide unos 310 px: medido, la mediana del brillo se iba al techo (3.4) los seis segundos del agarre. |

Encima de eso: **cambios de comportamiento en los golpes fuertes de 0:30 en
adelante** (`pickStrongMoments` + `SHOW_REGIMES`: DISPERSA, REMOLINO, PEGOTE,
GRUMOS, LÁTIGO, FLOTA, CAE — cada uno escribe cohesión/viscosidad/gravedad/masa
y suelta su atractor), **anclados al ARRANQUE del sonido** (`anchorToRise`
camina el flujo hacia atrás desde el pico: una subida como la de 1:06 se marca
donde empieza, un golpe seco no se mueve). En la segunda mitad se alternan
tirones secos con atractores largos sostenidos; desde 1:35 todos son suaves
(envolvente de respiración) y desde 1:52 los golpes ya no mandan. La
**gravedad sólo existe como pulso** de 1.6 s cuando un régimen la pide (nunca
sostenida — pedido explícito). Juegos cortos (vórtice/repel) desde 0:52,
apagones a negro repartidos (1:06, 1:26, 2:02) con `DARK_BLINKS`, acentos de
exposición en los cortes de sección del análisis, y **la respiración**
(1:35–1:52): pulso de atracción suave cada 9 s. **Flashes y estrobos recién
desde 1:25** (los dos son blancos, y hasta el chorro la única luz blanca
permitida es el chorro). Los barridos de sombra (`shadow-bar`) se probaron y
Manuel los ODIÓ ("no interactúan con el coso") — el tipo de evento existe pero
no se siembra.

## La línea

- **EL QUIEBRE se hace en la GEOMETRÍA, no en curvas** (`lineShatterAt` +
  `pushLine`), y **el reloj del quiebre son LOS CRUJIDOS DEL TRACK**: cada
  fractura grande siembra además sub-eventos `fracture` de **fuerza cero**,
  uno por onset real del análisis en su ventana con fuerza ≥ 0.12 (el quiebre
  de 0:29 son doce crujidos en un segundo: 28.83, 28.98, 29.09, 29.20,
  29.32...). **El corte de 0.12 es deliberado**: un tick de 0.07 es el gemido
  de la rama sobre la nota grave constante, no un crujido, y se pidió
  explícito que en el silencio los palitos NO vibren — la cola de 0:19 (seis
  ticks de 0.01-0.10) queda afuera entera. Al fluido el sub-evento no le hace
  nada (el director corta en `force <= 0.001`), pero **cada crujido siembra
  también SU TIRÓN**: un `attractor` corto (0.5 s, radio 0.35, pegado con
  `soft` 0 y sin sostener con `sustain` 0) que junta el fluido hacia la
  rajadura Y LO SUELTA al pasar el ruido — medido: en los tramos callados el
  tirón activo es 0.00 y las astillas se mueven <0.002/cuadro; en la ráfaga,
  tirón 1.0 y saltos de 0.21-0.24.
  **EL CUÁNTO LO MANDA LA CURVA `lineBreak`** (lane "LÍNEA · QUIEBRE",
  separada de la emisión, editable a mano — pedido explícito): 0 = línea
  entera aunque las fracturas sigan sonando en el fluido, 0.5 = quebrada y
  QUIETA, 1 = glitch a fondo. La siembra la dibuja desde los crujidos (~186
  llaves: piso 0.5 desde el primer crujido, un pico por golpe a la altura de
  su fuerza, y 0 recién en 0:43, cuando la línea ya se apagó) y el director
  la OBEDECE tal cual: `amount` = la curva, `kick` (la violencia: vibración,
  twitch, destello) = lo que la curva asoma por encima de 0.5. Los EVENTOS
  `fracture` siguen poniendo el ritmo (semilla del re-apuntado, tumbo,
  `shards`, `crackle`) y la física (cuñas del padre, tirones de los
  crujidos): mover la curva no mueve los tirones del fluido.
  Desde el primer crujido el blade deja de ser un rectángulo: 4-8 astillas
  (`shards` del padre + 2) que se acortan —lo que pierden es el hueco— y se
  desparraman del eje (`LINE_SHARD_APART` 0.13). TODO el glitch va con la
  curva; con ella en el reposo la rama queda quieta, sólo asentándose:
  - **CADA UNA APUNTA A CUALQUIER LADO** (360°, `LINE_SHARD_AIM = 2π`),
    resorteado por crujido. La semilla es el TIEMPO del último crujido, no su
    posición en el array (ver trampa 9undecies).
  - **TUMBAN**: tras cada crujido siguen girando solas (`LINE_SHARD_SPIN` 3.4
    rad/s) y se frenan con `age/(1 + 1.6·age)`.
  - **VIBRAN** a saltos cuantizados de 47 Hz (glitch, no flotación), sólo con
    el ruido: `VIB_KICK·kick`, cero en el silencio.
  - **TWITCHEAN**: hasta el 28 % de las astillas por paso del `crackle`
    (escalado por `kick`) suelta la puntería un paso, destella ×1.45 y
    tartamudea el largo. En silencio, ninguna.
  - **CADA UNA ARDE DISTINTO** (0.2 a 1.6 del brillo), con el conjunto
    NORMALIZADO a promedio 1 y piso 0.1·glow; el latido del silencio es sólo
    la brasa (`FLICKER_EMBER` 0.08).
  **Y QUEDA QUEBRADA**: el piso `LINE_SHARD_REST` (0.5) no baja nunca. Una
  rama rota no se rearma; lo único que sube y baja es el golpe.
  **Mientras está quebrada NO respira**: el achique por emisión
  (`emissionShrink`) se apaga, porque quiebre + fuelle juntos se leen como un
  acordeón y lo que se pidió ver ahí es el quiebre.
  Hay lugar de sobra: la geometría admite 160 instancias y el show nunca pasó
  de 6. **Con curvas NO se puede**: se probó tartamudear `lineEmit`,
  `lineSize`, `lineX` y `lineY` y lo único que se lograba era que la línea se
  ACHIQUE y parpadee. Y como de 0:13.8 a 0:42 la lámpara apunta al hueco y la
  línea es la ÚNICA luz del cuadro, cada corte de `lineEmit` era un apagón de
  pantalla entera en vez de un destello.
- **`lineSpin` NUNCA se toca**: el ángulo es su INTEGRAL analítica, así que
  cualquier tirón ahí corre la línea de forma PERMANENTE (medido: 7.42° que no
  vuelven nunca ni en t=150) y encima no se vería — con `SPIN_SCALE` 0.35 rad/s
  la línea tarda 18 s en dar una vuelta y un pulso de 0.1 s aporta 1.43°.
- `lineEmit <= 0.02` se lleva el blade, su oclusor Y sus anillos de colisión en
  un solo cuadro. La emisión de partículas NO lo mira: la línea puede estar
  rota e invisible y seguir escupiendo.
- Blade emisivo + oclusor de respaldo (emisión unilateral, como el faro de
  Tres Masas). `lineEmit` es su BRILLO; la emisión de partículas es aparte —
  la línea puede estar apagada y seguir escupiendo (pasa de 0:42 a 0:50).
- **Rebota**: anillos de colisión (`mode: 'collide'`) a lo largo del blade
  mientras se ve; apagada deja de ser un objeto.
- **Respira con la emisión**: se encoge INSTANTÁNEO hasta un 78 % con cada
  chorro y vuelve suave en 1.7 s (`emissionShrink`: máximo de la curva de
  emisión reciente con peso cuadrático — tiempo absoluto, sin acumular).

## Los eventos (tipos y trampas)

`strobe-lines`, `flash`, `blackout`, `shadow-bar`, `burst`, **`emit-burst`**
(chorro con material y cantidad propios, reservado del techo), **`attractor`**
(modos 0 atrae / 1 repele / 2 remolino / 3 remolino inverso / **4 AGARRA** —
`drag` del solver con velocidad = derivada analítica de su paseo), `set-material`,
`set-lamp`, `reset-fluid`. Params del atractor: `radius`, `force`, `wander`
(óvalo de paseo, 0.24 Hz; el agarre a 0.12 Hz), `sustain` (0 = golpe que
decae, 1 = sostiene), `soft` (campana lenta de respiración en vez de pegada).
**La pegada es ataque de 70 ms + caída cuadrática** — la campana simétrica
original llegaba al pico a mitad del evento y todo se sentía tarde.

Trampa de round-trip: `parseShowDoc` rellena los params faltantes con sus
defaults, así que **la siembra tiene que escribir TODOS los params de cada
evento** (incluso `wander: 0, sustain: 0, soft: 0`) o el test de persistencia
falla por la diferencia.

## FluidScene (el pegamento)

`frameFluidsShow`: corre el director, aplica `resetParticles`/`resetRadiance`,
las masas (`setMaterialMass` — verificado: cambiarlas en caliente NO resetea
nada; van iguales las cuatro a 0.45, con `gravitySense` como multiplicador
global throttleado a 10 Hz), `setParameters` a 20 Hz, y convierte unidades de
las interacciones: `x*width`, `y*height`, `vx/vy*height` (desplazamiento POR
PASO en unidades de alto), `radius*minDim`. `solver.step(3)` por frame.

## El editor

- Autosave a `localStorage` (debounce 500 ms, `skipNextSave` en la carga).
- **SEMBRAR DESDE AUDIO** reemplaza todo; **SEMBRAR SIN TOCAR EMISIÓN**
  conserva la curva de emisión dibujada a mano (el caudal se adapta solo).
  Ninguno toca los gestos grabados.
- **Después de cambiar la siembra en el código, Manuel tiene que RESEMBRAR**:
  su doc guardado no se migra solo. Decíselo en cada entrega que toque
  `seed.ts` o `show-doc.ts`; si sólo cambió el director/renderer, alcanza con
  recargar.
- **UN SEMBRADO SE DESHACE.** `seedFromAudio` llama a `replace`, que empuja el
  documento anterior a la pila de deshacer (`use-show-doc.ts:66`). Si Manuel
  sembró por error y perdió una curva dibujada a mano, **DESHACER se la
  devuelve** — mientras no recargue la página, porque la pila vive en memoria.
  Decíselo apenas pase, antes que nada.
- Undo por snapshots serializados (coalescencia 500 ms). Playhead como div
  transformado dentro de `.fs-lanes`. Gestos con punch-overwrite estilo DAW.

## Cómo se trabaja acá

- `npm run check` = vitest + `tsc -b` + build. **Verde antes de cada commit,
  un commit por entrega** (Manuel usa los commits como fallback).
- No hay `@types/node`: los tests importan el JSON del análisis como módulo,
  nada de `node:fs`.
- No hay verificación visual posible: medí TODO con tests o scripts de
  medición (un `scratch.test.ts` temporal que se borra). Contá partículas,
  sampleá curvas, imprimí tiempos — los números son los ojos.
- El plan (`docs/plan-fluids-show.md`) se actualiza con cada decisión: es el
  contrato con el operador.
- Los tests describen PROPIEDADES del show en castellano ("nadie emite luz
  hasta el blanco"). Cuando el pedido cambia, el test cambia con él — son la
  memoria de qué pidió Manuel.

## Trampas conocidas (no vuelvas a caer)

1. **Piso continuo de emisión** = "está emitiendo siempre" = grito. Impulsos.
1bis. **El caudal se normaliza contra el techo, así que la altura de la curva
   es un REPARTO, no un volumen.** Todo lo que se escupe temprano no está
   después. Tres síntomas del mismo error, los tres gritados: "emitís al
   principio donde casi no hay sonido", "después te quedás sin partículas" y
   "cuando suena BIEN fuerte tenés que estar emitiendo". El arreglo NO es
   tocar la escala del tramo —se probó dos veces y las dos veces movió el
   problema de lugar—: es que la altura de cada chorro siga al VOLUMEN del
   pasaje (ver §1b). La escala del tramo sólo sirve para apagar la emisión
   (0 en los tramos que no emiten), no para dosificarla.
1quater. **Los `set-material` salen de los CHOROS DE LA CURVA, no de los
   `impulses` del análisis** (`emissionBursts`). La primera parte está
   dibujada a mano por Manuel, así que los colores tienen que caer donde están
   sus chorros. Y cada chorro escupe LOS DOS colores: arranca rojo y a los
   0.13 s (`MATERIAL_SPLIT`) pasa a negro. Se puede porque `emitMaterialAt` se
   resuelve POR CUADRO contra el tiempo absoluto (`FluidsShowDirector.ts:364`),
   no se congela al arrancar el chorro. El rojo se lleva el ataque y el negro
   la cola: como el caudal es cuadrático el reparto queda ~64/36, que es lo
   que hace falta (los negros son los CUERPOS que tapan la luz roja; si fueran
   la mitad, el cuadro se llenaría de sombras). Medido: 7 704 rojas / 5 070
   negras, y NINGÚN chorro de un solo color.
1quinquies. **`seedShowDoc` acepta `keepEmission`.** "SEMBRAR SIN TOCAR
   EMISIÓN" ahora le pasa la curva dibujada a mano ANTES de sembrar, en vez de
   pisarla después: si no, los `set-material` se siembran contra una curva que
   se descarta y quedan corridos de lo que se ve. Ese botón conserva sólo
   `curves.emission` y `gestures`; TODO el resto (eventos, las otras 14 curvas
   y `materialColors`) se reemplaza.
1ter. **"Muchos picos" es un defecto.** Setenta y cuatro chorros en cincuenta
   segundos no se leen como golpes. `thinImpulses` los adelgaza a uno cada
   0.6 s quedándose con el más fuerte.
2. **Sensibilidad de velocidad alta** = todo saturado = "no cambia con la
   velocidad". Es una DIVISIÓN: subirla achica el rango.
3. La campana simétrica en atractores llega tarde al golpe. Pegada + caída.
4. El onset más cercano al reloj puede ser un golpecito: para momentos con
   nombre usá `loudestImpulseAround` (boom del pasaje) o `nextImpulseFrom`
   (nunca antes de la hora), según qué pidió.
5. Los picos de los onsets no son el ARRANQUE del sonido: `anchorToRise` para
   pasajes que crecen.
6. `sampleCurve` antes de la primera key devuelve esa key: una curva parcial
   "se extiende" hacia atrás. Cerrala con keys explícitas.
7. Dos keys en el mismo t: el sampleo devuelve la primera. `pushKey`/`holdKeys`
   deduplican; mantené tiempos estrictamente crecientes.
8. Los curve specs CLAMPEAN al parsear (`lineSpin` max 1): sembrar fuera de
   rango rompe el round-trip de persistencia.
9quater. **`blackout` NO oscurece el cuadro donde `bodies` es 0.** Mueve una
   sola palanca, `exposureScale` -> `radianceExposure` -> `uExposure`, y
   `uExposure` se usa en UN solo lugar del renderer: el término de
   irradiancia. NO toca las caras emisivas de las partículas
   (`visibleEmitterWeight`, que sale de `uEmission`) ni el mesh de display del
   campo HRC (`AmitabhaRadianceField.ts` no menciona exposure ni una vez).
   Cuando `bodies` es 0 y sólo hay un material emisor, el cuadro ES eso —
   los dos inmunes. Encima el término dominante va en raíz y clampeado
   (`clamp(sqrt(irradianceLuma) * 1.9, 0, 1)`): con exposure ×0.45 la luz
   local sólo cae a ×0.67, y donde ya satura no cambia NADA. **Para oscurecer
   de verdad se usa `set-lamp` a `LAMP_NONE`**, que pone `emissionWeight` en 0
   y se lleva puestos los emisores Y el campo. Por eso los cuatro apagones del
   show son `set-lamp` y no hay un solo evento `blackout` sembrado.
9octies. **La VELOCIDAD no ilumina a una partícula que no emite.**
   `emissionWeight` vale 0 para todo material que no sea el emisor y
   `velocityGain` lo MULTIPLICA, en los dos pases del shader; y el término
   ambiente que sí las alcanzaría (`ambientVelocityEmission`) está hardcodeado
   en 0 en el director. O sea que entre 0:14 y 0:34 —donde la lámpara apunta al
   hueco— una roja a toda velocidad se ve IGUAL que una roja quieta, y la curva
   LUZ no cambia un solo píxel. Lo que las hace visibles es la luz de la línea,
   y la respuesta es en RAÍZ (`sqrt(irradianceLuma) * 1.9`): la pendiente es
   máxima cerca de cero, así que **moverlas hacia o desde la línea cambia su
   brillo muchísimo más que cualquier cosa que se le haga a su velocidad**. Es
   el mecanismo sobre el que se apoya la fractura.
9septies. **`collide` y `lock`/`unlock` NO son código muerto.** El worker los
   aplica de verdad (`_pvfs_collide_particles_circle`, `_pvfs_lock_particles`).
   `collide` es un obstáculo DURO: el fluido no lo atraviesa, lo rodea. Es lo
   que hace que las partículas se GOLPEEN en vez de sólo apartarse, y es la
   base de la fractura. El show sólo lo usaba para los anillos de la línea.
9sexies. **EL RADIO DE UN ATRACTOR VA EN UNIDADES DEL LADO CORTO, y el show
   corre en pantallas MUY anchas.** En 2100x847 un radio de 0.5 son 424 px
   desde el centro, y las partículas de los bordes están a 900: el atractor no
   las toca NUNCA. La juntada de 1:52 tenía 0.5 y por eso el cierre quedaba
   con grumos blancos sueltos por todo el cuadro — medido replayando los
   eventos reales contra el solver a esa resolución, la dispersión de las
   blancas pasaba de 882 a **1017 px** (las desparramaba MÁS) y quedaban 994
   de 1220 fuera del blob. Con radio **1.3** termina en 83 px y quedan 37.
   El tope del param subió de 0.6 a 1.5 y después a **2.5** (`show-doc.ts` y
   el clamp del director): la media diagonal de 2100x847 ya es 1.34 y la de
   una 32:9 es 1.8, así que con 1.5 no había forma de escribir un atractor que
   llegara a las cuatro esquinas de cualquier monitor. La juntada y el agarre
   permanente van en **2**. **Ensanchar la RESPIRACIÓN del cierre NO es la
   solución**: se midió y casi no gana dispersión (max 688 -> 548 px) mientras
   el brillo mediano salta de 0.79 a 1.27 — la masa queda encendida. Lo que
   junta es la juntada, y lo que la sostiene es el agarre permanente.
9nonies. **UNA JUNTADA QUE SE SUELTA REBOTA.** Es la trampa que dejaba el
   cierre lleno de grumos aunque la juntada de 1:52 funcionara perfecto.
   Medido replayando la cadena real del director contra el solver (2100x847):
   a 1:58 las blancas están impecables —ninguna a más de 300 px del grueso,
   máximo 279— y a los dos segundos de que la fuerza se va, a las 2:04, la
   bola REVIENTA: p90 salta de 324 a **667 px** y se queda ahí hasta el final
   (1 192 blancas sueltas de 1 608, máximo 979 px). Es exactamente la captura
   de las 2:32. **No es la cohesión**: congelar los parámetros del solver en
   los de 2:02 no cambia nada. Es la presión de una bola comprimida cuando la
   soltás. El arreglo es no soltarla: un atractor de cuadro entero, débil
   (0.2) y CONSTANTE (`sustain` 1, `soft` 0, `wander` 0) desde que termina la
   juntada hasta el final. Con él: p90 ~300 px, máximo 375, y el brillo del
   cierre no se mueve del piso (0.14 de mediana entre 2:06 y 2:15) — porque
   una bola densa en equilibrio con una fuerza constante NO SE MUEVE, la
   presión la compensa. Lo que sí hay que bajar es todo lo que la toca
   después: con la masa junta y densa, la respiración a 0.7 y los agarres a
   radio 0.3 mueven TODO y clavan la mediana en el techo (3.4).
9undecies. **La POSICIÓN de un evento en `doc.events` no es contenido.** El
   editor arrastra eventos con `patch(id, {t})` SIN reordenar el array, y
   `parseShowDoc` SÍ ordena al recargar: cualquier cosa visible que dependa
   del índice de un evento (un serial, un "número de fractura") se ve de una
   manera en vivo y de OTRA tras guardar y recargar. Lo encontró un
   verificador replayando el flujo real del editor: la semilla del quiebre
   era el serial y las seis astillas cambiaban de lugar, ángulo y brillo al
   recargar. La semilla es ahora el TIEMPO del último crujido, y hay un test
   que baraja el array y exige geometría byte-idéntica
   (`FluidsShowDirector.test.ts`, "no depende del orden del array").
9duodecies. **Para purificar un núcleo de UN material, PERMUTÁ, no empujes —
   y no purgues un disco más grande que la población.** Tres mediciones
   contra el solver real: (1) juntar las blancas con el riel las deja en UNA
   bola pero MEZCLADAS — el racimo conexo se clava en 52 % porque adentro
   siguen los otros materiales; (2) purgar EMPUJANDO a los ajenos es una
   pulseada permanente contra la presión: todo hierve (mediana 0.3-1.9) y el
   núcleo queda mezclado igual; (3) purgar PERMUTANDO (un ajeno de adentro y
   una blanca de afuera se cambian de lugar) no mueve masa — la ocupación
   del espacio es la misma, cero respuesta de presión — y cada canje suma
   una blanca al núcleo por construcción. Y el núcleo tiene que medir lo que
   mide la población pura: 1 764 blancas llenan ~0.2 del lado corto; con el
   núcleo en 0.36 el canje se queda sin blancas de afuera con el disco al
   25 % y el racimo vuelve a clavarse en 50 %.
9decies. **El atractor NO tira más fuerte por tener más radio, tira más
   LEJOS.** Medido sobre el WASM: el desplazamiento por llamada cae lineal con
   la distancia y se anula en el radio (`fuerza ∝ 1 - d/r`), pero en el centro
   vale casi lo mismo con radio 0.45 que con 2.0 (0.59 px contra 0.65). Lo que
   cambia es el borde: a 0.3 del centro, radio 0.45 da 0.22 px y radio 1.5 da
   0.53. Por eso ensanchar un atractor no "aprieta más" el grueso —lo que hace
   es poner en marcha a los de afuera— y por eso un radio grande con fuerza
   chica es la única forma de alcanzar los bordes sin encender la masa.
9quinquies. **El `strength` de un atractor en modo 4 (AGARRE) nunca llega al
   solver.** `ATTRACTOR_MODES[4] = 'drag'`, y el worker, para drag, llama
   `_pvfs_drag_particles(sim, x, y, radius, vx/steps, vy/steps)` sin pasar
   `strength` (`kot-fluid.worker.js:256-264`) — sólo attract/repel y vortex lo
   usan. El `force` de un agarre entra por otro lado: `dragScale = envelope *
   force` -> `vx`/`vy`. Es el mismo patrón del bug histórico de `drag`: si
   calculás "energía" de un agarre por su strength, estás sumando un fantasma.
9ter. **Un atractor no puede juntar "sólo los blancos"** (ver 9) — pero con
   `bodies` en 0 lo único VISIBLE son los blancos, así que una atracción ancha
   sobre todo el fluido se ve exactamente como los blancos juntándose. Medido:
   la cohesión no los segrega en doce segundos (el radio del conjunto blanco
   se mueve menos del 5 %); la juntada la hace el atractor.
9bis. **Cohesión 1 = la masa HIERVE.** Atascada del todo (densidad de reposo
   11.2, rigidez de contacto 1.45) las partículas se rebotan entre ellas en el
   lugar y quedan iluminadas para siempre aunque nadie las mueva — medido
   contra el solver: el 10 % más agitado se clava en 0.90 de brillo (piso
   0.12) y no baja NUNCA. Con 0.62 la masa entera cae al piso en tres segundos
   y ahí se queda. Por eso el cierre usa `STILL_COHESION = 0.62` y no 1.
   `velocityEmissionSmoothing` sola no alcanza: suprime la vibración ~6×, pero
   6× de un hervor grande sigue siendo brillo.
9. El solver no filtra fuerzas por material: "atraé sólo los blancos" no
   existe — se aproxima juntando todo o con masas.
10. Población y radiancia sobreviven al replay: por eso el `reset-fluid` en 0.
