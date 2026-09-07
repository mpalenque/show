# PLAN — Visuales en tiempo real WebGPU para pantalla LED 8 × 3 m (2688 × 1008)

Documento maestro del proyecto. Escrito por Claude (Fable) a partir del storyboard de Manuel
(`STORYBOARD/*.png`) y del repo `particlesvideo/` (base de los "palitos"). Lo ejecuta Sonnet, fase por fase.

**Leer primero [CONTEXTO.md](CONTEXTO.md) y el [contexto vigente versionado](particlesvideo/visuales/docs/CONTEXTO-ACTUAL.md).** Este documento conserva el diseño original de Parte 1. Decisión actual de Radiance: **24 = previa negra/línea blanca, timeline 0 detenido; 25 = PLAY completo desde cero; audio siempre desde Ableton y nunca desde la web**. Notas 24/25 del canal 10; 26–29 libres; motor live preservado sin asignación. [Configuración](particlesvideo/visuales/docs/CONFIGURACION.md) · [Operación](particlesvideo/visuales/docs/integracion-radiance/OPERACION.md) · [Plan original de Fluids](particlesvideo/visuales/docs/origen-radiance/INDICE.md). Las pruebas de la primera integración pertenecen a la asignación anterior y no validan esta nueva decisión.

---

## 0. Cómo usar este documento (LEER PRIMERO — instrucciones para Sonnet)

1. Este plan se ejecuta **por fases** (sección 14). Manuel va a pedir "ejecutá la Fase N". Hacé **solo esa fase**.
2. Antes de la primera fase, leé completas las secciones 1 a 7 (contexto, arquitectura, convenciones, Params, escenas, IO). Después, para cada fase, leé su bloque en la sección 14 y las secciones de spec que referencia.
3. Cada fase termina con **criterios de aceptación**. No des por terminada una fase sin verificarlos (correr `npm run dev`, abrir Chrome, probar con teclado y con el editor, mirar la consola). Lo que no se pueda verificar sin la pantalla LED física, decilo explícitamente en el reporte.
4. **No cambies** la arquitectura, la estructura de carpetas ni los `id` de parámetros definidos acá sin avisar. Si algo no compila con la versión instalada de three.js, buscá el equivalente en `node_modules/three/` (carpetas `src/nodes/`, `examples/jsm/tsl/`) y anotá el cambio en `NOTAS.md`.
5. Código **simple y modular**: un archivo por elemento visual, escenas como datos, sin lógica escondida. Comentarios cortos en español solo donde haya un "por qué".
6. **Nunca hardcodear** resolución, medidas físicas, colores de escena ni notas MIDI dentro de los elementos. Todo sale de `src/config/stage.js`, del registro de parámetros (`Params`) o del archivo de mapeos.
7. Todo parámetro que un elemento lee tiene que estar registrado en `Params` (sección 5) con `id`, tipo, rango y default. Es lo que hace que aparezca en el editor y se pueda mapear a MIDI/OSC. Si agregás un parámetro nuevo, agregalo también a la tabla de la sección 13.
8. Al terminar cada fase: `git add visuales && git commit -m "visuales: Fase N ..."` en la rama `visuales` del repo existente, y actualizá `NOTAS.md` con decisiones/desvíos.
9. Mantené `NOTAS.md` corto: qué se hizo distinto al plan y por qué, y problemas conocidos.

---

## 1. Resumen del proyecto

**Qué es:** un sistema de visuales en tiempo real que corre en Chrome (WebGPU, three.js + TSL) y se muestra en una pantalla LED de 8 × 3 m (2688 × 1008 px). Reemplaza un set hecho en vvvv beta. Lo controla Ableton Live por **MIDI** (notas y CC, varios canales) y además recibe **OSC**.

**Estructura del show:** una secuencia de **escenas** numeradas según el storyboard (1, 2, 3, 4, 5, 6, 7, 10 … 23). Cada escena se dispara con una **nota MIDI** en el canal de escenas. Dentro de cada escena, otras notas/CC (canales de batería, sintes) disparan acciones y modifican parámetros.

**Dos mundos visuales:**

- **Capa 2D** (escenas 1 a 6, y sigue disponible después): placa de advertencia, marco rojo, línea blanca móvil, grillas por bloque (la pantalla dividida en 5 "pantallas verticales"), barridos de gradiente. Todo en píxeles exactos (líneas de 1 px).
- **Capa 3D** (escenas 7 en adelante): piso de carriles punteados con fuga, caja de aristas, bloque rojo atractor, rayos que caen con debris, y el sistema de partículas "palitos" (MLS-MPM del repo `particlesvideo`, portado y extendido con fuerzas: turbulencia, flujo, atractores, torbellino, repulsores, límite de caja móvil). La cámara es un **espectador a 4 m de la pantalla y 1 m de altura**: proyección off-axis para que la pantalla funcione como ventana.

**Requisitos no funcionales:**

- ≥ 50 fps sostenidos a 2688 × 1008 (objetivo 60).
- Modular: agregar una escena = agregar una entrada de datos; agregar un elemento = un archivo nuevo que registra sus parámetros.
- Editor de mapeo MIDI/OSC con "learn", una nota puede controlar varias cosas, un parámetro puede recibir de varias fuentes.
- Nada de UI sobre la salida LED: el editor vive en **otra ventana** del navegador.

### 1.1 Decisiones clave (ya tomadas)

| Tema | Decisión | Por qué |
|---|---|---|
| Motor | three.js `three/webgpu` + TSL, **versión pineada `0.176.0`** (la del repo) | El MLS-MPM ya funciona con esa versión. Actualizar después, no ahora. |
| Bundler | Vite 6, JS plano (sin TypeScript) | Igual que el repo; menos fricción para Sonnet. Sin `vite-plugin-tsl-operator`: usar siempre `.add() .mul()` explícitos. |
| Resolución | Canvas **fijo** 2688 × 1008, `setPixelRatio(1)`, escalado por CSS si la ventana es más chica | Líneas a píxel exacto; independiente del tamaño de ventana en desarrollo. |
| Composición | Un `PostProcessing` de three: pase 3D (+bloom por MRT solo en partículas) y pase 2D compuesto encima con alpha | Un solo grafo, sin `autoClear` frágil. Fallback descripto en §8.3. |
| Cámara 3D | `OffAxisCamera` (subclase de `PerspectiveCamera`) con la pantalla como plano de proyección | La pantalla es una ventana; horizonte a la altura del ojo. |
| Partículas | Portar `mlsMpmSimulator.js` + `particleRenderer.js` del repo. Dominio de simulación = **todo el escenario** (9 × 4 × 6 m, celdas isotrópicas de 0.1 m). La caja es una restricción **sub-AABB rotable** dentro del dominio | Mover/ocultar/liberar la caja es cambiar uniforms; el mismo sim sirve para "encerradas" y "libres". |
| Colores partículas | Color base por escena (rojo/azul/blanco) mezclado a blanco según velocidad | Pedido explícito del storyboard. |
| Emisión continua (esc. 12) | Wrap vertical en GPU (sale por arriba → reaparece abajo) | Sin loops CPU ni uploads de 33 MB por frame. |
| Reset de partículas | Kernel de compute `resetInBox` con hash en GPU | Cambiar de escena no puede trabar el frame subiendo buffers. |
| Estado | `Params` = única fuente de verdad. Escenas = presets de parámetros + acciones. Mapper MIDI/OSC → Params | Todo lo controlable pasa por un solo lugar → editor y mapeo automáticos. |
| Editor | Ventana aparte (`editor.html`) conectada por `BroadcastChannel` | La salida LED queda limpia. |
| OSC | Bridge Node (UDP → WebSocket) en `tools/osc-bridge.mjs` | El navegador no puede recibir UDP. |
| Fuente | Helvetica ya instalada en Windows por Manuel: Canvas2D la usa como fuente de sistema (`Helvetica, "Helvetica Neue", Arial`) | Confirmado 2026-09-02. |

### 1.2 Decisiones confirmadas por Manuel (2026-09-02) y puntos que siguen abiertos

Respuestas a las preguntas del plan original. Cada una es una constante en `stage.js` o un parámetro, así que cambiarla es barato.

- **C1. Altura de la pantalla:** el borde inferior de la LED está a **0 m** (apoyada en el piso). El piso 3D es y = 0 y el horizonte queda a la altura del ojo (1 m).
- **C2. Cámara:** ojo en (x = 0, y = 1.0 m, z = 4.0 m) frente a la pantalla. Ajustable en vivo (`camera.*`).
- **C3. Bloques:** 5 columnas iguales. 2688 / 5 = 537.6 → límites redondeados a píxel `[0, 538, 1075, 1613, 2150, 2688]`. Las 6 columnas del storyboard se reinterpretan como 5.
- **Presets de la caja (actualizado 2026-09-04):** `left`/`center`/`right` = **±3.0 m**, y el dominio de simulación se ensanchó a **±5.5 m** en x para que entren sin pelearse con la pared del escenario. El cambio de preset es **instantáneo**, no un deslizamiento.
- **C4. Caja:** rotada 45° (una arista vertical apunta al espectador, como en 10/11/13), 2.6 × 3.0 × 2.6 m, arista frontal sobre el plano de pantalla. **Manuel quizás la gire**: `box.yaw` es parámetro mapeable a CC y hay `box.yawSpeed` (grados/s) para rotación continua. La restricción de las partículas se calcula en el espacio local de la caja, así que rotarla en vivo funciona sin que se escapen.
- **C5. `1b`, `2b`, `6b`, `6c` no son escenas:** son disparadores dentro de su escena (1b = apagar fondo de la placa; 2b = invertir la línea; 6b = barrido blanco; 6c = bloque azul sólido). Cada uno tiene su nota.
- **C6. Escena 5:** sigue la misma dinámica que la 4 (grillas finas por bloque). Tiene su propia nota y su propia entrada en `scenes/index.js` por si después se diferencia.
- **C7. Escena 10:** partículas **blancas**.
- **C8. Línea blanca (escena 2):** Manuel: "es como un trueno que cae, desaparece". Se implementa como **golpe (strike)**: al disparar, la línea aparece de arriba hacia abajo en ~0.12 s, avanza lento en horizontal, invierte sentido con `2b`, y al salir por el borde se apaga. Cada nota dispara una nueva. Queda también un modo `loop` (siempre visible, con wrap) por si hace falta. **Confirmar visualmente en la Fase 3.**
- **C9. Barridos:** azul baja, blanco sube, bloque sólido alterna. Parametrizable.
- **C10. Rayos:** posición X aleatoria (también se puede fijar por nota o por OSC).
- **C11. OSC:** la fuente **todavía no está definida** (Manuel la define después). Consecuencia: el editor tiene que documentar solo todo lo que expone: cada parámetro muestra su dirección OSC, el puerto UDP se cambia desde el editor, y un botón exporta una **hoja de referencia** (Markdown y CSV) con todos los nombres, rangos, direcciones OSC y notas MIDI asignadas (§7.6–7.7). No se envía OSC hacia afuera (backlog).
- **C12. GPU del show:** **RTX 3090**. Presupuesto holgado: 262 144 partículas por defecto, `maxParticles` = 524 288 con preset "ultra".
- **C13. Ubicación:** el proyecto vive **dentro de este repo**, como sub-proyecto `particlesvideo/visuales/` (igual que `poly/` y `moon-simulator/`, con su propio `package.json`). Está en OneDrive: `node_modules` va en `.gitignore`; si el sync molesta, marcar esa carpeta en OneDrive como "Liberar espacio" o excluirla.
- **C14. Fuente:** Helvetica ya está instalada en Windows; Canvas2D la usa como fuente de sistema.

Abierto (no bloquea): qué app manda OSC y por qué puerto; validar a ojo el comportamiento de la línea "trueno" (C8) en la Fase 3.

---

## 2. Escenario físico, coordenadas y cámara

### 2.1 Pantalla

| Dato | Valor |
|---|---|
| Resolución | **2688 × 1008 px** (aspecto 8:3 exacto) |
| Medidas | 8.0 × 3.0 m |
| Pitch | 8000 / 2688 = **2.976 mm** (Manuel dijo ≈ 2.9678; 16 × 6 módulos de 168 px = 500 mm cada uno) |
| Bloques | 5 columnas: límites px `[0, 538, 1075, 1613, 2150, 2688]`, anchos 538/537/538/537/538, 1.6 m cada uno |
| `devicePixelRatio` | debe ser **1** (escala de Windows al 100 % en la salida LED). El overlay de stats avisa si no. |

### 2.2 Sistema de coordenadas 2D (capa 2D)

- Unidades: **píxeles**. Origen arriba-izquierda, x a la derecha, y hacia abajo.
- Cámara ortográfica: `new THREE.OrthographicCamera(0, 2688, 0, 1008, -10, 10)` (left, right, top, bottom). Un quad con `position.set(x + w/2, y + h/2, 0)` y `scale(w, h, 1)` cubre el rectángulo `[x, x+w] × [y, y+h]` en píxeles. Verificar en Fase 1 con un rectángulo de prueba en (0,0)-(100,100): tiene que aparecer arriba a la izquierda.
- Para líneas a píxel exacto, los shaders usan `screenCoordinate` (TSL) — coordenadas de píxel del fragmento. **Verificar empíricamente la orientación de y** en Fase 3 (en WebGPU suele ser hacia abajo); si está invertida, usar `screenSize.y.sub(screenCoordinate.y)`.

### 2.3 Sistema de coordenadas 3D (capa 3D)

- Unidades: **metros**. Convención three.js: x derecha, y arriba, **z hacia el espectador**.
- El plano de la pantalla es **z = 0**, con x ∈ [−4, 4] y y ∈ [0, 3] (C1).
- La profundidad de la escena es **z negativo** (detrás de la pantalla). El piso es y = 0.
- Ojo: `(camera.eyeX, camera.eyeY, camera.eyeZ)` = (0, 1.0, 4.0) por defecto (C2). Mira hacia −z (orientación por defecto de three, sin rotación).
- Horizonte (línea de fuga) queda a y = eyeY = 1 m → a 1/3 de la altura desde abajo (píxel y ≈ 672).

### 2.4 Cámara off-axis (la pantalla como ventana)

La proyección se construye a mano: el frustum pasa exactamente por las cuatro esquinas de la pantalla. Implementación en `src/render/OffAxisCamera.js`:

```js
import * as THREE from 'three/webgpu';

export class OffAxisCamera extends THREE.PerspectiveCamera {
  constructor(stage) {
    super(60, 8 / 3, 0.05, 60);
    this.stage = stage;                    // { widthM, heightM, bottomM }
    this.eye = new THREE.Vector3(0, 1, 4); // se actualiza desde Params camera.*
  }
  // El renderer llama a esto cuando cambia coordinateSystem; por eso se sobreescribe
  // en vez de setear projectionMatrix "a mano" (si no, lo pisa).
  updateProjectionMatrix() {
    const { widthM, heightM, bottomM } = this.stage;
    const d = this.eye.z;                   // distancia ojo → plano de pantalla (z = 0)
    const s = this.near / d;
    const left   = (-widthM / 2 - this.eye.x) * s;
    const right  = ( widthM / 2 - this.eye.x) * s;
    const bottom = ( bottomM     - this.eye.y) * s;
    const top    = ( bottomM + heightM - this.eye.y) * s;
    // Firma en r176: makePerspective(left, right, top, bottom, near, far, coordinateSystem).
    // Si la versión instalada tiene más argumentos (reversedDepth), pasarlos también.
    this.projectionMatrix.makePerspective(left, right, top, bottom, this.near, this.far, this.coordinateSystem);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  setEye(x, y, z) {
    this.eye.set(x, y, z);
    this.position.copy(this.eye);
    this.rotation.set(0, 0, 0);
    this.updateProjectionMatrix();
    this.updateMatrixWorld(true);
  }
}
```

Cada frame el `Layer3D` lee `camera.eyeX/eyeY/eyeZ` de Params y llama `setEye` si cambiaron.

### 2.5 Dominio de simulación de partículas

- AABB mundo: x ∈ [−4.5, 4.5], y ∈ [−0.5, 3.5], z ∈ [−5.5, 0.5] (medio metro de margen alrededor de la pantalla; por arriba las partículas de la escena 12 pueden salir del cuadro antes de reaparecer abajo).
- Celda: **0.1 m** → grilla **90 × 40 × 60 = 216 000 celdas** (similar a las 262 144 del repo original). Si el fluido se ve demasiado "grueso", bajar a 0.075 m (cambia solo `stage.sim.cellSize`).
- Conversión: `grid = (world − sim.min) / cellSize`. El objeto renderer de partículas tiene `position = sim.min` y `scale = cellSize` (uniforme).

### 2.6 Caja (bound) de partículas

- Tamaño por defecto 2.6 (ancho) × 3.0 (alto) × 2.6 (profundo) m, yaw 45° (C4).
- Centro por defecto: `x = 0`, `y = 1.5`, `z = −1.84` (= −(2.6·√2)/2, así la arista vertical frontal queda en z = 0). Esquina trasera en z = −3.68 (entra en el dominio).
- Presets de posición X: `left = −2.1`, `center = 0`, `right = +2.1` (con yaw 45° la huella es un rombo de 3.68 m de diagonal; ±2.1 deja las esquinas dentro de la pantalla).
- Todo esto son parámetros (`box.*`), la escena los tweenea.

### 2.7 `src/config/stage.js` (constantes)

```js
export const STAGE = {
  width: 2688, height: 1008,
  physical: { widthM: 8.0, heightM: 3.0, bottomM: 0.0, pitchMm: 2.976 },
  blocks: 5,
  blockBounds: [0, 538, 1075, 1613, 2150, 2688],
  camera: { eyeX: 0, eyeY: 1.0, eyeZ: 4.0, near: 0.05, far: 60 },
  sim: { min: [-4.5, -0.5, -5.5], max: [4.5, 3.5, 0.5], cellSize: 0.1, maxParticles: 8192 * 64 },   // RTX 3090: default 262144, preset "ultra" 524288
  box: { width: 2.6, height: 3.0, depth: 2.6, yawDeg: 45, y: 1.5, z: -1.84, presets: { left: -2.1, center: 0, right: 2.1 } },
};
```

---

## 3. Arquitectura

```
Ableton Live ──MIDI (loopMIDI)──► Chrome: ventana SALIDA (index.html)
TouchOSC/otro ─OSC UDP:9000─► tools/osc-bridge.mjs ─WS:8081─► ventana SALIDA
                                                                  │
   ┌──────────────────────────────────────────────────────────────┴───────────────┐
   │ io/MidiInput  io/OscClient ──► io/Mapper ──► core/Params ◄── core/SceneManager│
   │                                   │             ▲  │                          │
   │                                   │ learn/monitor│  │ valores (pull por frame) │
   │                                   ▼             │  ▼                          │
   │                              io/Bridge ◄─BroadcastChannel─► ventana EDITOR     │
   │                                                 │                              │
   │ core/Engine (loop rAF) ─► layers2d/* + layers3d/* (leen Params) ─► render/Compositor
   └──────────────────────────────────────────────────────────────────────────────┘
```

**Regla de oro:** los elementos visuales **no saben** de MIDI, OSC ni escenas. Solo leen `Params` cada frame y exponen acciones. Escenas y Mapper solo escriben en `Params`. Así cualquier cosa se puede controlar desde cualquier lado.

### 3.1 Módulos

| Módulo | Responsabilidad |
|---|---|
| `core/Params.js` | Registro de parámetros y acciones. Tipos, rangos, defaults, tween, smoothing, serialización para el editor. |
| `core/SceneManager.js` | Lista de escenas (datos), `goto(id)`, aplica `BASE + scene.params` con tween, dispara `scene.actions`, hooks opcionales. |
| `core/Engine.js` | Crea renderer, capas, compositor; loop `requestAnimationFrame`; `dt` clampeado; llama `params.update(dt)`, `layer2d.update(dt)`, `layer3d.update(dt)`, `compositor.render()`. Stats. |
| `render/Renderer.js` | `WebGPURenderer` a tamaño fijo, CSS scale-to-fit, `pixelRatio = 1`. |
| `render/Compositor.js` | `PostProcessing`: pase 3D + bloom (MRT) + pase 2D encima + master brightness/blackout. |
| `render/OffAxisCamera.js` | §2.4. |
| `layers2d/Layer2D.js` | Escena ortográfica en píxeles; contiene los elementos 2D; `update(dt)` los recorre. |
| `layers2d/WarningPlate.js` `Frame.js` `MovingLine.js` `GridBlocks.js` `Sweeps.js` | Elementos 2D (§9). |
| `layers3d/Layer3D.js` | Escena 3D + `OffAxisCamera`; contiene elementos 3D. |
| `layers3d/Floor.js` `BoxWire.js` `RedBlock.js` `Rays.js` `Debris.js` | Elementos 3D (§10). |
| `layers3d/particles/MlsMpmSimulator.js` `StickRenderer.js` `StructuredArray.js` `noise.js` | Partículas (§11). |
| `io/MidiInput.js` | Web MIDI: enumerar inputs, parsear note on/off y CC, hot-plug. |
| `io/OscClient.js` | WebSocket al bridge, reconexión automática, parsea `{address, args}`. |
| `io/Mapper.js` | Tabla de mapeos fuente → destino, modos, fan-out, filtro por escena, learn, persistencia, rutas OSC automáticas. |
| `io/Bridge.js` | `BroadcastChannel('vis-bus')`: protocolo salida ↔ editor (§7.5). |
| `editor/*` | UI del editor (ventana aparte). |
| `scenes/base.js` `scenes/index.js` | Preset BASE y lista de escenas (§12). |
| `config/stage.js` | Constantes físicas (§2.7). |
| `public/mappings.default.json` | Mapeos MIDI/OSC que viajan con el proyecto. |
| `tools/osc-bridge.mjs` | Bridge OSC UDP → WebSocket. |

---

## 4. Stack y estructura de archivos

### 4.1 Dependencias

```json
{
  "name": "visuales-led",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host --port 5173",
    "build": "vite build",
    "preview": "vite preview --port 5173",
    "osc": "node tools/osc-bridge.mjs",
    "start": "concurrently -k \"npm:dev\" \"npm:osc\""
  },
  "dependencies": {
    "three": "0.176.0",
    "tweakpane": "^4.0.5",
    "@tweakpane/plugin-essentials": "^0.2.1"
  },
  "devDependencies": {
    "vite": "^6.3.1",
    "concurrently": "^9.0.0",
    "osc": "^2.4.5",
    "ws": "^8.18.0"
  }
}
```

Node instalado: v24. Chrome ≥ 113 (WebGPU). Windows 11.

### 4.2 Árbol

```
particlesvideo/visuales/     sub-proyecto dentro del repo existente (como poly/ y moon-simulator/)
  index.html                 ventana de SALIDA (solo un <div id="stage">, sin UI)
  editor.html                ventana del EDITOR
  package.json  vite.config.js  .gitignore  NOTAS.md  README.md
  public/
    mappings.default.json
  tools/
    osc-bridge.mjs
    launch-show.bat          abre Chrome en kiosk en la LED + editor en el monitor
  src/
    main.js                  boot de la salida
    config/stage.js
    core/Params.js  SceneManager.js  Engine.js  Tween.js  Keyboard.js
    render/Renderer.js  Compositor.js  OffAxisCamera.js
    layers2d/Layer2D.js  WarningPlate.js  Frame.js  MovingLine.js  GridBlocks.js  Sweeps.js
    layers3d/Layer3D.js  Floor.js  BoxWire.js  RedBlock.js  Rays.js  Debris.js
    layers3d/particles/MlsMpmSimulator.js  StickRenderer.js  StructuredArray.js  noise.js  Forces.js
    io/MidiInput.js  OscClient.js  Mapper.js  Bridge.js
    scenes/base.js  index.js
    editor/main.js  panels/ScenesPanel.js  ParamsPanel.js  MappingsPanel.js  MonitorPanel.js  editor.css
```

### 4.3 Convenciones de código

- ES modules, clases con `constructor(ctx)`, `init()` (async si crea GPU), `update(dt, t)`, `dispose()`.
- `ctx` = `{ params, stage, renderer, scenes, mapper, clock }` que el Engine pasa a todos.
- Los elementos reciben `ctx.params` y definen sus parámetros en `static defineParams(params)` (llamado antes de `init`), así el registro está completo antes de que el editor pida el listado.
- TSL: importar de `'three/tsl'`; materiales `*NodeMaterial` de `'three/webgpu'`. Los uniforms se crean **una vez** (`uniform(valor)`) y se actualizan con `.value` cada frame. Nunca crear materiales ni nodos dentro de `update`.
- Colores en Params como string hex `#RRGGBB`; convertir con `new THREE.Color(hex)` al escribir el uniform.
- Log de arranque con `console.info('[vis] ...')`; errores con `console.error`. Sin `console.log` sueltos en el loop.

---

## 5. Sistema de parámetros (`core/Params.js`)

Registro central. Todo lo controlable es un **param** (tiene valor) o una **action** (se dispara).

### 5.1 API

```js
const params = new Params();

params.define({
  id: 'particles.turbulence',     // único, "grupo.nombre" o "grupo.sub.nombre"
  type: 'float',                  // 'float' | 'int' | 'bool' | 'enum' | 'color'
  min: 0, max: 2, default: 0.6,
  smooth: 0.15,                   // seg. de suavizado hacia el target (0 = instantáneo)
  label: 'Turbulencia', group: 'particles',
  sceneReset: true,               // false → las escenas no lo tocan salvo que lo listen (ej. camera.*, master.*)
  options: ['left','center','right'],   // solo enum
});
params.defineAction({ id: 'ray.spawn', label: 'Disparar rayo', group: 'rays', argHint: 'x: random|left|center|right|número' });

params.get(id)                 // valor actual (suavizado / tweeneado) — usar en update() de los elementos
params.target(id)              // valor objetivo
params.set(id, value, { immediate = false } = {})   // fija target (y valor si immediate o smooth==0)
params.setNormalized(id, n01)  // 0..1 → min..max (para CC/OSC)
params.tween(id, value, seconds, easing = 'smooth')  // float/int/color; bool/enum saltan al final
params.trigger(id, arg)        // dispara action → llama listeners
params.onAction(id, fn)        // el elemento registra su handler
params.onChange(id, fn)        // opcional, para cosas caras (ej. cambiar count de partículas)
params.update(dt)              // avanza tweens y smoothing (lo llama Engine al inicio del frame)
params.list()                  // [{id,type,min,max,default,label,group,options,isAction}] para el editor
params.snapshot()              // {id: target} de todo (para el editor / debug)
```

### 5.2 Reglas

- `get()` devuelve el valor **suavizado**: `value += (target - value) * (1 - exp(-dt / smooth))`.
- `tween()` crea una interpolación de `value` y `target` en el tiempo (easing smoothstep). Un `set()` posterior cancela el tween.
- `color`: se interpola en RGB lineal (convertir hex ↔ `THREE.Color`).
- `bool` y `enum` no se interpolan; en un tween cambian al **final** si el valor "apaga" (false / opacidad 0) y al **inicio** si "prende" — simplificación: cambian al inicio salvo que la escena indique `{ at: 'end' }`. Para no complicar: **cambian al inicio**. Para fades usar siempre params `float` de opacidad (`xxx.opacity`), nunca bools.
- Eventos de cambio se disparan solo si el valor realmente cambió.

---

## 6. Escenas (`core/SceneManager.js`, `scenes/`)

### 6.1 Formato

```js
// scenes/index.js
export const SCENES = [
  {
    id: '11', name: 'Piso + caja roja', transition: 1.5,    // seg
    params: {
      'layer3d.opacity': 1, 'floor.opacity': 1,
      'box.visible': 1, 'box.enabled': true, 'box.preset': 'center',
      'particles.opacity': 1, 'particles.baseColor': '#ff0000', 'particles.turbulence': 0.8,
    },
    actions: [ ['floor.reveal'] ],            // se disparan al entrar (después de aplicar params)
    onEnter(ctx) {}, onExit(ctx) {}, update(ctx, dt) {},   // opcionales, para lógica que no entra en datos
  },
  // ...
];
```

### 6.2 Semántica

- `scenes/base.js` exporta `BASE`: **todo apagado** (todas las opacidades 0, fuerzas 0, `sweep.enabled false`, `rays.enabled false`, etc.).
- `goto(id, { transition })`: para cada param con `sceneReset: true`, target = `scene.params[id] ?? BASE[id]`; se aplica con `params.tween(id, target, transition)` (floats/colors) o `set` (bool/enum). Params con `sceneReset: false` (cámara, master, bloom global) solo cambian si la escena los lista.
- Después de aplicar: `scene.actions` → `params.trigger(...)`; `scene.onEnter(ctx)`.
- Expone `params` propios: action `scene.goto` (arg id), `scene.next`, `scene.prev`; param `scene.current` (enum de ids, sceneReset false) para que el editor lo muestre.
- Emite `onSceneChange(id)` (el Mapper lo usa para el filtro por escena y el Bridge lo manda al editor).
- Un valor tocado por CC durante una escena persiste hasta el próximo `goto` (que lo vuelve a BASE/escena). Es el comportamiento MIDI normal.

### 6.3 Agregar una escena nueva

1. Agregar una entrada en `scenes/index.js` con `id`, `params`, `actions`.
2. Si necesita un elemento nuevo: crear `layers*/NuevoElemento.js` con `defineParams` + `update`, registrarlo en la capa, agregar sus defaults a `BASE`.
3. Mapear su nota en el editor (o en `mappings.default.json`).

---

## 7. Entrada: MIDI, OSC, Mapper, Editor

### 7.1 `io/MidiInput.js`

- `await navigator.requestMIDIAccess({ sysex: false })`. Enumerar `inputs`; habilitar todos por defecto (lista de habilitados en `localStorage['vis.midiInputs']`, editable en el editor). `onstatechange` para hot-plug.
- Parseo: status `0x90` note on (velocidad 0 = off), `0x80` note off, `0xB0` CC. Canal interno 0–15, en UI 1–16.
- Emite `{ kind: 'note', channel, note, velocity, on: true|false }` y `{ kind: 'cc', channel, cc, value }` a `mapper.dispatch(msg)` y a `bridge.midiActivity(msg)` (throttle 30 msg/s para el monitor; los de learn no se throttlean).

### 7.2 OSC: `tools/osc-bridge.mjs` + `io/OscClient.js`

Bridge (Node):

```js
import osc from 'osc'; import { WebSocketServer } from 'ws';
let UDP_PORT = +(process.env.OSC_PORT ?? 9000); const WS_PORT = +(process.env.WS_PORT ?? 8081);
const wss = new WebSocketServer({ port: WS_PORT });
const broadcast = (obj) => { const s = JSON.stringify(obj); wss.clients.forEach(c => c.readyState === 1 && c.send(s)); };
let udp = null;
const openUdp = (port) => {                       // el editor puede cambiar el puerto en vivo ({ t: 'rebind', port })
  if (udp) udp.close();
  UDP_PORT = port;
  udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: port, metadata: true });
  udp.on('message', (m) => broadcast({ t: 'osc', address: m.address, args: m.args.map(a => a.value) }));
  udp.on('ready', () => broadcast({ t: 'status', udpPort: port }));
  udp.on('error', (e) => broadcast({ t: 'error', message: String(e) }));
  udp.open();
};
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'status', udpPort: UDP_PORT }));
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'rebind' && m.port > 0) openUdp(m.port); });
});
openUdp(UDP_PORT);
console.log(`[osc-bridge] UDP ${UDP_PORT} → ws://localhost:${WS_PORT}`);
```

Cliente (`io/OscClient.js`): conecta a `ws://localhost:8081`, reconecta cada 2 s, emite `{ kind: 'osc', address, args }` a `mapper.dispatch`. Guarda el `udpPort` que llega en `status` para mostrarlo en el editor; `setPort(n)` manda `{ t: 'rebind', port: n }`, persiste el puerto en `localStorage['vis.oscPort']` y lo reenvía al reconectar.

**Rutas OSC automáticas** (sin mapear nada):

| Dirección | Efecto |
|---|---|
| `/p/<id con . → />` `f` | `params.set(id, valor)` en rango nativo. Ej. `/p/particles/turbulence 0.8` |
| `/pn/<id>` `f 0..1` | `params.setNormalized(id, v)` |
| `/a/<id>` `[arg]` | `params.trigger(id, arg)`. Ej. `/a/ray/spawn`, `/a/sweep/blue 3` |
| `/scene` `s|i` | `scene.goto` |

Cualquier otra dirección se puede mapear con learn como una fuente más.

### 7.3 `io/Mapper.js`

Modelo (`public/mappings.default.json`, y `localStorage['vis.mappings']` pisa al default):

```json
{
  "version": 1,
  "mappings": [
    { "id": "m01", "source": { "kind": "note", "channel": 1, "note": 36 }, "mode": "trigger",  "target": "scene.goto", "arg": "1" },
    { "id": "m02", "source": { "kind": "note", "channel": 3, "note": 60 }, "mode": "toggle",   "target": "grid.b1.enabled", "scenes": ["4","5","6","7"] },
    { "id": "m03", "source": { "kind": "note", "channel": 2, "note": 38 }, "mode": "trigger",  "target": "ray.spawn", "arg": "random" },
    { "id": "m04", "source": { "kind": "cc",   "channel": 2, "cc": 21 },   "mode": "range",    "target": "particles.turbulence", "min": 0, "max": 2, "curve": "linear" },
    { "id": "m05", "source": { "kind": "note", "channel": 2, "note": 40 }, "mode": "gate",     "target": "box.flicker" },
    { "id": "m06", "source": { "kind": "note", "channel": 3, "note": 62 }, "mode": "set",      "target": "box.preset", "value": "left" },
    { "id": "m07", "source": { "kind": "osc",  "address": "/touch/fader1" }, "mode": "range",  "target": "vortex.swirl", "min": 0, "max": 4 }
  ]
}
```

Modos:

| Modo | Fuente típica | Efecto |
|---|---|---|
| `trigger` | note on | action → `trigger(target, arg)`; param → `set(target, arg ?? true)` |
| `toggle` | note on | bool → invierte |
| `gate` | note on/off | bool → true mientras está apretada; float → `velocity/127` mapeado a min..max y 0 al soltar |
| `velocity` | note on | float → `velocity/127` → min..max |
| `set` | note on | param → `set(target, value)` (varias notas → varios valores del mismo param: "select") |
| `range` | cc / osc float | float → normalizado (`cc/127` o `args[0]` con `in:[a,b]`) → `curve` (`linear`, `exp`, `log`) → min..max → `set` |

Reglas:

- **Fan-out**: varias filas pueden tener la misma fuente; se aplican todas en orden.
- **Filtro por escena**: `scenes: []` o ausente = siempre; si no, solo cuando `scene.current` está en la lista.
- Índice interno por clave `note:ch:n`, `cc:ch:n`, `osc:address` para despachar en O(1).
- `learn(rowId)`: la próxima fuente que llegue (note on, cc, osc) se asigna a la fila; el modo por defecto se infiere: nota + action → `trigger`; nota + bool → `toggle`; nota + float → `velocity`; cc/osc → `range` con min/max del param.
- Persistencia: `save()` → `localStorage`; `exportJson()` → descarga; `importJson(file)`; `resetToDefault()`. **Al terminar de mapear, copiar el JSON exportado a `public/mappings.default.json`** para que viaje con el proyecto.
- Monitor: guarda los últimos 50 mensajes con timestamp y qué mapeos disparó.

### 7.4 Teclado (solo desarrollo, `core/Keyboard.js`)

`E` abre/foco editor (`window.open('/editor.html', 'vis-editor')`) · `F` overlay fps · `,` / `.` escena anterior / siguiente · `1`..`9` escenas 1..9 de la lista · `Space` acción principal de la escena actual (definida en la escena como `mainAction`) · `L` `line.flip` · `B` toggle `box.visible` · `R` `ray.spawn` · `G` toggle grillas (`grid.toggleAll`) · `W` `warning.pulse`.

### 7.5 `io/Bridge.js` — protocolo salida ↔ editor

`BroadcastChannel('vis-bus')`. JSON plano.

Salida → editor:

| `t` | payload | cuándo |
|---|---|---|
| `hello` | `{ registry: params.list(), values: params.snapshot(), scenes: [{id,name}], mappings, midiInputs, currentScene }` | al arrancar y cuando el editor manda `hi` |
| `values` | `{ values: {id: target} }` solo los que cambiaron | 10 Hz |
| `stats` | `{ fps, ms, particles, dpr }` | 2 Hz |
| `midi` | `msg` | cada mensaje (throttle) |
| `osc` | `msg` | cada mensaje (throttle) |
| `scene` | `{ id }` | al cambiar |
| `mappings` | `{ mappings }` | tras learn / import |
| `oscStatus` | `{ connected, udpPort }` | al cambiar |

Editor → salida:

| `t` | payload |
|---|---|
| `hi` | — |
| `set` | `{ id, value }` |
| `trigger` | `{ id, arg }` |
| `scene` | `{ id }` |
| `mappings` | `{ mappings }` (reemplazo completo) |
| `learn` | `{ rowId }` / `{ rowId: null }` cancela |
| `midiInputs` | `{ enabledIds: [] }` |
| `oscPort` | `{ port }` (la salida reenvía `rebind` al bridge) |
| `fakeMidi` | `msg` (para probar sin Ableton) |
| `save` / `resetMappings` | — |

### 7.6 Editor (`editor.html`, `src/editor/`)

Layout en 3 columnas, tema oscuro, tipografía sistema:

1. **Escenas**: botones con id + nombre, la actual resaltada, campo "transición (s)". Estado MIDI (inputs con checkbox), estado OSC (conectado/no, **puerto UDP editable** → `oscPort`), stats (fps, ms, partículas, aviso si dpr ≠ 1).
2. **Parámetros**: Tweakpane con una carpeta por `group`; sliders/checkbox/lista/color según tipo; botones para actions. Cambiar un control → `set`/`trigger`. Los `values` entrantes refrescan el objeto espejo + `pane.refresh()` (evitar eco: ignorar valores entrantes de un id modificado hace < 200 ms localmente). Debajo, una **lista de referencia** filtrable con una fila por parámetro/acción: `id`, etiqueta, tipo, rango, **dirección OSC automática** (`/p/...`, `/pn/...`, `/a/...`) con botón "copiar", y la(s) fuente(s) MIDI/OSC mapeadas actualmente. Esta es la "página para setear el MIDI map y el OSC, todo bien nomenclado" que pidió Manuel.
3. **Mapeos**: tabla `[fuente] [modo] [destino ▾] [arg/min/max/curva] [escenas] [Learn] [×]`, botón "+ mapeo", "Guardar", "Exportar JSON", "Importar JSON", "Restaurar default", **"Exportar hoja de referencia"** (genera `REFERENCIA-MIDI-OSC.md` y `.csv` con todos los ids, etiquetas, tipos, rangos, direcciones OSC y notas/CC asignados, para imprimir o tener al lado de Ableton). Abajo: **Monitor** (últimos 20 mensajes MIDI/OSC con el/los mapeos que dispararon) y **Probar** (enviar nota/CC/OSC falsos).

Learn: click en "Learn" de una fila → la fila parpadea → el próximo MIDI/OSC la completa. Si el destino es una escena, elegir `scene.goto` + arg = id en el desplegable.

### 7.7 Nomenclatura (para que todo sea legible desde Ableton, TouchOSC o el editor)

- Ids: `grupo.nombre` o `grupo.sub.nombre`, en inglés, camelCase, sin espacios. El grupo es el elemento (`grid`, `line`, `box`, `particles`, `rays`…). Etiquetas (`label`) en español para el editor.
- OSC automático: `/p/grupo/nombre` valor nativo, `/pn/grupo/nombre` 0..1, `/a/grupo/nombre` acción, `/scene id`. Los puntos del id se convierten en `/`.
- Por bloque: `grid.b1` … `grid.b5`, de izquierda a derecha. Lados: `left/center/right`. Sentidos: `up/down`; `dir` = −1/+1.
- Escenas: id = número del storyboard como string (`'7'`, `'10'`). Los sub-disparadores 1b/2b/6b/6c son acciones (`warning.bgOff`, `line.flip`, `sweep.white`, `sweep.solid`).
- Archivo de mapeos: una fila por fuente→destino, con `id` legible (`m01`…). La hoja de referencia se regenera siempre desde el registro, nunca a mano.

---

## 8. Render y composición

### 8.1 `render/Renderer.js`

```js
const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
await renderer.init();
if (!renderer.backend.isWebGPUBackend) throw new Error('WebGPU no disponible');
renderer.setPixelRatio(1);
renderer.setSize(STAGE.width, STAGE.height, false);   // false: no toca el CSS
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

CSS: el canvas mide 2688 × 1008 px CSS; `#stage` lo centra y le aplica `transform: scale(min(innerW/2688, innerH/1008))` con `transform-origin: top left` (recalcular en `resize`). En modo show (ventana kiosk exactamente 2688 × 1008) la escala es 1.

### 8.2 `render/Compositor.js`

```js
import { pass, mrt, output, float, vec3, vec4, uniform, Fn, mix } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

const scene3DPass = pass(layer3d.scene, layer3d.camera);
scene3DPass.setMRT(mrt({ output, bloomIntensity: float(0) }));
const color3D = scene3DPass.getTextureNode();
const bloomMask = scene3DPass.getTextureNode('bloomIntensity');
const bloomPass = bloom(color3D.mul(bloomMask));   // strength/radius/threshold desde Params bloom.*

const scene2DPass = pass(layer2d.scene, layer2d.camera);     // scene.background = null → alpha 0 donde no hay nada
const color2D = scene2DPass.getTextureNode();

const uBrightness = uniform(1), uBlackout = uniform(0), uBloomOn = uniform(1);
const post = new THREE.PostProcessing(renderer);
post.outputColorTransform = false;
post.outputNode = Fn(() => {
  const a = color3D.rgb.clamp(0, 1).toVar();
  const b = bloomPass.rgb.clamp(0, 1).mul(uBloomOn).toVar();
  // screen-blend como en el repo original: (1-2b)·a² + 2·b·a
  const c3 = vec3(1).sub(b).sub(b).mul(a).mul(a).add(b.mul(a).mul(2)).clamp(0, 1);
  const c = mix(c3, color2D.rgb, color2D.a);            // 2D encima
  return vec4(c.mul(uBrightness).mul(uBlackout.oneMinus()), 1);
})().renderOutput();
```

Cada frame: `await sim.update()` (compute) → `await post.renderAsync()`.

### 8.3 Fallback si `pass` 2D con alpha da problemas

Renderizar secuencial: `post.renderAsync()` (3D+bloom al canvas) → `renderer.autoClear = false; renderer.clearDepth(); await renderer.renderAsync(layer2d.scene, layer2d.camera); renderer.autoClear = true`. Los materiales 2D deben ser `transparent: true, depthTest: false`. Master brightness pasa a ser un quad negro con alpha encima. Usar solo si el camino principal falla; anotar en `NOTAS.md`.

### 8.4 Bloom

Solo lo que escribe `bloomIntensity > 0` en el MRT brilla: partículas (`particles.bloom`), rayos y debris (`rays.bloom`). La capa 2D nunca (se compone después). Params `bloom.strength` (0.9), `bloom.radius` (0.8), `bloom.threshold` (0.0), `master.bloomEnabled`.

---

## 9. Elementos 2D (spec)

Todos viven en `Layer2D` (ortográfica en píxeles). Cada uno: quad(s) `PlaneGeometry(1,1)` + `MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false })`, `renderOrder` creciente en el orden de esta lista. Todos tienen `xxx.opacity` (float 0..1, default 0) que multiplica su alpha.

### 9.1 `WarningPlate` — escena 1 / 1b

Dos texturas generadas **una sola vez** con Canvas2D a 2688 × 1008 (fuente Helvetica Bold → `document.fonts.load('700 100px Helvetica')` antes de dibujar; fallback Arial):

- **Capa fondo (`warning.bg`)**: chevrones ámbar/negro + cajas negras "LUCES PARPADEANTES" con texto ámbar. Se **desvanece** (imagen 1b la muestra al ~4 %).
- **Capa banda (`warning.band`)**: banda negra horizontal centrada con líneas ámbar arriba/abajo (2 px) y texto "ADVERTENCIA" repetido, más los **ticks ámbar** laterales de las cajas "LUCES PARPADEANTES" (en 1b se ven prendidos). Siempre encendida.

Medidas por defecto (todas en `warning.layout` dentro del archivo, no hace falta que sean params): color ámbar `#F39C12` (ajustar a ojo con la imagen 1), fondo negro. Chevrones: zigzag con vértices cada 448 px en x (6 picos en 2688), amplitud 260 px, franja 85 px, período vertical 185 px. Banda: alto 100 px centrada en y = 504, texto 62 px con tracking, repetido cada ~720 px. Cajas "LUCES PARPADEANTES": 470 × 44 px, texto 30 px, centradas en los picos superiores (y ≈ 370) e inferiores (y ≈ 630).

Params: `warning.band` (0..1), `warning.bg` (0..1, smooth 0.3), `warning.scroll` (px/s, 0; desplaza la banda de texto en x con wrap), `warning.pulseAttack` (s, 1.0), `warning.pulseRelease` (s, 2.0). Actions: `warning.pulse` (tween bg 0→1 en attack, luego 1→0.04 en release), `warning.bgOff` (tween bg → 0.04 en 2 s; **es 1b**), `warning.bgOn` (tween → 1 en 1 s).

Nota: el shader del quad solo muestrea la textura y multiplica por opacidad. Nada de texto en GPU.

### 9.2 `Frame` — marco rojo (escena 2+)

Cuatro quads (o un quad con shader que pinta los bordes). Params: `frame.opacity`, `frame.thickness` (px, 10), `frame.color` (`#7A0000`; en la imagen 3 se ve más brillante `#E00000` — es el mismo param, la escena lo cambia si hace falta).

### 9.3 `MovingLine` — línea blanca "trueno" (escena 2/2b+)

Un quad de `line.width` × 1008 px (vertical) o 2688 × `line.width` (horizontal). Dos modos (`line.mode`):

- **`strike`** (default; Manuel: "es como un trueno que cae, desaparece"): la acción `line.strike` hace aparecer la línea en `x0` **de arriba hacia abajo** en `line.strikeTime` s (el quad crece en alto desde y = 0 hasta 1008, con un flash de brillo 1.5× que decae), después avanza en horizontal a `line.speed` px/s en el sentido `line.direction`, y al salir por el borde se apaga en `line.fadeOut` s. `x0` = arg de la acción: `'edge'` (borde opuesto al sentido de avance; default), `'center'`, `'random'`, o un número en px. Un `strike` nuevo mientras hay una activa la reemplaza (o suma, si `line.maxLines` > 1; default 1).
- **`loop`**: siempre visible, avanza y al salir reaparece por el otro lado (`line.wrap` true) o rebota (false).

`line.flip` (**es 2b**) invierte `line.direction` en cualquier modo sin cortar el movimiento. `line.orientation` (`vertical|horizontal`, default vertical) por si "cambiar la orientación" significa girar la línea 90° (entonces avanza de arriba a abajo); la acción `line.rotate` la alterna. Posición redondeada a píxel al dibujar.

Params: `line.opacity` (0..1), `line.mode` (enum strike/loop), `line.width` (px, 3), `line.speed` (px/s, 30), `line.direction` (int −1/+1, +1), `line.orientation` (enum), `line.strikeTime` (s, 0.12), `line.fadeOut` (s, 0.3), `line.maxLines` (int 1..8, 1), `line.wrap` (bool true), `line.x` (px, estado vivo, `sceneReset: false`). Actions: `line.strike` (arg x0), `line.flip`, `line.rotate`, `line.hide` (apaga con fadeOut).

### 9.4 `GridBlocks` — grillas por bloque (escenas 3, 4, 5 y "siguen jugando" en 7+)

**Un quad por bloque** (5), cada uno con su propio material y uniforms. Shader del fragmento (pseudo-TSL):

```
px = screenCoordinate.x - blockX0;  py = screenCoordinate.y;     // píxeles dentro del bloque
cellW = coarse ? blockW : cellW;    cellH = coarse ? H/2 : cellH;
onX = mod(px - offsetX, cellW) < lineWidth;                       // línea vertical
onY = mod(py - offsetY, cellH) < lineWidth;                       // línea horizontal
alpha = (onX || onY) ? brightness * enabledFade * grid.opacity : 0;
color = white
```

`offsetX` avanza `dir * scrollSpeed * speedMul * dt` y **se redondea a entero** antes de subir al uniform si `grid.pixelSnap` (default true) → líneas siempre de exactamente `lineWidth` px, sin antialias. `enabledFade` es una opacidad por bloque suavizada (0.15 s) para que prender/apagar no sea un corte seco (param `grid.fadeTime`).

Params globales: `grid.opacity` (0..1), `grid.lineWidth` (px int, 1), `grid.brightness` (0..1, 0.6), `grid.cellW` (px, 96), `grid.cellH` (px, 96), `grid.coarse` (bool, false; true = celdas del tamaño del bloque → escena 3), `grid.scrollSpeed` (px/s, 12), `grid.pixelSnap` (bool), `grid.fadeTime` (s, 0.15).
Por bloque N = 1..5: `grid.bN.enabled` (bool), `grid.bN.dir` (int ±1), `grid.bN.speedMul` (0..3, 1), `grid.bN.offsetY` (px, 0). Actions: `grid.bN.toggle`, `grid.bN.flip`, `grid.toggleAll`, `grid.randomize` (offsets aleatorios).

### 9.5 `Sweeps` — barridos por bloque (escenas 6, 6b, 6c)

Pool de 10 quads con material propio. Un barrido activo = `{ block, type, dir, t0, duration }`. Cada frame se posiciona el quad dentro de su bloque:

- **Recorrido**: el frente va de fuera de pantalla arriba a fuera de pantalla abajo (o al revés según `dir`) en `duration` s, easing lineal. `front = lerp(-length, H + length, u)` con u = (t − t0)/duration.
- **type `blue`** (6): rectángulo de alto `sweep.length · H` detrás del frente; alpha = 1 en el frente → 0 en la cola (gradiente lineal). Color `sweep.blueColor` (`#0000C8`).
- **type `white`** (6b): igual con `sweep.whiteColor` (`#C8C8C8`).
- **type `solid`** (6c): rectángulo **sin gradiente**, alto `sweep.solidHeight · H` (0.5), alpha 1, color azul.
- El gradiente se hace con `uv.y` en el shader (`mix` según `dir`).
- Bloque elegido: `arg` de la acción (`'random'` o 1..5). Con `sweep.avoidRepeat` no repite el último bloque.

Params: `sweep.enabled` (bool), `sweep.opacity` (0..1), `sweep.duration` (s, 1.2), `sweep.length` (0..1, 0.7), `sweep.solidHeight` (0..1, 0.5), `sweep.dirBlue` / `sweep.dirWhite` / `sweep.dirSolid` (enum `down|up|random`; defaults down / up / random), `sweep.blueColor`, `sweep.whiteColor`, `sweep.avoidRepeat` (bool true). Actions: `sweep.blue`, `sweep.white`, `sweep.solid` (arg bloque).

---

## 10. Elementos 3D (spec)

Viven en `Layer3D` (escena three con `OffAxisCamera`). Todo en metros. `layer3d.opacity` multiplica a todos.

### 10.1 `Floor` — piso de carriles punteados (escena 7+)

Un `PlaneGeometry(60, 60)` rotado a y = 0, centrado en (0, 0, −25) (cubre z ∈ [−55, 5]). `MeshBasicNodeMaterial` transparente, `colorNode` blanco, `opacityNode`:

```
p = positionWorld
lane  = abs(fract(p.x / laneSpacing + 0.5) - 0.5) * laneSpacing        // distancia al centro del carril (m)
onLane = 1 - smoothstep(dashWidth/2 - aa, dashWidth/2 + aa, lane)     // aa = fwidth(p.x)
zz = -p.z + scroll                                                        // scroll avanza con el tiempo
onDash = 1 - smoothstep(dashLength/2 - aa, dashLength/2 + aa, abs(fract(zz / dashPeriod + 0.5) - 0.5) * dashPeriod)
reveal = 1 - smoothstep(revealDist - 0.5, revealDist, -p.z)             // crece desde la pantalla hacia el fondo
farFade = 1 - smoothstep(fadeFar * 0.6, fadeFar, -p.z)                  // evita moiré en el horizonte
opacity = onLane * onDash * reveal * farFade * floor.opacity * floor.brightness
```

Los dashes de todos los carriles quedan alineados en filas (como en la imagen 7). `scroll` avanza `floor.scrollSpeed · dt` (positivo = el patrón viene hacia el espectador). Como el patrón es periódico, el loop no se nota.

Params: `floor.opacity`, `floor.brightness` (0..1, 1), `floor.laneSpacing` (m, 0.5), `floor.dashLength` (m, 0.4), `floor.dashPeriod` (m, 1.0), `floor.dashWidth` (m, 0.08), `floor.scrollSpeed` (m/s, 0.6), `floor.revealDuration` (s, 4), `floor.fadeFar` (m, 30), `floor.revealDist` (m, estado, `sceneReset: false`). Actions: `floor.reveal` (tween revealDist 0 → 60 en revealDuration), `floor.hide` (tween → 0 en 1.5 s).

### 10.2 `BoxWire` — aristas de la caja (10, 11, 13, 16–19, 22, 23)

`THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)), new THREE.LineBasicNodeMaterial({ transparent: true }))`. Cada frame: `position = (box.x, box.y, box.z)`, `scale = (box.width, box.height, box.depth)`, `rotation.y = box.yaw`. Si `box.yawSpeed ≠ 0`, `Layer3D` avanza `box.yaw` cada frame (`params.set('box.yaw', wrap180(yaw + yawSpeed·dt), { immediate: true })`), así las aristas y el simulador leen siempre el mismo ángulo. Opacidad = `box.visible · layer3d.opacity · flicker`. Flicker: si `box.flicker`, `flicker = (fract(t · box.flickerRate) < box.flickerDuty) ? 1 : 0`. Las líneas son de 1 px (WebGPU no hace líneas gruesas); si Manuel quiere más grosor, reemplazar por 12 cajas finas (backlog).

Los params `box.*` los **comparte** con el simulador (§11.4), que los lee del mismo registro:
`box.visible` (0..1), `box.enabled` (bool, límite activo), `box.preset` (enum left/center/right; al cambiar, `params.tween('box.x', STAGE.box.presets[preset], transición actual)`), `box.x` `box.y` `box.z` (m), `box.width` `box.height` `box.depth` (m), `box.yaw` (grados, 45), `box.yawSpeed` (grados/s, 0), `box.wallStiffness` (0..2, 0.3), `box.wallMaxPush` (0..5, 1.0), `box.hardClamp` (bool false), `box.flicker` (bool), `box.flickerRate` (Hz, 8), `box.flickerDuty` (0..1, 0.5), `box.color` (`#FFFFFF`).

### 10.3 `RedBlock` — bloque rojo atractor (14, 15)

`PlaneGeometry` vertical apoyado en el piso, `MeshBasicNodeMaterial` rojo, `DoubleSide`. Posición: `x = redBlock.side == left ? -redBlock.x : +redBlock.x`, `y = height/2`, `z = redBlock.z`, `rotation.y = ±redBlock.yaw` (mirando levemente al centro). Cuando `redBlock.attract > 0` publica un atractor al simulador: `sim.setAttractor(0, centro, attract, attractRadius)`.

Params: `redBlock.opacity`, `redBlock.side` (enum left/right), `redBlock.x` (m, 3.3), `redBlock.z` (m, −1.0), `redBlock.width` (m, 2.2), `redBlock.height` (m, 2.4), `redBlock.yaw` (grados, 20), `redBlock.color` (`#B00000`), `redBlock.attract` (0..10, 0), `redBlock.attractRadius` (m, 2.0).

### 10.4 `Rays` — rayos que caen (17+)

Hasta 8 rayos simultáneos, gestionados en CPU. Cada rayo: barra vertical (`BoxGeometry(width, length, width)`, blanco, `bloomIntensity: rays.bloom`) en `(x, y, z)`; nace en `y = rays.startY` y cae a `rays.fallSpeed` m/s. Al llegar a `y = length/2` (tocó el piso): desaparece, dispara `debris.burst(x, z)` y un **shockwave** (repulsor puntual en el piso con radio que crece 0 → `rays.impactRadius` en 0.3 s y fuerza que decae a 0).

Mientras cae publica un **repulsor de segmento** al simulador: `sim.setRepulsor(slot, x, yBottom, z, yTop, strength, radius)`.

`ray.spawn(arg)`: `arg = 'random'` → x uniforme en [−3.8, 3.8]; `'left'|'center'|'right'` → −2.5 / 0 / 2.5 con jitter ±0.4; número → x en metros. z uniforme en [`rays.zMin`, `rays.zMax`].

Params: `rays.enabled` (bool), `rays.opacity`, `rays.fallSpeed` (m/s, 6), `rays.length` (m, 0.8), `rays.width` (m, 0.1), `rays.startY` (m, 4.5), `rays.zMin` (m, −2.5), `rays.zMax` (m, −0.5), `rays.repelRadius` (m, 1.0), `rays.repelStrength` (0..10, 3), `rays.impactRadius` (m, 1.5), `rays.impactStrength` (0..10, 4), `rays.bloom` (0..1, 1), `rays.color`. Action `ray.spawn`.

### 10.5 `Debris` — esquirlas blancas en el piso (17+)

`InstancedMesh(PlaneGeometry(size, size), MeshBasicNodeMaterial blanco, 4000)`, simulado en CPU: cada esquirla `{ pos, vel, yaw, life }`. `burst(x, z)`: `debris.count` esquirlas con velocidad radial `debris.speed · rand(0.3, 1)` + vertical `rand(0.5, 1.5) · speed`; gravedad `debris.gravity`; al tocar y = 0 rebota (`vel.y *= -bounce`) y frena (`vel.xz *= friction`); apoyadas quedan planas (rotación x = −90°) con yaw aleatorio; alpha decae en el último 30 % de `debris.lifetime`. Actualiza `instanceMatrix` de los vivos y pone escala 0 a los muertos; `instanceMatrix.needsUpdate = true`.

Params: `debris.count` (int, 60), `debris.size` (m, 0.06), `debris.speed` (m/s, 2), `debris.lifetime` (s, 3), `debris.gravity` (m/s², 6), `debris.bounce` (0..1, 0.4), `debris.friction` (0..1, 0.9), `debris.opacity`.

---

## 11. Partículas "palitos" (MLS-MPM portado)

### 11.1 Qué se reutiliza del repo `particlesvideo/`

Rutas relativas a `particlesvideo/` (desde el sub-proyecto `visuales/` son `../src/...`). **Copiar** los archivos al sub-proyecto, no importarlos desde `../src`: los sub-proyectos son independientes, como `poly/`.

| Archivo original | Destino | Qué hacer |
|---|---|---|
| `src/mls-mpm/mlsMpmSimulator.js` | `layers3d/particles/MlsMpmSimulator.js` | Portar los kernels `clearGrid`, `p2g1`, `p2g2`, `updateGrid`, `g2p` (líneas 116–404). **Quitar**: todo lo de imagen/video (`imageGridSampler`, `imageUploadManager`, `updateEmitter`, `startVideoSampling`, `initializeFromImage`, `shufflePixelOrder`, `getNextPixelIndex`, `resetParticlesToSphere`), `particleLifetimes`/`particleAlive` (CPU), sensor de gravedad, `mouseRay*` (opcional dejarlo apagado), color HSV en el sim. **Agregar**: §11.3–11.6. |
| `src/mls-mpm/particleRenderer.js` | `layers3d/particles/StickRenderer.js` | Mantener `calcLookAtMatrix`, `createRoundedBox`, la geometría fusionada y el `positionNode`. Cambiar color/opacidad (§11.7). Quitar lifetime fade (o dejarlo con lifetime infinito). |
| `src/mls-mpm/structuredArray.js` | `layers3d/particles/StructuredArray.js` | Copiar tal cual. |
| `src/common/noise.js` | `layers3d/particles/noise.js` | Copiar tal cual (`triNoise3Dvec`). |
| `src/conf.js` | — | No se copia. Sus campos pasan a ser params `particles.*` (misma fórmula de `updateParams`: `level = max(count/8192, 1)`, `actualSize = 1.6/level^(1/3) · size`, `restDensity = 0.25 · level · density`). |
| `src/app.js` | — | Referencia para el grafo de bloom (ya está en §8.2). |
| Todo lo demás (HDRI, texturas, backgroundGeometry, lights, info, poly, moon) | — | No se usa. |

### 11.2 Struct de partícula

Igual al original menos `color`, `birthTime`, `lifetime` (quedan `position, density, velocity, mass, C, direction, alive`). 128 → 96 bytes por partícula; con 262 144 partículas ≈ 25 MB. Si se quiere mantener `alive` para futuros usos, dejarlo.

### 11.3 Grilla y dominio

- `gridSize = round((sim.max − sim.min) / cellSize)` = (90, 40, 60). Todo el código de kernels ya usa `uniforms.gridSize` por eje, así que grillas no cúbicas funcionan.
- Los límites duros del dominio (margen de 2 celdas en `p2g`/`g2p`/`updateGrid`) **se mantienen tal cual**: son la pared exterior del escenario (para el modo "libres").
- `dt = min(interval, 1/60) · 6 · particles.speed` como el original.

### 11.4 Caja como sub-AABB rotable (reemplaza el bloque `containParticles` del `g2p`)

Uniforms nuevos: `boxEnabled (uint)`, `boxCenter (vec3, grid)`, `boxHalf (vec3, grid)`, `boxYaw (float, rad)`, `wallStiffness`, `wallMaxPush`, `hardClamp (uint)`. Al final de `g2p`, después de `particlePosition.addAssign(velocity·dt)`:

```
If(boxEnabled == 1):
  c = cos(boxYaw), s = sin(boxYaw)
  rel = pos - boxCenter
  local = vec3( c*rel.x - s*rel.z,  rel.y,  s*rel.x + c*rel.z )        // rotar -yaw alrededor de Y
  lv    = vec3( c*vel.x - s*vel.z,  vel.y,  s*vel.x + c*vel.z )
  If(hardClamp): local = clamp(local, -boxHalf, boxHalf)
  xN = local + lv*dt*3                                                   // predicción, como el original
  pen = max(0, -boxHalf - xN) - max(0, xN - boxHalf)                     // penetración con signo, por eje
  lv += clamp(pen * wallStiffness, -wallMaxPush, wallMaxPush)
  // volver a mundo
  pos = boxCenter + vec3( c*local.x + s*local.z, local.y, -s*local.x + c*local.z )
  vel = vec3( c*lv.x + s*lv.z, lv.y, -s*lv.x + c*lv.z )
```

El CPU calcula `boxCenter`/`boxHalf` en unidades de grilla desde los params `box.*` (metros) cada frame: `center_grid = (box.xyz − sim.min)/cellSize`, `half_grid = (box.whd/2)/cellSize`. `wallMaxPush` evita explosiones cuando la caja se re-activa con partículas afuera (escena 22).

### 11.5 Fuerzas (`Forces.js` = uniforms + bloque TSL insertado en `g2p` donde el original suma gravedad y ruido)

Todo en unidades de grilla por paso (misma escala que el original: gravedad 0.2, ruido 0.28).

```
v += gravityVec * dt                                   // particles.gravityY (0 por defecto)
v += flow * dt                                          // particles.flowX/Y/Z  (escena 12: flowY > 0)
v -= curlNoise(pos*turbScale, time, turbSpeed) * turbulence * dt      // ya existe (triNoise3Dvec)
for i in 0..attractorCount-1:                           // uniformArray vec4 [x,y,z,strength] + vec4 [radius,...]
  d = att[i].xyz - pos;  dist = length(d)
  v += normalize(d) * att[i].w / (1 + (dist/radius_i)^2) * dt
if vortexSwirl>0 or vortexPull>0:                       // eje vertical en (vx, vz)
  r = vec2(pos.x - vx, pos.z - vz); dist = length(r); f = 1/(1 + (dist/vortexRadius)^2)
  tangent = vec2(-r.y, r.x)/max(dist, 0.01)
  v.xz += (tangent*vortexSwirl - r/max(dist,0.01)*vortexPull) * f * dt
  v.y  += vortexLift * f * dt
for i in 0..repulsorCount-1:                            // uniformArray vec4 [x, yBottom, z, yTop] + vec4 [strength, radius, 0, 0]
  q = vec3(rep.x, clamp(pos.y, rep.y, rep.w), rep.z)    // punto más cercano del segmento vertical
  d = pos - q; dist = length(d)
  v += normalize(d) * strength_i * clamp(1 - dist/radius_i, 0, 1) * dt
v *= (1 - drag*dt)                                      // particles.drag
v += kick * curlNoise(...)                              // particles.kick: impulso de turbulencia que decae (kickAmount·exp(-t/kickDecay))
```

Límites: `MAX_ATTRACTORS = 4`, `MAX_REPULSORS = 8`. Las posiciones se convierten a grilla en CPU. `uniformArray` de `'three/tsl'`; contadores como `uniform(0,'uint')`.

API CPU del simulador: `setAttractor(slot, worldPos, strength, radius)`, `clearAttractor(slot)`, `setRepulsor(slot, x, yBottom, z, yTop, strength, radius)`, `clearRepulsor(slot)`, `setVortex(...)` (o lee params directo), `resetInBox()`.

### 11.6 Emisión continua por wrap (escena 12) y reset en GPU

- `wrapMode (uint)`: 0 = nada; 1 = **vertical**: si `local.y > boxHalf.y` (o `pos.y > wrapTop` cuando la caja está desactivada) → `local.y = -boxHalf.y + 0.5`, `local.x/z = (hash(instanceIndex + frame) - 0.5) * 2 * boxHalf.xz`, `vel = flow`, `C = 0`. Se evalúa después del bloque de caja. `hash` de TSL. **2 = horizontal** (agregado 2026-09-04, escenas 14/15): cruza la caja en el sentido de `flowX` y al llegar a la pared de destino renace en la de enfrente con y/z al azar. El test va en el espacio LOCAL de la caja, no en X del mundo: con la caja girada, el clamp la frena contra su propia pared y un umbral en X del mundo no se alcanzaría nunca.
- Kernel `resetInBox` (compute, `count = maxParticles`): posición uniforme aleatoria dentro de la caja actual (en local → mundo con yaw), `vel = 0`, `C = 0`, `mass = 1 - hash·0.002`, `density = 1`, `alive = 1`. Se ejecuta con `renderer.computeAsync(kernels.resetInBox)` cuando se dispara la action `particles.resetInBox` (la disparan las escenas 10 y cualquier otra que lo liste). También `particles.resetSphere` opcional.
- El número activo `particles.count` se cambia como en el original (`kernel.count = n; kernel.updateDispatchCount()`), con `onChange`.

### 11.7 `StickRenderer` — color y opacidad

```
speed   = length(particle.velocity)                            // unidades grilla/paso
white   = smoothstep(whiteSpeedMin, whiteSpeedMax, speed)
colorNode   = mix(uBaseColor, vec3(1), white)
opacityNode = uOpacity * float(particle.alive == 1)
mrtNode     = { bloomIntensity: uBloom }
material.transparent = true; depthWrite = false               // como el original
```

`positionNode` igual al original (matriz look-at por `direction`, escala por `size`/`length` y por densidad). El `object.position = sim.min`, `object.scale = cellSize` (los tres ejes iguales). `uBaseColor` se actualiza desde `particles.baseColor` (tweeneado por Params → transiciones rojo → azul suaves).

Params: `particles.opacity`, `particles.count` (int 4096..524288, 262144, paso 4096), `particles.baseColor` (`#FF0000`), `particles.whiteSpeedMin` (0..5, 0.6), `particles.whiteSpeedMax` (0..10, 3.0), `particles.size` (0.5..6, 2), `particles.length` (0.02..4, 1.0), `particles.speed` (0..2, 0.8), `particles.turbulence` (0..2, 0.6), `particles.turbulenceScale` (0.005..0.05, 0.015), `particles.turbulenceSpeed` (0..2, 0.5), `particles.density` (0.4..2, 0.4), `particles.stiffness` (0.5..10, 3), `particles.viscosity` (0.01..0.4, 0.1), `particles.gravityY` (−1..1, 0), `particles.flowX/Y/Z` (−3..3, 0), `particles.drag` (0..1, 0), `particles.wrapMode` (enum off/vertical), `particles.wrapTop` (m, 3.5), `particles.bloom` (0..1, 1), `particles.kickAmount` (0..3, 1), `particles.kickDecay` (s, 0.4). Actions: `particles.resetInBox`, `particles.kick`.
Vortex: `vortex.swirl` (0..4, 0), `vortex.pull` (0..4, 0), `vortex.lift` (−2..2, 0), `vortex.radius` (m, 2), `vortex.x` (m, 0), `vortex.z` (m, −1.84).

### 11.8 Orden por frame (Engine)

```
params.update(dt)
layer2d.update(dt)                 // mueve línea, grillas, barridos
layer3d.update(dt)                 // cámara, piso, caja, redBlock→atractor, rays→repulsores, debris, sube uniforms del sim
await sim.update(dt)               // compute: clearGrid, p2g1, p2g2, updateGrid, g2p
await compositor.render()          // post.renderAsync()
bridge.tick()                      // values 10 Hz, stats 2 Hz
```

---

## 12. Storyboard → escenas

Ids = número de imagen. Notas: `T` = trigger dentro de la escena (no cambia de escena). Los valores son puntos de partida para afinar a ojo.

| Escena | Imagen | Qué se ve | Params clave (sobre BASE) | Triggers/CC dentro de la escena |
|---|---|---|---|---|
| **1** | 1, 1b | Placa de advertencia: chevrones ámbar, "ADVERTENCIA", "LUCES PARPADEANTES" | `warning.band 1`, `warning.bg 1`; transición 1.0 | T `1b` → `warning.bgOff` (fondo a 4 %); `warning.pulse`; CC → `warning.bg` |
| **2** | 2, 2b | Se apaga la placa con fade muy suave; queda marco rojo oscuro + línea blanca vertical fina tipo "trueno": aparece de arriba a abajo, avanza lento, se apaga al salir por el borde | `frame.opacity 1`, `frame.color #7A0000`, `line.opacity 1`, `line.mode strike`, `line.speed 30`; actions `line.strike edge`; transición 3.0 | nota → `line.strike`; T `2b` → `line.flip`; CC → `line.speed` |
| **3** | 3 | Igual + grilla gruesa: la pantalla dividida en 5 columnas (× 2 filas), líneas 1 px tenues; cada bloque con su desplazamiento | `grid.opacity 1`, `grid.coarse true`, `grid.lineWidth 1`, `grid.brightness 0.35`, `grid.b1..b5.enabled true`, `grid.scrollSpeed 8` | notas → `grid.bN.flip` |
| **4** | 4 | Grillas finas por bloque que se prenden/apagan con notas; cada grilla se desplaza a izq/der según otra nota | `grid.coarse false`, `grid.cellW 96`, `grid.cellH 96`, `grid.brightness 0.6`, b1/b3/b5 on, b2/b4 off | notas → `grid.bN.toggle`; notas → `grid.bN.flip`; CC → `grid.scrollSpeed` |
| **5** | 5 | Misma dinámica que la 4 (Manuel: "sigue misma dinámica"); entrada propia por si después se diferencia | como 4 | idem |
| **6** | 6, 6b, 6c | Igual que 4 + barridos en un bloque aleatorio: azul con gradiente (6), blanco con gradiente (6b), bloque azul sólido de media pantalla (6c) | como 4 + `sweep.enabled true`, `sweep.opacity 1` | T `6` → `sweep.blue random`; T `6b` → `sweep.white random`; T `6c` → `sweep.solid random` |
| **7** | 7 | Se apaga el marco; aparece el piso de carriles punteados con fuga (cámara 4 m / 1 m), se extiende hacia el fondo y luego avanza suave sin loop visible. **La grilla de la escena anterior NO se apaga**: sigue encima del piso, más tenue (pedido de Manuel, 2026-09-04 — antes se cortaba en seco al entrar) | `layer3d.opacity 1`, `floor.opacity 1`, `grid.opacity 1` con el reparto de bloques de la 6 y `grid.brightness 0.26`; actions `floor.reveal`; transición 2.0 | T → `grid.toggleAll` / `grid.bN.toggle` (grillas encima del piso); CC → `floor.scrollSpeed` |
| **8** | — | No está en el storyboard. Piso + grilla (reparto invertido) + los barridos de la 6 | como 7 + `sweep.enabled true`, `floor.scrollSpeed 1.2` | T → `sweep.blue/white/solid random` |
| **9** | — | No está en el storyboard. Piso rápido + grilla gruesa + trueno: el puente hacia el 3D puro de la 10 | `floor.scrollSpeed 2.4`, `grid.coarse true`, `line.opacity 1` `line.speed 90` | T → `line.strike random` |
| **10** | 10 | Sin piso. Caja de aristas (más alta que ancha, rotada 45°, ocupa el alto de la pantalla) llena de palitos **blancos** con turbulencia suave, contenidos | `floor.opacity 0`, `box.visible 1`, `box.enabled true`, `box.preset center`, `particles.opacity 1`, `particles.baseColor #FFFFFF`, `particles.turbulence 0.8`; actions `particles.resetInBox` | CC → `particles.turbulence`, `particles.size`, `particles.length`, `box.yaw` |
| **11** | 11 | Vuelve el piso; partículas rojas, siguen adentro de la caja | como 10 + `floor.opacity 1`, `particles.baseColor #FF0000`, `whiteSpeedMin 0.8` | |
| **12** | 12 | Desaparecen las aristas; partículas azules suben en flujo constante, a **un tercio** de la velocidad original y en hélice. **Siempre azul**: el umbral de blanco se pone muy por encima de la velocidad que alcanzan | `box.enabled false`, `particles.flowY 0.35`, `particles.wrapMode vertical`, `vortex.swirl 0.6`, `whiteSpeedMin 18` | CC → `particles.flowY` |
| **13** | 13 | Vuelve la caja; rojas con turbulencia (movimiento interno, no flujo) | como 11 | |
| **14** | 14 | Bloque rojo a la izquierda. **No hay atractor**: los palitos son un STREAM que cruza la caja hacia el bloque y, apenas tocan la pared de llegada, mueren y renacen en la de enfrente. Así no se apelmazan nunca | `box.visible 1`, `box.preset center`, `box.yaw 0`, `particles.wrapMode horizontal`, `flowX −3`, `drag 0.02`, `density 1.4`, `redBlock.attract 0` | CC → `particles.flowX` |
| **15** | 15 | Igual, stream hacia el bloque de la derecha | como 14 + `redBlock.side right`, `flowX +3` | |
| **16** | 16 | Caja visible corrida a la izquierda; partículas rojo/blanco con turbulencia | `box.visible 1`, `box.preset left`, `redBlock.opacity 0`, `redBlock.attract 0`, `particles.baseColor #FF0000` | |
| **17** | 17 | Caja al centro; rayos blancos caen y explotan en el piso generando debris; repelen partículas | como 13 + `rays.enabled true`, `rays.opacity 1`, `debris.opacity 1` | T (batería) → `ray.spawn random` |
| **18** | 18 | Caja a la izquierda + rayos | como 17 + `box.preset left` | idem |
| **19** | 19 | Caja a la derecha + rayos | como 17 + `box.preset right` | idem |
| **20** | 20 | Las partículas se liberan (sin límite) y vuelan por toda la pantalla. Las mueve el **campo** (`field.*`): un ruido 3D direccional con 5 sectores, cada franja con su comportamiento y su velocidad. **No lleva torbellino**: tiene centro y entonces dejan de estar libres | `box.enabled false`, `field.amount 0.5`, `field.align 2.6`, `field.sectors 5`, `particles.drag 0.02`, rays on | idem |
| **21** | 21 | Torbellino: fuerza tubular que las acerca y las hace girar | como 20 + `vortex.swirl 1.2`, `vortex.pull 0.6`, `vortex.radius 2.5` | CC → `vortex.swirl`, `vortex.pull` |
| **22** | 22 | Vuelve la caja (aristas + límite); torbellino más fuerte, muy blancas cerca del centro; rayos siguen | `box.enabled true`, `box.visible 1`, `box.preset center`, `vortex.swirl 2.2`, `vortex.pull 1.4`, `whiteSpeedMin 0.4` | idem |
| **23** | 23 | **Sin caja**: lo que sostiene la forma es el torbellino, más fuerte y por eso más fino, **con estrobo** (corta la fuerza 11 veces por segundo, así la columna late) | `box.enabled false`, `particles.density 2`, `vortex.pull 30`, `vortex.radius 3.2`, `vortex.strobe 0.85`, `particles.flicker 0.8` | nota gate → `particles.flicker` / `vortex.strobe` |

**Dos reglas de transición que valen para toda la tabla** (2026-09-04):
- La caja **no se traslada** al cambiar de preset: aparece ya en su lugar y el límite salta con
  ella (`BoxWire` hace `set` inmediato, no tween).
- El **color de las partículas corta en 0.15 s** aunque la escena entre en 1.5, vía el mapa
  `transitions` de la escena: un fundido de rojo a azul se ve como un lavado violeta.

Canales MIDI sugeridos (Manuel ya los tiene en Ableton; solo es orientación para el JSON default): canal 1 = escenas (`scene.goto`), canal 2 = batería (rayos, barridos, kicks), canal 3 = sintes (grillas, línea, flicker), CC en cualquier canal. Todo se define con learn en el editor.

---

## 13. Registro completo de parámetros y acciones

(Referencia para el editor y para el mapeo. `SR` = sceneReset.)

| id | tipo | rango / opciones | default | SR | notas |
|---|---|---|---|---|---|
| `master.brightness` | float | 0..1 | 1 | no | multiplica la salida |
| `master.blackout` | bool | | false | no | |
| `master.bloomEnabled` | bool | | true | no | |
| `master.quality` | enum | ultra/high/medium/low | high | no | preset de carga (§14 Fase 9); se persiste por máquina |
| `bloom.strength` | float | 0..2 | 0.9 | no | |
| `bloom.radius` | float | 0..1 | 0.8 | no | |
| `bloom.threshold` | float | 0..1 | 0 | no | |
| `ao.resolutionScale` | float | 0.25..1, paso 0.25 | 0.5 | no | Escala solo GTAO; 0.5 procesa un cuarto de los píxeles. Geometría y salida 2D conservan resolución nativa; 1 restaura AO completo. |
| `camera.eyeX` `eyeY` `eyeZ` | float | −4..4 / 0..3 / 1..10 | 0 / 1.0 / 4.0 | no | §2.4 |
| `scene.current` | enum | ids | '1' | no | solo lectura práctica |
| `scene.goto` `scene.next` `scene.prev` | action | arg id | | | |
| `layer3d.opacity` | float | 0..1 | 0 | sí | |
| `warning.band` `warning.bg` | float | 0..1 | 0 | sí | bg con smooth 0.3 |
| `warning.scroll` | float | −200..200 px/s | 0 | sí | |
| `warning.pulseAttack` `pulseRelease` | float | 0.1..10 s | 1 / 2 | sí | |
| `warning.pulse` `warning.bgOff` `warning.bgOn` | action | | | | 1b = bgOff |
| `frame.opacity` | float | 0..1 | 0 | sí | |
| `frame.thickness` | int | 1..60 px | 10 | sí | |
| `frame.color` | color | | #7A0000 | sí | |
| `line.opacity` | float | 0..1 | 0 | sí | |
| `line.mode` | enum | strike/loop | strike | sí | §9.3 |
| `line.width` | int | 1..20 px | 3 | sí | |
| `line.speed` | float | 0..600 px/s | 30 | sí | |
| `line.direction` | int | −1 / 1 | 1 | sí | |
| `line.orientation` | enum | vertical/horizontal | vertical | sí | |
| `line.strikeTime` | float | 0.02..1 s | 0.12 | sí | aparición arriba→abajo |
| `line.fadeOut` | float | 0..2 s | 0.3 | sí | |
| `line.maxLines` | int | 1..8 | 1 | sí | |
| `line.x` | float | 0..2688 | 0 | no | estado vivo |
| `line.wrap` | bool | | true | sí | solo modo loop |
| `line.strike` `line.flip` `line.rotate` `line.hide` | action | strike: arg edge/center/random/px | | | flip = 2b |
| `grid.opacity` | float | 0..1 | 0 | sí | |
| `grid.lineWidth` | int | 1..8 px | 1 | sí | |
| `grid.brightness` | float | 0..1 | 0.6 | sí | |
| `grid.cellW` `grid.cellH` | int | 8..1008 px | 96 | sí | |
| `grid.coarse` | bool | | false | sí | celdas = bloque |
| `grid.scrollSpeed` | float | 0..400 px/s | 12 | sí | |
| `grid.pixelSnap` | bool | | true | no | |
| `grid.fadeTime` | float | 0..2 s | 0.15 | no | |
| `grid.bN.enabled` (N=1..5) | bool | | false | sí | |
| `grid.bN.dir` | int | −1 / 1 | 1 | sí | |
| `grid.bN.speedMul` | float | 0..3 | 1 | sí | |
| `grid.bN.offsetY` | float | 0..1008 | 0 | sí | |
| `grid.bN.offsetX` | float | −1008..1008 | 0 | sí | corrimiento horizontal, aparte del scroll |
| `grid.offsetTime` | float | 0..3 s | 0.35 | sí | el corrimiento se desliza, no salta (0 = salto) |
| `grid.offsetStep` | float | 1..1008 px | 42 | sí | cuánto corre cada disparo |
| `grid.offsetEase` | enum | smooth/out/linear | out | no | curva del deslizamiento |
| `grid.offsetAxis` | enum | vertical/horizontal/ambos/random | vertical | sí | eje del corrimiento |
| `grid.bN.toggle` `grid.bN.flip` `grid.toggleAll` `grid.randomize` | action | | | | |
| `grid.nudge` `grid.bN.nudge` | action | arg v \| h \| ambos \| random \| px | | | corrimiento suave |
| `grid.offsetReset` | action | | | | vuelve los offsets a cero |
| `sweep.enabled` | bool | | false | sí | |
| `sweep.opacity` | float | 0..1 | 1 | sí | |
| `sweep.duration` | float | 0.1..6 s | 1.2 | sí | |
| `sweep.length` | float | 0.1..1.5 | 0.7 | sí | fracción del alto |
| `sweep.solidHeight` | float | 0.1..1 | 0.5 | sí | fracción del alto que cubre el sólido al posarse |
| `sweep.solidHold` | float | 0..8 s | 0.8 | sí | cuánto se queda quieto antes de apagarse |
| `sweep.solidFade` | float | 0.05..4 s | 0.5 | sí | se apaga EN EL LUGAR, no sale de cuadro |
| `sweep.dirBlue` `dirWhite` `dirSolid` | enum | down/up/random | down / up / random | sí | |
| `sweep.blueColor` `sweep.whiteColor` | color | | #0000C8 / #C8C8C8 | sí | |
| `sweep.avoidRepeat` | bool | | true | no | |
| `sweep.blue` `sweep.white` `sweep.solid` | action | arg random / 1..5 | | | 6 / 6b / 6c |
| `floor.opacity` `floor.brightness` | float | 0..1 | 0 / 1 | sí | |
| `floor.laneSpacing` `dashPeriod` | float | m | 0.7 / 1.1 | sí | no cambian al achicar el dash |
| `floor.dashLength` `dashWidth` `dashHeight` | float | m | 0.385 / 0.105 / 0.021 | sí | 30% más chicos que el original |
| `floor.scrollSpeed` | float | −5..5 m/s | 0.6 | sí | |
| `floor.revealDuration` | float | 0.1..20 s | 4 | sí | |
| `floor.fadeFar` | float | 5..60 m | 30 | sí | |
| `floor.revealDist` | float | 0..60 | 0 | no | estado |
| `floor.reveal` `floor.hide` | action | | | | |
| `box.visible` | float | 0..1 | 0 | sí | opacidad de aristas |
| `box.enabled` | bool | | true | sí | límite físico |
| `box.preset` | enum | left/center/right | center | sí | tweenea box.x |
| `box.x` | float | −6..6 m | 0 | **no** | estado vivo: lo maneja `box.preset`, la escena no lo pisa |
| `box.y` `box.z` | float | m | 1.5 / −1.84 | sí | |
| `box.width` `box.height` `box.depth` | float | 0.5..8 m | 2.6 / 3.0 / 2.6 | sí | |
| `box.yaw` | float | −180..180 ° | 45 | sí | mapeable a CC |
| `box.yawSpeed` | float | −90..90 °/s | 0 | sí | rotación continua |
| `box.wallStiffness` | float | 0..2 | 0.3 | sí | |
| `box.wallMaxPush` | float | 0..40 | 1.0 | sí | era SR=no: se filtraba a las escenas siguientes |
| `box.hardClamp` | bool | | false | sí | idem |
| `box.flicker` | bool | | false | sí | |
| `box.flickerRate` | float | 0.5..30 Hz | 8 | sí | |
| `box.flickerDuty` | float | 0..1 | 0.5 | sí | |
| `box.color` | color | | #FFFFFF | sí | |
| `redBlock.opacity` | float | 0..1 | 0 | sí | |
| `redBlock.side` | enum | left/right | left | sí | |
| `redBlock.x` `redBlock.z` | float | m | 3.3 / −1.0 | sí | |
| `redBlock.width` `redBlock.height` | float | m | 2.2 / 2.4 | sí | |
| `redBlock.yaw` | float | ° | 20 | sí | |
| `redBlock.color` | color | | #B00000 | sí | |
| `redBlock.attract` | float | 0..400 | 0 | sí | fuerza atractor (techo subido para las escenas 14/15) |
| `redBlock.attractRadius` | float | 0.2..6 m | 2.0 | sí | |
| `redBlock.attractDir` | float | 0..1 | 1 | sí | 0 = atrae a un punto, 1 = empuja en dirección |
| `redBlock.attractPulse` | float | 0..2 | 0 | sí | la fuerza late; **por encima de 1 se da vuelta** y el bloque empuja en el valle |
| `redBlock.attractPulseRate` | float | 0.2..30 Hz | 2 | sí | arriba de ~4 Hz es vibración, no envión |
| **Dirección del empuje** | — | — | — | — | es el eje **X de la pantalla** (±1,0,0), no la normal del bloque |
| `particles.opacity` | float | 0..1 | 0 | sí | |
| `particles.count` | int | 4096..524288 (paso 4096) | 262144 | no | 3090: preset "ultra" = 524288 |
| `particles.baseColor` | color | | #FF0000 | sí | |
| `particles.whiteSpeedMin` `whiteSpeedMax` | float | 0..5 / 0..10 | 0.6 / 3.0 | sí | |
| `particles.size` | float | 0.5..6 | 2 | sí | |
| `particles.length` | float | 0.02..4 | 1.0 | sí | |
| `particles.speed` | float | 0..2 | 0.8 | sí | escala de dt |
| `particles.turbulence` | float | 0..2 | 0.6 | sí | |
| `particles.turbulenceScale` | float | 0.005..0.05 | 0.015 | sí | |
| `particles.turbulenceSpeed` | float | 0..2 | 0.5 | sí | |
| `particles.density` | float | 0.4..2 | 0.4 | sí | densidad de REPOSO: sube y la masa ocupa menos volumen (así se afina la 23) | |
| `particles.stiffness` | float | 0.5..10 | 3 | no | |
| `particles.viscosity` | float | 0.01..0.4 | 0.1 | no | |
| `particles.gravityY` | float | −1..1 | 0 | sí | |
| `particles.flowX` `flowY` `flowZ` | float | −3..3 | 0 | sí | |
| `particles.drag` | float | 0..1 | 0 | sí | |
| `particles.wrapMode` | enum | off/vertical/**horizontal** | off | sí | |
| `particles.wrapTop` | float | 0..4 m | 3.5 | sí | |
| `particles.bloom` | float | 0..1 | 1 | sí | |
| `particles.kickAmount` `kickDecay` | float | 0..3 / 0.05..3 s | 1 / 0.4 | sí | |
| `particles.resetInBox` `particles.kick` | action | | | | |
| `vortex.swirl` `vortex.pull` | float | 0..30 | 0 | sí | techo subido para la 23 |
| `vortex.lift` | float | −2..2 | 0 | sí | |
| `vortex.radius` | float | 0.2..6 m | 2 | sí | |
| `vortex.response` | float | 0..60 1/s | 0 | sí | Modificador de velocidad reconstruida; escena 21 usa 45 para girar de inmediato. 0 conserva fuerzas anteriores. |
| `vortex.x` `vortex.z` | float | m | 0 / −1.84 | sí | |
| `vortex.strobe` | float | 0..1 | 0 | sí | corta la FUERZA del torbellino (0 = siempre on) |
| `vortex.strobeRate` | float | 0.2..40 Hz | 10 | sí | |
| `vortex.strobeDuty` | float | 0.05..0.95 | 0.4 | sí | fracción del ciclo encendida |
| `field.amount` | float | 0..6 | 0 | sí | **campo**: empuje hacia un ruido 3D direccional |
| `field.align` | float | 0..12 1/s | 0 | sí | gira la velocidad hacia el campo (lectura de bandada) |
| `field.scale` | float | 0.002..0.06 | 0.012 | sí | escala espacial del ruido |
| `field.speed` | float | 0..3 | 0.35 | sí | qué tan rápido evoluciona |
| `field.sectors` | int | 1..5 | 3 | sí | franjas verticales con comportamiento propio |
| `field.variation` | float | 0..1 | 0.7 | sí | cuán distinto es cada sector (0 = uno solo) |
| `field.speedSpread` | float | 0..1 | 0.5 | sí | diferencia de velocidad entre sectores |
| `rays.enabled` | bool | | false | sí | |
| `rays.opacity` | float | 0..1 | 0 | sí | |
| `rays.fallSpeed` | float | 0.5..30 m/s | 6 | sí | |
| `rays.length` `rays.width` | float | m | 0.8 / 0.1 | sí | |
| `rays.startY` | float | 3..8 m | 4.5 | sí | |
| `rays.zMin` `rays.zMax` | float | −5..0 m | −2.5 / −0.5 | sí | |
| `rays.repelRadius` `rays.repelStrength` | float | m / 0..200 | 1.6 / 25 | sí | el rayo abre un canal MIENTRAS CAE |
| `rays.impactRadius` `rays.impactStrength` | float | m / 0..200 | 2.6 / 60 | sí | golpe al tocar el piso |
| `rays.bloom` | float | 0..1 | 1 | sí | |
| `rays.color` | color | | #FFFFFF | sí | |
| `ray.spawn` | action | arg random/left/center/right/número | | | |
| `debris.opacity` | float | 0..1 | 0 | sí | |
| `debris.count` | int | 0..300 | 60 | sí | |
| `debris.size` | float | 0.01..0.3 m | 0.06 | sí | |
| `debris.speed` | float | 0..40 m/s | 11 | sí | explosión, no tiro suave |
| `debris.lifetime` | float | 0.05..10 s | 0.35 | sí | salen disparadas y desaparecen rápido |
| `debris.spread` | float | 0..1 | 0.7 | sí | apertura del cono (0 = vertical, 1 = media esfera) |
| `debris.drag` | float | 0..30 1/s | 6 | sí | frena el estallido en el aire |
| `debris.gravity` | float | 0..20 | **0** | sí | 0 = sin parábola que cae (pedido de Manuel) |
| `debris.bounce` `debris.friction` | float | 0..1 | 0.4 / 0.9 | sí | |

---

## 14. Fases de ejecución

Cada fase: objetivo → tareas → archivos → aceptación. Commit al final de cada una.

### Fase 0 — Esqueleto del proyecto

**Tareas**
1. Crear `particlesvideo/visuales/` (C13: sub-proyecto dentro del repo existente, como `poly/`) con `npm init`, dependencias de §4.1, `vite.config.js` (`base: './'`, `server.port 5173`, `build.rollupOptions.input: { main: 'index.html', editor: 'editor.html' }`), `.gitignore` propio (node_modules, dist). **No** hacer `git init`: crear la rama `visuales` en el repo existente (`git checkout -b visuales`) y commitear ahí; Manuel decide cuándo mergear. Anotar en README que `node_modules` conviene excluirlo del sync de OneDrive.
2. `index.html`: fondo negro, `<div id="stage">`, `<script type="module" src="/src/main.js">`. Sin ningún otro elemento visible.
3. `config/stage.js` (§2.7). `render/Renderer.js` (§8.1) con escalado CSS. `core/Engine.js` con loop rAF, `dt` clampeado a 1/30, contador fps en un overlay `<div>` (toggle `F`).
4. Pantalla de error legible si no hay WebGPU.
5. `README.md` con cómo correr. `NOTAS.md` vacío.

**Aceptación**: `npm run dev` → Chrome muestra canvas negro de 2688 × 1008 escalado a la ventana, overlay fps ~60, consola sin errores, `renderer.backend.isWebGPUBackend === true`.

### Fase 1 — Núcleo: Params, escenas, capa 2D, compositor

**Tareas**
1. `core/Params.js` completo (§5) con tests manuales en consola (`window.vis = ctx` en dev).
2. `core/Tween.js` (smoothstep). `core/SceneManager.js` (§6) con `BASE` y dos escenas de prueba.
3. `layers2d/Layer2D.js` con ortográfica en píxeles; elemento de prueba `TestRect` (quad 100 × 100 en (0,0) blanco) — solo para verificar coordenadas, se borra después.
4. `layers3d/Layer3D.js` con `OffAxisCamera` (§2.4) y un cubo de 1 m en (0, 0.5, −2) de prueba.
5. `render/Compositor.js` (§8.2) con 3D + 2D (bloom puede quedar con strength 0 por ahora).
6. `core/Keyboard.js` (§7.4, los atajos que ya tengan sentido).

**Aceptación**: el cuadrado blanco aparece arriba-izquierda tapando al cubo; `params.tween('test.opacity', 0, 2)` desde consola lo desvanece; `,`/`.` cambian entre las 2 escenas de prueba con tween; el cubo se ve con perspectiva coherente (el piso y = 0 proyecta a píxel y ≈ 672 en el horizonte: mover la cámara con `camera.eyeY` mueve el horizonte).

### Fase 2 — IO: MIDI, OSC, Mapper, Bridge, Editor

**Tareas**
1. `io/MidiInput.js` (§7.1). `io/Mapper.js` (§7.3) con todos los modos, fan-out, filtro por escena, learn, persistencia, rutas OSC automáticas.
2. `tools/osc-bridge.mjs` + `io/OscClient.js` (§7.2). Script `npm run osc`.
3. `io/Bridge.js` (§7.5).
4. `editor.html` + `src/editor/*` (§7.6–7.7): escenas, params (Tweakpane + lista de referencia con direcciones OSC), mapeos con learn, monitor, probar, puerto UDP editable, **exportar hoja de referencia** (.md y .csv).
5. `public/mappings.default.json` inicial: filas para `scene.goto` de cada id de escena (fuente vacía, para aprender) y ejemplos de cada modo.

**Aceptación**: con loopMIDI + Ableton (o el panel "Probar"): una nota aprendida cambia de escena; un CC mueve un slider en vivo; una misma nota mapeada a dos destinos dispara ambos; el filtro por escena funciona; recargar la página conserva los mapeos; `Exportar` baja un JSON válido; enviar `/p/test/opacity 0.5` por OSC (`node -e` con el paquete `osc`, o TouchOSC) cambia el valor; la hoja de referencia exportada lista todos los params y acciones con su dirección OSC y su fuente MIDI; cambiar el puerto UDP desde el editor hace que el bridge escuche en el puerto nuevo.

### Fase 3 — Elementos 2D y escenas 1 a 6

**Tareas**
1. `WarningPlate` (§9.1), `Frame` (§9.2), `MovingLine` (§9.3), `GridBlocks` (§9.4), `Sweeps` (§9.5). Borrar `TestRect`.
2. Escenas `1, 2, 3, 4, 5, 6` en `scenes/index.js` según §12, con `mainAction` (Space) = `warning.pulse` / `line.strike` / `grid.toggleAll` / `sweep.blue`.
3. Verificar orientación de `screenCoordinate.y` y anotar en NOTAS.

**Aceptación**: comparar contra `STORYBOARD/1.png … 6c.png` a ojo: placa con fuente correcta; 1b deja la banda prendida y el fondo al 4 %; transición 1 → 2 con fade suave de 3 s; línea de 3 px que aparece de arriba a abajo al disparar (`line.strike`, nota o Space), avanza, se invierte con `L` y se apaga al salir por el borde; grilla de líneas de **exactamente 1 px** (zoom del navegador al 100 %, captura y contar píxeles), bloques independientes prendiendo/apagando con fade corto y desplazándose en direcciones distintas; barridos azul/blanco/sólido en bloques aleatorios sin repetir. fps ≥ 58.

### Fase 4 — Capa 3D base: piso con fuga

**Tareas**
1. `Floor` (§10.1) con reveal y scroll. Quitar el cubo de prueba.
2. Escena `7` (+ placeholders `8`, `9`) según §12. En la 7 las grillas 2D pueden volver con `G`.
3. Params `camera.*` en vivo desde el editor.

**Aceptación**: entrar a la 7 apaga lo 2D con fade, el piso "crece" desde la pantalla hacia el fondo en 4 s y luego avanza sin salto visible; el punto de fuga está a la altura del ojo (y ≈ 672 px); cambiar `camera.eyeY` mueve la fuga; las grillas se superponen bien al piso. fps ≥ 58.

### Fase 5 — Partículas: port MLS-MPM + palitos + caja

**Tareas**
1. Copiar `StructuredArray.js`, `noise.js`. Portar `MlsMpmSimulator.js` (§11.1–11.4, 11.6 reset) con dominio/grilla de §2.5, caja rotable, `resetInBox`. Fuerzas mínimas: gravedad, turbulencia (ya existe).
2. `StickRenderer.js` (§11.7). Bloom por MRT en el compositor (§8.4).
3. `BoxWire` (§10.2) compartiendo params `box.*`.
4. Escenas `10`, `11`, `13`.
5. Medir: con 262 144 partículas y bloom a 2688 × 1008, anotar ms de compute y de render en NOTAS. En la RTX 3090 del show (C12) tiene que sobrar; probar también 524 288 y anotar si sirve como preset "ultra". Si la máquina de desarrollo no llega a 50 fps, bajar el default local, no el del show.

**Aceptación**: escena 10 muestra la caja rotada 45° ocupando el alto de la pantalla con palitos adentro que se mueven con turbulencia y no salen (rebotan en las 6 caras rotadas, no en el AABB del mundo); 11 → rojo, 13 idéntico; los palitos se orientan según su velocidad y se vuelven blancos al acelerar; el reset al entrar a la 10 no traba el frame (no hay subida de buffers desde CPU); `box.preset left/right` tweenea la caja y las partículas la siguen; fps ≥ 50 con el count elegido.

### Fase 6 — Fuerzas y modos: flujo/wrap, atractor, torbellino, libres, flicker

**Tareas**
1. `Forces.js` (§11.5): flow, atractores (uniformArray), vortex, repulsores (dejar el array listo para la fase 7), drag, kick. Wrap vertical (§11.6).
2. `RedBlock` (§10.3) publicando el atractor 0.
3. Flicker y rotación continua (`box.yawSpeed`) en `BoxWire`/`Layer3D`; el simulador lee el mismo `box.yaw`. Modo libre (`box.enabled false`) probado: las partículas salen y quedan dentro del dominio 9 × 4 × 6.
4. Escenas `12, 14, 15, 16, 20, 21, 22, 23`.

**Aceptación**: 12: columna azul que sube y reaparece abajo sin cortes visibles; 14/15: bloque rojo a un lado, partículas azules se apilan contra la cara del límite más cercana al bloque y rebotan; 16: caja a la izquierda; 20: se liberan; 21: giran y se juntan; 22: la caja vuelve sin explosiones (wallMaxPush) y quedan muy blancas al centro; 23: titila. Transiciones de color rojo↔azul suaves. Girar la caja en vivo (CC en `box.yaw` o `box.yawSpeed`) arrastra las partículas sin que se escapen.

### Fase 7 — Rayos y debris

**Tareas**
1. `Rays` (§10.4) con repulsores de segmento + shockwave al impactar. `Debris` (§10.5).
2. Escenas `17, 18, 19`, y sumar rays a `20–23`.
3. Bloom en rayos/debris por MRT.

**Aceptación**: `R` (o la nota) hace caer una barra blanca desde arriba del cuadro hasta el piso; al impactar salen ~60 esquirlas blancas que rebotan, se deslizan y se apagan; las partículas se apartan de la barra al pasar y del impacto; 8 rayos simultáneos sin caída de fps; con la caja a un lado los rayos caen igual en toda la pantalla.

### Fase 8 — Afinado de escenas, mapeo default, documentación

**Tareas**
1. Repasar las 23 escenas contra el storyboard con Manuel; ajustar defaults en `scenes/index.js` y `BASE`.
2. Exportar los mapeos hechos con Ableton → `public/mappings.default.json`.
3. `README.md` de operación: instalar loopMIDI, salida MIDI de Ableton al puerto virtual, canales, arrancar (`npm start`), abrir salida en la LED (kiosk) y editor en el monitor, atajos, cómo agregar una escena/elemento (§6.3). Incluir la hoja `REFERENCIA-MIDI-OSC.md` exportada del editor.
4. `tools/launch-show.bat`: `start chrome --kiosk --window-position=<X>,0 --window-size=2688,1008 --autoplay-policy=no-user-gesture-required http://localhost:5173/` y `start chrome --new-window http://localhost:5173/editor.html`.

**Aceptación**: recorrer 1 → 23 solo con notas desde Ableton sin tocar el teclado; README suficiente para que Manuel lo levante solo.

### Fase 9 — Rendimiento y robustez

**Tareas**
1. Medir con `performance.now()` alrededor de `sim.update` y `post.renderAsync` (stats al editor). Objetivo: ≤ 16 ms total.
2. Presets de calidad (`master.quality`: high = 262k partículas + bloom; medium = 131k; low = 65k sin bloom) seleccionables desde el editor y persistidos.
3. Chequeos: `devicePixelRatio === 1` (aviso), pérdida de MIDI (reconectar por `onstatechange`), WS OSC caído (reconexión), `visibilitychange` (no pausar el sim si la ventana pierde foco: usar `setTimeout` fallback si rAF se frena; documentar que Chrome debe estar en primer plano en la LED).
4. Verificar que ningún `update` crea objetos por frame (materiales, geometrías, Vector3 en loops calientes → preasignar).

**Aceptación**: ≥ 50 fps sostenidos 10 min en la escena 22 con rayos cayendo, sin crecimiento de memoria en `chrome://performance` / DevTools.

### Backlog (después del show o cuando Manuel lo pida)

- Iluminación de partículas: `MeshStandardNodeMaterial` + `SpotLight` con sombras (el repo original ya lo hace: `lights.js`, `onBeforeShadow`), HDRI opcional.
- Más fuerzas: campos por textura, atractores múltiples animados, colisión con la caja de otras formas (esfera/cilindro).
- Segundo sistema de partículas ligero (sin grilla, solo fuerzas) intercambiable detrás de la misma interfaz (`sim.particleBuffer` + `update`).
- Escenas 8 y 9. Aristas de la caja con grosor (12 cajas finas). Texto 2D animado adicional.
- OSC de salida (estado hacia TouchOSC), MIDI clock para sincronizar scrolls al tempo.
- Grabación de un pase (`MediaRecorder` del canvas) para previews.

---

## 15. Presupuesto de rendimiento (2688 × 1008 @ 60 Hz, ~16.6 ms)

| Etapa | Estimado (RTX 3060; la RTX 3090 del show rinde ~1.8×) | Notas |
|---|---|---|
| MLS-MPM 262k partículas, 216k celdas (5 kernels) | 3–5 ms | Atómicos en p2g; igual que el repo original |
| Palitos instanciados 262k | 1.5–3 ms | Geometría fusionada; sin sombras |
| Bloom (mip chain) | 2–3 ms | Solo MRT de partículas/rayos |
| Piso + caja + rayos + debris | < 0.5 ms | |
| Capa 2D (5 quads grilla + ~12 quads) | < 0.5 ms | |
| Composición | < 0.5 ms | |
| **Total** | **~9–12 ms** | margen para 60 fps |

Reglas: nunca leer buffers de GPU a CPU por frame; un solo `computeAsync` con los 5 kernels; `renderAsync` una vez; `uniformArray` en vez de crear uniforms; sin `await` que no sea de GPU en el loop.

---

## 16. Operación en el show

1. Windows: escala de pantalla 100 % en la salida LED (dpr = 1). Chrome actualizado.
2. `loopMIDI`: crear puerto "Visuales". En Ableton, la pista/pistas MIDI salen a "Visuales" con su canal.
3. `npm start` (dev server + bridge OSC). Con `npm run build` + `npm run preview` para el show (más estable que dev).
4. Abrir `tools/launch-show.bat` (kiosk en la LED + editor en el monitor).
5. En el editor: verificar entradas MIDI habilitadas, fps, escena actual. Mapeos ya cargados de `mappings.default.json`.
6. Atajos de emergencia en la ventana de salida: `,` `.` escenas, `F` fps, `E` editor. `master.blackout` desde el editor.

---

## 17. Referencias de código del repo original (para portar)

Desde el sub-proyecto `visuales/`, estas rutas son `../src/...`. Números de línea del estado actual del repo.

- `particlesvideo/src/mls-mpm/mlsMpmSimulator.js`: kernels en líneas 116–404; el bloque a reemplazar por §11.4 es `If(this.uniforms.containParticles.equal(uint(1)) …)` en 379–392; el bloque de fuerzas a extender (§11.5) está en 326–340 (gravedad, emisión, ruido). El cálculo de `dt` en 466–468. La forma de cambiar el count en 455–464.
- `particlesvideo/src/mls-mpm/particleRenderer.js`: `calcLookAtMatrix` (líneas 8–22), `createRoundedBox` (24–90), construcción de geometría/material y `positionNode` (110–156), transform del objeto (170–172).
- `particlesvideo/src/app.js`: grafo de bloom con MRT (131–158).
- `particlesvideo/src/conf.js`: fórmula `updateParams` (68–73) para `actualSize` y `restDensity`.

---

## 18. Respuestas de Manuel (2026-09-02) y pendientes

| # | Pregunta | Respuesta | Efecto en el plan |
|---|---|---|---|
| 1 | Altura del borde inferior de la LED | 0 m | C1 |
| 2 | Caja rotada 45° | Sí, "quizás la giro" | C4: `box.yaw` mapeable + `box.yawSpeed` |
| 3 | 1b/2b/6b/6c son disparadores | Sí | C5 |
| 4 | Escena 5 | "Sigue misma dinámica" | C6: igual a la 4, nota propia |
| 5 | Color escena 10 | Blancas | C7 |
| 6 | Línea al llegar al borde | "Es como un trueno que cae, desaparece" | C8: modo `strike` (§9.3), confirmar en Fase 3 |
| 7 | Barridos | Sí | C9 |
| 8 | Rayos | Aleatoria | C10 |
| 9 | OSC | Todavía no lo sabe; quiere una página para setear MIDI y OSC "todo bien nomenclado" | C11: §7.6–7.7, hoja de referencia exportable, puerto editable |
| 10 | GPU | RTX 3090 | C12 |
| 11 | Ubicación | "Acá en este repo" | C13: `particlesvideo/visuales/`, rama `visuales` |
| 12 | Helvetica | Ya instalada | C14 |

Pendiente (no bloquea): qué app manda OSC y por qué puerto; validar a ojo la línea "trueno" en la Fase 3.
