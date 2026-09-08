# Fluids: la 26 como final reactivo de la 25, y la luz — 2026-09-07

Alcance: escena 26 = continuación de la 25 gobernada por MIDI (modo `sequel` del `FluidRuntime`), geometría Ikeda (losetas sobre la grilla de 1 m), faders `fluids.seq.*`, mapeos de JEJE FLUID, y el cierre de la pregunta "la iluminación quedó más baja que en el original". [Decisión vigente](CONTEXTO-ACTUAL.md) · [Plan y propuesta](../../../PLAN-ESCENA-26.md) · [Operación](integracion-radiance/OPERACION.md) · [Detalle de la vuelta](../NOTAS.md).

## Qué se cambió

| Área | Antes | Ahora |
|---|---|---|
| Escena 26 | Motor libre sin documento, gotas azules, `fluids.live.*` reseteados por escena | **La 25 que sigue**: mismo solver, director con clon mutable del documento, reloj continuo; notas inyectan eventos y losetas; faders escriben keys `hold` |
| Controles | `fluids.live.*` (escena) | `fluids.seq.*`: 9 faders (estado vivo) + 10 acciones; `fluids.live.*` queda como capacidad sin escena |
| Mapeos | — | `mappings.default.json` **v13**: Ch1 n0/n2/n4 y Ch2 n38/n39/n49/n47/n45/n40, sólo en la 26 |
| Ableton | El slot JEJE FLUID del track "scene" estaba vacío | Clip "26" (pista 31, slot 37): cuatro notas de pitch 26 |
| Población inicial de la 25 | Se había puesto la del original (20 000) para "recuperar luz" | **Revertido**: la 25 arranca vacía como el documento pide; `SHOW_INITIAL_POPULATION` sólo para entrar en 26 sin venir de la 25 |
| Luz | Pregunta abierta | Cerrada: la integración reproduce el documento igual que la página original con el documento real |

## La luz: qué se midió

- En los primeros 8 s (deterministas) la página original **fresca** da brillo medio 18–21 con máximo 255 en todos los cuadros, y la integración alterna 21–24 con caídas a 2,6 y 0,2. La diferencia no es de render: **la página original arranca con el documento vacío** (`useShowDoc()` vacío → adopción asíncrona → el director sólo recibe el documento nuevo en una edición). Sin curvas ni `reset-fluid`, sus 20 000 partículas blancas iniciales iluminan todo el tiempo.
- Con el documento real forzado en la página original (import por CDP), original e integración coinciden: 21,4 contra 21,9 de brillo medio a los 6 s; misma fila de píxeles con el supersampling 2×.
- Arrancar la 25 con las 20 000 partículas del original hizo la integración **más oscura** (la masa blanca tapaba la línea emisora): se probó y se revirtió.
- La palanca vigente sin tocar el documento es `fluids.gain` (1,25 por defecto: brillo medio 38 → 58 a mitad de secuencia, picos p99 244 → 242).

## La 26: qué se comprobó

`node tools/check-radiance.mjs` (8 comprobaciones; la de la 26 es nueva), en desarrollo:

| Comprobación | Resultado |
|---|---|
| Entrar en 26 al final de la 25 | escena `26`, modo `sequel`, **mismas partículas ±200**, sesión pausada |
| Faders al entrar | `fluids.seq.viscosity` 1, `cohesion` 0,62 (valores del documento), `bodies` 0,15 |
| Reloj | `sequelTime` > 152,6 s y sigue avanzando |
| Dos 808 (Ch1 n4) | 2 losetas vivas |
| Kick (Ch1 n0) | ≥ 1 evento activo inyectado |
| Sci-fi button (Ch2 n45) con `tileLife` 1 | `frozenFluid` true a los 150 ms, false a los 750 ms (stutter que se suelta solo) |
| Fader gravedad −0,4 | el documento guardado en `vis.radiance.show.v1` no cambia |
| Solver | `solverFrame` avanza en la 26 |
| Vuelta a la escena 1 | Fluids se oculta, Parte 1 vuelve |
| Rendimiento del recorrido | 481 frames a 60,0 FPS |

Ensayo con el patrón de JEJE FLUID simulado dentro de la página a 140 BPM (kick cada negra, contratiempo, 808 cada dos negras, acentos del canal 2 en sus posiciones del loop de 29 negras), entrando a la 26 desde el final de la 25 (9 000 partículas heredadas):

| t (s) | losetas vivas | grilla | eventos activos | solver (ms) |
|---|---|---|---|---|
| 5 | 2 | 1 m | 2 | 5,2 |
| 30 | 5 | 1 m | 3 | 9,8 |
| 60 | 8 | 1 m | 2 (stutter en curso) | 5,7 |
| 95 | 10 | 50 cm | 1 | 5,5 |

60 FPS al final del ensayo. Capturas en `radiance-check/seq/ensayo3/` (`b-26-t{5,30,60,95}.png`) y del kick en `radiance-check/seq/kick/`.

Dinámica del kick, desplazamiento **medio** de todas las partículas en 350 ms (unidades: píxeles del solver, ancho 2688), 6 192 partículas:

| `fluids.seq.viscosity` | sin golpe | con kick |
|---|---|---|
| 1 (documento) | 6,8 | **22,9** |
| 0,7 | 18,2 | 20,0 |
| 0,5 | 16,6 | 14,5 |
| 0,3 | 14,3 | 14,9 |

El primer kick sobre la masa compacta del cierre midió 246 px: la abre en un anillo que se enciende. Con la viscosidad del documento el fluido está quieto y el golpe se lee; con menos, fluye solo y el golpe desaparece. La 26 se queda con la del documento.

Otras pruebas de esta vuelta: 16 tests de `radiance-session.test.mjs`, TypeScript del paquete Radiance, `walk-scenes` (29 escenas a 60 FPS, 0,5–1,9 ms), referencia MIDI/OSC regenerada (20 filas `fluids.seq`).

## Las losetas como obstáculos (misma fecha, pedido posterior de Manuel)

*"falta q esos cuadrados que creas interacuten con las particulas osea q estas choquen ahi y reboten"*. Las losetas pasaron de `repel` (blanca) y `lock` (negra) a **colisionadores rectangulares** del solver.

| Comprobación | Resultado |
|---|---|
| Lectura de `_pvfs_collide_particles_rect(sim, a, b, c, d)` sobre una masa de 1 m con 2 867–3 645 partículas adentro | centro + medios lados: 3 172 → 3 203 (nada); centro + lados: 3 125 → 3 006 (nada); **dos esquinas: 2 867 → 0 a los 120 ms** |
| Obstáculo entero de golpe sobre la masa compacta del cierre | detonación: la masa entera se va a las paredes del dominio en 2 s |
| Obstáculo creciendo 0,4 s, condición real de la 26 (después de los primeros kicks), cuadrado más denso (1 090 adentro) | 109 adentro a los 120 ms, 0 a los 2,5 s; partículas en el borde del dominio 17 → 0 |
| Ensayo de 90 s con el patrón de JEJE FLUID | 0 partículas adentro de toda loseta con más de 0,4 s (la recién nacida tiene las que está expulsando); 3 → 6 → 10 → 19 interacciones por frame con 3 → 5 → 8 → 10 losetas; solver 3–5 ms; 60 FPS |
| Borde del dominio sin la inhalación del cuarto kick | 14 → 167 → 320 partículas a los 8 / 30 / 60 s |
| Borde del dominio con la inhalación | 27 → 67 → 240 → **4** a los 8 / 30 / 60 / 90 s |
| `check-radiance` | la comprobación de la 26 suma «las losetas llegan al solver como colisionadores» (≥ 2 interacciones con dos losetas); 8 comprobaciones, 481 frames a 60 FPS |

Capturas en `radiance-check/seq/obstaculos2/` (`c-26-t{8,30,60,90}.png`): la masa envuelve el cuadrado negro del centro y se aplasta contra su lado, fluido apoyado sobre el borde superior de una loseta, masas achatadas contra las lámparas con la grilla en 50 cm.

## Movimiento, vida con techo y glow de amb 1 (misma fecha, tercer pedido)

*"No está interactuando el fluido con los cuadrados"* (era la ventana vieja: el worker en memoria no conocía `collide-rect`; con recargar alcanza — se abrió una ventana nueva), *"los cuadrados al final quedaron como colgados y fijos, tiene que seguir cambiando"*, *"que también se muevan en x o en y de manera geométrica en base a los MIDIs"*, *"el sinte amb1 tiene que generar que crezca un poco la luz [...] con un poco de decay"*, *"tenés que crear uno de esos canales que mandan MIDI"*.

| Comprobación | Resultado |
|---|---|
| Ableton: pista de envío **AMB1** (índice 46) | creada; entrada "amb 1" Post FX, monitor In, salida RTX3090 (Port 2) **Ch. 11** (verificado con la lectura de routing). El batch inicial expiró por un cuelgue de Live; al reabrir, el set tenía 46 pistas y el clip "26" intacto, y se hizo paso a paso |
| `check-radiance`, comprobación de la 26 ampliada | el tercer 808 cambia de celda a las dos losetas anteriores y `tilesMoving` ≥ 2; una nota del canal 11 pone `fluids.seq.amb` en 1; soltar una del acorde la deja en 1; `ambGlow` 0,25–0,9 a los 1,2 s; sin notas la compuerta cierra y el glow cae a menos del 40 % en 1,5 s. 480 frames a 60 FPS, en desarrollo y sobre el build |
| Ensayo de 50 s con el patrón de JEJE FLUID y amb 1 (nota a los 2 s, acorde a los 9, suelta a los 20, vuelve a los 26) | glow 0,85 → 0,01 → 0,79 → 0,87; 2–5 losetas en marcha por captura; 0 partículas adentro de toda loseta que pasó el crecimiento; borde del dominio 39 / 237 / 224 / 24; solver 3–6 ms; 60 FPS |
| Antes de detener el reloj de las losetas con el stutter | 370, 636 y 1 154 partículas adentro de losetas en marcha al medir justo al salir del stutter; después, 0 |
| Estrobo de 12 líneas a intensidad plena | pared entera blanca (captura t = 19 s); ahora la intensidad baja ÷√n desde 4 líneas |

Capturas en `radiance-check/seq/movimiento2/` (`d-26-t{12,24,32,50}.png`).

## Cuatro lámparas al azar, tamaños mezclados y azules que emiten quietos (misma fecha, cuarto pedido)

*"Se ven los azules pero no se vuelven emissive con la nota"*, *"que cambie qué cubos tienen emissive, siempre sólo 4, random"*, *"los que no son emissive sin borde blanco"*, *"al principio cuadrados grandes y después sólo chicos, pierde dinamismo"*, *"las líneas blancas con emissive no me gustan: que esos flash sean de los cubos"*.

| Comprobación | Resultado |
|---|---|
| Sonda del glow: lámpara, render y compuerta con `fluids.seq.amb` en 1 | `mix` 0,56 a los 4 s y 0,67 a los 8 s; el render tiene el material 2 como secundario con ese peso (`nextEmission` 0,559 / 0,672, `dataset.reactiveSecondaryMaterial` 2); al soltar, 0,03 a los 2,5 s. La cadena estaba bien: lo que faltaba era la **compuerta de velocidad** del shader (una partícula quieta emite al 12 %) |
| Uniform nuevo `uNextSteady` en los dos shaders (fuente y visible) | el material secundario reactivo emite con ganancia ≥ 1 aunque esté quieto, sólo mientras el overlay secundario está aplicado; el principal conserva "lo quieto es tenue, lo que corre flamea" |
| Ensayo de 40 s con amb 1 (nota a los 2 s, suelta a los 24, vuelve a los 30) | tamaños por captura `221` → `2412` → `241` → `2124` → `21241`; lámparas 3, 4, 3, 4, 4 (cuatro cuando hay cuatro o más losetas); 0 partículas adentro de toda loseta quieta y crecida; borde 10 / 14 / 472 / 137 / 331; 60 FPS |
| Emisión de las lámparas sin normalizar (0,6 por área) con una de 2 m | pared entera blanca (t = 16 s); normalizada al tamaño (luz de una de 1 m a 0,4, techo 1,0) queda en gris medio |
| Crecimiento de la loseta de 2 m en 0,4 s | 1 016 partículas al borde del dominio; en 0,8 s, 139 |
| Destello del relámpago ×2,5 durante 140 ms con el contratiempo cada negra | un tercio de las capturas claras; ahora ×2 durante 120 ms y `telemetry().flash` dice si la captura es de destello |
| `check-radiance` | las comprobaciones de la 26 (paso de losetas, colisionadores, compuerta, glow) siguen pasando; 481 frames a 60 FPS en desarrollo y producción |

Capturas en `radiance-check/seq/lamparas3/` (`g-26-t{8,12.2,16.4,28.1,40.3}.png`; 12,2 y 28,1 son cuadros de destello).

## Pistones, lámparas chicas, blancas por compás y glow rápido (misma fecha, quinto pedido)

*"El release tiene que durar 1 segundo; la potencia del azul 40 % más fuerte; el ataque más rápido y como con una vibración; los cuadrados son demasiado grandes y demasiados los prendidos, nunca prendan los más grandes; que a veces esté todo muy oscuro y sólo un cuadrado o un par ilumina, que se apaguen las blancas; más mecánico industrial, que busquen presionar y mover al fluido."*

| Comprobación | Resultado |
|---|---|
| Perfil del glow muestreado cada 50 ms (nota a los 2 s, suelta a los 14) | ataque 0 → 0,86 (velocidad 110) entre 2,00 y 2,70 s, con el `mix` vibrando (0,19 · 0,23 · 0,38 · 0,45 · 0,47 · 0,59 · 0,54 · 0,66 · 0,60 …) hasta asentarse en 0,74; **release 0,866 → 0 entre 14,00 y 14,85 s**, lineal |
| Potencia | `mix` hasta 0,85 (antes 0,7) y ganancia parada 1,15: +40 % |
| Tamaños y lámparas en 40 s de ensayo | tamaños `121` → `1121` → `121` → `112` → `2112` → `112112` (sin 2 m); lámparas por muestra: 1 el 44 % del tiempo, 2 el 44 %, 3 el 9 %; nunca una de 1 m |
| Blancas | emiten el 22 % del tiempo (sorteo al 40 % por compás); el resto, sólo cubos y azules |
| Obstáculos | 0 partículas adentro de toda loseta crecida; borde del dominio 4 / 65 / 84 / 21 / 17 / 4; 60 FPS |
| `check-radiance` (comprobaciones actualizadas: paso con el kick, glow > 0,85 a los 0,9 s, < 0,02 a 1,15 s de soltar) | 8 comprobaciones, 481 frames a 60 FPS en desarrollo y producción |

Capturas en `radiance-check/seq/pistones/` (`h-26-t{6,12,15.2,22,34}.png`).

## Máquinas que no se pisan, atractor del canal 3 y luz que late (misma fecha, sexto pedido)

*"Los cuadrados son mecánicos y no pueden chocarse ni solaparse; le falta dinamismo a la iluminación; los fluidos no se mueven con los atractores que usamos en las otras escenas; el emisor azul queda siempre prendido, el release es muy largo; cuando las partículas se aceleran, si son emissive tendrían que iluminarse más."*

| Comprobación | Resultado |
|---|---|
| Solapes entre losetas (rectángulos de celdas, donde están y a donde van), en seis capturas de 34 s y en `check-radiance` tras seis golpes | **0** en todas |
| Atractor del canal 3: nota apretada de 8 a 11 s (atracción) y de 24 a 29 s (remolino) | `telemetry().attractor` 0 y 2 mientras la nota está apretada, −1 al soltar; desplazamiento medio del fluido en 350 ms: **38 px sin atractor, 73 con atracción, 226 con remolino**; en la captura de 9,5 s la masa se junta en un racimo denso |
| Release del glow (nota suelta a los 14 s) | 0,866 → 0 entre 14,00 y 14,40 s |
| Blancas | emiten quietas el 46 % del tiempo; el resto, sólo en movimiento (en las capturas las masas que corren se ven encendidas y las quietas negras) |
| `check-radiance` (suma: sin solapes tras seis golpes; el canal 3 prende y apaga el atractor; release < 0,02 a 0,65 s) | 8 comprobaciones, 481 frames a 60 FPS en desarrollo y producción |

Capturas en `radiance-check/seq/maquinas/` (`i-26-t{6,9.5,15,22,26,34}.png`).

## Esquive real y barrido que invierte (misma fecha, séptimo pedido)

*"Los cuadrados tienen que moverse evitando chocarse y pisarse. Y la línea que pasa como un barrido negro tiene que alterar la iluminación de todo sobre ella, o sea invertirla: lo que es blanco emissive pasa a ser negro, las partículas que eran negras pasan a ser blancas emissive, y las azules pasan a ser rojo emissive."*

| Comprobación | Resultado |
|---|---|
| Solapes **visuales** (rectángulos dibujados, no celdas) muestreados 40 veces por segundo durante 35 s, con hasta 11 losetas y vida larga | **0** en todo el ensayo |
| Las losetas no se traban entre ellas | 10 de 11 moviéndose en la última muestra; 7 de 7 al inicio |
| Kicks a 40 ms de distancia (redoble) | antes: 1 solape (una loseta arrancaba un paso sin terminar el anterior); ahora **0**, porque termina su carrera primero |
| Banda de inversión | `telemetry().invert` 1 mientras cruza, con `invertX` recorriendo 0,84 → 0,40 → 0,38 → 0,84 en cuatro disparos, y 0 al terminar |
| Inversión, mirando las capturas | dentro de la banda: cubo negro → **blanco**, cubo blanco → **negro**, partículas blancas → negras, gotas azules → **rojas**, pared iluminada → oscura. En el borde se ve un cubo partido al medio, mitad blanco mitad negro |
| `check-radiance` (suma: sin solapes a mitad del deslizamiento; la banda enciende, cruza y se apaga) | 8 comprobaciones, 480 frames a 60 FPS en desarrollo y producción |

Capturas en `radiance-check/seq/invert3/` (`j-banda-{1,2,3,4}.png`, `j-antes.png`).

## Los dos kicks y el azul al doble (misma fecha, octavo pedido)

*"Fijate con Ableton MCP que hay 2 notas de kick sincopadas, tenés que usar ambas así los cuadrados son más dinámicos"*, y *"la nota del canal amb 1 tiene que hacer aumentar más la luz del emissive azul, el doble de lo que hace; empieza del nivel mínimo de esa emissive hasta el doble, y cuando deja de sonar la nota, en 1 segundo vuelve a su valor mínimo"*.

Leído con el MCP (`get_drum_pads` del rack `amen_tearsofthekiller1` y las notas del clip): el pad **0 es "deep dark kick"** y el pad **2 es "Instrument Rack"**, que adentro tiene el **"Cymatics - Kick 69"**. En el loop del clip (beats 12–18) el 0 cae en cada negra (12, 13, 14…) y el 2 en cada contratiempo (12,5, 13,5…): dos kicks sincopados entre sí.

| Comprobación | Resultado |
|---|---|
| Cambios de celda por segundo con los dos kicks, en 34 s | **4,9** (las corcheas de 140 BPM son 4,67); con un solo kick eran 2,3 |
| Losetas trabadas | ninguna: todas en movimiento en cada muestra (3 de 3, 4 de 4, 5 de 5) |
| Solapes visuales con los dos kicks, 40 muestras por segundo durante 34 s | **0** |
| Glow en reposo (sin nota) | `mix` **0,2** constante, no cero |
| Ataque (nota a los 6 s) | 0,2 → 0,75 en 850 ms, con el `mix` vibrando: 0,425 · 0,304 · 0,552 · 0,496 · 0,592 · 0,633 · 0,619 · 0,708 · 0,654 · 0,737 |
| Potencia | ganancia parada 1,15 → **2,3** (el doble); techo de lámpara 0,85 |
| Release (suelta a los 18 s) | 0,763 → 0,2 entre 17,95 y 18,85 s, lineal |
| `check-radiance` (suma: el segundo kick mueve las losetas; el glow llega arriba de 0,7 y vuelve al mínimo, no a cero) | 8 comprobaciones, 481 frames a 60 FPS en desarrollo y producción |

Capturas en `radiance-check/seq/glow/`: sin nota las gotas azules están ahí pero apagadas; con la nota irradian y tiñen de azul la pared entera.

## Lo que se probó y se descartó

- Comparar sólo las celdas destino: dos losetas que se cruzan quedan una encima de la otra a mitad del deslizamiento. Se comparan cajas barridas (origen ∪ destino).
- Dejar la barra negra del barrido y encima invertir: la barra borra la luz, así que debajo no queda imagen que dar vuelta (la inversión de una franja negra es una franja blanca lisa). La banda no dibuja nada.
- Invertir con el complemento crudo: el azul salía amarillo. Con el sesgo (restarle el verde según lo azul que era) sale rojo, y con umbral el fondo no se tiñe de naranja.

- Apagar las blancas cambiando la lámpara principal al material vacío: quedaban muertas también en movimiento. Ahora se apagan bajando el piso de la emisión por velocidad a 0.
- Release del glow de 1 s: con la nota de amb 1 de 32 negras se veía "siempre prendido". Medio segundo; y la nota es lo que manda.

- Glow con ataque de 2,5 s y caída exponencial de 0,8 s: demasiado lento para Manuel. Ataque 0,22 s de constante, release lineal de 1 s.
- Cuatro lámparas fijas de cualquier tamaño: demasiadas y demasiado grandes. De una a tres, sólo de 50 cm.
- Paso con el 808 y deslizamiento suavizado de una negra: poco frenético y blando. Paso con cada kick, lineal a 0,18 s por celda.

- Glow al 0,85 del render sin sacar la compuerta de velocidad: se veían azules (el color) pero apagados (la emisión). Con `uNextSteady`, prendidos.
- Lámparas a 0,6 por área con tres tamaños: la de 2 m dejaba la pared blanca. Normalizadas por tamaño.
- Losetas blancas/negras fijas al nacer y estrobo de líneas: reemplazados por el sorteo de cuatro lámparas y el destello de las lámparas.

- Losetas deslizándose durante el stutter: el `lock` gana al colisionador y al soltar se expulsa todo lo que quedó adentro de golpe. Su reloj se detiene con el fluido.
- Glow al 0,85 de la lámpara: un cuarto de las partículas emitiendo azul teñía la pared entera. Techo 0,7.

- Loseta blanca con `repel` y negra con `lock`: ninguna era un cuerpo; el fluido las atravesaba o quedaba congelado adentro.
- Obstáculo entero de golpe: detonación (arriba). Crece en 0,4 s.
- Obstáculo sin liberación al morir: cicatrices rectas de partículas en línea donde estuvo cada borde (diez a los 60 s). Un `repel` de 6 frames al morir las desarma.
- Kick siempre hacia afuera: la masa se iba a las paredes. Cada cuarto kick contrae.

- Stutter como **toggle**: el botón llega una vez por vuelta de 29 negras y dejaba el fluido quieto 12 s de cada 25. Pasó a duración fija (`tileLife` negras).
- Lámpara blanca con emisión **1,25**: inundaba de gris medio cuadro. Quedó en 0,9 ÷ √lámparas vivas, con máscara blanca encima para que el cuadrado siga nítido.
- Loseta negra sin marco: invisible sobre negro. Marco blanco de 4 px.
- Entrar sin cambiar la lámpara ni `bodies`: cuadro negro entre golpes a los 12 s. Ahora `set-lamp` a los materiales dominantes y `bodies` 0,15.
- Vida fija de 2 negras: una sola loseta viva siempre, nunca se acumulaban. Vida 4 negras × (1 + n/24).

## Límites

- Todo se ensayó con un **patrón simulado**, no con el Live set sonando: los tiempos de JEJE FLUID salen del MCP, pero la mezcla final (cuánto emiten las lámparas, la vida por defecto, si el pulso va al kick o al 808) hay que afinarla en la pared con la música real.
- Los eventos inyectados se podan cada 300 frames; en una 26 muy larga (más de 10 minutos) no se midió el crecimiento del documento clonado.
- **Falla preexistente:** `tools/smoke-learn.mjs` sigue reprobando «acción + nota → modo trigger» por el mapeo `drum-vortex-kick-21` de la vuelta de rayos, no por esta.
