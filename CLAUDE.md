# Visuales LED — cómo funciona el sistema y cómo trabajamos

**Entrada vigente para cualquier chat: [CONTEXTO.md](CONTEXTO.md) → [contexto canónico versionado](particlesvideo/visuales/docs/CONTEXTO-ACTUAL.md).** Leerlo antes de este resumen o de planes anteriores. La decisión más reciente de Manuel siempre prevalece.

**Decisión actual de Fluids, 2026-09-06:** 24 = previa negra con sólo línea blanca, timeline en cero detenido y población vacía; 25 = PLAY de la secuencia completa desde cero; 26 = el motor libre, controlado por MIDI con `fluids.live.*`. **El audio del show lo reproduce la página** (por Ableton los dos relojes se separaban); Ableton manda sólo las notas. Al terminar la secuencia el fluido **sigue corriendo**. Fluids renderiza con supersampling 2×, que es lo que saca el rayado del campo de radiancia. Notas 24/25/26 del canal 10, sin reinicio por notas repetidas; 27–29 libres. [Sistemas](particlesvideo/visuales/docs/ARQUITECTURA-Y-SISTEMAS.md) · [Configuración](particlesvideo/visuales/docs/CONFIGURACION.md) · [Plan original Fluids preservado](particlesvideo/visuales/docs/origen-radiance/INDICE.md).

Las secciones siguientes conservan el resumen histórico de Parte 1. Su diagrama de un solo motor no describe por sí solo la integración actual. Las métricas históricas no equivalen a una prueba nueva del flujo 24 previa / 25 PLAY.

Este archivo lo lee Claude Code solo al abrir un chat desde `PARTE 1`. Es el punto de entrada:
qué es el proyecto, cómo está armado, con qué reglas se toca y cómo trabajamos Manuel y yo.

**No repite** lo que ya está escrito en otro lado. Cuando algo tiene su propio documento, acá va
el puntero y no la copia.

---

## 1. Qué es esto

Visuales en tiempo real para una **pantalla LED de 8 × 3 m (2688 × 1008 px)**, corriendo en
Chrome con **WebGPU** (three.js + TSL), controladas en vivo por **MIDI desde Ableton** y por
**OSC**. El registro tiene **29 IDs**: Parte 1 ocupa 1–23, Fluids usa 24 para previa, 25 para PLAY y 26 para el motor libre, y 27–29 permanecen libres.

El corazón visual son los "palitos": un fluido **MLS-MPM** de ~131 000 partículas simulado en
GPU, que se dibujan como palitos alargados orientados según hacia dónde van.

La cámara **no** es una cámara de 3D normal: es una proyección **off-axis** que trata la pantalla
como una ventana, con el espectador parado a 4 m y a 1 m de altura. Por eso el volumen se lee
como si estuviera detrás de la pared y no como un render en perspectiva.

| Dato | Valor |
|---|---|
| Pantalla | 8 × 3 m · 2688 × 1008 px · borde inferior al piso |
| Bloques lógicos | 5 franjas verticales (el storyboard tenía 6) |
| Ojo (cámara) | x 0, y 1 m, z 4 m |
| Dominio de simulación | x −5.5..5.5, y −0.5..7, z −5.5..0.5, celda 0.1 m |
| GPU del show | RTX 3090 · objetivo ≥ 60 fps |

Ojo con dos cosas que engañan siempre:

- **El dominio es más ancho que la pantalla** (11 m contra 8) para que las cajas puedan irse a
  los costados sin pelearse con la pared del escenario.
- **En perspectiva la pantalla se abre con la profundidad.** A 1.8 m de fondo el cuadro ya
  abarca ±5.8 m, no ±4. Cualquier cosa que tenga que "llenar la pantalla" a cierta profundidad
  necesita ser bastante más ancha que 8 m.

---

## 2. Dónde está cada cosa

Proyecto: **`particlesvideo/visuales/`** (sub-proyecto dentro del repo `particlesvideo`, que es
un fork de holtsetio/flow). Rama `visuales`. Está en OneDrive.

| Documento | Para qué |
|---|---|
| `particlesvideo/visuales/docs/CONTEXTO-ACTUAL.md` | **Primera lectura:** decisiones vigentes y estado de validación. |
| `particlesvideo/visuales/docs/ARQUITECTURA-Y-SISTEMAS.md` | Entradas de código, motores, Output, editores, MIDI y OSC. |
| `particlesvideo/visuales/docs/CONFIGURACION.md` | Configuración operativa, rutas, notas y claves persistidas. |
| `particlesvideo/visuales/docs/origen-radiance/INDICE.md` | Plan original de Fluids y documentación preservada con hashes. |
| `particlesvideo/visuales/README.md` | **Operación**: instalar, arrancar, el editor, OSC, atajos, herramientas. Es el manual de uso. |
| `particlesvideo/visuales/NOTAS.md` | **Bitácora**: cada vuelta de cambios, qué se probó, qué se descartó y por qué. Crece hacia abajo. Es la memoria del proyecto. |
| `PLAN.md` | El plan original completo (arquitectura, specs de cada elemento, registro de params, fases). Histórico pero sigue siendo la referencia de diseño. |
| `PLAN-ESCENAS-14-15.md` | Registro del primer rehacer de las escenas 14 y 15 (quedó viejo: ver la décima vuelta de `NOTAS.md`). |
| `particlesvideo/visuales/REFERENCIA-MIDI-OSC.md` / `.csv` | Todos los params con su rango y su dirección OSC. **Se genera**, no se edita a mano. |
| `STORYBOARD/*.png` | Los cuadros de referencia del show. |

Código:

```
visuales/src/
  main.js              arranque: crea todo, en orden, y lo cablea
  config/stage.js      medidas físicas, cámara, dominio, presets de caja
  core/
    Params.js          EL REGISTRO. Todo lo controlable vive acá
    SceneManager.js    escenas: aplica presets y dispara acciones
    Engine.js          el loop: fija el orden del frame
    Settings.js        ajustes del editor que sobreviven la recarga
    Tween.js  Keyboard.js  SceneBar.js
  scenes/
    index.js           LAS 29 ESCENAS. Son datos, no código
    base.js            "todo apagado": el valor de reposo de cada param
  layers2d/            Layer2D + WarningPlate, GridBlocks, Sweeps, Frame, MovingLine
  layers3d/            Layer3D + Lights, Floor, BoxWire, RedBlock, Orb, Debris, Rays
    particles/         MlsMpmSimulator (kernels GPU), Forces, StickRenderer, noise
  render/              Renderer, OffAxisCamera, Compositor (bloom + GTAO + composición)
  io/                  MidiInput, OscClient, Mapper, Bridge
  editor/              la ventana de mapeo (editor.html)
tools/                 scripts de verificación headless (ver §7)
```

---

## 3. La regla que sostiene todo

> **Los elementos visuales no saben de MIDI, de OSC ni de escenas. Solo leen `Params` cada
> frame. Las escenas y los mapeos solo escriben en `Params`.**

`Params` es un registro central: cada cosa controlable se declara con `params.define(...)` (o
`defineAction` si se dispara en vez de tener valor) y queda con un `id` tipo `grupo.nombre`, un
rango y un default. De ahí salen solos el panel del editor, la dirección OSC y la hoja de
referencia.

El flujo es siempre en una dirección:

```
Ableton (MIDI) ─┐
                ├─→ Mapper ─→ Params ─→ elementos (leen y dibujan)
OSC (UDP 9000) ─┘              ↑
                     SceneManager (presets + acciones)
```

Consecuencia práctica: **para agregar comportamiento nuevo casi nunca hace falta tocar el
cableado**. Se define un param, el elemento lo lee, y ya es mapeable por MIDI/OSC y usable por
cualquier escena.

### Orden del frame (`Engine._tick`)

```
params.update(dt)        ← primero los tweens
scenes.update(dt)
layer2d.update(dt, t)
layer3d.update(dt, t)    ← acá los elementos publican fuerzas al simulador
sim.update(dt)           ← kernels GPU del MLS-MPM
compositor.render()
```

Ese orden importa: si un elemento escribe un param *después* de `params.update`, el valor recién
se ve al frame siguiente.

---

## 4. Las escenas son datos

Cada entrada de `src/scenes/index.js` es:

```js
{
  id: '14', name: 'Cardumen azul', transition: 2.0,
  params: { ... },        // el preset: qué valores toma la escena
  transitions: { ... },   // opcional: tiempo propio para algunos params
  actions: [[...]],       // se disparan AL ENTRAR
  mainAction: '...',      // lo que dispara la barra espaciadora
}
```

Cuatro cosas que hay que tener presentes siempre:

1. **`BASE` es "todo apagado".** Un param con `sceneReset: true` que la escena NO lista vuelve a
   su valor en `base.js`, o a su default. Por eso una escena que necesita algo tiene que
   listarlo, aunque coincida con el default.
2. **`sceneReset: false` = estado vivo**, no lo toca el cambio de escena (cámara, master,
   calidad, `box.x`).
3. **`transitions` da tiempo propio por param.** Con `0` el fundido se vuelve un set inmediato.
   Es lo que usa `COLOR_RAPIDO`: el color de las partículas corta en 0.15 s mientras el resto de
   la escena entra en su tiempo.
4. **Las acciones se disparan inmediatamente**, mientras los params recién empiezan a fundirse
   (ver la trampa en §5).

---

## 5. Trampas conocidas (leer antes de tocar escenas o partículas)

Todas se pagaron una vez. Están documentadas largo en `NOTAS.md`; acá va el resumen.

### Del motor

- **Una acción de entrada corre con los valores de la escena ANTERIOR.** `SceneManager.goto`
  funde los params y dispara las `actions` enseguida, así que un `resetInBox` al entrar usa la
  caja vieja. Si una acción depende de un param, ese param necesita transición `0` en el
  `transitions` de la escena. Hoy ninguna escena está en ese caso, pero la trampa sigue viva.
- **Un `set` cancela el tween en curso.** Por eso un integrador que escribe un param todos los
  frames (como el giro continuo de la caja) puede comerse el valor que pidió la escena.
- **Param huérfano = fuga global.** Si un param no lo lista ninguna escena ni el `BASE`, queda
  fuera de `SceneManager.ownedParams` y entonces moverlo desde el editor le pisa el **valor de
  fábrica a todas las escenas**, sobreviviendo a la recarga. Al sacar un elemento de una escena,
  sus params van al `BASE`.

### De las partículas

- **El umbral de blanco tiene jitter.** `particles.whiteJitter` (0.7 por defecto) corre el umbral
  de cada partícula hasta ±35 % del span. Bajar `whiteSpeedMin` "porque va lento" es el error
  clásico: el umbral efectivo queda por debajo del régimen y el color se lava a blanco.
- **Flujo constante sin rozamiento = velocidad sin techo = todo blanco.** Cualquier escena con
  `flowX/Y/Z` lleva `particles.drag` > 0.
- **Lo que aprieta una masa es la DENSIDAD, no el torbellino.** La presión va con la densidad a
  la quinta: subir `particles.density` es lo único que hace que los mismos palitos ocupen menos
  lugar. Con la densidad de fábrica no hay vórtice que forme una columna.
- **`vortex.radius` es ALCANCE, no grosor.** Es la distancia a la que la fuerza cae a la mitad.
  Para que un vórtice junte masa lejana, el radio va **grande**.
- **Subir el giro ENSANCHA.** La fuerza centrífuga le gana a la atracción y escupe los palitos
  para afuera. Para afinar hay que subir `pull`, no `swirl`.
- **`vortex.lift` NO.** Probado varias veces: el ascenso es una fuerza en un solo sentido, nada
  la devuelve, y en 6-14 s el cuadro queda vacío de la mitad para abajo.
- **La caja se dimensiona como la MASA que se quiere ver, no como el recorrido.** El fluido no
  tiene tensión superficial: se reparte por todo el volumen que le den, así que la silueta que se
  ve en pantalla es la de la caja. Una caja de 4.6 m llena el cuadro de niebla azul plana.
- **Un torbellino de eje vertical NO se ve girar.** Gira en planta; desde la butaca se lee como
  una masa que se junta. Para que el giro se vea hay que poner `vortex.axis: 'z'` (eje
  horizontal, la rueda de las escenas 14 y 15).
- **Un degradado suave no se lee: el ojo necesita un borde.** Pasó con el halo del orbe, que iba
  de 1 en el centro a 0 en el radio y solo lograba poner toda la masa un poco más gris. Cualquier
  efecto que tenga que leerse como "acá falta algo" necesita una zona plena y una transición
  corta.
- **Una partícula puede estar "sin nacer": edad NEGATIVA y `alive` en 0.** No se dibuja, no se
  mueve y no pesa en el fluido; la cuenta regresiva la lleva `g2p`. Es lo que usa
  `particles.birthTime` para que la masa de la escena 10 se vaya formando de abajo hacia arriba.
- **Un efecto de color puede quedar tapado por la iluminación.** Un palito con el albedo en negro
  todavía devuelve el reflejo especular de una luz que tenga encima, y se ve blanco justo donde
  tiene que verse negro. Si se apaga un palito, hay que apagarle el color, la emisión Y subirle
  la rugosidad.
- **Un caudal parejo dentro de una caja no tiene nada que mirar.** Todos los palitos alineados y a
  la misma velocidad dan un ladrillo uniforme, sin textura ni borde. Probado con cuatro juegos de
  valores en la 14: el problema no es de valores.
- **Sin reciclado, todo se apelmaza contra la pared del dominio.** Cualquier escena con una
  fuerza o un flujo sostenido necesita un `particles.wrapMode` (`vertical`, `horizontal` o
  `radial`), o la masa termina clavada en un borde y ahí se queda.

---

## 6. Cómo trabajamos

**Manuel escribe en español, rápido y sin puntuación.** Contestarle en español. Es directo: si
algo no le gusta lo dice sin vueltas ("es una mierda lo que hiciste"), y casi siempre tiene
razón sobre lo visual. Cuando rechaza algo, el problema suele ser conceptual, no de valores.

### El ciclo

1. **Para algo grande, primero el plan.** Manuel suele pedir "armá un plan para ejecutarlo con
   Opus/Sonnet". El plan va a un `.md` en `PARTE 1/`, con los valores de arranque, las trampas
   que aplican y cómo verificar.
2. **Ejecutar y VERIFICAR MIRANDO.** Esto no es opcional y es lo que más cambia el resultado:
   los valores que uno calcula en la cabeza casi nunca funcionan a la primera. Levantar
   `npm run dev`, sacar capturas con Chrome headless y **abrir las imágenes**. Varias, separadas
   en el tiempo, porque el movimiento no se ve en un cuadro solo.
3. **Iterar sobre capturas, no sobre teoría.** Probar 3-4 juegos de valores en una sola corrida
   aplicándolos en vivo con `vis.params.set(...)`, comparar las imágenes y recién ahí fijar los
   ganadores en el archivo.
4. **Registrar la vuelta en `NOTAS.md`** con el formato que ya tiene: qué pidió Manuel (cita
   textual), qué se cambió, **qué se probó y se descartó**, y los bugs que aparecieron.
5. **Regenerar la referencia** si cambiaron params o nombres de escena:
   `node tools/gen-reference.mjs`.

### Cómo se escribe el código acá

- **Comentarios en español, y explican el PORQUÉ.** El estilo del proyecto es contar la decisión:
  qué se probó, qué pasó, por qué quedó este número. Un comentario que dice lo que la línea ya
  dice, sobra. Los comentarios existentes son la razón por la que se pueden retomar cosas meses
  después: mantener ese nivel.
- **Los valores que van juntos se comentan juntos.** Si tres números son un equilibrio (pasa
  seguido con las fuerzas), decirlo, así el que toca uno sabe que tiene que mirar los otros.
- **Preferir datos sobre código.** Si algo se puede resolver agregando params a una escena en vez
  de escribir lógica nueva, va por ahí.
- **Nada de placeholders ni "TODO".** Si algo queda sin hacer, se dice en la respuesta.

### Al terminar

Contarle en criollo qué quedó, **qué se apartó de lo planeado y por qué**, y avisarle de los
efectos colaterales (por ejemplo: "el bloque rojo ya no lo usa ninguna escena"). Si una prueba
falla y es preexistente, decirlo en vez de taparlo.

---

## 7. Verificar (todo pide `npm run dev` corriendo)

```bash
cd particlesvideo/visuales
npm run dev                          # http://localhost:5173

node tools/walk-scenes.mjs           # recorre las 29 escenas: fps, ms y errores de consola
node tools/shoot-scenes.mjs <dir>    # capturas a 2688 × 1008 nativo
node tools/smoke-settings.mjs        # que la escena mande y los ajustes no se filtren
node tools/smoke-learn.mjs           # el "learn" del editor
node tools/smoke-persist.mjs         # los ajustes sobreviven la recarga
node tools/gen-reference.mjs         # regenera REFERENCIA-MIDI-OSC.md y .csv
```

Para capturas a medida conviene copiar `tools/shoot-scenes.mjs`, tocarlo y **borrarlo al
terminar** (tiene que vivir en `tools/` para que resuelva `ws`).

Desde la consola del navegador (o vía CDP) está todo colgado de `window.vis`:
`vis.scenes.goto('15')`, `vis.params.set('vortex.pull', -7, {immediate:true})`,
`vis.params.get(...)`, `vis.engine.fps`.

**Sobre los fps:** si corren dos Chrome headless a la vez los números bajan por contención. Mirar
los **ms por frame**, que son los que no mienten: el show va sobrado a ~1-4 ms.

Dos ruidos esperables que no son bugs:
- `no se pudo abrir MIDI: NotAllowedError` en headless — no hay permiso de Web MIDI, normal.
- **`smoke-io.mjs` tiene 4 fallas preexistentes**: espera escenas con id `testA`/`testB` que no
  existen en `SCENES`. La prueba quedó vieja.

---

## 8. Estado actual

- Las **29 escenas** andan a 60 fps: 23 armadas de Parte 1 (ids 1 a 23), 3 de Fluids (24 previa,
  25 secuencia, 26 motor libre) y **3 libres** (27 a 29), que existen y se pueden disparar por
  nota pero dejan la pantalla en negro hasta que se defina qué va en cada una.
- **Los ids son el ORDEN DEL SHOW, corridos y sin huecos** — no el número de imagen del
  storyboard, como eran hasta el 2026-09-05. De la 1 a la 15 coinciden; de la 16 a la 19 el número
  del storyboard es el id + 1; de la 20 en adelante ya no hay correspondencia (la 20 es una escena
  nueva que el storyboard no tiene). Ver las vueltas decimotercera y decimoséptima de `NOTAS.md`.
- **La 19 y la 20 son la misma nube con y sin atractor** (helper `nubeSuelta`): primero se ve que
  las partículas están libres, y recién en la 20 aparece el orbe que se las lleva.
- **Escena N = nota N del canal 10**, del 1 al 29. La nota 0 está reservada: es el *deep dark
  kick* (canal 1) que dispara los rayos en todas las escenas, y que además alterna el color de los
  palitos entre rojo y azul en la 23.
- **Una nota de la escena en curso NO la vuelve a disparar.** El guard está en
  `SceneManager.goto`; para forzar el re-disparo hay que pedirlo con `{ force: true }`.
- Las escenas **14 y 15 son la misma escena espejada** ("Rueda azul", empujando a la izquierda y
  a la derecha). Las dos están DENTRO del bound: una masa azul girando como rueda de frente a la
  cámara —torbellino de eje horizontal, la única escena donde se ve girar algo— mientras una
  corriente lateral la aprieta contra el bloque rojo, que no se mueve pero titila. Comparten el helper
  `ruedaAzul(sentido)`. Ver las vueltas décima y undécima de `NOTAS.md`.
- **La escena que era la 16 se sacó**: era la 18 sin rayos, y `16.png` y `18.png` del storyboard
  son la misma imagen.
- El **bloque rojo (`RedBlock`)** vuelve a aparecer en la 14 y la 15, como presencia visual: se ve
  pero no tira (`redBlock.attract: 0`).
- El **ORBE (`Orb`)**: un atractor invisible (`orb.core` en 0) que alumbra con una luz puntual y
  **apaga a negro** a los palitos que se lleva. Lo enciende **solo la escena 20** y hoy se dispara
  solo con `orb.auto`. **Pendiente**: Manuel tiene que definir de qué mensaje va a colgar; ese día
  se mapea `orb.flash` a ese mensaje y `orb.auto` va a 0.
- `vortex.travelX/Z/Rate` (paseo del centro del vórtice) está implementado y disponible, pero
  ninguna escena lo usa hoy.
- Pendiente de definición: de dónde sale el OSC en el show.
