# Plan — Escena 26: el final de la 25, reactivo a Ableton (onda Ryoji Ikeda)

**Fecha:** 2026-09-07. **Pedido de Manuel, textual:** *"EL ESCENA 26 TIENE Q SER EL FINAL DE LA ESCENA 25, NO UNA ESCENA NUEVA... VA A PARTIR DE LA ESCENA 25 SOLO Q AHORA VA A REACCIONAR A MIDIS DE MI ABLETON LIVE... EL MOMENTO MAXIMO DE ESA PARTE VA A SER LA MUSICA Q HAY EN JEJE FLUID... MAS TIPO MISTERIOSO... ALGO COMO BIEN MATEMATICO ONDA SINCRONICO GEOMETRICO QUE ALTERE LOS FLUIDOS PERO COMBINADO CON LOS FLUIDOS. MUCHA DINAMICA RITMICA... PRIMERO Q EMPIECE MAS FLUIDO PERO AL FINAL COMO Q HAYA CUADRADOS Y COSAS CON O SIN EMISSIVE Q NO SOLO GENERAN SOMBRAS E ILUMINACION SINO Q INTERACTUAN CON EL FLUIDO Y A SU VEZ EL FLUIDO TMB TIENE Q CAMBIAR... ONDA RYOJI IKEDA EL SHOW."*

Este plan reemplaza la 26 anterior ("motor libre con gotas azules"), que era una escena nueva y no la continuación de la 25. **Estado: ejecutado y verificado** (§7). Lo que sigue es el plan tal como quedó después de ejecutarlo: donde la ejecución se apartó del plan original, está dicho en el lugar.

---

## 0. Antes que nada: la luz (cerrado — la integración es fiel al documento)

Manuel: *"TODA LA ILUMINACION QUEDO MAS BAJO EN LO DE LOS FLUIDOS Q EN EL ORIGINAL"*. Se midió tres veces y las dos primeras estaban mal:

1. **Comparar cuadros a los 40 s o más** no sirve: el fluido es caótico y las dos corridas ya divergieron. Se pasó a los primeros 8 s, donde el show todavía es determinista.
2. En esos 8 s la página original **sí** se veía más clara, y la diferencia parecía explicarse porque el original crea el solver con **20 000 partículas** (`[6666, 6666, 6666, 2]`) y la integración con `[0, 0, 0, 0]`. Se implementó esa población en la 25 (`SHOW_INITIAL_POPULATION`) y **la integración quedó más oscura, no más clara**: la masa blanca apagaba a la línea emisora en vez de sumarle. Revertido.
3. Lo que de verdad pasaba: la página original tiene un bug de arranque. `useShowDoc()` empieza con el **documento vacío** y adopta el real de forma asíncrona, pero el director sólo recibe el documento nuevo cuando hay una edición. Una carga fresca del original corre el documento vacío: sin curvas de emisión ni exposición, con las 20 000 partículas blancas iluminando todo y sin `reset-fluid`. **Eso es lo que Manuel recuerda como "el original más brillante"**, y no es el show escrito. Forzando el documento real en la página original (import por CDP), original e integración dan la misma imagen: brillo medio 21,4 contra 21,9 a los 6 s, misma fila de píxeles con el supersampling 2×.

**Conclusión:** la integración reproduce el documento tal como está escrito. La oscuridad de la 25 es de diseño del documento (cierre con lámpara sobre el material 0 y viscosidad 1). La palanca para verla más clara sin tocar el documento es `fluids.gain` (arranca en 1,25; medido a mitad de secuencia sube el brillo medio de 38 a 58 sin mover los picos). Si Manuel quiere el look del "original vacío" —todo blanco, sin dramaturgia—, es otro show, no un bug.

---

## 1. Qué es la 26

**La 26 es la 25 que sigue viva.** Cuando llega la nota 26 (canal 10), no se reinicia nada: el mismo solver con las mismas partículas, el mismo director con el mismo documento, la misma paleta y la misma exposición del último instante de la 25. Lo único que cambia es **quién manda**: ya no el timeline, sino las notas y CCs de Ableton.

Técnicamente es un modo nuevo del `FluidRuntime`, **`sequel`** (`enterSequel` / `sequelFrame` / `sequelAction`):

- El director de la 25 sigue corriendo con un **documento clonado y mutable** (`sequelDoc`): las curvas quedan en su valor final (hold más allá del último key, que es lo que `sampleCurve` hace solo) y los eventos nuevos se **inyectan** con `t = ahora` cuando llega MIDI. El documento persistido de la 25 no se toca (verificado en `check-radiance`: mover un fader no cambia el doc guardado).
- El reloj sigue avanzando desde donde quedó la 25 (`sequelTime`), así que todo lo que es "tiempo absoluto" en el director (fases de eventos, strobes, semillas de fractura) funciona igual que en la secuencia.
- Encima del `out.geometry` del director se agregan las **losetas** (la geometría Ikeda) y encima de `out.interactions` sus fuerzas. Los faders escriben **keys `hold`** en las curvas del clon, en el instante actual, descartando las keys futuras: desde ese momento la curva vale lo que dice el CC.
- Entrar en 26 sin venir de la 25 (por ejemplo en un ensayo) arranca con la población del original y las curvas en su valor final: se ve lo mismo que si la 25 hubiera terminado. Es el **único** uso que quedó de `SHOW_INITIAL_POPULATION`.
- La 26 hereda el final de la 25 aunque la nota llegue **antes** de que la secuencia termine: el timeline deja de avanzar en el instante de la nota y la 26 toma el control desde ahí.
- La sesión (transporte, WAV) queda **pausada**: en la 26 la música es la de Ableton.

**Por qué reutilizar el director y no escribir un motor nuevo:** los doce tipos de evento del show (`strobe-lines`, `flash`, `blackout`, `shadow-bar`, `burst`, `emit-burst`, `attractor`, `fracture`, `unite`, `set-material`, `set-lamp`, `reset-fluid`) ya están implementados, probados y con la misma estética de la 25. Dispararlos en vivo es escribir un evento en un array. Lo único realmente nuevo son las losetas y su interacción física.

El motor libre (`enterLive`, `fluids.live.*`) sigue registrado como capacidad sin escena; ninguna escena lo usa.

---

## 2. La música: JEJE FLUID

Leído del Live set con el MCP de Ableton (escena 37 de Session, "JEJE FLUID"; 140 BPM, 4/4; negra = 0,429 s, compás = 1,714 s):

| Pista | Clip | Qué hace | Sale por MIDI |
|---|---|---|---|
| **DRUM** (rack `amen_tearsofthekiller1`) | loop de 6 beats (12→18) | **dos kicks sincopados entre sí**: "deep dark kick" (n0) en cada negra y "Instrument Rack" (n2, que adentro tiene el "Cymatics - Kick 69") en cada contratiempo; 808 (n4) cada 2 beats | **Sí: canal 1** (pista de salida "DRUM" → RTX3090 Port 2, Ch. 1) |
| **PERC** (Drum Rack) | loop 29 beats (12,4 s) | acentos aislados: alarm keypad (n38) en 0,5 y 16,5; alarm keypad (n39) en 4,6; fx_powered (n49) en 3,0; waaaeey (n47) en 20,7; sci-fi button (n45) en 22,7; bowl ride (n40) en 22,9 | **Sí: canal 2** (pista "PERC" → Ch. 2) |
| SINUS (Operator + Overdrive) | 122 beats | **drone**: una sola nota La1 (pitch 33) sostenida 52 s | no |
| PAD (Ambient Pad) | 16 beats | Re sostenido (y Fa en la segunda vuelta): pad menor | no |
| raro (Wavetable "Martian Ham Radio") | 56 beats | notas largas Re · La · Do · La · Fa · Do, a volumen bajo | no |
| amb 1 (Ambiente Pad) | 32 beats | Do7 y Re#7 sostenidos, muy agudos | no |

**Carácter:** La menor / Re menor modal, drone grave continuo, pads sostenidos, y encima un pulso mecánico a 140 (kick cada negra, contratiempos) con acentos sueltos de texturas "raras". Tenso, misterioso, con reloj. Para lo visual eso da dos capas claras: **un pulso regular** (canal 1: kick, contratiempo, 808) y **acentos impredecibles** (canal 2). Ikeda vive exactamente de esa dualidad: métrica exacta contra acontecimientos discretos.

**Lo que llega a la web:** canal 1 (todo el rack DRUM) y canal 2 (todo el rack PERC) ya salían. La **nota 26** se agregó con el MCP en el track "scene" (pista 31), slot 37 (JEJE FLUID): clip "26" de medio compás con cuatro notas de pitch 26. Disparar la escena JEJE FLUID en Ableton entra en la 26 solo.

---

## 3. Propuesta visual y de dinámica (Ikeda) — como quedó

Principios que se respetan en todo: **monocromo** (blanco, grises, negro; el fluido pierde el color en los primeros 3 s de la 26), **bordes duros** (nada de degradados decorativos: el ojo necesita un borde — trampa conocida del proyecto), **cuantización** (todo cae en la grilla y en el pulso; nada flota), **silencio** (el negro entre golpes es parte del ritmo).

### La grilla

La pared es 8 × 3 m. La grilla base son **celdas cuadradas de 50 cm = 168 px** (16 × 6), y las losetas miden 1 o 2 celdas de lado (50 cm o 1 m), por orden de aparición según la serie `1, 1, 2, 1, 1, 2`: dos de cada tres de 50 cm. Los dos tamaños conviven desde el principio (2026-09-07, Manuel: *"al principio se ven cuadrados más grandes y después sólo los chicos, pierde dinamismo"*; antes la grilla se subdividía con la cuenta). Hubo una de 2 m cada seis y se sacó (*"son demasiado grandes los cuadrados"*); el bowl ride pone una de 1 m. `fluids.seq.grid` por encima de 0,5 hace todas de 50 cm. Un cuadrado siempre ocupa celdas enteras.

### La entrada: el fluido heredado se tiene que VER

Lo que encontró el primer ensayo: el final de la 25 deja la lámpara sobre el material 0 (unas pocas burbujas), viscosidad 1 y `bodies` 0. Al entrar en 26, entre golpe y golpe el cuadro era **negro**. Tres cosas al entrar, todas medidas mirando capturas:

- **La lámpara pasa a los materiales que de verdad quedaron** (`set-lamp` a los dos con más partículas, histograma de `solver.materialIds`, fundido 2 s).
- **`bodies` arranca en 0,15**: la masa se lee como cuerpo gris con el borde punteado, aunque el documento la deje en 0. Es el único fader que no arranca donde lo dejó la curva.
- **La paleta funde a monocromo** en 3 s (`fluids.seq.mono`, arranca en 1).

### Fase A — "más fluido" (entrada, primeros ~30 s)

Sobre el fluido de la 25, sólo el pulso:

- **Kick (Ch1 n0, cada negra) → `fluids.seq.pulse`**: flash de exposición (×1,8, caída 0,12 s) y un `burst` radial (radio 0,3) desde el centro de masa; **cada cuarto kick tira para adentro** (`attractor` modo atraer, radio 0,9, fuerza 2, 0,3 s): tres exhalaciones y una inhalación. Sin la inhalación la masa se iba quedando pegada a las paredes del dominio (14 → 320 partículas en el borde en un minuto; con ella, 4 a los 90 s). **Con la viscosidad del documento (1) el fluido está clavado y cada kick lo hace saltar**: medido, 7 px de desplazamiento medio en 350 ms sin golpe contra 23 con golpe; el primer kick sobre la masa compacta del cierre la abre en un **anillo que se enciende** (246 px). Lo que se mueve se ilumina y el freno del cierre lo apaga en medio segundo: eso es el ritmo. Con viscosidad 0,5 el fluido fluye solo (17 px sin golpe) y el kick deja de leerse (14 px). Por eso la 26 **se queda con la viscosidad del documento** y el fader la baja si Manuel quiere agua.
- **Segundo kick (Ch1 n2, el del contratiempo) → `fluids.seq.strobe` + `fluids.seq.step`**: el **relámpago** (sortea de nuevo cuántas y cuáles losetas emiten y las hace destellar, emisión ×2 durante 120 ms; reemplaza al estrobo de líneas del plan original, Manuel: *"las líneas esas blancas con emissive no me gusta; hacé que esos flash sean de los cubos"*) **y un paso más de las losetas, cruzado**. Manuel: *"hay 2 notas de kick sincopadas, tenés que usar ambas así los cuadrados son más dinámicos"*. Con los dos kicks las losetas avanzan en **corcheas** (4,9 cambios de celda por segundo medidos, contra 2,3 con un solo kick) y en zigzag: el golpe de la negra empuja por el eje propio y el del contratiempo por el perpendicular.
- **808 (Ch1 n4, cada 2 beats) → `fluids.seq.tile`**: la primera loseta. Ver Fase B.

### Fase B — la geometría entra (~30 s → ~70 s)

- **Loseta (`fluids.seq.tile`)**: un cuadrado de la grilla que aparece de golpe. **Todas son obstáculos duros**: el fluido choca contra los cuatro lados y rebota (pedido de Manuel del 2026-09-07: *"que choquen ahí y reboten"*). Usan el colisionador rectangular del solver (`collide-rect`, ver §5). Lo que la loseta encuentra adentro al aparecer sale expulsado por el lado más cercano; el obstáculo crece en 0,4 s para empujar en vez de detonar. **Entre una y tres son lámparas, siempre de 50 cm, y el resto bloques negros**; cuáles y cuántas emiten se sortea con cada relámpago (Manuel: *"que vaya siendo random cuáles son"*, *"son demasiados los prendidos; nunca tienen que prender los más grandes; que a veces esté todo muy oscuro y sólo un cuadrado o un par ilumina"*):
  - **lámpara**: emite con la luz de una de 1 m a 0,4, normalizada por área y con techo 1,0; máscara blanca encima para que el cuadrado quede nítido. Proyecta **sombras duras** de todo lo que tiene delante.
  - **bloque negro**: absorbe (1,05) y tapa con máscara negra, **sin marco** (Manuel: *"los que no son emissive que no tengan el borde blanco porque queda mal"*): sobre negro no se ve, y se ve donde tapa fluido o luz.
  - Cuando una lámpara muere, otra loseta chica al azar toma su lugar.
  - **Las partículas blancas se apagan por compás… salvo cuando se mueven.** Cada cuatro kicks se sortea si el material principal emite quieto (40 %, piso de velocidad 0,2) o sólo en movimiento (piso 0): en ese estado las blancas quietas son cuerpos negros y sólo alumbran los cubos y las azules, pero cada kick las hace relampaguear al empujarlas (Manuel: *"que se apaguen las partículas blancas"*, y después *"cuando las partículas se aceleran, si son emissive tendrían que iluminarse más"*). Además el techo de emisión por velocidad sube de 3,4 a 5,5 y se alcanza con menos velocidad (sensibilidad 2,6): lo que corre flamea, blancas y azules.
  - **No se pisan nunca, y se esquivan.** Las losetas son máquinas (Manuel: *"tienen que moverse evitando chocarse y pisarse"*). Cada una ocupa una **caja barrida**: su celda, y mientras se desliza también la de la que viene. Un paso sólo se acepta si su caja barrida no toca la de ninguna otra, así que no puede haber solape en **ningún instante** del deslizamiento (no alcanza con que las celdas destino sean distintas: dos losetas que se cruzan pasarían una por encima de la otra a mitad de camino). Al dar el paso, una loseta prueba **cuatro rumbos por orden**: un pistón tira primero hacia el centro de masa por su eje y después por el otro; una patrulla sigue derecho, y si no puede **dobla noventa grados**, y recién después se vuelve. Si ningún rumbo está libre, se queda quieta ese golpe. Y una máquina **termina su carrera antes de arrancar la siguiente**: un golpe que llega con el deslizamiento en curso no la mueve. Al nacer busca celda libre en la secuencia (hasta 32 intentos; si no hay, esa vez no nace).
  - **La luz late.** Cada kick pulsa las lámparas (+80 % durante 150 ms), el relámpago las destella ×2,5, y cada lámpara sale del sorteo con su propia intensidad (0,6 a 1,2): no hay dos iguales.
  - Al morir, un `repel` corto desde su centro (6 frames) suelta el fluido que tenía apretado contra los bordes: sin eso quedaban cicatrices rectas de partículas en línea.
  - **Se mueven como máquinas** (Manuel, 2026-09-07: *"que también se muevan en el espacio en x o en y de manera geométrica en base a los MIDIs"*, y después *"más mecánico industrial, que busquen presionar y mover al fluido, como animaciones industriales modificando un ambiente de laboratorio"*): con **cada uno de los dos kicks** todas las losetas vivas dan un paso (por el eje propio con el de la negra, por el perpendicular con el del contratiempo), de una celda las de 50 cm y de dos las de 1 m, deslizándose a velocidad constante (0,18 s por celda) con arranque y frenada en seco. La mitad son **pistones**: el paso apunta al centro de masa del fluido y cuando lo pasan vuelven, así que martillan la masa de un lado y del otro. La otra mitad **patrulla** en línea recta y rebota en el borde. El obstáculo viaja con el dibujo, así que una loseta en marcha arrastra el fluido que tiene delante y deja estela. El 808 sólo coloca la loseta nueva.
  - **Time stop:** durante el stutter el reloj de las losetas también se detiene (no se deslizan, no nacen, no mueren). Si seguían deslizándose pasaban por encima de partículas trabadas y al soltar el colisionador expulsaba 1 154 de golpe (medido).
  - **Flip** (`fluids.seq.flip`, Ch2 n38 junto con el barrido): otro sorteo de lámparas, sin destello.
  - (Descartado el 2026-09-07: la blanca repelía con radio y la negra congelaba lo de adentro con `lock`; ninguna era un cuerpo.)
  - Dónde cae: recorrido determinista sobre la grilla (van der Corput sobre las celdas: cubre la pared pareja sin repetir ni agruparse). La grilla se subdivide sola: con más de 8 losetas vivas la siguiente cae en la ×2; con más de 16, en la ×4. `fluids.seq.grid` lo fuerza desde un CC.
  - **Vida:** `fluids.seq.tileLife` negras (4 por defecto = 1,7 s), **multiplicada por (1 + n/24) con techo ×4**, donde n es la cuenta de losetas colocadas: la loseta 24 vive el doble, la 72 y las siguientes 16 negras (7 s). Sin techo, a los cinco minutos vivían medio minuto y la pared quedaba colgada de cuadrados fijos (Manuel: *"al final quedaron como colgados y fijos, tiene que seguir cambiando"*). Lo que las mantiene cambiando es el paso, no la vida. `fluids.seq.clear` vuelve la cuenta a cero.
- **Acentos del canal 2** (las texturas raras de PERC), uno por sonido:
  - alarm keypad (n38) → `fluids.seq.sweep`: **la banda que invierte**, ver abajo;
  - alarm keypad (n39) y fx_powered (n49) → `fluids.seq.crack`: `fracture` en el centro de masa, tres astillas, ángulo alternado;
  - waaaeey (n47) → `fluids.seq.dark`: `blackout` de 0,3 s — el silencio visual;
  - sci-fi button (n45) → `fluids.seq.freeze`: **stutter**: todo el fluido queda como una foto fija (`lock` global) durante `tileLife` negras y se suelta de golpe (`unlock`). **Se apartó del plan**, que lo tenía como toggle: el botón llega una vez por vuelta de 29 negras y el toggle dejaba el fluido quieto 12 s de cada 25;
  - bowl ride (n40) → `fluids.seq.tileBig`: una loseta de 2 × 2 celdas.

### Fase C — clímax (~70 s en adelante)

- Las losetas viven más y se mueven: la pared se va llenando de cuadrados de tres tamaños al pulso, con cuatro lámparas que saltan de cuadrado en cuadrado con el contratiempo — y el fluido queda **atrapado entre ellos**: empujado por los que avanzan, apilado contra los que frenan, haciendo sombra en los pasillos. Techo: 48 losetas vivas.
- `fluids.seq.grid` achica todas las losetas a la mitad si la música aprieta.
- Cierre: `fluids.seq.dark` (apagón) y, si Manuel quiere, `fluids.seq.reset` (vacía el fluido: la pared queda sólo con la geometría, y luego negro). **No quedó implementado** el strobe fijo a 12 líneas de la fase C: la serie 1·2·4·8·12 sigue igual en toda la escena.

### El barrido que invierte

Manuel: *"la línea que pasa como un barrido negro tiene que alterar la iluminación de todo sobre ella, o sea invertirla: lo que es blanco emissive pasa a ser negro, las partículas que eran negras pasan a ser blancas emissive, y las azules pasan a ser rojo emissive"*. El barrido dejó de ser una barra negra que tapa (una barra que borra la luz no deja nada que dar vuelta) y pasó a ser una **banda de inversión**: una franja vertical de **1 m de ancho y borde duro** que cruza la pared en 0,8 s a velocidad constante, alternando el sentido con cada disparo.

La inversión la hace el **paso de grade** del render (`postFragmentShader`), que ve la imagen ya compuesta —campo de radiancia, partículas y cubos—, así que da vuelta *todo* lo que queda debajo: el cubo blanco emisor se ve negro, el cubo negro se ve blanco, la pared iluminada se oscurece y la sombra se aclara. El azul va al rojo con una inversión con sesgo: el complemento crudo de un azul es amarillo, y restarle el verde en proporción a lo azul que era el pixel lo lleva a rojo. El umbral (`smoothstep(0.05, 0.3)`) deja que el fondo, levemente teñido de azul por el glow, se invierta a gris neutro, y sólo lo francamente azul —las partículas de amb 1— salga rojo.

El runtime no dibuja nada: calcula la posición de la banda por el reloj de las losetas (se congela con el stutter, como todo lo demás) y la manda en el estado de render (`invertX`, `invertHalf`, `invertTilt`, `invertAmount`). Fuera de la 26 ese estado no existe y la banda no se enciende.

### El glow azul de amb 1

Manuel: *"el sinte amb1 tiene que generar como que crezca un poco la luz: cuando suena la nota MIDI que se prendan unas de las partículas emissive azules, que vaya aumentando su emissiveness cuando suena y cuando no suena que se apague, con un poco de decay"*; después: *"el release tiene que durar 1 segundo, la potencia 40 % más fuerte, el ataque más rápido y como con una vibración de su emisividad a medida que sube"*; y después *"el emisor azul queda siempre prendido… el release es muy largo"* (release a 0,5 s; y ojo: en JEJE FLUID la nota de amb 1 dura 32 negras con un corte de 0,15 s en el loop, así que mientras ese clip suene el azul va a estar casi siempre prendido: la compuerta sigue a la nota). amb 1 es un pad de notas largas (en JEJE FLUID, Do6 y Re#6 sostenidas 32 negras) cuyo instrumento no sale por MIDI: se creó en Ableton la pista de envío **AMB1** (entrada "amb 1" Post FX, monitor In, salida RTX3090 Port 2 **canal 11**, el único libre entre los envíos). En la web, cualquier nota del canal 11 abre la compuerta `fluids.seq.amb` (modo `gate` con cuenta de notas sostenidas: soltar una nota del acorde no la cierra) y el runtime la convierte en `ambGlow`: **ataque al 95 % en 0,7 s con una vibración de 11 Hz que se apaga al llegar, y release lineal de 1 s hasta el MÍNIMO**. Manuel, 2026-09-07: *"que llegue más, más potente, el doble de lo que hace; empieza del nivel mínimo de esa emissive hasta el doble de lo que llega ahora, y cuando deja de sonar la nota, en 1 segundo vuelve a su valor mínimo"*.

Son dos cosas a la vez, las dos interpoladas por la envolvente:
- **cuánta lámpara azul reciben**: el `mix` del `set-lamp` de entrada —cuyo material secundario es el segundo con más partículas, al final de la 25 un cuarto de la masa (histograma [684, 4014, 1530, 0])— va de **0,2 (el mínimo, siempre presente) a 0,85** (el techo de la lámpara);
- **cuánto emiten PARADAS**: el uniform `uNextSteady` del render (estado `reactiveSecondarySteady`) va de 0 a **2,3**, el doble de la ganancia anterior. Sin él, la compuerta de velocidad del shader deja a una partícula quieta al 12 % y "se veían azules pero no encendidos".

El color del material se queda azul (`0x3060ff`, mezcla 0,6 a 1) aunque no suene: lo que sube y baja es cuánto emiten, no de qué color son. Resultado: sin nota las gotas azules están ahí pero apagadas; con la nota irradian y tiñen de azul la pared entera; al soltar, en un segundo vuelven al mínimo.

### El atractor del canal 3

Manuel: *"los fluidos no están moviéndose con los atractores que usamos en las otras escenas, y antes estaban"*. La pista de envío **atractor** de Ableton (canal 3, la que mueve las otras escenas) ahora también mueve la 26: cualquier nota sostenida del canal 3 abre `fluids.seq.attract` (gate, `mappings.default.json` v15) y mientras está apretada hay un `attractor` del show vivo desde un punto sorteado del centro del cuadro (radio 0,9, fuerza 3 × velocidad, sostenido), alternando **atracción** y **remolino** con cada nota; al soltar se apaga en 0,3 s. Medido con el patrón de JEJE FLUID: desplazamiento medio del fluido en 350 ms de 38 px sin atractor, 73 px con atracción y 226 px con remolino.

### El fluido también cambia

Los faders `fluids.seq.gravity / cohesion / viscosity / light / exposure / bodies` **son las curvas del documento**: mover uno escribe una key `hold` en el instante actual del clon y el director la evalúa igual que en la secuencia. Arrancan donde las curvas dejaron la 25 (gravedad 0, cohesión 0,62, viscosidad 1, luz 1, exposición 1,2), salvo `bodies` (0,15). `fluids.gain` sigue por encima de todo.

---

## 4. Controles (todo mapeable por MIDI/OSC desde el editor)

| Acción / param | Qué hace | Mapeo por defecto (sólo en la 26, `mappings.default.json` v13) |
|---|---|---|
| `fluids.seq.pulse` | flash ×1,8 + `burst` desde el centro de masa (cada cuarto kick, contracción); **todas las losetas dan su paso** por su eje; cada cuatro kicks se sortea si las blancas emiten | Ch1 n0 (deep dark kick) — también es `mainAction` (barra espaciadora) |
| `fluids.seq.step` | otro paso de todas las losetas, **cruzado** (por el eje perpendicular) | Ch1 n2 (el segundo kick, en el contratiempo) |
| `fluids.seq.strobe` | relámpago: sortea cuántas (1 a 3) y cuáles losetas chicas emiten, y las hace destellar | Ch1 n2 (el segundo kick) |
| `fluids.seq.tile` | loseta nueva (50 cm o 1 m según la serie), negra hasta que el sorteo la elija | Ch1 n4 (808) |
| `fluids.seq.tileBig` | loseta de 1 m | Ch2 n40 (bowl ride) |
| `fluids.seq.sweep` | la banda que invierte la iluminación cruza la pared en 0,8 s, sentido alternado | Ch2 n38 (alarm keypad) |
| `fluids.seq.crack` | fractura en el centro de masa | Ch2 n39 y n49 |
| `fluids.seq.dark` | apagón 0,3 s | Ch2 n47 (waaaeey) |
| `fluids.seq.freeze` | stutter: congela todo el fluido `tileLife` negras y lo suelta; las losetas también se detienen | Ch2 n45 (sci-fi button) |
| `fluids.seq.flip` | otro sorteo de lámparas, sin destello | Ch2 n38 (junto con el barrido) |
| `fluids.seq.amb` (0..1) | compuerta de amb 1 → glow azul con ataque y decay | Ch11 cualquier nota, modo gate (pista AMB1) |
| `fluids.seq.attract` (0..1) | compuerta del atractor: mientras hay nota, un atractor (atracción / remolino alternados) tira del fluido | Ch3 cualquier nota, modo gate (pista atractor) |
| `fluids.seq.clear` | borra todas las losetas (unlock incluido) y la cuenta | — |
| `fluids.seq.reset` | vacía el fluido | — |
| `fluids.seq.tileLife` (0,25..32 negras, 4) | unidad de vida de las losetas y del stutter; crece sola con la cuenta | CC libre |
| `fluids.seq.grid` (0..1, 0) | por encima de 0,5 todas las losetas nuevas son de 50 cm | CC libre |
| `fluids.seq.mono` (0..1, 1) | cuánto se va al monocromo (1 = Ikeda pleno) | arranca en 1 al entrar |
| `fluids.seq.gravity / cohesion / viscosity / light / exposure / bodies` | curvas del documento, pisadas por el fader | CCs libres |

Todos los `fluids.seq.*` son **estado vivo** (`sceneReset: false`): al entrar se cargan con lo que las curvas valen en ese instante, no con un preset. La escena 26 en `scenes/index.js` no lista params: sólo el `mainAction`. Mapeos en `mappings.default.json` **v16**.

---

## 5. Trampas que aplican (y las que aparecieron)

- **Los faders llegan al runtime en el frame siguiente.** `RadianceController.frame()` junta los `fluids.seq.*` y los pasa con el frame; una acción disparada en el mismo tick que un `params.set` todavía ve el valor anterior. Le pasó a la prueba del stutter (fijaba `tileLife` 1 y disparaba en la misma evaluación: el congelado duró 4 negras).
- **En el motor la luz sube con la velocidad.** Una masa grande y quieta se lee apagada. Por eso las losetas **mueven** el fluido (repel/unlock) además de iluminarlo, y por eso el kick se ve: lo que se mueve se enciende.
- **El primer kick abre la masa compacta del cierre en un anillo.** Es lo que se quiere (la entrada de la 26 es ese estallido), pero si un día la 26 tiene que entrar "quieta", el pulso no puede estar mapeado al kick en los primeros compases.
- **El colisionador rectangular del WASM toma dos esquinas.** `_pvfs_collide_particles_rect(sim, x0, y0, x1, y1)`: existía en el módulo pero el worker sólo cableaba el círculo. Se probaron las tres lecturas posibles de los cuatro números (centro + medios lados, centro + lados, esquinas) sobre una masa de 2 900 partículas: sólo la de esquinas vacía el cuadrado. Ahora el worker tiene el modo `collide-rect` (`hw`/`hh` en fracción del alto, el runtime los pasa a px).
- **Un obstáculo que aparece entero sobre la masa es una bomba.** El solver proyecta afuera en un subpaso todo lo que encuentra adentro: 3 500 partículas expulsadas de golpe y la masa entera se va a las paredes en 2 s. El obstáculo crece en 0,4 s (`TILE_GROW`); el cuadrado dibujado aparece de golpe igual.
- **El obstáculo deja cicatrices.** Aprieta las partículas contra su borde en una línea de un punto de grosor y, con la viscosidad del cierre, al morir la loseta la línea se queda. El `repel` de liberación al morir las desarma.
- **Un obstáculo que se mueve sobre partículas trabadas no las mueve.** El `lock` del stutter gana al colisionador: la loseta pasa por encima y al soltar el rectángulo expulsa todo lo que quedó adentro de golpe. Por eso el reloj de las losetas (`tileClock`) se detiene con el fluido.
- **Las posiciones que ve la página están interpoladas** entre dos fotos del solver: una loseta en marcha parece tener algunas partículas adentro en el borde delantero aunque el solver ya las haya sacado. Medir "adentro" con margen y con las losetas quietas.
- **El cliente del worker tiraba interacciones a partir de 32 por frame.** Con 48 losetas más los 13 círculos de la línea eso dejaba losetas viejas sin chocar sin aviso. Tope en 128.
- **La emisión de una loseta va por área.** Una de 2 m a la misma emisión que una de 1 m tira cuatro veces la luz y dejó la pared entera blanca (ensayo, t = 16 s). La emisión se normaliza al tamaño (luz de una de 1 m a 0,4) con techo 1,0 para que una de 50 cm no sea un sol. La máscara blanca mantiene el cuadrado nítido aunque alumbre poco.
- **Al mirar capturas con el contratiempo sonando, un cuarto son de destello.** Antes de bajar la luz de las lámparas por una captura clara, mirar `telemetry().flash`.
- **La emisión de una partícula pasa por la compuerta de velocidad del shader.** Una partícula quieta emite al 12 % aunque su material tenga la lámpara al máximo: para que algo se prenda parado hay que sacarle la compuerta (`uNextSteady`, sólo para el material secundario reactivo).
- **Apagar las blancas cambiando el material de la lámpara principal** se probó y se descartó: un cambio de material principal funde, y mientras funde el render suspende la lámpara secundaria (el glow parpadeaba; `instantEmissionRole` lo evitaba pero las blancas quedaban muertas del todo). Ahora se apagan bajando a 0 el piso de la emisión por velocidad: quietas negras, en movimiento encendidas.
- **Que dos losetas terminen en celdas distintas no alcanza para que no se solapen.** Si se cruzan, a mitad del deslizamiento están una encima de la otra. Hay que comparar **cajas barridas** (origen ∪ destino), y volver a mirarlas cuando llega un golpe con un deslizamiento todavía en curso.
- **Una barra negra no se puede invertir.** El barrido tapaba la luz, así que debajo no quedaba imagen que dar vuelta: la inversión de una franja negra es una franja blanca lisa. La banda no dibuja nada y sólo invierte.
- **Un `attractor` inyectado en vivo se estira por delante**: el director lo apaga con `fade` en los últimos 0,3 s de su `dur`, así que mientras la nota está apretada hay que correr `dur` medio segundo por delante en cada frame, y al soltar dejarlo terminar 0,3 s después.
- **Un cuadrado negro sobre negro no existe.** El marco blanco de 4 px (`top: true`, dibujo puro) es lo que lo hace leer.
- **Los eventos inyectados usan `id` único** (`createId`) porque `fracture` usa `event.t` como semilla y `emit-burst` acumula por id. Se podan cada 300 frames los ya vencidos (menos `set-material`/`set-lamp`/`reset-fluid`/`fracture`, que dejan estado).
- **Un `set` cancela el tween en curso** y **un param huérfano es fuga global**: los `fluids.seq.*` son `sceneReset: false` a propósito (estado vivo), así que no aplican al `BASE`.

---

## 6. Cómo se verificó

1. `node tools/check-radiance.mjs`: 8 comprobaciones, incluida la de la 26: hereda las partículas de la 25 (±200), la sesión queda pausada, los faders arrancan en los valores del documento (viscosidad 1, cohesión 0,62, `bodies` 0,15), `sequelTime` sigue de largo de 152,6 s, dos 808 → 2 losetas, el kick deja eventos activos, el sci-fi button congela y se suelta solo, mover gravedad no toca el documento guardado, el solver sigue avanzando, y la vuelta a la escena 1 limpia. 481 frames a 60 FPS.
2. Ensayos con el patrón de JEJE FLUID simulado a 140 BPM dentro de la página (`tools/tmp-seq.mjs`, borrado): capturas a 5/12/20/30 s (ensayos 1 y 2) y 5/30/60/95 s (ensayo 3). Se conservan las del ensayo 3 y las del kick en `radiance-check/seq/`.
3. Medición de dinámica (`tools/tmp-dyn.mjs`, borrado): desplazamiento medio de las partículas en 350 ms, con y sin kick, para cuatro viscosidades (tabla en NOTAS).
4. Luz: comparación original/integración con el documento real forzado por CDP, primeros 8 s (herramientas temporales borradas; conclusión en §0).
5. Obstáculos: prueba de las tres lecturas del colisionador y del crecimiento sobre el peor caso (masa compacta del cierre) y sobre la condición real de la 26; ensayo de 90 s midiendo por loseta las partículas adentro (0 en todas las que pasaron los 0,4 s), las pegadas al borde del dominio y las interacciones por frame (19 con 10 losetas). Capturas en `radiance-check/seq/obstaculos2/`.

---

## 7. Estado

- [x] §0 Luz: cerrado. La integración es fiel; el "original más brillante" era el documento vacío. El hack de población se probó y se revirtió.
- [x] §1 Modo `sequel`: la 26 hereda solver, director, doc clonado y reloj; la sesión queda pausada.
- [x] §4 Acciones y params `fluids.seq.*` + mapeos por defecto filtrados a la 26 (`mappings.default.json` v13).
- [x] §3 Losetas como obstáculos rectangulares (`collide-rect`, crecen en 0,4 s, sueltan al morir), que **se deslizan una celda por 808 y rebotan**, vida con techo ×4, grilla por cuenta de colocadas, flip, monocromo, strobe en serie alternando orientación, stutter que detiene también las losetas, respiración del kick (3 afuera, 1 adentro), lámpara sobre el material dominante, `bodies` 0,15.
- [x] Glow azul de amb 1: pista AMB1 en Ableton (canal 11), compuerta `fluids.seq.amb` con cuenta de notas sostenidas, ataque 2,5 s / caída 0,8 s sobre el material secundario, que emite **quieto** (uniform `uNextSteady` del render: la compuerta de velocidad lo dejaba al 12 % y "se veían azules pero no encendidos").
- [x] Lámparas sorteadas (1 a 3, sólo de 50 cm; relámpago en el contratiempo con destello ×2 de 120 ms), bloques negros sin marco, tamaños 50 cm / 1 m mezclados desde el principio (sin 2 m), emisión normalizada por área, blancas apagadas por compás al azar.
- [x] Movimiento mecánico: paso con cada kick, deslizamiento lineal a 0,18 s por celda, pistones que buscan el centro de masa y patrullas que rebotan.
- [x] Glow: ataque 0,7 s con vibración de 11 Hz, release lineal de 0,5 s, +40 % de potencia (`mix` 0,85 × ganancia parada 1,15).
- [x] Losetas que no se pisan (celda libre al nacer, rebote o espera al moverse); luz que late (pulso de kick, relámpago ×2,5, intensidad propia por lámpara); blancas que emiten sólo en movimiento cuando están "apagadas"; emisión por velocidad 5,5 / 2,6.
- [x] Atractor del canal 3 (`fluids.seq.attract`, gate): atracción y remolino alternados mientras la nota está apretada.
- [x] Losetas que se esquivan (caja barrida, cuatro rumbos por orden, una carrera por vez): cero solapes medidos a 40 Hz durante 35 s con hasta 11 losetas.
- [x] Barrido que invierte la iluminación (blanco ↔ negro, azul → rojo) en el paso de grade del render.
- [x] Los **dos** kicks del rack mueven las losetas (negra por el eje propio, contratiempo cruzado): corcheas en vez de negras.
- [x] Glow del mínimo (0,2 de lámpara, siempre) al doble de potencia (0,85 de lámpara × 2,3 de ganancia parada), con release de 1 s al mínimo.
- [x] Nota 26 en el track "scene" de Ableton (slot JEJE FLUID), clip "26".
- [x] §6 Verificación con capturas, medición de dinámica y `check-radiance`.
- [ ] Afinar con la música real en la pared: emisión de las lámparas, vida por defecto, y si el pulso va al kick o al 808. Es de Manuel.
