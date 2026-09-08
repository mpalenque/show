# Visuales LED

Visuales en tiempo real (WebGPU / three.js + TSL) para la pantalla LED de 8 × 3 m
(**2688 × 1008 px**). Controlado por MIDI desde Ableton y por OSC.
Primera lectura para continuar el proyecto: [contexto vigente](docs/CONTEXTO-ACTUAL.md), [sistemas](docs/ARQUITECTURA-Y-SISTEMAS.md) y [configuración](docs/CONFIGURACION.md). El plan histórico está en `../../PLAN.md`; las decisiones anteriores, en `NOTAS.md`.

**Fluids, decisión vigente:** **24 = previa negra con sólo una línea blanca**, timeline detenido en cero y física vacía/preparada; **25 = PLAY del timeline completo desde cero**; **26 = el FINAL de la 25: el mismo fluido sigue y reacciona a las notas de JEJE FLUID (canales 1 y 2) y a los faders `fluids.seq.*`, con losetas blancas y negras sobre la grilla de 1 m**. Notas **24/25/26 del canal 10**, sin reiniciar por notas repetidas; entrar desactiva loops de ensayo. **El audio del show lo reproduce la página** (con el track por Ableton los dos relojes se separaban): silenciar esa pista en Ableton y **hacer un clic en la ventana de salida** antes del show, que es lo que Chrome pide para dejar sonar. Al terminar la secuencia el fluido **sigue corriendo**. **27–29 libres**. [Operación actual](docs/integracion-radiance/OPERACION.md).

Para instalar desde los lockfiles, ejecutar **`npm ci`**: su `postinstall` prepara también las dependencias aisladas de Radiance. El timeline está en **`http://localhost:5173/fluids.html`**, el editor normal en **`/editor.html`** y la salida en **`/`** (ventana `vis-salida`). El reloj de la secuencia se ancla al track que reproduce la salida, así que imagen y música no se despegan; `fluids.audioMode` en `external` vuelve a dejar el audio en Ableton para ensayar. [Plan original de Fluids preservado](docs/origen-radiance/INDICE.md).

Flujo, editor, 217 tests, TypeScript y build aprobados. Las pruebas de rendimiento variaron entre una corrida con caídas y su repetición a ~60 FPS; no se garantiza un mínimo permanente. [Resultados actuales y límites](docs/integracion-radiance/VALIDACION-CUES-24-25.md).

---

## 1. Preparar la máquina (una sola vez)

1. **Chrome** actualizado (≥ 113, con WebGPU). Node 24 ya instalado.
2. Usar la salida en modo nativo: el canvas conserva **2688×1008 píxeles físicos** y compensa el DPR por CSS. Comprobar el encuadre en la pantalla LED.
3. Conservar el puerto MIDI utilizado por el set. El documentado es **RTX3090 (Port 2)**; si se crea un puerto loopMIDI nuevo, elegir ese mismo puerto en Ableton y habilitarlo en el editor.
4. En **Ableton**: Preferencias → Link/Tempo/MIDI → activar *Track* en la salida que llega a Visuales. Las notas de escena usan **canal 10**.
5. `npm ci` dentro de esta carpeta.

Configuración de escenas vigente; los demás canales conservan sus mapeos del set:

| Canal | Para qué |
|---|---|
| 10 | Escenas (`scene.goto`); nota 24 previa, nota 25 PLAY |
| Los demás | Según `public/mappings.default.json` y los mapeos aprendidos; ver el monitor y Learn |

---

## 2. Arrancar

```
npm start          # servidor de desarrollo + bridge OSC juntos
```

o por separado:

```
npm run dev        # http://localhost:5173
npm run osc        # bridge OSC (UDP 9000 → WebSocket 8081)
```

Para el show conviene el build, que es más estable que el server de desarrollo:

```
npm run build
npm run preview -- --port 5173
```

Después, `tools/launch-show.bat` abre las dos ventanas: la **salida** en kiosk sobre la LED y el
**editor** en el monitor. Antes de usarlo, ajustar `POS_X` dentro del `.bat` a la coordenada X
donde arranca la LED en el escritorio extendido.

- **Salida**: `http://localhost:5173/` — solo el canvas, sin ninguna UI encima.
- **Editor**: `http://localhost:5173/editor.html` — va en la otra pantalla.
- **Timeline Fluids**: `http://localhost:5173/fluids.html` — previa 24, PLAY 25, curvas, eventos y gestos.

El editor refleja la salida: si no está abierta la ventana de salida, avisa y espera.

---

## 3. El editor

Tres columnas:

1. **Escenas** — un botón por escena (la actual queda resaltada), tiempo de transición,
   entradas MIDI con checkbox, estado del bridge OSC con **puerto UDP editable**, y stats
   (fps, ms totales, ms de simulación y de render, partículas, aviso si `dpr ≠ 1`).
2. **Parámetros** — todos los controles agrupados, y debajo una **lista de referencia**
   filtrable con el `id` de cada parámetro, su rango, su **dirección OSC** (click para copiar)
   y la fuente MIDI/OSC que lo controla hoy.
3. **Mapeos** — la tabla fuente → destino, con **Learn**, monitor de los últimos mensajes y un
   panel para **probar** sin Ableton. Botones para guardar, exportar/importar JSON, restaurar el
   default y **exportar la hoja de referencia** (`.md` y `.csv`).

### Mapear una nota

1. "+ mapeo" → elegir el destino en la lista (por ejemplo `scene.goto`, con arg `7`).
2. Click en **Learn** (la fila parpadea) y tocar la nota en Ableton.
3. **Guardar**. Los mapeos quedan en el navegador; para que viajen con el proyecto,
   **Exportar JSON** y copiar el archivo a `public/mappings.default.json`.

Modos de mapeo: `trigger` (dispara), `toggle` (invierte), `gate` (mientras está apretada),
`velocity` (según la fuerza), `set` (fija un valor) y `range` (CC / OSC continuo).
Una misma nota puede ir a varios destinos, y un mapeo puede limitarse a ciertas escenas.

---

## 4. OSC

El bridge (`npm run osc`) escucha UDP en el **9000** y lo reenvía al navegador.
El puerto se cambia en vivo desde el editor.

Sin mapear nada funcionan estas direcciones:

| Dirección | Efecto |
|---|---|
| `/p/<grupo>/<nombre>` f | fija el valor en su rango nativo |
| `/pn/<grupo>/<nombre>` f (0..1) | fija el valor normalizado |
| `/a/<grupo>/<nombre>` [arg] | dispara una acción |
| `/scene` s\|i | cambia de escena |

La lista completa de nombres está en **`REFERENCIA-MIDI-OSC.md`** (y `.csv`), que se regenera
con `node tools/gen-reference.mjs` o desde el botón del editor.

### Las notas que disparan escenas

**Escena N = nota N del canal 10.** La escena 1 es la nota 1 y no la 0: la más grave queda
libre a propósito. Van del 1 al 29, corridas y sin huecos, igual que los ids de las escenas.

Del lado de Ableton eso sale del canal **`scene`** (pista 31 del set), cuya salida va a
**RTX3090 (Port 2), Ch. 10**. Cada clip de esa pista lleva cuatro notas cortas seguidas de su
altura —repetidas por seguridad, para que el disparo no se pierda— y el nombre del clip es el
número de escena. Si hay varios clips con el mismo nombre, los cuatro llevan la misma nota.

Los mapeos ya vienen hechos en `public/mappings.default.json`. Al arrancar, el sistema conserva
lo aprendido a mano y agrega o corrige automáticamente las filas nuevas. **«Restaurar mapeos por
defecto»** reemplaza la configuración completa y ahora también la guarda para los próximos
arranques.

Y una nota que vuelve a llegar para la escena que ya está en pantalla **no la vuelve a
disparar**: solo se cambia cuando llega la nota de otra escena. Está pensado para que un doble
disparo, o un clip que loopea, no reinicie la escena en el medio.

### Foley 2 y los offsets de grilla

La pista MIDI **`foley2`** (pista 40 del set) sale por **RTX3090 (Port 2), Ch. 6**. Cualquier
nota de ese canal dispara `grid.nudgeRandom` solamente en las escenas **3, 4, 5 y 6**. Cada
golpe elige al azar una parte de los bloques visibles y desplaza cada elegido en X o en Y; nunca
mueve toda la grilla de la misma manera.

### DRUM y la fila FULL

El `deep dark kick` de **DRUM** sale como nota 0 por el canal 1. En las escenas 3–9 arma una
combinación aleatoria nueva de bloques de grilla visibles: siempre deja alguno prendido y alguno
apagado, y no repite el dibujo anterior.

La fila `full beat` aporta el resto del reparto, usando notas distintas para que los eventos no
salgan todos juntos:

| Fuente | Acción | Escenas |
|---|---|---|
| PERC, ch2 nota 41 | offset aleatorio de grilla | 3–9 |
| BASS, ch4 nota 33 | línea en posición aleatoria | 2–6 y 9 |
| BASS, ch4 nota 24 | bloque azul sólido | 6 y 8 |
| PAD, ch8 nota 48 | barrido azul | 6 y 8 |
| PAD, ch8 nota 51 | barrido blanco | 6 y 8 |

### PERC y la dirección de la línea

El pad `creepy bell (g)` de **PERC** es la nota 36 y sale por el canal 2. Cada Note On de esa
nota invierte la dirección de la línea móvil, únicamente mientras está activa la escena 2.

### SUB y los barridos desde la escena 5

Desde la escena 5 hasta la 9 los tres efectos tienen notas distintas, para conservar la variedad
rítmica del set:

| Fuente | Acción |
|---|---|
| SUB `PRENDO CARA`, ch7 nota 36 | medio bloque azul sólido; entra en 0.6 s |
| PERC, ch2 nota 44 | barrido azul con gradiente |
| PERC, ch2 nota 39 | barrido blanco con gradiente |

Cada evento elige un bloque al azar sin repetir el anterior. Fuera de las escenas 5–9 estas notas
no disparan esos barridos.

### DRUM, rayos y color de la escena 23

El `deep dark kick` de **DRUM** es la nota 0 del canal 1. Dispara un rayo aleatorio en las escenas
16–23; por lo tanto sigue funcionando desde la 19 hasta `A punto de explotar`. En la escena 23 el
mismo Note On también intercambia instantáneamente —sin fade— el color de los palitos entre rojo
y azul. En un 40% de los golpes también vuelve negra una selección nueva de aproximadamente la
mitad de los palitos; el resto conserva el rojo o azul de ese golpe. El Note Off no dispara
ninguna de estas acciones.

En la escena 21 el torbellino tiene un radio reducido de 1.8 m y el blanco por velocidad está
desactivado. Cada Note On del mismo kick alterna instantáneamente su eje entre Y y X; al volver a
entrar en la escena arranca nuevamente en Y.

---

## 5. Atajos en la ventana de salida (desarrollo)

| Tecla | Qué hace |
|---|---|
| `,` `.` | escena anterior / siguiente |
| `1`..`9` | ir a las primeras 9 escenas |
| `Espacio` | acción principal de la escena actual |
| `F` | overlay de fps |
| `E` | abrir el editor |
| `L` | invertir la línea · `R` rayo · `G` grillas · `W` pulso de la placa · `B` aristas de la caja |

En emergencia: `master.blackout` desde el editor apaga la salida.

---

## 6. Escenas

Los ids son los números del storyboard. `1b`, `2b`, `6b` y `6c` **no** son escenas: son acciones
dentro de su escena (`warning.bgOff`, `line.flip`, `sweep.white`, `sweep.solid`).
Las escenas 8 y 9 todavía no están definidas y por ahora repiten la 7.

### Agregar una escena

1. Agregar una entrada en `src/scenes/index.js` con `id`, `params` y `actions`.
2. Si necesita un elemento nuevo: crear `src/layers2d/` o `layers3d/NuevoElemento.js` con
   `static defineParams(params)` y `update(dt, t)`, registrarlo en el array `ELEMENTS` de su capa
   y agregar sus valores apagados a `src/scenes/base.js`.
3. Mapear su nota con Learn en el editor.

Regla que sostiene todo esto: **los elementos visuales no saben de MIDI, OSC ni escenas**.
Solo leen `Params` cada frame. Escenas y mapeos únicamente escriben en `Params`.

---

## 7. Calidad y rendimiento

`master.quality` en el editor cambia entre presets y se recuerda por máquina:

| Preset | Partículas | Bloom |
|---|---|---|
| `ultra` | 262 144 | sí |
| `high` (default) | 131 072 | sí |
| `medium` | 65 536 | sí |
| `low` | 32 768 | no |

Las cantidades bajaron a la mitad de las originales cuando los palitos se hicieron ~2.7× más
largos y ~1.7× más gruesos: con las de antes la caja se tapaba sola y volvía a verse como un
bloque plano. Menos y más grandes = se ve el palito, la oclusión y el rumbo.

Medido en la RTX 3090 del show, a 2688 × 1008 con bloom y sin vsync:
**262 144 partículas → 4.1 ms por frame (244 fps)**; **524 288 → 7.9 ms (127 fps)**.
O sea que hasta el preset `ultra` sobra margen para 60 fps.

**La ventana de la LED tiene que estar en primer plano.** Si Chrome la tapa o la minimiza, frena
`requestAnimationFrame`; hay una red de contención que mantiene el loop a ~4 fps, pero no
reemplaza tener la ventana al frente.

---

## 8. Herramientas de verificación (`tools/`)

Todas abren Chrome headless con WebGPU y no necesitan tocar el navegador a mano.
Requieren `npm run dev` corriendo.

| Comando | Para qué |
|---|---|
| `node tools/walk-scenes.mjs [carpeta]` | recorre las 29 escenas, dispara su acción principal y reporta fps/ms/errores |
| `node tools/shoot-scenes.mjs <carpeta>` | captura a 2688 × 1008 nativo para comparar con el storyboard |
| `node tools/smoke.mjs <url> <png> <seg> "<expr>"` | abre una página, evalúa una expresión y saca screenshot |
| `node tools/smoke-io.mjs` | prueba MIDI/OSC/mapper/editor de punta a punta |
| `node tools/gen-reference.mjs` | regenera `REFERENCIA-MIDI-OSC.md` y `.csv` |

---

## 9. OneDrive

Este sub-proyecto vive dentro de `particlesvideo/`, que está sincronizado por OneDrive.
`node_modules/` está en `.gitignore`; si el sync molesta o hace lento el `npm install`,
marcar `visuales/node_modules` como "Liberar espacio" o excluirla del sync.
