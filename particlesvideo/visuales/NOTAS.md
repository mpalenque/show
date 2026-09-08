# NOTAS

Qué se hizo distinto al plan y por qué, y problemas conocidos. Corto.

## Fluids: nueva asignación y contexto compartido — 2026-09-06

- Decisión que reemplaza la integración anterior: **24 previa negra/sólo línea blanca, tiempo 0 detenido y población vacía; 25 PLAY completo desde cero; audio siempre desde Ableton, nunca desde la web**. Notas 24/25 ch10 sin doble PLAY ni reinicio por repeticiones. Live se conserva sin asignar 26; 26–29 siguen libres.
- `fluids.arm` ahora prepara; `fluids.standby` selecciona 24; `fluids.play` selecciona/continúa 25; `fluids.restart` reinicia 25. El WAV sólo se decodifica offline como referencia. Mapeos v11 añaden sc24/sc25 si faltan, preservando filas personalizadas. Entrar en 24 o 25 desactiva el loop de ensayo. La previa deja el arranque listo: 24→25 inicia sin reset ni espera del Worker en el cue.
- Contexto canónico en [docs/CONTEXTO-ACTUAL.md](docs/CONTEXTO-ACTUAL.md), arquitectura y configuración al lado; raíz `CONTEXTO.md`, `AGENTS.md`, `CLAUDE.md` y `PLAN.md` apuntan allí. Los planes anteriores quedan identificados como históricos.
- El plan original de Fluids y cómo funciona estaban en la copia completa de Radiance. Se preservaron además seis documentos/avisos byte por byte en [docs/origen-radiance](docs/origen-radiance/INDICE.md), con manifiesto SHA-256 contra `heidi` y el sibling.
- Código nuevo: 217 tests, TypeScript y build aprobados. Flujo 24/25, MIDI, ausencia de audio web, editor y recursos/cues bajo `/show/` aprobados. Previa blanca exacta de 320×8 px, 2552 píxeles iluminados y ninguno coloreado en el fixture.
- Evidencia GPU nueva bajo `radiance-check/cues-24-25`, separada de la anterior: primera producción con 45 intervalos >20 ms y máximo 83,6 ms; repetición sin cambios de código con máximo 17,5 ms y ninguno >20 ms. Último DEV, incluyendo loop desactivado al entrar: 480 frames a ~60 FPS y máximo 17,8 ms. Editor: 427 frames, máximo 17,7 ms y ninguno >20 ms. Se observó carga de otras aplicaciones después del ensayo problemático, sin aislar su causalidad. No hay garantía permanente de rendimiento; [informe actual](docs/integracion-radiance/VALIDACION-CUES-24-25.md).

## Primera integración Radiance — 2026-09-06 (histórico, asignación reemplazada)

- Implementadas 24 = timeline Fluids completo y 25 = el mismo solver/render con controles live; 26–29 reservadas. Se mantienen los mapeos de escena del canal 10 y `rays.width = 0.014` m. No se escribió una coreografía MIDI para la 25.
- El runtime vive en `vendor/radiance`, con dependencias propias; `npm ci` ejecuta su instalación desde lockfile mediante `postinstall`. Un solo Engine decide qué motor trabaja. La transferencia 24→25 conserva población y drena el Worker antes de quitar director, geometría y gestos; entrar directamente en 25 comienza vacío.
- `fluids.html` conserva el editor del timeline como cliente de la salida `vis-salida`. Documento/revisión bajo `vis.radiance.show.v1`, separado de Settings y Mapper. Audio local requiere un clic en Output; modo `silent` = reloj libre desde cue, sin seguimiento de posición de Ableton. Pausa conserva física; fin del track congela el cierre; master/blackout sólo afectan imagen.
- Referencia recuperada de Downloads: 152,694 s, 256 eventos, 400 claves y 0 gestos. No se confirmó si existe una sesión original de navegador posterior; se puede importar otro export sin resembrar. Origen `heidi` intacto y copia completa verificada por SHA-256. Backups: `17ff81a` en este repo y `e91ec3b` en la copia Radiance.
- Se reemplazó la dependencia del reset original en 0,05 s por reset explícito antes del cue 24: el arranque genérico podía tener 20.000 partículas y saltarse ese evento inicial.
- Verificación final: 198 tests Radiance + 8 transporte + 4 preview = 210 aprobados; TypeScript y build aprobados. Tres pasadas de producción a 60,001 FPS, máximo 17,9 ms y ningún intervalo >20 ms. Regresión 1–23 y siete pruebas funcionales del editor aprobadas. La física baja hasta 42,45 Hz en ventanas de 1 s (Worker hasta 36,4 ms): no cumple todavía el mínimo estricto. Se preservaron los tres subpasos. [Resultados y límites](docs/integracion-radiance/RENDIMIENTO.md).
- Preview corregido: transfiere ImageBitmap y codifica JPEG 672×252 a 2 Hz en Worker con OffscreenCanvas; no crea otro solver. Las lanes sólo se redibujan al cambiar datos visuales. Prueba final: 427 frames a 60,001 FPS, máximo 18,6 ms, ninguno >20 ms y 15/15 capturas sin errores; captura CPU máxima 0,3 ms tras preparación. La medición anterior (44,4 ms) queda conservada en el reporte.

## Fase 0

- `editor.html` se creó como placeholder vacío (el editor real es Fase 2) porque `vite.config.js`
  lo lista como entrada de build y si no existe `npm run build` falla.
- Identidad de git configurada **local** en el repo (`particlesvideo/.git/config`), no global.

## Fase 1

- **DoubleSide obligatorio en la capa 2D.** La ortográfica en píxeles
  (`OrthographicCamera(0, 2688, 0, 1008, ...)`, top=0 / bottom=1008) invierte el eje Y y con eso
  el winding de las caras: con `FrontSide` los quads quedan culleados y no se ve nada.
  Todos los materiales 2D llevan `side: THREE.DoubleSide`.
- `makePerspective` en r176 tiene la firma de 7 argumentos del plan (sin `reversedDepth`): sin cambios.
- **Off-axis verificado numéricamente**: con el ojo en (0, 1, 4) el horizonte (piso y=0 en el infinito)
  proyecta a píxel y = 672.7 y el borde inferior de la pantalla (z=0, y=0) a y = 1008 exacto.
  Coincide con la predicción del plan (§2.3).
- `tools/smoke.mjs` (agregado, no estaba en el plan): abre la salida en Chrome headless con WebGPU vía
  CDP, junta consola/excepciones, evalúa una expresión en la página y saca screenshot. Sirve para
  verificar los criterios de aceptación de cada fase sin abrir el navegador a mano.
  Uso: `node tools/smoke.mjs http://localhost:5173/ out.png 8 "expresión"`.
- `Engine` saltea el frame si el anterior no terminó (`_busy`), para no encimar frames si la GPU se atrasa.

## Fase 2

- **Canales MIDI se emiten 1..16**, no 0..15 como decía el plan (§7.1). Es lo que ya usan el archivo
  de mapeos (`"channel": 1`) y el editor, así que evita una conversión en el medio.
- El editor muestra un cartel **"Esperando la ventana de salida"** y reintenta el `hi` cada 1.5 s:
  la salida es la dueña del estado, y abrir `editor.html` solo mostraba una UI vacía sin explicación.
- `src/editor/reference.js` (archivo nuevo, no estaba en el árbol del plan): nomenclatura OSC
  automática + generación de la hoja `REFERENCIA-MIDI-OSC.md` / `.csv`. Lo usan ParamsPanel
  (lista de referencia) y MappingsPanel (botón de exportar), por eso está fuera de `panels/`.
- `tools/smoke-io.mjs` (agregado): prueba automática de la fase — abre salida + editor en el mismo
  Chrome headless y verifica bridge, learn, fan-out, filtro por escena, persistencia, OSC real por UDP
  y la hoja de referencia. 16/16 en verde.
- **Verificado con OSC real**: `/p/`, `/pn/` y `/scene` por UDP; cambiar el puerto desde el editor
  hace que el bridge reabra el socket (probado 9000 → 9001 con el mensaje llegando al param).

## Fase 3

- **Texturas 2D necesitan `flipY = false`.** Igual que el culling de la Fase 1, es consecuencia de que
  la ortográfica invierte Y: con el `flipY` por defecto de three la textura sale espejada en vertical.
  Verificado dibujando un rectángulo rojo en la esquina 0,0 del canvas.
- **No se usa `screenCoordinate`.** Las grillas sacan el píxel de `uv() × tamaño del quad`: el quad
  mapea 1:1 a píxeles, así que da coordenadas exactas sin depender de la orientación de la pantalla
  ni de la convención de Y de WebGPU. Verificado contando píxeles: líneas de exactamente 1 px.
- **Medidas de la placa sacadas del storyboard con canvas** (no a ojo): ámbar real `#F2A100`,
  período horizontal 329.5 px, chevrones de 35 px con período vertical 70 y amplitud pico a pico 96,
  banda de 48 px con líneas de 2, cajas de 225 × 24.
  El storyboard mide 1976 × 464 (4.26:1), **no** tiene el aspecto de la LED (8:3), así que no hay una
  escala única: el ritmo horizontal se escala por ancho (×1.360 → 6 columnas de 448 px, como el plan)
  y los tamaños verticales por alto (×2.172), para que la banda y el texto conserven su peso visual.
  Todo está en el objeto `LAYOUT` arriba de `WarningPlate.js` para ajustarlo a ojo en un solo lugar.
- **Celdas de grilla 84 × 63 px** (medidas del storyboard 4.png), puestas en las escenas 4/5/6, no como
  default del param: el registro mantiene 96 × 96 como dice la tabla del plan.
- `tools/shoot-scenes.mjs` (agregado): saca una captura por escena/disparador para comparar con el
  storyboard. Fuerza el viewport a 2688 × 1008 con `Emulation.setDeviceMetricsOverride` y recorta al
  canvas — **sin eso las capturas salen a escala CSS (~0.35×) y las líneas de 1 px desaparecen al
  reescalar**, que al principio pareció un bug del shader y no lo era.

### Limitaciones conocidas (no son bugs)

- **Chrome headless no da permiso de Web MIDI** (`NotAllowedError`), así que el MIDI real solo se puede
  probar en el Chrome de Manuel con loopMIDI. El parseo (note on/off, velocidad 0 = off, CC, canal)
  sí se verificó llamando al parser directamente.
- **Una pestaña en segundo plano frena `requestAnimationFrame`** (fps → 0). En el show no molesta
  porque salida y editor son ventanas visibles en monitores distintos, pero la ventana de la LED
  tiene que estar en primer plano. Se ataca en la Fase 9.

## Fase 4

- `Floor` usa `positionWorld` + `fwidth` para el antialias de carriles y dashes; el `aa` se clampea a
  un mínimo para que cerca del horizonte `smoothstep` no reciba los bordes invertidos.
- Cada elemento 3D multiplica su opacidad por `layer3d.opacity` en su `update` (explícito, sin
  acoplar los elementos a la capa).
- **Horizonte verificado con la cámara en vivo**: con el ojo a 2.2 m el punto de fuga cae en y ≈ 269 px,
  que es exactamente 1008 × (1 − 2.2/3). Con el ojo a 1.0 m cae en 672. La pantalla funciona como ventana.
- El cubo de prueba de la Fase 1 se eliminó.

## Fase 5

Port del MLS-MPM. Dos calibraciones fueron necesarias porque **la grilla del repo original era
anisotrópica** (celdas de 0.125 × 0.047 × 0.047 m) y la nuestra es isotrópica de 0.1 m:

- **`DENSITY_CALIBRATION = 9` en `MlsMpmSimulator.js`.** El volumen natural del fluido es
  `count / restDensity` celdas, que con la fórmula del original queda fijo en ~82 m³ con nuestras
  celdas — 4× la caja de 2.6 × 3 × 2.6 m. El fluido quedaba aplastado contra las paredes y se veía
  como un bloque blanco sólido. La constante lo lleva a ~9 m³ con `particles.density` en su default.
- **Tamaño del palito en metros (`BASE_THICKNESS_M` / `BASE_LENGTH_M` en `StickRenderer.js`).**
  El original metía la relación de aspecto de sus celdas en la escala del objeto; acá se expresa
  directo en metros. Calibrado contra STORYBOARD/10.png: con los defaults del plan (262144, size 2,
  length 1) da palitos de ~3.3 mm × 2.5 cm. Los defaults del registro **no** cambiaron.
- Ojo con esto si se cambia `stage.sim.cellSize`: las dos constantes están atadas al tamaño de celda.

Otros desvíos:

- La pared exterior del dominio está **siempre activa** (no solo cuando la caja está desactivada):
  es el borde del escenario, y es lo que sostiene el modo "libres" de la escena 20.
- `?stats` en la URL activa `trackTimestamp` del renderer (tiene costo, por eso no va en el show).

### Rendimiento medido (RTX 3090, 2688 × 1008, con bloom, sin vsync)

| Partículas | ms/frame | fps |
|---|---|---|
| 262 144 (default) | 4.09 | 244 |
| 524 288 (preset "ultra") | 7.87 | 127 |

Sobra margen para 60 fps en las dos: el preset "ultra" es viable para el show.
Las consultas de timestamp de la GPU devuelven 0 en Chrome headless (la feature no está
habilitada), así que la medición es de throughput real con vsync desactivado.

## Fase 6

- **`floor.revealDist` es estado (`sceneReset: false`)**, así que saltar directo a una escena 12+
  dejaba el piso invisible aunque `floor.opacity` fuera 1. Las escenas que quieren el piso ya
  extendido lo listan explícitamente (`'floor.revealDist': 60`); solo la 7 y la 11 animan el reveal.
- **Atractores y repulsores usan división protegida** (`d / max(len(d), 0.001)`) en vez de
  `normalize()`: un slot vacío tiene d = 0 y `normalize` daría NaN, que se propaga a toda la
  velocidad. Se recorren siempre los 4 / 8 slots; los vacíos tienen fuerza 0 y no aportan.
- **Escena 21**: con los valores del plan (swirl 1.2 / pull 0.6) la fuerza centrífuga dispersa las
  partículas contra las paredes del dominio en vez de juntarlas. Subido a pull 1.0 y radio 3.0.
  Es puro gusto y los dos son params mapeables, así que Manuel lo termina de afinar a ojo.
- Verificado: el yaw continuo envuelve bien en ±180 y las partículas siguen a la caja al girar y al
  trasladarse; el titileo alterna a la frecuencia y duty pedidos.

## Fase 7

- **Un slot de repulsor por rayo, desde que cae hasta que se apaga el impacto.** El plan pedía
  8 rayos simultáneos y `MAX_REPULSORS` = 8; en vez de sumar slots aparte para las ondas expansivas,
  cada rayo se queda con el suyo durante toda su vida (caída → onda de 0.3 s → libera). Así entra
  todo en los 8 slots sin cambiar el límite.
- `Debris` preasigna todo (4000 instancias, `Float32Array` por atributo, matrices y quaternions
  reutilizados): no se crea ni un objeto por frame en el loop.
- Verificado: 8 barras cayendo a la vez a 6 m/s con sus 8 repulsores publicados, 480 esquirlas
  al impactar que se apagan solas, y 245 fps sin vsync con partículas + rayos + bloom.

## Fases 8 y 9

- **`master.quality`** agrega un preset `ultra` (524 288) además de los tres del plan, porque en la
  3090 sobra margen. Se persiste en `localStorage` (depende de la máquina, no del show).
- **`simMs` y `renderMs` son tiempo de CPU, no de GPU.** `computeAsync` vuelve antes de que la GPU
  termine, así que `simMs` da casi 0 y `renderMs` se lleva casi todo. Sirven para ver dónde se traba
  la CPU, pero el número real de rendimiento es el frame time / fps. Las consultas de timestamp de
  la GPU (`?stats`) devuelven 0 en Chrome headless; en el Chrome normal de Manuel deberían andar.
- **Red de contención para el rAF frenado**: si la ventana queda tapada, un `setInterval` mantiene
  el loop a ~4 fps para que el show no quede congelado. No reemplaza tener la ventana al frente.
- **Objetos por frame**: verificado que ningún `update` crea materiales, geometrías ni vectores en
  loops calientes (`Debris` preasigna todo para sus 4000 instancias). Lo único que se asigna por
  frame son arrays de ≤ 10 elementos al compactar los pools de barridos, líneas y rayos —
  despreciable y no crece con la cantidad de partículas.
- `tools/walk-scenes.mjs`, `tools/soak.mjs` y `tools/gen-reference.mjs` agregados (ver README §8).
- **Pendiente de Manuel**: `public/mappings.default.json` tiene las filas de cada escena y un ejemplo
  de cada modo, pero **sin fuente asignada**. Hay que hacer el learn con Ableton y después
  Exportar JSON → copiar sobre ese archivo para que los mapeos viajen con el proyecto.

### Prueba de estabilidad (`node tools/soak.mjs 10 22`)

10 minutos en la escena 22 con un rayo cada 400 ms, 262 144 partículas y bloom, a 2688 × 1008:

```
fps  mín 60  máx 60
heap 68 MB → 67 MB (máx 73)
geometrías 11 (estable)
errores: ninguno
```

Sin caída de fps ni crecimiento de memoria. Cumple el criterio de la Fase 9.

## Nitidez del piso (post Fase 9)

Manuel reportó que las tiras del piso se veían pixeladas / "resampleadas". Eran dos cosas distintas:

1. **El shader difuminaba de más.** El antialias usaba `smoothstep` con `fwidth`, que es isotrópico:
   en el piso, con la cámara casi a ras, el pixel se estira muchísimo en Z respecto de X, así que
   el borde se desparramaba ~6 px. Reemplazado por **filtrado analítico** (`pulseCoverage` en
   `Floor.js`): se integra el tren de pulsos y se calcula la cobertura EXACTA del pixel, por eje
   por separado. Con pixel chico da el borde nítido con su fracción justa; con pixel grande
   converge al promedio (gris uniforme) en vez de moiré. Borde medido: 6 px → 4.3 px en el campo
   medio, y ~1 px en el cercano.
2. **La ventana reducía el canvas.** Lo que se veía en una ventana de ~1700 px era el canvas de
   2688 reducido por el navegador, no la salida real. Ahora el escalado se hace poniendo el
   **tamaño CSS del canvas** en vez de un `transform: scale()` (filtra mejor), y **`P` alterna a
   vista 1:1** para poder juzgar nitidez de verdad. El buffer de dibujo siempre es 2688 × 1008.

## Ajustes pedidos por Manuel al ver el resultado

- **Línea blanca detrás del marco rojo** (escena 2): `MovingLine` pasó de `renderOrder` 20 a 6,
  debajo del marco (10).
- **Grillas cuadradas**: el modo grueso usaba ancho-del-bloque × media pantalla (rectangular);
  ahora la celda es un cuadrado del ancho del bloque. Las finas de las escenas 4/5/6 pasaron de
  84 × 63 (medido del storyboard) a 84 × 84.
- **Los palitos se salían de la caja.** El resorte de pared era preventivo pero no garantizaba nada,
  y con la caja moviéndose o girando se escapaban. Se agregó un **clamp final** en espacio local de
  la caja que los deja siempre adentro, invirtiendo la velocidad normal con `box.wallBounce` (0.2).
- **Palitos ~25 % más grandes** y **transición a blanco mucho más tardía**
  (`whiteSpeedMin` 0.6 → 2, `whiteSpeedMax` 3 → 7): con los valores viejos apenas aceleraban
  ya se ponían blancos y se perdía el rojo/azul de la escena.
- **Piso: de shader procedural a geometría real.** Manuel lo pidió explícitamente ("cubitos pero
  finitos", "quiero que sea PURO el pixel"). Cada dash es ahora una **caja instanciada** en vez de
  un patrón pintado con un shader filtrado: cada píxel sale blanco puro o negro puro, sin el gris
  de promediar que a él le leía como ruido.

  La grilla entera (41 carriles × 110 filas = 4510 instancias) se arma **en el vertex shader** desde
  `instanceIndex`: no hay matrices que componer ni subir por frame. El scroll es el patrón
  desplazándose módulo el período, así que el loop no se nota. Param nuevo `floor.dashHeight`
  (0.03 m) porque las cajas tienen altura; `floor.contrast` se eliminó (no aplica sin filtrado).

  **El costo de esto es aliasing en movimiento**: sin filtrado, los dashes lejanos titilan cuando el
  piso avanza. Es la contrapartida inevitable de tener pixel puro, y fue una decisión consciente de
  Manuel después de ver las dos versiones. Si en la LED el titileo molesta, la palanca es bajar
  `floor.fadeFar` para que no se dibujen los que ya no se resuelven.

  Rendimiento: 444 fps solo el piso, 184 con las partículas encima (sin vsync).

## Palitos iluminados con ambient occlusion

**Punto de retorno: tag `palitos-basicos`.** Es el commit anterior a este cambio, con los palitos
como `MeshBasicNodeMaterial` transparentes sin luces ni AO. Para volver:
`git checkout palitos-basicos -- visuales/src/layers3d/particles/StickRenderer.js visuales/src/render/Compositor.js`
(y sacar `Lights` del array `ELEMENTS` de `Layer3D`).

- **Material**: pasó de `MeshBasicNodeMaterial` a `MeshStandardNodeMaterial`, con `depthWrite: true`
  para que los palitos se tapen entre sí de verdad y el GTAO tenga profundidad con la que trabajar.
  Sigue con `transparent: true` **a propósito**: con `transparent: false` el `opacityNode` se ignora
  y `particles.opacity` dejaba de fundir las partículas en las transiciones de escena. Con alpha 1
  se comporta igual que un opaco.
- **`computeVertexNormals()` obligatorio**: `createRoundedBox` reescribe posiciones e índices, así
  que las normales que traía la `BoxGeometry` quedaban mal y three avisaba
  ("Vertex attribute normal not found"). Sin normales el material iluminado no tiene con qué trabajar.
- **AO**: GTAO (`three/examples/jsm/tsl/display/GTAONode.js`) sobre el pase 3D. El MRT ahora saca
  también `normal: transformedNormalView`, que junto con la profundidad es lo que necesita.
  Params `ao.enabled`, `ao.amount`, `ao.distance`, `ao.thickness`.
  Ojo: `ao.enabled: false` solo pone la mezcla en 0, el pase se sigue calculando — no ahorra tiempo.
- **Luces** (`Lights.js`): ambiente + principal + relleno, todo parametrizado (posición, color e
  intensidad) para poder animarlo por MIDI/OSC más adelante.
- **Tamaño por partícula**: campo `age` nuevo en el struct, que avanza en segundos reales y se
  resetea al reubicar y al reaparecer por wrap. El tamaño es densidad × `particles.ageGrow`
  (crecen al nacer) × una variación fija por partícula (`particles.sizeJitter`, hash del índice) —
  sin esa variación todos los palitos miden exactamente lo mismo y se nota.
- **Titileo** (`particles.flicker`, `particles.flickerRate`): cada partícula tiene su propia fase,
  así la masa "hierve" en vez de parpadear entera. Es lo que da el efecto de estar por explotar.

Costo: 184 → 165 fps (6 ms/frame) con partículas + piso, incluyendo GTAO y luces.

## Otros ajustes

- **Escena 1**: el texto ADVERTENCIA hace scroll continuo hacia la izquierda (`warning.scroll` 90)
  y el fondo late con `warning.bgPulse` / `warning.bgPulseRate`. El latido toca **solo** el quad de
  los chevrones; la banda y el texto van en otro quad, así que nunca se apagan.
- **Escena 23** ("A punto de explotar"): torbellino mucho más fuerte (swirl y pull 4, radio 1.6),
  `particles.speed` 1.6, titileo de partículas y de la caja a 14 Hz, emisión propia al 0.5,
  y **sin piso** (`floor.opacity` 0).

## Resolución fija (no escala con la ventana)

Manuel pidió explícitamente que el contenido no se reescale al cambiar el tamaño de la ventana.
`view.mode` default pasó de `'fit'` a `'native'`: el canvas siempre mide 2688 × 1008 en CSS
(pixel a pixel), y al redimensionar la ventana solo se recentra, nunca se escala. `P` sigue
disponible para pasar a `'fit'` si hace falta ver el cuadro completo en una ventana chica durante
el desarrollo, pero ya no es el default — ni en desarrollo ni en el show.

## Antialiasing de las diagonales de la escena 1

Las franjas ámbar del fondo se pintaban columna por columna con `fillRect` de 1 px: sin
antialiasing en el borde diagonal, quedaba en escalones (visible en zoom). Reemplazado por
**trazos vectoriales**: cada franja es una polilínea por los vértices exactos del zigzag,
y Canvas2D antialíasa los bordes de cualquier trazo por defecto.

El grosor pedido (`stripe`) es vertical, pero `lineWidth` mide perpendicular al trazo; en una
pendiente perpendicular = vertical × cos(ángulo), así que se compensa (`cosAngle` calculado desde
la geometría del zigzag) para que el ancho visual de la franja sea el mismo que antes.

## MSAA de hardware en el pase 3D

Manuel pidió mejorar más el antialiasing de los carriles del piso y confirmar que se usa WebGPU.
Confirmado: `renderer.backend.constructor.name === 'WebGPUBackend'`, `isWebGPUBackend === true`.

Se agregó **MSAA 4x real** (`pass(scene, camera, { samples: 4 })`) solo al pase 3D — es
antialiasing de hardware, no un shader: suaviza el borde de cualquier geometría (cubitos del piso,
palitos, aristas de la caja) sin el costo de un post-proceso ni el efecto de "promediar" que hizo
que sacáramos el filtrado analítico del piso. La capa 2D **no** lleva MSAA (necesita líneas a pixel
exacto). `render.msaa` (bool, default true) lo prende/apaga; el `renderTarget.samples` se reasigna
cada frame pero el backend de WebGPU solo recrea el render target si el valor realmente cambió
(lo compara él mismo), así que no tiene costo cuando no cambia.

Nota técnica: WebGPU solo soporta 1 o 4 muestras por pixel (no 2 o 3), por eso el param es bool y
no un número intermedio.

Costo: sin cambio medible (242 fps con partículas + AO + luces, escena 13). Las 23 escenas siguen
a 60 fps.

## Bloques rojos, debris y persistencia de ajustes

- **Bloques rojos (escenas 14/15)**: `redBlock.height` 2.4 → 7 m y param nuevo `redBlock.y`
  (centro, default 1.5). La pantalla va de y=0 a y=3, así que el bloque va de −2 a 5 y **se pasa
  por arriba y por abajo**: nunca se le ven los bordes horizontales y lee como bloque entero.
  `redBlock.width` 2.2 → 3.2. Es un desvío deliberado del storyboard (ahí estaba apoyado en el
  piso), pedido por Manuel.
- **Debris (escenas 17+)**: ahora vuela y se apaga **en el aire**, sin llegar al piso.
  `debris.lifetime` 3 → 0.9 s, `debris.floorCollision` nuevo (default false; en true vuelve el
  rebote y la fricción de antes) y `debris.fadeFraction` (0.7) para que el fade sea largo y visible.
  El chequeo del piso solo corre **mientras bajan**: nacen a ras del suelo y suben, así que mirar
  la altura sin más las mataba en el frame en que se creaban. Medido: antes llegaban a y = −1.45 m
  (se hundían bajo el piso y se veían por los huecos entre dashes); ahora el mínimo es 0.002 m,
  suben hasta 0.79 m y ninguna queda apoyada.
- **Los ajustes del editor se guardan solos** (`core/Settings.js`). Los mapeos ya se guardaban;
  lo que se perdía al recargar eran los params de los sliders.

  La clave es que se guarda como **default** del param, no solo como valor actual: `goto` cae en el
  default cuando ni la escena ni BASE listan el param, así que pisar el default es lo que hace que
  el ajuste sobreviva al próximo cambio de escena. Si la escena SÍ lista el param, la escena sigue
  ganando — que es lo correcto, el look de esa escena está definido en `scenes/index.js`.

  Solo se registra lo que viene del editor (`{t:'set'}` por el bus). Lo que cambian las escenas, el
  MIDI/OSC o la simulación (por ejemplo `box.yaw` girando con `box.yawSpeed`) no se guarda, si no el
  archivo crecería con estado que cambia 60 veces por segundo. Se excluyen además `scene.current`,
  `line.x` y `floor.revealDist`, que son estado vivo y no configuración.
  Botón **"Restaurar ajustes de fábrica"** en el editor. Verificado con `tools/smoke-persist.mjs`:
  ajustar → recargar → siguen; restaurar → vuelven los valores de fábrica.

## Palitos: tamaño, dirección, oclusión y flujo de la escena 12

Cuatro pedidos de Manuel, con el diagnóstico de por qué pasaba cada cosa.

### 1. "Falta detalle, son demasiado chicos"

Los palitos medían 3.3 mm × 2.5 cm. Con 336 px/m en la LED eso es **1.4 px de ancho por 10 de
largo**: menos de un pixel de sombreado útil, así que no se veía ni el volumen del palito ni la
oclusión entre palitos — la masa quedaba como ruido plano de un solo color.

Ahora miden **9 mm × 8 cm (≈ 3 × 27 px)** y hay la mitad de partículas
(`BASE_THICKNESS_M` 0.00825 → 0.0140, `BASE_LENGTH_M` 0.0625 → 0.125, `particles.count`
262144 → 131072, y los presets de `master.quality` bajaron un escalón cada uno). Menos y más
grandes: con las cantidades viejas y este tamaño la caja se tapaba sola y volvía a verse plana.

**La iluminación no cambió de nivel, cambió de relación**: `light.ambient` 0.55 → 0.32 y
`light.fill` 1.1 → 0.8, con la principal quieta en 3.2. Con el ambiente alto la cara en sombra
de cada palito nunca bajaba de medio tono, así que tanto el degradado como el AO quedaban
aplastados. `particles.emissive` 0.15 → 0.08 por lo mismo.

### 2. "Se note su dirección"

Tres arreglos, uno de bug y dos de diseño:

- **Bug del `lookAt`**: `calcLookAtMatrix` usaba un eje de referencia fijo `(0,0,1)`, así que
  para una partícula que viaja **hacia la cámara** el `cross` daba el vector nulo y la
  orientación salía basura. Y con `direction` en cero (partícula frenada) `normalize` daba NaN.
  Ahora el eje de referencia se elige según la dirección y hay guarda para el vector nulo.
- **Bug del heading**: `direction` se guardaba como `mix(direction, vel, 0.1)`, o sea un vector
  cuyo módulo *era* la velocidad. Con la partícula casi quieta quedaba en ~0 y el palito
  temblaba sin rumbo. Ahora se guarda **siempre unitario**, el suavizado es por segundo real
  (`particles.turnRate`) y no por frame, y ante velocidad ~0 conserva el último rumbo.
- **Forma de cometa**: `particles.taper` afina la cola y `particles.headTail` la apaga, así el
  palito tiene punta adelante. Es lo que hace que a 3 px de ancho se lea para dónde va.

### 3. "El flujo azul tiene que salirse de pantalla y seguir emitiendo"

La escena 12 tenía `box.enabled: true` con la caja invisible: el chorro chocaba contra el techo
de la caja y se apelmazaba en un hongo **dentro del cuadro**. Ahora `box.enabled: false` y la
caja queda solo como **encuadre del emisor** (`box.width` / `box.depth` son el ancho y el fondo
del chorro, aunque el límite esté apagado).

Sacar la caja sola no alcanzaba: el techo del dominio estaba en 3.5 m, apenas por encima de la
pantalla, y las partículas chocaban igual contra la pared del dominio. Dos cambios más:

- **El dominio sube a 7 m** (`STAGE.sim.max`, grilla 90 × 75 × 60). Hay lugar de sobra arriba
  del cuadro para que el chorro se vaya antes de reciclarse.
- **El techo del reciclado no es un plano horizontal**: es el **borde superior del encuadre**,
  que en perspectiva sube con la profundidad (a 2 m de fondo hay que llegar más alto para
  salirse del cuadro). La CPU manda la recta `y = wrapA + wrapB·z` en unidades de grilla
  (`_updateWrapLine`, sale del ojo y de `STAGE.physical.heightM`) y el kernel la evalúa por
  partícula. `particles.wrapTop` dejó de ser un techo absoluto: ahora es **cuántos metros por
  encima del borde de pantalla** se recicla.

Además la escena lleva `particles.drag: 0.22`. Sin rozamiento el flujo constante acelera sin
techo y termina todo en blanco; con rozamiento el chorro llega a una velocidad estable
(flujo/roce) y se mantiene azul parejo. Verificado a los 8 s y a los 25 s: misma densidad y
misma altura, sin acumulación.

### 4. "El pasaje a blanco se hace en chunks"

Dos causas, las dos arregladas:

- La velocidad sale de **interpolar la grilla**, así que todas las partículas de una misma celda
  comparten valor: el color quedaba cuantizado al tamaño de la celda y saltaba de golpe. Ahora
  hay un campo `speedSmooth` en el struct de la partícula (promedio exponencial,
  `particles.speedSmooth`) y es ese el que colorea.
- Aunque el valor sea suave, si **todas** las partículas usan el mismo umbral una zona de
  velocidad parecida se da vuelta entera de un frame para el otro. `particles.whiteJitter`
  corre el umbral de cada partícula un poco al azar, así la zona **se disuelve** palito por
  palito. Comparado A/B: con jitter en 0 el borde rojo/blanco es un blob macizo; con 0.7 hay
  una franja mezclada de decenas de píxeles.

El campo nuevo entra en el padding que ya tenía el struct: sigue midiendo 28 floats, no ocupa
un byte más.

### AO de verdad

El radio del GTAO estaba en **0.35 m** para palitos de 9 mm que se tocan a pocos centímetros:
medía la silueta de toda la nube y no veía nada del hueco entre palito y palito. Bajó a
**0.10 m** (probado también 0.05 y 0.25; 0.10 es el que mejor separa sin perder la forma).

Con un radio chico el GTAO sale **muy ruidoso** (rota sus muestras con una textura de ruido), y
ahí subir la calidad se ve como suciedad. Se agregó el **`denoise` bilateral** de three
(`DenoiseNode`, guiado por profundidad y normal) después del AO: es lo que convierte el
granulado en sombra limpia. Params nuevos: `ao.contrast`, `ao.samples`, `ao.denoise`.

También se le dio atributo `normal` a la `EdgesGeometry` de la caja: el MRT le pide
`transformedNormalView` a todo lo del pase 3D y sin el atributo three avisaba por consola y el
buffer de normales quedaba con basura justo donde van las aristas — que es lo que después lee
el GTAO.

Costo: **5–6 ms/frame** en la escena 13 (contra 6 ms antes), o sea el denoise se paga solo con
las partículas que sacamos. Las 23 escenas siguen a 60 fps.

### Los ajustes guardados que quedan viejos se tiran solos

`Settings` persiste lo que se toca en el editor **pisando el default**, que es lo que hace que el
ajuste sobreviva a los cambios de escena. El efecto colateral: cambiar un default en el código no
tenía ningún efecto en la máquina donde ese param se había movido alguna vez a mano — el valor
guardado le ganaba en silencio y había que acordarse de ir a borrar los ajustes. Nadie se acuerda
de eso a las tres de la mañana antes de un show.

Ahora **cada ajuste guarda contra qué valor de fábrica se hizo** (`{ v, d }` en vez de un valor
suelto). Si el código mueve ese valor de fábrica, el ajuste guardado se descarta solo al arrancar
y lo dice por consola. Todo lo demás que Manuel haya tocado sigue vivo.

Para el formato viejo (una tabla plana, sin saber contra qué default se guardó) hay una lista de
params invalidados a mano: los que cambiaron de default al recalibrar los palitos, más
`particles.wrapTop`, que además cambió de **significado** (era un techo absoluto en metros, ahora
es el margen por encima del borde de pantalla).

`tools/smoke-settings-viejos.mjs` lo cubre: 13 comprobaciones entre migración del formato viejo,
descarte por default cambiado, y que un ajuste vigente siga sobreviviendo a la recarga. Es el
complemento de `smoke-persist.mjs`, que prueba lo contrario (que un ajuste del editor **sí**
sobreviva).

## El cuadro sale 1:1 aunque Windows no esté al 100%

El overlay de fps avisaba `dpr 1.3 ¡debe ser 1!` y no había nada que hacer salvo ir a cambiar la
escala de Windows a mano. Ahora se compensa solo.

**Qué es el dpr**: `window.devicePixelRatio`, cuántos píxeles físicos usa el navegador por cada
píxel CSS. Con la escala de pantalla de Windows en 130%, el dpr vale 1.3.

**Por qué rompía**: el buffer de dibujo siempre mide 2688 × 1008 píxeles reales, pero
`canvas.style.width` está en píxeles **CSS**, que solo son lo mismo con la escala al 100%. Con
dpr 1.3, `width: 2688px` hacía que el navegador estirara el cuadro a **3494 píxeles físicos**:
todo borroso, las líneas de 1 px de la capa 2D deshechas, y encima el cuadro más ancho que el
panel de 2688 así que ni siquiera entraba entero — se veía como el 77% del cuadro, ampliado.

**El arreglo** (`fitStage`, modo `native`): el tamaño CSS se divide por el dpr. 2688 / 1.3 =
2068 px CSS × 1.3 = 2688 físicos, uno a uno de nuevo. Además hay una media query
`(resolution: Ndppx)` que se reevalúa cuando el dpr cambia, porque mover la ventana a un monitor
con otra escala **no** dispara `resize`.

`tools/smoke-dpr.mjs` lo comprueba con escala 100, 130, 150 y 200%: en las cuatro, el buffer y
los píxeles físicos en pantalla dan 2688 × 1008 exacto. Medido además sobre la grilla fina de la
escena 4: las líneas siguen midiendo **1 píxel físico** con escala 130%, igual que al 100%.

El aviso del overlay y el del editor se quedan (ahora dicen "compensado"): con una escala que no
sea múltiplo entero el navegador todavía puede correr medio píxel al redondear, así que para el
show sigue siendo mejor tener el monitor de la LED al 100%. Pero ya no es algo que rompa nada.

## La escena manda: se acabó la fuga de ajustes entre escenas

Manuel reportó que la escena 7 —que solo tiene que mostrar el piso— aparecía con partículas y
con el bloque rojo, que "quedaban colgados los atractores", que la 12 dejaba de ser un flujo
para arriba y hacía cualquier cosa, y que todo quedaba "atraído siempre". Con perfil limpio la 7
se veía bien, así que no eran las escenas.

**La causa era una sola**, y explicaba las cuatro cosas a la vez: `Settings.record` guardaba
cada ajuste del editor pisando el **`default`** del param, y `SceneManager.goto` cae justo en el
`default` para todo lo que la escena no lista. O sea que mover un slider en la 14 le cambiaba el
valor de reposo a **todas** las demás escenas, para siempre y sobreviviendo a la recarga.
Reproducido con `diag`: tocando `redBlock.attract`, `particles.opacity` y `vortex.swirl` estando
en la 14, la escena 7 quedaba con `{particulas: 1, atraccion: 6, torbellino: 1.5}` y el atractor
0 vivo en la GPU.

**El arreglo**: `SceneManager.ownedParams(SCENES, BASE)` devuelve el conjunto de ids que alguna
escena o el BASE listan — o sea, todo lo que es **estado del show**. Settings no guarda ni pisa
el default de ninguno de esos. Lo que queda guardándose es lo que ninguna escena escribe: luces,
AO, bloom, piso, cámara, calidad. Que es exactamente lo que uno quiere que sobreviva.

Contrapartida a tener presente: un ajuste sobre algo que la escena sí maneja (turbulencia,
opacidad, color) se aplica en vivo pero **se pierde al cambiar de escena**, porque de eso manda
`scenes/index.js`. Es a propósito. Si alguna vez hace falta que quede, lo que corresponde es
guardarlo *por escena*, no como default global.

`tools/smoke-settings.mjs` (antes `smoke-settings-viejos.mjs`) cubre las dos reglas: 17
comprobaciones, incluida la fuga exacta que se reportó.

## Bloque rojo: opaco, temblando, y empujando en una dirección

- **Opaco**: era `depthWrite: false`, así que el piso —que también es transparente— se colaba
  por encima según el orden de dibujado y se le veían los dashes a través. Ahora escribe
  profundidad y va con `renderOrder: -1`. Sigue siendo `transparent` porque `redBlock.opacity`
  tiene que poder fundirlo en las transiciones, pero con alpha 1 se comporta como un opaco.
- **Vibración** (`redBlock.vibrate`, `redBlock.vibrateRate`): tiembla la placa, perpendicular a
  su propia cara, con dos senos de frecuencias no múltiplas para que no se vea el ciclo. Es
  temblor, no parpadeo: nunca deja de ser rojo pleno.
- **Atractor de plano, no de punto** (`redBlock.attractDir`, 0 = punto, 1 = dirección). El
  atractor puntual chupaba toda la masa hacia un mismo sitio y quedaba un embudo pegado al
  bloque. Ahora el empuje es perpendicular al bloque, igual para todos, y la caída depende solo
  de la distancia **al plano**: la masa entera se corre para ese lado y golpea la pared del
  bound a lo ancho. El radio subió de 2 a 5 m porque en modo plano se mide perpendicular y con
  2 m media caja quedaba fuera de alcance.

## La escena 12 arranca ya en régimen

La emisión ya era constante (medido: 51–54% de cobertura parejo de abajo arriba, igual a los
10 s que a los 30 s). Lo que se notaba era el **arranque**: al entrar desde la 11 las partículas
venían encerradas en la caja y se veía cómo se soltaban y se desordenaban unos segundos antes de
armar el chorro.

Kernel nuevo `fillColumn` (action `particles.fillColumn`, que la escena 12 dispara al entrar):
reparte las partículas por toda la columna, del piso hasta el techo del reciclado —usando la
misma recta del borde del encuadre— con la velocidad del flujo ya puesta y las edades repartidas.
Medido a 1 segundo de entrar: 49–52% de cobertura, o sea el mismo régimen que a los 20 s. Sin
transitorio.

## Escenas con más textura (y la grilla que sobrevive a la 7)

Pedido de Manuel: más riqueza en las escenas, y que **en la escena 7 se siga viendo la grilla de
la escena anterior** — se apagaba de golpe al entrar.

**Por qué se apagaba**: la 7 no listaba ningún param `grid.*`, y `SceneManager.goto` devuelve al
BASE (`grid.opacity: 0`) todo lo que la escena no lista. No era un fade: los `grid.bN.enabled`
son bool, así que se cortaban en seco. Ahora la 7 lista la grilla completa con el mismo reparto
de bloques que la 6, brillo 0.6 → 0.26 y scroll 12 → 5: el piso queda de protagonista y la
grilla sigue como textura encima. **Esto contradice a propósito el §12 del PLAN** ("todo lo 2D
se apaga" en la 7); el PLAN ya está corregido. El marco sí se va: lo que Manuel pidió sostener
es la grilla.

Todo lo demás salió de `scenes/index.js`, sin tocar ningún elemento: son datos.

- **Los 5 bloques de grilla dejan de moverse como una cortina.** Helper `gridBlocks()`:
  `[encendido, sentido, ×velocidad, offset Y]` por bloque, en las escenas 3 a 9. Escribe los
  cuatro valores **también en los bloques apagados**, porque `grid.toggleAll` (la barra
  espaciadora de esas escenas) los prende en vivo y si no caerían todos con sentido 1 y ×1.
  En la grilla gruesa el offset Y es lo que más rinde: la celda mide lo que el bloque, así que
  reparte a distinta altura la única línea horizontal de cada columna.
- **8 y 9 dejan de ser copias mudas de la 7**: 8 = piso + barridos (reparto de bloques
  invertido), 9 = piso rápido + grilla gruesa + trueno. Siguen sin estar en el storyboard; si
  Manuel las define, son dos entradas de datos.
- **La caja gira despacio siempre que se le vean las aristas** (`box.yawSpeed`, 3–6 °/s; 10 en
  la 22 y 26 en la 23). Quieta a 45° se lee como un dibujo. El límite físico gira con ella.
  Cuando la caja es solo un bound invisible (14, 15) no gira.
- **Torbellino flojo donde no había ninguno**: la 12 sube en hélice en vez de en columna recta
  (swirl 0.6 / pull 0.3); la 14 y la 15 se enroscan camino al bloque rojo (swirl sin pull, así
  no se cierran en embudo); la 20 tiene un torbellino de 5 m de radio que la mantiene circulando
  en vez de dispersarse hasta quedar quieta.
- **El piso corre más rápido a medida que avanza el show** (`floor.scrollSpeed` 0.6 → 2.4).
- Trueno con `line.maxLines: 3` en las escenas 2 a 6 y 9: con 1 sola línea cada nota mataba la
  anterior de golpe y la cola no se veía nunca.

### `vortex.lift` NO se usa (se probó y no sirve)

La idea era el hongo de `21.png`. Medido con capturas pareadas (mismo estado inicial, mismos
tiempos) en la 21 con lift 0 / 0.15 / 0.35 / 0.55 / 0.7: **el ascenso es una fuerza en un solo
sentido y nada la devuelve**, así que la masa sube y a los 6–14 s el cuadro queda vacío de la
mitad para abajo. Compensándolo con `particles.gravityY` negativo lo que aparece es una nube
caótica que llena la pantalla entera. El hongo del storyboard es un momento de paso del remolino
plano, no un estado que se pueda sostener. Las escenas 21, 22 y 23 quedan sin `lift`.

### Contrapartida a tener presente

Todo param que una escena lista pasa a ser **estado del show** para `Settings` (ver la sección de
la fuga de params): se aplica en vivo desde el editor pero **no se guarda como default**. Con
este cambio entran a esa lista `grid.bN.speedMul` / `.offsetY`, `line.maxLines`, `line.fadeOut`,
`box.yawSpeed` y `vortex.lift`. Son cosas que cambian por escena, así que corresponde. Lo que se
calibra por máquina (tamaño y largo de los palitos, luces, AO, bloom, forma del piso) se dejó
deliberadamente afuera para que se siga pudiendo guardar desde el editor.

`node tools/walk-scenes.mjs <carpeta> <url> 5`: las 23 escenas a **60 fps**, heap 87 MB, sin
errores (salvo el permiso de Web MIDI, que en headless nunca se da).

## Segunda vuelta de ajustes de Manuel (2026-09-04)

### Escena 12: la mitad de velocidad
`particles.flowY` 1.2 → 0.6. Como el rozamiento no cambió, la velocidad de régimen (flujo/roce)
también queda a la mitad. Los umbrales de blanco bajan en la misma proporción (5/13 → 2.5/6.5):
si no, el chorro nunca llegaría al blanco y quedaría azul plano.

### Escenas 14 y 15: 40× la fuerza, y por eso SIN caja
`redBlock.attract` 6 → 240 (y 7 → 280), con el techo del param subido de 10 a 400.

Lo importante no es el número sino lo que obligó a cambiar: **se apaga el límite de la caja**,
aunque el storyboard diga "aristas ocultas pero el límite sigue". Se probaron las tres opciones
con capturas al mismo tiempo de escena:

- Caja original (2.6 m) + clamp duro: la masa se clava contra la pared en menos de un segundo y
  queda un **ladrillo azul perfectamente plano**. No se lee violento, se lee congelado.
- Caja mucho más ancha (7.5 m): el mismo ladrillo, un poco más lejos.
- Sin límite: la masa sale despedida, revienta contra el bloque, se abre sobre él y sigue
  revolviéndose. Eso sí se lee como "super violenta".

Es lo que tiene que pasar: una fuerza constante enorme contra una pared da compresión, no
violencia. Lo que mantiene todo en cuadro es el dominio de simulación (x = ±4.5 m, apenas más
ancho que la pantalla). Las dos escenas disparan `particles.resetInBox` al entrar, porque el
embate es el momento de la escena y si se entra con la masa ya desparramada no se ve nunca.

**Efecto colateral arreglado**: `box.wallMaxPush`, `box.hardClamp` y `box.wallBounce` eran
`sceneReset: false`. Una escena que los tocara se los dejaba puestos a todas las siguientes —
la misma fuga que ya documentamos con `redBlock`. Ahora son `sceneReset: true`.

### Escena 20: campo en vez de torbellino
Manuel: *"no están tan libres, ya están armando el torbellino"*. Tenía razón: un torbellino tiene
centro, y con centro deja de ser libre.

`field.*` (en `Forces.js`) es lo contrario: **no tiene centro**. Un ruido 3D da una dirección en
cada punto del espacio; como varía suave con la posición, las partículas vecinas terminan
apuntando parecido y se arman filamentos y remolinos que nacen y mueren solos sin converger a
ningún lado. Es lectura de bandada sin vecinos y sin O(n²): cada partícula lee el campo donde
está y nada más.

- `field.amount` empuja hacia el campo; `field.align` **gira** la velocidad hacia él sin cambiarle
  el módulo. Son distintos a propósito: solo con `amount` la nube acelera y se desarma; con
  `align` los palitos se peinan conservando lo que traían, que es lo que se lee como cardumen.
- `field.sectors` parte el escenario en franjas verticales (5 = una por bloque de la LED) y a
  cada una le da otro trozo de ruido (`variation`) y otra velocidad (`speedSpread`). Distintos
  sectores, distintos comportamientos. Con variation y speedSpread en 0 vuelve a ser un campo
  solo. Está apagado (`amount` y `align` en 0) en todas las escenas menos la 20.

### Rayos y esquirlas
- **Los rayos ahora mueven los palitos de verdad.** El mecanismo ya existía (un repulsor de
  segmento mientras cae, una onda expansiva al chocar) pero con fuerza 3 y 4, que en unidades de
  grilla son 0.3 y 0.4 m/s²: nada al lado de la turbulencia. Ahora 25 y 60, con radios más
  grandes. La caída abre un canal a su paso y el impacto es un golpe seco. Techos a 200 para
  poder exagerar desde MIDI.
- **Las esquirlas ya no dibujan una parábola.** Manuel: que salgan disparadas para arriba en la
  explosión y desaparezcan rápido, sin la asíntota que cae. `debris.gravity` pasa a **0** (el
  param queda por si se quiere el tiro parabólico), `speed` 2 → 11, `lifetime` 0.9 → 0.35, y se
  agregan `debris.spread` (apertura del cono) y `debris.drag` (frenado exponencial: salen
  disparadas y se plantan, en vez de viajar a velocidad constante hasta que se les acaba la
  vida). La dirección sale de un ángulo polar medido desde la vertical con `cos` uniforme sobre
  el casquete: sin eso se amontonan todas cerca del eje y el cono se ve hueco en los costados.
  Medido: a los 240 ms de la explosión hay 200 esquirlas vivas subiendo de y=0.09 a y=0.89 m y
  **ninguna con velocidad vertical negativa** — o sea que ninguna cae.

### Barrido sólido 6c: hasta la mitad y se posa
Antes cruzaba la pantalla entera como los otros dos. Ahora entra desde su borde, avanza hasta
cubrir `sweep.solidHeight` del alto (0.5 = la mitad), se queda `sweep.solidHold` y se apaga
**en el lugar** durante `sweep.solidFade`. Medido: el quad se detiene con el borde en y = 0 y
504 px de alto (la mitad exacta de 1008) y de ahí baja el alpha sin moverse. Los barridos con
gradiente (6 y 6b) siguen cruzando de lado a lado.

### Corrimiento de las grillas: suave y en los dos ejes
Manuel: *"cuando le llegue el MIDI no tienen que ser así saltando, sino suave"*. Antes
`grid.randomize` escribía el offset de una. Ahora:

- Acciones nuevas `grid.nudge` y `grid.bN.nudge` (arg `v` / `h` / `ambos` / `random` / píxeles),
  que **tweenean** el offset en `grid.offsetTime` con curva `grid.offsetEase`.
- `grid.bN.offsetX` nuevo: el corrimiento horizontal es aparte del scroll continuo, se suman en
  el shader. Antes solo se podía correr en vertical.
- `grid.randomize` y `grid.offsetReset` también animan.
- Cada bloque se corre para **su propio lado** (según su `dir`), así el disparo no lee como una
  cortina única.

Dos trampas que costaron y quedaron resueltas:
1. Antes de arrancar el tween, el offset actual se reduce **módulo la celda**. El shader ya hace
   `mod`, así que reducirlo no se ve, pero es lo que evita que después de unos cuantos disparos
   el param se clave en el tope de su rango y el corrimiento deje de responder.
2. El tween arranca del valor **actual** (`params.get`), no del destino del tween anterior
   (`params.target`). Con `target`, un segundo disparo antes de que terminara el primero saltaba
   de golpe al destino viejo — justo el salto que había que sacar. Medido con disparos cada
   60 ms sobre un tween de 350 ms: el valor avanza 46 → 46.5 → 49.9 → 51.8 → 58.4 → 63 sin
   ningún salto.

### MIDI learn por parámetro (editor)
En vez de una página nueva, cada fila de la lista de referencia —que ya tenía TODOS los
parámetros y acciones, con filtro— ahora tiene su botón **Learn** y un **×** para borrar.
Learn crea el mapeo ya apuntado a ese destino y lo deja esperando; el modo lo deduce el Mapper
según lo que llegue (CC/OSC → `range` con el rango del propio parámetro, nota sobre acción →
`trigger`, nota sobre bool → `toggle`). Escape cancela y no deja filas vacías. Se agregó también
un filtro "solo mapeados".

El orden importa y está resuelto: primero se publican los mapeos (la salida crea la fila) y
recién después el `learn`, porque el Mapper busca la fila **por id** cuando llega el mensaje.

`tools/smoke-learn.mjs` (nuevo) cubre todo el circuito con MIDI falso: 14 comprobaciones en
verde, incluidos los 259 botones (uno por parámetro), el modo deducido, que el CC después mueva
el parámetro de verdad, y que el mapeo quede guardado.

### `vortex.lift` sigue sin usarse
Ver la sección anterior: es una fuerza en un solo sentido y nada la devuelve.

### Nota sobre los fps de las pruebas
`walk-scenes` da entre 30 y 60 fps según cuánto más esté corriendo en la máquina, pero el
**costo por frame es de 1 a 2 ms** (sim 0.2, render 0.9–1.5) sobre un presupuesto de 16.7 ms.
O sea que sobra ~8×: cuando el número baja lo que frena es el `requestAnimationFrame` del
Chrome headless compitiendo con el resto, no el show. Mirar `frameMs`, no solo `fps`.

## Los rayos se comían casi la mitad de las notas (2026-09-04)

Manuel, con una batería a **218 BPM en semicorcheas** (una nota cada 69 ms): *"no parece salir
todas"*. No era el MIDI: las notas llegaban y la action se disparaba. Las tiraba `Rays.spawn`,
**en silencio**.

Cada rayo ocupa un slot de repulsor desde que empieza a caer hasta que se apaga su onda
expansiva: 0.68 s de caída + 0.3 s de onda ≈ **1 s**. A 14.5 notas por segundo hacen falta ~15
slots simultáneos y había **8** (`POOL = MAX_REPULSORS`). `_freeSlot()` devolvía −1 y `spawn`
hacía `return` sin decir nada.

Medido antes y después con notas falsas al mismo ritmo, contando pedidos contra rayos nacidos:

| tempo | intervalo | antes | después |
|---|---|---|---|
| 218 BPM 1/8 | 138 ms | 0 % perdidos | 0 % |
| **218 BPM 1/16** | **69 ms** | **45 % perdidos** | **0 %** |
| 120 BPM 1/16 | 125 ms | 6 % perdidos | 0 % |
| 218 BPM 1/32 | 34 ms | 73 % perdidos | 0 % |

Tres cambios:

1. `MAX_REPULSORS` 8 → **32**.
2. `repulsorCount` pasa a ser la cantidad **real** de slots ocupados en vez de `MAX_REPULSORS`
   fijo. Antes el kernel daba 8 vueltas por partícula y por frame aunque no hubiera un solo
   rayo en pantalla; ahora sin rayos el loop no corre. Por eso subir el máximo salió gratis:
   medido con 29 rayos vivos a la vez, frame 1.7–2.0 ms (sim 0.1) contra 1.1–2.8 ms en reposo,
   o sea dentro del ruido.
3. Cuando de verdad se llena, se sacrifica el rayo **más viejo** en vez del disparo nuevo.
   Que falte un golpe donde el oído lo espera se nota; que al rayo que ya venía cayendo se le
   corte la cola, no.

Regla general que conviene recordar: **el techo de rayos por segundo es `MAX_REPULSORS` dividido
la vida de un rayo**. Con los valores de fábrica son ~32 por segundo. Si se sube
`rays.fallSpeed` los rayos duran menos y entran más; si se baja, menos.

## Tercera vuelta: contención, azul y torbellino fino (2026-09-04)

### Las partículas se escapaban de la caja en la 14 y la 15
No era un bug del límite: el clamp del final de `MlsMpmSimulator` mete las partículas adentro
**siempre** que `box.enabled` esté en true. Se escapaban porque en la vuelta anterior yo se lo
había apagado para evitar que la masa se aplastara en un ladrillo plano. Manuel pidió lo
contrario: que queden adentro aunque las arranque el bloque.

Al volver a prenderlo aparecen dos cosas que conviene tener anotadas porque no son obvias:

1. **El fluido es prácticamente incompresible**, así que la masa ocupa SIEMPRE el volumen de la
   caja: la silueta que se ve es la de la caja, no la de la masa. Probado con una caja de 6.6 m:
   la llenaba entera y se veía el rectángulo. O sea que la caja hay que dimensionarla como la
   masa que se quiere ver, no como el espacio por el que uno imagina que la masa viaja.
2. **`box.preset` pisa cualquier `box.x` que ponga la escena**, porque `BoxWire` lo tweenea
   cuando el preset cambia de valor. Hay que mover la caja con el preset, no con `box.x`.

Solución: preset `left` / `right` (±2.1 m), sin girar, 2.4 m de ancho → la pared del lado del
bloque cae en x = ±3.3, justo sobre el bloque rojo. La masa se frena SOBRE el bloque, que es lo
que muestra el storyboard, en vez de contra un plano invisible a mitad de camino. Alto 3.2
centrado en 1.5 para que las tapas queden fuera de pantalla. Con `wallBounce 0.75`, poco
rozamiento y turbulencia alta, la masa embiste, vuelve y vuelve a embestir en vez de apelmazarse,
y la cara contra el bloque queda deshilachada en vez de recta.

Los umbrales de blanco subieron a 20/40 para que la masa quede azul saturada como en `14.png`;
con los de antes salía celeste lavada.

### La 12 ahora es siempre azul
Dos cambios. `particles.flowY` 0.6 → **0.35** (velocidad de régimen = flujo/rozamiento ≈ 1.6,
menos de un tercio del arranque) y `whiteSpeedMin` 2.5 → **18**.

El error de la vuelta anterior fue bajar los umbrales de blanco junto con el flujo: no alcanza
con ponerlos por encima de la velocidad, hay que dejar margen para **`particles.whiteJitter`**,
que corre el umbral de cada partícula hasta ±35 % del span. Con 2.5/6.5 el umbral efectivo más
bajo quedaba en 1.1, o sea por DEBAJO de la velocidad de régimen — por eso el chorro se
blanqueaba de la mitad para arriba. Con 18/36 el efectivo más bajo es ~11.7 contra 1.6: no se
blanquea ni con un `particles.kick`.

### La 23: sin caja y con el torbellino fino
Lo que hace fina a la columna **no es principalmente el torbellino**. Tres cosas, medidas una
por una con capturas:

1. **`particles.density` 0.4 → 2.** La presión va con la densidad a la QUINTA (`pow(d/d0, 5)`),
   o sea que el fluido es casi incompresible y ocupa siempre su volumen de reposo. Subir la
   densidad de reposo es lo único que hace que los mismos palitos ocupen ~5 veces menos lugar.
   Sin esto no hay torbellino que la afine.
2. **`pull` alto (4 → 30) con `swirl` BAJO (4 → 5).** Al revés de lo que parece, subir el giro
   ENSANCHA: la velocidad tangencial de régimen es swirl/rozamiento y la fuerza centrífuga va
   con su cuadrado, así que pasa a la atracción y escupe los palitos. Probado con swirl 20 y
   radio 0.7: una nube que ocupaba toda la pantalla.
3. **`radius` GRANDE (1.6 → 3.2), no chico.** El radio no es el grosor de la columna: es la
   distancia a la que la fuerza cae a la mitad, o sea el ALCANCE. Con 0.7 m, a 3 m la atracción
   vale el 5 % y lo que quedó afuera no vuelve nunca.

Además `particles.drag` 0.01 → 0.45 (le pone techo a la velocidad de giro) y `particles.speed`
1.6 → 1.2 (con fuerzas de este tamaño el paso de simulación se volvía inestable).

**Ojo con el mapeo**: la 23 ya no tiene caja, así que `box.flicker` ahí no hace nada. El titileo
lo lleva `particles.flicker` (0.8 a 14 Hz). Si había una nota mapeada a `box.flicker` para esa
escena, hay que reapuntarla.

Las 23 escenas siguen a 60 fps (1–2.5 ms por frame).

## Cuarta vuelta: bound del medio, cortes secos y estrobo (2026-09-04)

### El bound de la 14 y la 15 vuelve a ser la caja del medio
Pedido de Manuel, y deja sin efecto el intento anterior de correr la caja hasta el bloque para
disimular la pared invisible. La masa se estira hacia el bloque y se frena contra la pared de la
caja del centro, con sus medidas de siempre. Queda anotado en la escena, porque es contraintuitivo:
**no sirve agrandar la caja "para que la masa tenga espacio de viaje"**, porque el fluido es casi
incompresible y termina ocupando el volumen entero de la caja — la silueta que se ve es la de la
caja, no la de la masa.

### La caja ya no se traslada: aparece
`BoxWire` tweeneaba `box.x` en 1 s al cambiar de preset y se veía la caja viajar de un lado al
otro. Ahora es `set` inmediato: la caja nueva aparece ya en su lugar. El simulador lee el mismo
param, así que el límite salta con ella y el clamp del final mete adentro, en el mismo frame, a
las que quedaron afuera. Medido: pasando de la 17 (center) a la 18 (left), `box.x` va de 0 a
−2.1 en menos de 30 ms y no se mueve más.

### El color de las partículas ahora corta, no funde
Novedad en `SceneManager`: una escena puede traer `transitions`, un mapa `id → segundos` que pisa
el tiempo de transición **de esos params nada más**. Se usa para `particles.baseColor` (0.15 s)
en las 14 escenas que definen un color: pasar de rojo a azul en el segundo y medio de la escena
se veía como un lavado violeta en el medio.

Medido entrando a la 14 desde la 13, con la transición normal de 1.5 s: el color pasa
`#FF0000 → #e0008b → #6400f0 → #0000FF` en unos 180 ms, mientras el resto de la escena
(opacidades, piso, caja) sigue entrando en su tiempo.

### Estrobo del torbellino (escena 23)
`vortex.strobe` (0..1), `vortex.strobeRate` (Hz) y `vortex.strobeDuty` cortan la fuerza del
torbellino a intervalos. **No es un parpadeo de brillo: es la fuerza misma.** En cada corte la
columna se suelta y se abre por inercia, y al volver se cierra de golpe — la masa late en vez de
titilar. La 23 lo usa a 11 Hz con duty 0.45 y amount 0.85.

El tiempo del estrobo se acumula con el `dt` del motor y no con `performance.now()`, para que
respete las pausas: si no, al recuperar el foco la fase pega un salto y se ve un parpadeo suelto.

Medido en la 23: `vortex.pull` efectivo alterna entre 30 (apretando) y 4.5 (soltado).

Las 23 escenas a 60 fps y `smoke-learn` en verde.

## Quinta vuelta: dirección de la fuerza, bloque al frente, cajas al costado (2026-09-04)

### La fuerza del bloque rojo empujaba casi toda en Z (bug)
Manuel: *"en 14 y 15 van contra la pared; la dirección tiene que ser absolutamente a la
izquierda o la derecha de toda la pantalla, no del lado del cubo contenedor"*. Tenía razón y el
motivo estaba en el código:

`RedBlock` publicaba como normal del atractor la normal de su propia geometría. Pero la
geometría es un `PlaneGeometry` —normal +Z, o sea mirando a cámara— al que `redBlock.yaw` le da
apenas 20° de inclinación estética. Su normal queda en (sin 20°, 0, cos 20°) ≈ **(0.34, 0, 0.94)**:
el empuje era casi todo en Z y los palitos se iban contra la pared de adelante o la de atrás de
la caja, no hacia el bloque.

Ahora la normal es el eje X del mundo a secas, `(±1, 0, 0)`, sin relación con la inclinación
visual del bloque. Medido: `attractorDirs[0] = [-1, 0, 0, 1]`.

Como el empuje es horizontal puro, en 14/15 la caja va con **`box.yaw 0`**: no se ve, así que lo
único que hace su rotación es decidir contra qué le pega la masa, y con los 45° de siempre un
empuje horizontal la metía en una ARISTA y quedaba una cuña finita. Sin girar, la pared queda
perpendicular al empuje y la masa se aplasta contra ella a lo ancho y a lo alto.

### La fuerza late (`redBlock.attractPulse`)
Con fuerza constante la masa llega a la pared y se queda quieta: no se lee que la esté
arrancando nada. `redBlock.attractPulse` (0..1) y `redBlock.attractPulseRate` (Hz) modulan la
atracción con dos senos de frecuencias no múltiplas, igual que el temblor de la placa. En 14/15
va a 0.85 y 7/9 Hz. Medido: la fuerza efectiva del atractor oscila entre **96 y 420** alrededor
de los 240 nominales — la masa embiste, afloja y vuelve a embestir.

### El bloque rojo va adelante, pero sin borrar los palitos
`renderOrder 1000` **con** test de profundidad. Esa combinación hace las dos cosas:
- **tapa el piso**, porque el piso no escribe profundidad (`depthWrite: false`) y por lo tanto no
  puede rechazar al bloque. Antes el bloque se dibujaba primero (renderOrder −1) y los dashes
  que caen más cerca de la cámara le pasaban por encima: correcto en 3D, pero no es lo que se
  quiere ver;
- **no borra los palitos**, porque ellos sí escriben profundidad.

Se probó primero con `depthTest: false` (tapar literalmente todo) y no sirve: la masa azul de
la 14/15 queda justo detrás del borde del bloque y desaparecía entera.

### Las cajas de 16/18/19 van mucho más al costado
Presets de ±2.1 → **±3.0 m**. Para que entren hubo que **ensanchar el dominio de simulación** de
±4.5 a ±5.5 m: con ±4.5, la caja a la izquierda no podía pasar de x = −2.46 (girada 45° mide
1.84 m de medio ancho) y más allá el clamp del dominio y el de la caja se peleaban en el borde.
Cuesta 20 celdas más en x, +22% de grilla sobre un simulador que corre en 0.2 ms.

### Bug encontrado de paso: la caja se plantaba en el centro
`box.x` era `sceneReset: true`, así que `goto` lo devolvía a su default (0) en cada cambio de
escena, y `BoxWire` solo lo vuelve a escribir cuando el preset **cambia de valor**. Saltar entre
dos escenas que comparten preset (de la 16 a la 18, las dos `left`) dejaba la caja plantada en el
centro. Recorriendo el show en orden no se notaba porque entre medio pasa la 17, que es `center`.
Ahora `box.x` es `sceneReset: false` — es estado vivo que maneja el preset, no un valor de
escena. Verificado saltando 16 → 18 → 19 → 18 → 17 → 16 → 13: siempre −3 / 3 / 0 según el preset.

### Dashes 30% más chicos
`floor.dashLength` 0.55 → 0.385, `dashWidth` 0.15 → 0.105, `dashHeight` 0.03 → 0.021. El período
y la separación de carriles NO cambian: el dash se achica y queda más aire entre uno y otro. Si
se achicara todo junto, la fuga se vería igual pero más chica.

Las 23 escenas a 60 fps.

## Sexta vuelta: la caja se ve y los palitos rebotan (2026-09-04)

Manuel: *"que no desaparezca la caja de los límites, y los palitos tienen como que rebotar más;
ahora están pegados por la atracción, tiene que querer ir para allá pero a su vez rebotar contra
la caja así hay más movimiento"*.

### La caja se ve
`box.visible: 1` en 14 y 15. Con `box.yaw 0` (que ya estaba, para que la pared quede
perpendicular al empuje) la caja se lee en perspectiva de un punto, como una habitación. Es
distinta al rombo de 45° del resto del show, pero es la rotación que necesita la física de estas
dos escenas.

### El pulso de la fuerza ahora se DA VUELTA
Es el cambio que resolvió el problema. Antes `redBlock.attractPulse` iba de 0 a 1 y la fuerza
oscilaba entre 0 y 2× la nominal: a 7 Hz eso es una **vibración**, no un envión — la masa tiene
70 ms para expandirse, o sea unos centímetros, y se queda pegada a la pared igual.

Ahora el param llega a **2** y por encima de 1 el modulador se va a negativo: **la fuerza cambia
de signo y el bloque empuja en vez de atraer**. Los palitos salen despedidos al fondo de la caja,
rebotan contra la pared de enfrente y el pico siguiente los vuelve a traer.

Y la frecuencia baja de 7 Hz a **2 Hz** (1.6 en la 15). Arriba de ~4 Hz no da tiempo a que se
vea el ciclo.

Medido frame a frame durante 1.1 s en la 14, fuerza efectiva del atractor:

```
392  198  -14  -91  33  278  476  511  394  242  162  165  181  149  93  101  230  426  551  493  272  31  -72
min −91 (el bloque EMPUJA) · max 554 (lo arranca) · nominal 240
```

En capturas separadas 340 ms se ve la diferencia: en una fase la masa está desgarrada en jirones
con tentáculos sueltos, en la otra vuelve aplastada contra la pared.

### La pared devuelve en vez de absorber
`box.wallBounce` 0.75 → **0.92** y `particles.drag` 0.06 → **0.015**. Con rozamiento alto lo que
volvía del rebote se apagaba antes de chocar con lo que seguía viniendo, y esa colisión entre las
dos corrientes es justamente el movimiento que se quería.

Corrida de 40 s en la 14 para descartar que el rebote alto acumule energía: 60 fps estables, sin
NaN, la masa nunca se sale de la caja.

## Séptima vuelta: la 14 y la 15 pasan de atractor a STREAM (2026-09-04)

Manuel: *"no me gusta cómo funciona el atractor; que sean como un stream que van emitiéndose
dentro del cubo y que apenas chocan con el bound desaparezcan, bien rápido y en dirección al
cuadrado rojo, porque ahora todos se apelmazan en el borde"*.

Tenía razón y el problema era estructural, no de valores: **tirar de una masa incompresible
contra una pared termina siempre en la masa apelmazada contra el borde**. Se probó con fuerza
constante, con fuerza pulsada, con la fuerza dándose vuelta, con rebote casi total y con
rozamiento casi nulo. Mejoraba el movimiento, pero el apelmazamiento es el estado de equilibrio
de ese sistema: mientras la fuerza tire y la pared aguante, la masa va a estar contra la pared.

La solución no es una fuerza distinta, es **sacar la fuerza**. Ahora hay un caudal:

### `particles.wrapMode: 'horizontal'` (nuevo)
Tercer modo de emisión continua, hermano del `vertical` de la escena 12. Los palitos cruzan la
caja en el sentido de `particles.flowX` y, **apenas tocan la pared de llegada, mueren y renacen
en la pared de enfrente** con y/z al azar. Como lo que llega desaparece, nunca se acumula nada:
lo que se ve es un chorro que atraviesa la caja sin fin.

Detalle de implementación que importa: **el test se hace en el espacio LOCAL de la caja**, no en
X del mundo. Si la caja estuviera girada, el clamp la frenaría contra su propia pared y el umbral
en X del mundo no se alcanzaría nunca — las partículas quedarían pegadas para siempre sin
reciclarse. El margen de 1.5 celdas hace que se reciclen apenas tocan, sin que se vea el frenado.

`redBlock.attract` queda en **0** en las dos escenas: el bloque rojo se sigue viendo pero ya no
tira. Es el destino del chorro, no un imán. Todo el aparato del pulso reversible
(`attractPulse` > 1) sigue existiendo por si se quiere usar en otro lado.

### Los valores del look
- `particles.density` 0.4 → **1.4**: con la densidad de fábrica los mismos palitos se reparten
  por todo el volumen de la caja y lo que se ve es una niebla azul oscura. Con la densidad de
  reposo alta el fluido acepta estar más junto y el chorro sale con cuerpo.
- `box.depth` 2.6 → **2.0** por lo mismo.
- `particles.drag` **0.02** con `flowX` ±3: cruzan rápido.
- `box.wallBounce` **0.1** y `wallStiffness` 0.4: acá no interesa que reboten, interesa que
  lleguen y desaparezcan. Con rebote alto volverían contra el caudal que viene y se taparía.
- Se dejó `particles.length` en su valor calibrado. Alargar el palito mejoraba el efecto de
  estela, pero es un ajuste global de Manuel y no corresponde que se lo quede una escena.

Verificado a los 5 s y a los 30 s: la imagen es la misma, o sea que el régimen es estable y no
se acumula. 23 escenas a 60 fps, `smoke-learn` en verde.

## Octava vuelta: la 14 y la 15 dejan de ser la misma escena dos veces (2026-09-05)

Manuel: *"hay unas escenas repetidas de las cajas bound de partículas... generá otras 2 escenas
completamente distintas de lo que pasa pero manteniendo los elementos y color; que sean azules
las partículas pero con otro comportamiento bien distinto; quizás sin el bound y que recorran
todo el espacio"*.

Tenía razón: la 14 y la 15 eran **el mismo stream duplicado**, con el signo de `particles.flowX`
cambiado y el bloque rojo de lado. Mismo encuadre, mismos valores, mismo comentario. Ahora son
dos escenas que solo comparten el azul y el piso, y ninguna de las dos usa el bound.

Efecto colateral a tener presente: **el bloque rojo ya no aparece en ninguna escena del show**.
El elemento y todos sus params siguen vivos y disponibles por MIDI/OSC (`redBlock.opacity` en 0
por defecto); simplemente ninguna escena lo enciende.

### Escena 14 — «Cardumen azul»
Campo de direcciones (el de la 20) para que se peinen en filamentos, **más un flujo lateral
flojo** que hace migrar la bandada entera; el que sale por un borde renace en el de enfrente.
Contra la 20 —una nube roja que se organiza en el lugar— esta es una corriente azul que
atraviesa el cuadro y no se detiene nunca.

La caja está apagada e invisible pero igual configurada: **el reciclado horizontal no mira
`box.enabled`**, solo `boxCenter`/`boxHalf`, así que la huella sirve de dominio sin volver a
encerrar nada. Es el mismo truco que la 12 usa en vertical.

- `box.width` **10 m**, y para eso hubo que subir el techo del param de 8 a 11 (el ancho del
  dominio). La pantalla mide 8 m en el plano z = 0, pero **en perspectiva se abre con la
  profundidad**: a 1.8 m de fondo el cuadro ya abarca ±5.8 m, así que con medio ancho 4 quedaban
  franjas negras a los costados. Con ±5 el reciclado además cae fuera de cuadro y no se ve nunca
  aparecer una partícula de la nada.
- `box.yaw` **0** explícito: `resetInBox` y el reciclado trabajan en el espacio local de la caja,
  y el default es 45°. Una huella de 10 × 2.8 m girada 45° se sale del escenario por las esquinas.
- `particles.density` se deja en **0.4** de fábrica: acá no se busca cuerpo sino una nube rala.
  Con la densidad alta de las viejas 14/15 los palitos se juntan y se pierde la lectura de bandada.
- Umbrales de blanco en 18/36 (ver la cuenta del `whiteJitter` en la escena 12).

Verificado a los 10 s, 35 s y 95 s: el cuadro sigue lleno y parejo. La deriva hacia arriba que se
ve en los primeros segundos es el transitorio del reparto inicial, no una fuga.

### Escena 15 — «Torbellino errante azul»
Los tres torbellinos que ya había (21, 22, 23) tienen el centro clavado. Acá **el centro pasea**
—param nuevo `vortex.travelX` / `travelZ` / `travelRate`, una Lissajous de 1 : 0.37 para que el
recorrido no se lea como un péndulo— y lo que se ve es un tornado con tronco que sale del piso,
se abre en copa y barre el escenario dejando estela.

El paseo es puro CPU: `vortexCenter` ya era un uniform que se actualiza por frame, el kernel no
se tocó. El tiempo se acumula con el `dt` del motor y no con `performance.now()`, igual que el
estrobo y por lo mismo: si no, al recuperar el foco el centro pegaría un salto a la otra punta
del escenario y la masa saldría disparada atrás.

Lo que costó encontrar fue el equilibrio de tres valores que tiran para lados opuestos:

| | masa muy repartida (11 m) | masa muy junta (6 m) | **9 m + radio 4** |
|---|---|---|---|
| tronco | desdibujado, queda una nube | nítido | nítido |
| cuadro | lleno | un tercio negro | lleno |

- `particles.density` **1.6**: es lo que hace que se vea el embudo, no el torbellino. Con la
  densidad de fábrica esto mismo daba una nube difusa sin tronco. Es la lección de la 23.
- `vortex.radius` **4** — el radio es ALCANCE, no grosor: es lo que hace que el vórtice llegue a
  buscar la masa hasta los bordes del reparto en vez de organizar solo la del medio.
- `vortex.travelX` **2.0**: probado con 2.4 y con 3, y el tornado se lleva la masa tan al costado
  que el otro tercio del cuadro queda negro.
- `whiteJitter` **0** con el umbral en 20: con un torbellino de esta fuerza el núcleo pasa de
  largo cualquier umbral razonable, y sin dispersión el corte queda duro y nada se blanquea.

**NO va `field.*` acá.** Se probó con `amount` 0.6 y 1.0 para llenar el rincón que el tornado
deja oscuro, y el campo le desarma el tronco: queda la misma nube difusa que se estaba tratando
de evitar. El cuadro se llena con la densidad, no con el campo.

### Dos bugs que aparecieron haciendo esto

**`box.yaw` no llegaba nunca al ángulo que pedía la escena.** `box.yawSpeed` se funde como
cualquier otro param, así que al entrar en una escena que lo pide en 0 viniendo de una que giraba,
el valor tarda toda la transición en llegar a cero. Durante esos segundos el integrador de giro de
`BoxWire` seguía escribiendo `box.yaw` frame por frame, y como en `Params` un `set` **cancela el
tween en curso**, el tween hacia el ángulo pedido moría en el primer frame y no lo volvía a crear
nadie. Medido: yendo de la 13 a una escena con `box.yaw: 0` terminaba en 14°, y viniendo de la 16
en 96°. Las viejas 14 y 15 también pedían `box.yaw: 0` y nunca lo alcanzaban — el stream corría
contra una pared torcida sin que se notara.

Arreglo: mirar el **destino** de `box.yawSpeed` en vez de su valor actual. El destino ya vale 0 en
el primer frame de la escena nueva, así que el integrador se calla enseguida y el tween del ángulo
llega. Para las escenas que sí giran no cambia nada (ahí el destino es ≠ 0 y el giro sigue mandando
sobre el ángulo, que es lo que se quiere).

**Las acciones de entrada corrían con la caja de la escena anterior.** `SceneManager.goto`
*funde* los params y dispara las acciones inmediatamente después, así que un
`particles.resetInBox` al entrar reubicaba las partículas usando la huella vieja, todavía a un
frame del arranque del fundido. Se arregla con la constante `HUELLA_YA` en `scenes/index.js`:
pone la geometría de la caja con transición **0**, que en `Params.tween` se convierte en un set
inmediato. No se ve saltar nada porque en estas escenas la caja es invisible.

Verificado: 13 → 14 → 15 → 16 con las transiciones reales, y salto directo a la 15 desde una
escena 2D. Todo lo de la 14/15 (densidad, jitter, rozamiento, wrap, paseo, campo) vuelve solo a
su valor de fábrica al salir. 59-61 fps, sin excepciones.

## Novena vuelta: la 15 deja de ser un torbellino y las partículas se van lejos (2026-09-05)

Manuel, sobre la 15 de la vuelta anterior: *"es una mierda lo que hiciste. Cambiala por algo
mejor, no podés repetir lo que ya pasa después. Hacé que las partículas se vayan lejos en vez de
eso"*. Y sobre la 14: *"de la 13 a la 14 tiene que ser más progresivo el cambio: que cambien de
color de una, pero que de la posición que tienen antes pasen a esa dinámica"*.

Tenía razón en las dos. El «torbellino errante» era el **cuarto** torbellino del show (21, 22 y
23 ya lo son) y el paseo del centro no alcanza para que se lea como otra cosa. Y la 14 entraba
con un `resetInBox`, que es un corte: las partículas desaparecen de la caja de la 13 y aparecen
repartidas por la pantalla en un frame — justo lo contrario de progresivo.

### La 15 ahora es FUGA, no torbellino
Las partículas nacen en el eje del medio y **salen despedidas hacia afuera**, ganando velocidad,
hasta perderse fuera de cuadro. Es lo contrario de los torbellinos: aquellos juntan, este empuja.
Visualmente queda un túnel radial con punto de fuga en el centro.

Hicieron falta dos cosas nuevas, las dos chicas:

- **`vortex.pull` puede ser negativo** (mínimo 0 → −30). La misma fuerza del torbellino con el
  signo cambiado deja de chupar y repele; no hay fuerza nueva, es la que ya estaba. Con `swirl`
  encima la fuga sale en espiral y no en radios rectos (sin giro se lee como un ventilador).
  Ojo con el guardia del kernel: era `vortexPull.greaterThan(0)` y con `pull` negativo se saltaba
  el bloque entero. Ahora es `notEqual(0)`.
- **`particles.wrapMode: 'radial'`**, tercer modo de emisión continua. Sin reciclado esto dura
  tres segundos: todo termina apelmazado contra la pared del escenario y ahí se queda. La
  partícula que pasa el borde de la huella muere y renace en el eje del centro, así que la fuga
  no se termina nunca.

Detalles de implementación que importan:
- El test de salida es un **CILINDRO** (distancia en XZ contra `boxHalf.x`), no la caja. Con el
  test por caja las que van en diagonal cruzarían más camino que las que van derecho y el frente
  de la fuga se vería cuadrado. Se compara al cuadrado, sin raíz, para no pagarla por partícula
  y por frame.
- Renace **quieta** (velocidad 0), al revés que los otros dos modos, que renacen con la velocidad
  del flujo. Acá lo que acelera es el propio vórtice, y arrancar de cero es lo que da la lectura
  de que la partícula nace en el centro y va ganando velocidad hacia afuera.
- El radio de reciclado es `box.width / 2` = 5.5 m, o sea el dominio entero: **cae siempre fuera
  de cuadro**. No se ve nunca a una partícula desaparecer, solo irse. Ese es todo el truco.

Los valores que costaron:
- `particles.drag` **0.01**. El rozamiento le pone techo a la velocidad; con el techo bajo las
  partículas frenan a mitad de camino y la fuga se queda en una bola alrededor del centro. Con
  0.01 la repulsión las sigue acelerando todo el trayecto.
- `particles.emitSpread` **1.0**, y es el mando del hueco del medio. La repulsión es más fuerte
  cuanto más cerca del centro (la caída va con 1/(1+(d/r)²), máxima en d = 0), así que las
  partículas evacúan el eje enseguida. Con la boca finita (0.35, probado) el agujero negro se
  come el tercio central de la pantalla; con 1 m queda del tamaño de un punto de fuga.
- Umbral de blanco **alcanzable** (14/34), al revés que en el resto de las escenas azules: acá la
  velocidad crece con la distancia, así que las puntas de la fuga se van aclarando solas. Es
  degradado, no lavado — el cuerpo sigue siendo azul.

### La 14 entra progresiva
Se le sacó el `resetInBox`. Ahora la masa arranca donde estaba —apretada en el medio, como la
dejó la 13— y se la ve ABRIRSE: el flujo lateral la estira, el campo la peina y en unos segundos
ocupa el cuadro. El color sí corta de una (`COLOR_RAPIDO`, 0.15 s), que es justo el reparto que
pidió Manuel: el color de golpe, la forma progresiva.

**Bug que destapó el cambio**: durante el fundido de entrada se veía **una caja de alambre del
tamaño del escenario** cruzando la pantalla. `HUELLA_YA` agranda la huella a 10-11 m de golpe,
pero `box.visible` seguía fundiéndose desde la escena anterior, así que durante ~2 s se dibujaban
las aristas de esa caja gigante. Se arregla metiendo `box.visible` en `HUELLA_YA`: se apaga de
una y no se nota (la escena anterior ya las tenía chicas).

Verificado: 13 → 14 → 15 → 16 con las transiciones reales y salto directo a la 15 desde una
escena 2D. Al salir, todo lo de la 14/15 (wrap, pull, spread, rozamiento, densidad, huella)
vuelve solo a su valor de fábrica. Las 23 escenas a 60 fps; la 14 y la 15 en 1.0-1.1 ms.

## Décima vuelta: las 14 y 15 vuelven al bound, se va la 16, y aparece el ORBE (2026-09-05)

Manuel: *"la escena 14 está mal porque no quiero que se suelten todavía los palitos. Tenés que
hacer otra escena con otra dinámica pero DENTRO DEL BOUND DE LA CAJA, lo mismo la 15, siempre
dentro de la caja. Además la 16 y la 18 son lo mismo, así que sacá las escenas duplicadas. Y
quiero que me propongas alguna otra interacción para los palitos: cuando están sueltas sin el
bound, que haya como un atractor que a su vez sea un punto de luz que las modifique; que aparezca
cuando reciba un mensaje que te voy a definir, pero por ahora hacé que actúe solo así veo cómo
es. O sea que las atrae pero también genera iluminación que modifica los palitos"*.

Lo de soltar las partículas en la 14 y la 15 era un error de armado del show, no de valores: las
10 a 13 son masa contenida y las 20 a 23 son masa suelta. Si la 14 ya suelta todo, el momento en
que la masa se libera —que es la 20— llega gastado.

### La 14 es una RUEDA (y para eso hizo falta `vortex.axis`)

Los tres torbellinos que ya existían (21, 22, 23) son de **eje vertical**: giran en el plano XZ,
o sea en planta. Desde la butaca eso no se ve girar — se ve una masa que se junta y se afina.

`vortex.axis` (enum `y` | `z`) agrega el **eje horizontal**: el mismo cálculo en el plano XY, de
frente a la cámara. Ahí el giro SÍ se ve: los palitos se orientan tangencialmente y dibujan una
rueda con su ojo en el medio, girando. Es la única de las 22 escenas donde se ve girar algo.
`vortex.y` es el centro vertical de esa rueda (con el eje `y` no se usa). Dos diferencias con el
bloque de eje vertical, las dos deliberadas: la profundidad no participa (si además tirara en z
se leería como un embudo, no como una rueda) y `vortex.lift` no se aplica, porque el ascenso ya
es parte del giro.

Los cinco valores de la rueda son un equilibrio, probados de a juegos completos con capturas:

- **`pull` no puede ser 0.** Sin atracción la centrífuga manda todo contra las paredes y queda un
  marco cuadrado hueco: se ve la caja, no la rueda (probado con swirl 2 / pull 0).
- **`swirl` alto con `pull` alto** da el huracán: masa llena con un ojo chico. Con swirl 2.5 /
  pull 0.5 sale una rosca gruesa con un agujero enorme — también se ve bien, pero se lee como un
  anillo y no como algo girando. Quedó en 6.5 / 3.5, radio 2.2.
- **El rozamiento le pone techo a la velocidad de giro, y ese techo decide el color.** La
  velocidad tangencial de régimen es swirl/drag = 13 y el umbral de blanco efectivo más bajo es
  20 − 0.35·20 = 13. O sea que el cuerpo queda azul y solo se encienden las puntas más rápidas.
  Si se sube el giro hay que subir el rozamiento, o se lava a blanco.

### Lo que se descartó para la 14: el caudal horizontal

Primero se rehizo como el stream de la séptima vuelta (los palitos cruzando la caja hacia el
bloque y reciclándose contra la pared). **En capturas es un ladrillo azul uniforme**: con todos
los palitos alineados y a la misma velocidad no hay textura, no hay borde y no se lee ninguna
dirección. Se probaron cuatro juegos completos —flujo 1.2 a 3, rozamiento 0.03 a 0.08, densidad
1.4 a 1.8, con y sin torbellino de eje vertical encima— y los cuatro dan la misma niebla plana.
La conclusión no es de valores: un caudal parejo dentro de una caja no tiene nada que mirar.

### La caja se dimensiona como la masa, no como el recorrido

Primer intento de la 14 con una caja de 4.6 × 3.2 × 2.0 m: **llenaba el cuadro entero** y lo que
se veía era una niebla azul plana. El fluido no tiene tensión superficial, así que se reparte por
todo el volumen que le den y la silueta que se ve en pantalla es la de la caja. Con 2.6 m de
ancho la masa tiene cuerpo y se lee la forma. Es la misma lección de la tercera vuelta, otra vez.

Y el bloque rojo se corrió de 3.3 a **3.0 m** para que su borde derecho caiga justo donde arranca
la caja. En perspectiva no basta con mirar los metros: el bloque está a z = −1.0 y la caja a
−1.84, así que con el default quedaba una franja negra entre uno y otra.

### La 15 son FILAMENTOS, y el motor es el campo

También dentro del bound, pero con el motor cambiado: acá no hay caudal ni dirección. Lo que
mueve la masa es el campo de direcciones (`field.*`), que no tiene centro, así que los palitos se
peinan en filamentos y remolinos que nacen y mueren solos sin converger a ningún lado. Contra la
14 (una rueda que gira en el lugar) esta es una masa que se retuerce, y contra la 20 —que es el
mismo campo con las partículas sueltas— acá los filamentos chocan contra las paredes y se
doblan: el mismo material en una pecera. Ese contraste es lo que hace que la 20 se sienta como
una liberación.

- `align` 6.0 con `amount` 1.0: los palitos se peinan entre ellos conservando lo que traían, en
  vez de acelerar todos juntos. Es lo que da la lectura de filamento.
- `field.scale` **0.024**, más chica que en la 20 (0.011): el campo tiene que dibujar varias
  corrientes dentro de 3.8 m, no repartidas en 11.
- `field.sectors` **2** y no 5: la caja ocupa un tercio del ancho del dominio, así que con 5
  sectores caería entera en uno solo y la variación no se vería.
- `box.wallBounce` **0.7** (contra 0.25 en la 14). La pared que devuelve es lo que convierte el
  choque en movimiento: el filamento que llega al vidrio rebota y se cruza con el que viene, y
  ahí se arma el nudo. Con la pared absorbente la masa se aplasta contra el borde y se queda.
- Rozamiento 0.15 con `amount` 1.0 deja la velocidad de régimen en 6.7, la mitad del umbral de
  blanco efectivo (13). Los tres números son un equilibrio: si se toca uno, mirar los otros dos.

En las dos escenas el bloque rojo **se ve pero no tira** (`redBlock.attract: 0`). Tirar de una
masa incompresible contra una pared termina siempre en la masa apelmazada contra el borde — está
medido en la séptima vuelta. Es el destino del chorro, no un imán.

### Se fue la escena 16

`16.png` y `18.png` del storyboard son la misma imagen (caja a la izquierda con masa roja), y en
código eran la misma escena con y sin rayos. Se sacó la **16** y no la 18 porque la 18 forma
terna con la 17 y la 19 (centro / izquierda / derecha, las tres con rayos): sacando la 18 quedaba
un hueco en el medio de una serie. **El show pasa de 23 a 22 escenas.** Los ids no se
renumeraron: son el número de imagen del storyboard, y ya había huecos (la 8 y la 9 no tienen
imagen). Se sacó también `sc16` de `mappings.default.json`.

**Efecto colateral:** un mapeo guardado en el localStorage de una máquina que ya venía usando el
editor va a seguir teniendo su fila `sc16`, y disparándola da `escena desconocida: 16` por
consola sin hacer nada más. Se arregla con «restaurar mapeos por defecto» en el editor.

### El ORBE

Elemento nuevo (`layers3d/Orb.js`), grupo de params `orb.*`. Es un punto de luz que hace **tres
cosas a la vez**, y las tres juntas son el efecto:

1. **Atrae** — publica el atractor 1 del simulador (el 0 es el del bloque rojo), en modo punto.
2. **Alumbra** — una `PointLight` de verdad, así los palitos cercanos reciben luz direccional y
   se les ve el volumen contra el fondo negro. Es sombreado físico, no un truco.
3. **Tiñe** — un halo de color que se mezcla al color de la partícula según lo cerca que esté, y
   que además le suma emisión. Lo aplica `StickRenderer` leyendo `ctx.orbState`.

**La luz sola no alcanzaba, y esto es lo que hay que saber si mañana se quiere otro efecto de
este tipo:** el palito mide unos 3 px de ancho en la LED y tiene emisión propia, así que el
aporte de una lámpara se le pierde adentro. Lo que se ve desde lejos es el tinte — el cambio de
color — y el brillo extra que lo mete en el bloom. La `PointLight` sí aporta, pero en el
relieve: sin ella el halo es una mancha plana.

Detalles de implementación que importan:

- **La luz vive siempre en la escena, apagada.** Agregarla y sacarla en vivo obliga a three a
  recompilar los materiales de toda la capa 3D (cambia el `LightsNode`) y eso es un tirón de
  varios frames justo en el momento del destello.
- **El orbe no está siempre encendido**: tiene envolvente (ataque + caída) y se dispara con la
  acción `orb.flash`. Un atractor puntual permanente termina siempre en una bola apelmazada y
  nada más se mueve. Como evento —aparece, arrastra, se va— la masa se junta y se vuelve a
  soltar.
- **Se mueve siempre**, encendido o apagado, en una Lissajous de frecuencias 1 : 0.61 : 0.37. Así
  cada destello lo agarra en otro lugar y no se repite dos veces la misma pasada.
- **`orb.auto` (Hz) lo dispara solo.** Es lo provisorio que pidió Manuel para verlo funcionando.
  Cuando defina el mensaje: mapear `orb.flash` a ese mensaje y poner `orb.auto` en 0. No hay que
  tocar código.

#### El empujón de salida (`orb.push`)

Sin esto la escena se muere sola: cada destello junta un poco más de masa, el campo de la 20 no
tiene fuerza para deshacer un grumo, y a los 38 s la nube ocupaba un tercio de lo que ocupaba al
entrar. Con `orb.push` la fuerza **se da vuelta** justo cuando el destello se apaga (una campana
de 0.35 s centrada en `attack + decay`, restada a la envolvente), así que el orbe **recoge y
suelta**: lo que juntó sale despedido y el campo lo vuelve a peinar. De paso el evento tiene
final — se ve la masa abrirse cuando la luz se va.

#### Fuerza suave con radio grande, no al revés

Es el valor que más costó y es contraintuitivo. Comparadas tres combinaciones a 32 s, cada una
con la escena reiniciada para que la comparación fuera honesta:

| | `pull` | `radius` | `push` | `auto` | resultado a 32 s |
|---|---|---|---|---|---|
| P | 70 | 3.0 | 1.2 | 0.10 | nube linda pero corrida a un costado, media pantalla vacía |
| Q | 110 | 3.4 | 1.4 | 0.08 | bola apretada, la escena deja de leerse como partículas libres |
| **R** | **60** | **4.5** | **0.6** | **0.14** | **la nube conserva el tamaño con el que entró** |

Con la fuerza alta y el radio corto el orbe hace lo que hace un imán: aprieta. Con la fuerza baja
y el radio grande alcanza a TODA la nube y la mueve entera — se ve arrastrar, no comprimir.

El orbe va **solo en la 20**. En la 21, 22 y 23 ya hay un torbellino tirando, y dos atractores
peleando por la misma masa no se lee, se ensucia. El `mainAction` de la 20 pasó de
`particles.kick` a `orb.flash`, así la barra espaciadora lo dispara a mano.

### Params que quedaron sin dueño (y volvieron al BASE)

Al cambiarle la dinámica a la 14 y a la 15 quedaron cinco params que las listaban ellas y ya no
lista nadie: `particles.flowX`, `particles.emitSpread`, `vortex.z`, `vortex.travelX` y
`vortex.travelZ`. Un param así es una fuga: moverlo desde el editor le pisa el valor de fábrica a
todas las escenas y sobrevive a la recarga. Y son justo los peligrosos — un flujo lateral o un
paseo del torbellino pegados se arrastran por el show entero sin que se entienda de dónde salen.
Van al `BASE` con su valor de reposo, más `orb.bloom` para que el orbe quede completo.

Vale aclarar, porque cuesta acordarse: **la mayoría de los params huérfanos son deliberados**
(hay 96 en total). Los ajustes finos de estética —`floor.dashLength`, `rays.color`, `debris.*`—
tienen que estar fuera de `ownedParams` justamente para que el editor pueda guardarlos como
ajuste del usuario. El problema aparece solo cuando un param que ERA de una escena se queda
suelto.

### Verificado

Las **22 escenas a 60 fps**, entre 1.0 y 6.0 ms por frame (la 20, que es la que suma el orbe,
mide 6.0 en el peor caso y 0.9 en el mejor; el ruido entre corridas es mayor que el costo del
orbe). `smoke-settings`, `smoke-learn` y `smoke-persist` en verde. Recorridos mirando capturas:
13 → 14 → 15 → 17 con las transiciones reales, y 19 → 20 con el orbe en automático a lo largo de
55 s para confirmar que la nube no se apelmaza ni se vacía.

## Undécima vuelta: la corriente, el orbe que apaga y el rayo que se nota (2026-09-05)

Manuel, sobre la vuelta anterior: *"la 14 y la 15 tienen que ser las azules, pero hacé que además
de ese torbellino haya como una fuerza hacia la izquierda que lo empuje, y además el cuadrado rojo
tiene que vibrar. Y la 15 que sea igual a la 14 pero para el otro lado, no con esa caja más grande
que hiciste. Está bien la bola atractor, pero hacé que no sea tan fuerte, que su radio no sea tan
grande, que NO SE VEA LA BOLA pero sí que ilumine. Y también pasa que se hacen como celestes o
cyan cuando los atrae la bola: hacé que se hagan NEGROS los que son atraídos, en vez de blancos,
progresivamente. Además mejorá lo que el rayo que cae produce con los palitos, porque no se llega
a notar que interactúe, que genere un cambio"*.

### La 14 y la 15 son ahora la misma escena espejada

Las dos comparten un helper (`ruedaAzul(sentido)` en `scenes/index.js`) y lo único que cambia es
el signo: el lado del bloque rojo, el sentido de la corriente y **el sentido del giro**. Para eso
`vortex.swirl` pasó a aceptar negativos (mínimo 0 → −30), igual que `pull` en la novena vuelta. Si
las dos giraran para el mismo lado la 15 no sería la 14 dada vuelta, sería la 14 con el bloque
mudado de lugar.

La 15 vuelve a la caja de la 14 (2.6 × 3.2 × 1.8): con los 3.8 m de ancho que tenía se leía como
otra escena en vez de como el espejo.

**La corriente** es `particles.flowX` en ±1.5 con el rozamiento en 0.5, o sea una velocidad de
régimen de 3 contra los 13 del giro. La rueda sigue girando pero apoyada contra la pared del
bloque, y el brazo de ese lado se aplasta y se deshilacha. Con el flujo al máximo (3) la rueda se
pierde: la masa se va entera al borde y vuelve a ser el ladrillo plano de la versión anterior.

### El temblor del bloque rojo iba en la dirección que no se ve

Bug viejo, encontrado midiendo. `RedBlock` movía la placa **por su normal** — lo correcto en 3D —
pero el bloque está apenas inclinado (`yaw` 20°), así que su normal es casi todo Z y el temblor se
iba en profundidad. Medido sobre cuatro frames seguidos con la amplitud en 14 cm, el borde del
bloque se movía **4 px de 2688**: nada.

Ahora el temblor va en **X del mundo** (lateral) más la mitad en vertical. Los mismos 14 cm son
~45 px, y con los 26 que usan la 14 y la 15 el recorrido medido es de **62 px**. El techo del
param subió de 0.3 a 0.8 m.

### El orbe: apaga en vez de teñir, y la bola no se ve

Tres cambios, y el tercero es el que costó:

- **`orb.core`** (0..1) es la opacidad del núcleo. En la 20 va en **0**: la bola no se dibuja y se
  ve solo lo que hace. La luz sigue estando y es lo único que la delata.
- **`orb.tint` → `orb.darken`**: el halo ya no mezcla hacia el color del orbe (que quedaba
  celeste), lleva a NEGRO el color **y la emisión**. Apagar los dos juntos no es opcional: el
  palito tiene brillo propio, así que con el color en negro y la emisión intacta el agujero no se
  ve. La rugosidad también sube a 1 dentro del halo, porque con el albedo en negro el palito
  todavía devuelve el reflejo especular de la luz del orbe —que la tiene encima— y se veía blanco
  justo donde tenía que verse negro.
- **`orb.color` pasa a blanco.** La luz también tiñe lo que toca; en celeste ponía cyan la nube
  roja alrededor, que es de lo que Manuel se quejaba.

Y la fuerza baja de 60 a **30** con el radio de 4.5 a **2.6 m**: el orbe se lleva un pedazo y deja
el resto donde estaba, que es lo que hace que se lea como algo que PASA por la nube.

#### El borde del halo tiene que ser DURO (lo que costó)

La primera versión iba de 1 en el centro a 0 en el radio, o sea una campana suavísima. Medido con
la masa quieta de la escena 10 y el orbe clavado en el medio, sin fuerza y sin luz para que lo
único que pudiera cambiar la imagen fuera el halo: **toda la masa queda un poco más gris y no se
ve ningún agujero**. El ojo necesita un borde para leer que falta algo.

Ahora el apagado es total hasta el 55 % del radio y cae a cero en el 45 % que queda: hay un núcleo
negro de verdad y un aro corto de transición. Con eso el mordisco en la nube se ve de una.

Vale anotar el camino, porque el primer diagnóstico fue equivocado: como la masa alrededor del
orbe se veía brillante, parecía que el halo no estaba llegando al shader. Los uniforms estaban
perfectos (`dark` 0.89, `radius` 32 celdas, `pos` (55, 21, 37)). Eran dos cosas a la vez: la luz
del orbe encendiendo por specular lo que el halo apagaba, y la caída del smoothstep demasiado
suave para leerse.

Y de paso, la 20 necesitaba subir el umbral de blanco del default (2 / 7) a **8 / 24**: con el de
fábrica cualquier partícula de esa nube lo supera, el cuadro entero queda blanco lavado, y el orbe
—que acelera lo que toca— blanqueaba justo lo que tiene que apagar. Con 8 la nube se mantiene roja
y el blanco vuelve a ser el pico, no el estado.

### El rayo ahora se nota

Tres cosas, y las tres hacían falta:

- **Las fuerzas casi se triplican**: impacto 60 → **160**, caída 25 → **70**, con los radios de
  2.6 → 3.6 y 1.6 → 2.2 m. El techo de los params sube a 400.
- **`rays.impactTime`** (param nuevo, antes era una constante de 0.3 s) pasa a **0.55 s**. Con 0.3
  la onda dura 18 frames, menos de lo que tarda el ojo en encontrar dónde pasó algo.
- **La fuerza cae al cuadrado** y no lineal, y el anillo arranca en el 25 % del radio en vez de en
  0. Con la caída lineal el empujón se reparte parejo en todo el medio segundo y lo que se ve es
  que la masa se corre despacio; con (1−u)² el 60 % del envión se entrega en el primer cuarto de
  la onda. Y con el radio arrancando en 0, el primer frame —que es cuando la fuerza vale más— no
  toca a nadie.

Pero lo que hace que SE VEA no es la fuerza sola: es que la fuerza alcance para que los palitos
pasen el umbral de blanco. Las escenas de rayos tienen `whiteSpeedMin` en 2.5, así que un golpe de
este tamaño no solo los mueve, los **enciende**. Comparado el mismo instante con los valores viejos
y los nuevos: con los viejos la masa se ve apenas revuelta y no se sabe dónde cayó; con los nuevos
la masa **se abre en dos** y hay un fogonazo blanco saliendo del piso.

### Verificado

Las 22 escenas a 60 fps, 1.0 a 3.3 ms. `smoke-settings`, `smoke-learn` y `smoke-persist` en verde.
Mirado con capturas: la 14 y la 15 a 6 / 14 / 25 s (el ojo de la rueda aguanta y el espejo cierra),
el rayo cuadro por cuadro contra los valores viejos, y el orbe en la 20 disparado a mano para
agarrar el agujero en su punto.

## Duodécima vuelta: la masa nace de a poco y el rojo titila (2026-09-05)

Manuel: *"cuando cargo la escena 10 las partículas tienen que ir apareciendo de a poco y con un
gradiente ir naciendo; ahora aparecen todas de una"*. Y en el medio: *"los cuadrados rojos que
atraen no tienen que moverse, sino que tiene que titilar su intensidad de rojo"*.

### Nacimiento progresivo (`particles.birthTime`)

La escena 10 es la primera vez en el show que aparecen los palitos, y aparecían de golpe: el
`resetInBox` de entrada las reubica a todas en el mismo frame y lo único que las fundía era la
opacidad global, que sube parejo. O sea que se veía la masa entera materializarse de una.

Ahora cada partícula recibe un **retardo propio según dónde cayó dentro de la caja**, y hasta que
le toca no existe. El mecanismo aprovecha lo que ya había:

- El retardo se guarda como **edad NEGATIVA**. No hizo falta un campo nuevo en el buffer: `age` ya
  estaba y no se usa para nada mientras la partícula no está viva.
- `alive` en 0 hace que `p2g1` y `p2g2` la salteen (ya era así), o sea que **tampoco pesa en el
  fluido**: la masa que ya nació se comporta como si fuera toda la que hay, y el volumen se va
  llenando de verdad en vez de aparecer comprimido.
- La cuenta regresiva avanza en `g2p`, que es el único kernel que corre una vez por partícula y
  por frame. Al llegar a 0 la partícula nace **con edad 0**, no con lo que le sobró del retardo,
  así entra desde el principio en el crecimiento de `particles.ageGrow` y se la ve aparecer en vez
  de llegar ya hecha. Mientras gesta no se mueve: queda congelada donde la dejó el reset.

Params: `particles.birthTime` (0 = como antes), `particles.birthAxis` (`y` por defecto — de abajo
hacia arriba, que es el que se lee mejor porque coincide con la gravedad que uno espera; también
`x`, `z` y `radial`) y `particles.birthSpread`, que desordena el frente. Con spread 0 el borde es
un plano perfecto que sube y se ve la línea; con 0.4 el frente queda deshilachado y parece que la
masa se condensa.

En la escena 10: **3 s**, eje `y`, spread 0.4. Es bastante más que la transición de 1.5 s de la
escena, así que el fundido de opacidad termina cuando la mitad de abajo ya está formada y la de
arriba todavía se arma; ese desfasaje es parte del efecto.

**La trampa de siempre, otra vez:** `birthTime` y `birthSpread` van en `transitions` con 0. `goto`
funde los params y dispara las acciones inmediatamente después, así que el `resetInBox` de entrada
corre en el primer frame del fundido — con el tween puesto, en ese frame el nacimiento todavía
valdría 0 (el valor de la escena anterior) y la masa aparecería entera de golpe, que es justo lo
que se estaba arreglando.

Los tres params van también al `BASE`: si `birthTime` quedara pegado, cualquier `resetInBox`
posterior (la 11, la 13, la barra espaciadora) haría desaparecer la masa y reaparecerla de a poco
sin que nadie lo pidiera.

### El bloque rojo titila en vez de temblar

En la vuelta anterior se había arreglado el temblor de posición para que se viera (iba por la
normal de la placa, que es casi toda profundidad). Manuel lo miró y pidió lo contrario: que el
bloque **no se mueva** y que lo que lata sea la intensidad del rojo.

`redBlock.flicker` (0..1) y `redBlock.flickerRate` (Hz). Tres senos de frecuencias no múltiplas
—como el temblor y como el pulso de la fuerza— para que no se escuche el ciclo; el tercero, mucho
más rápido, es el que le da el nervio eléctrico en vez de dejarlo en un latido de respiración. El
piso está en 0.12 y no en 0: un bloque que desaparece del todo se lee como un error de video, no
como un bloque que titila.

**Va en el COLOR, no en la opacidad.** Bajando el alfa el bloque se volvería translúcido y se
vería el piso a través, que es justo lo que la quinta vuelta arregló con el `renderOrder 1000` más
test de profundidad. Bajando el brillo el bloque sigue siendo opaco y lo que cambia es cuánto rojo
tira.

`redBlock.vibrate` pasa a **0 por defecto** (era 0.035) y las escenas 14 y 15 lo listan en 0. El
temblor de posición sigue existiendo y ahora funciona de verdad, pero hay que pedirlo.

Medido sobre cuatro frames seguidos de la 14: el borde del bloque se queda clavado en la misma
columna (981 de 2688) mientras el rojo de su interior va 68 → 59 → 91 → 99. No se mueve y late.

### Verificado

Las 22 escenas a 60 fps, 1.0 a 3.3 ms. `smoke-settings` y `smoke-persist` en verde. El nacimiento
mirado cuadro por cuadro entrando desde la 9 con la transición real: a 0.8 s hay un frente
deshilachado subiendo desde el piso de la caja y a 2 s la masa ya llena casi todo.

## Decimotercera vuelta: ids corridos, seis escenas libres y notas que no re-disparan (2026-09-05)

Manuel: *"recién me equivoqué, fijate que ya hice unos mapeos, pero quiero tener primero todas las
escenas de la 1 a la 20. Después voy a tener más escenas que sigan, así que sumalas también: sumá
unas 6 escenas más. [...] Además, los de escenas se tienen que comportar así: si llega una nota
para controlar la escena, hasta que no cambie de escena —o sea que llegue una nota que es de otra
escena— tiene que seguir en esa escena y no volver a triggerearla, porque quizás llegan varias
notas de la escena juntas, pero es por seguridad"*.

### Los ids pasan a ser el ORDEN DEL SHOW, no el número del storyboard

Hasta acá el id era el número de imagen del storyboard, y cuando se sacó la 16 (era la 18 sin
rayos) quedó un agujero: en el editor la lista aparecía salteada y mapear desde Ableton se volvía
un lío — que es exactamente donde Manuel se equivocó. Ahora van corridos del **1 al 28**.

| id nuevo | id viejo | storyboard |
|---|---|---|
| 1 a 15 | igual | igual |
| 16 | 17 | `17.png` |
| 17 | 18 | `18.png` |
| 18 | 19 | `19.png` |
| 19 | 20 | `20.png` |
| 20 | 21 | `21.png` |
| 21 | 22 | `22.png` |
| 22 | 23 | `23.png` |
| 23 a 28 | — | libres, sin storyboard |

De la 16 en adelante, **el número de imagen del storyboard es el id + 1**. Está anotado en la
cabecera de `scenes/index.js` y es lo único que se pierde con el cambio.

Se revisaron y corrigieron **21 comentarios** repartidos por todo `src/` que nombraban escenas por
número (`Rays.js` decía "escenas 17+", `Forces.js` hablaba de "la 21, 22 y 23", etc.). Y de paso
quedaron al día tres que ya estaban mintiendo desde la vuelta 10: `wrapMode` `'horizontal'` y
`'radial'`, y el paseo del torbellino, que decían pertenecer a la 14 y la 15 y hoy no los usa
ninguna escena.

### Seis escenas libres (23 a 28)

Existen, tienen nombre (`Libre 1` … `Libre 6`) y se pueden disparar por nota, pero **no listan
ningún param**. Eso no es un descuido: una escena que no lista nada cae entera en el `BASE`, o sea
"todo apagado", así que al dispararla la pantalla queda en negro de forma limpia y previsible —y,
sobre todo, apaga bien lo que venía de la escena anterior—. Un relleno copiado de otra escena
sería peor: se vería algo que nadie decidió. Cuando cada una tenga contenido se le agrega el
bloque `params` y listo, el mapeo ya está hecho.

### Una nota de la escena en curso ya no la re-dispara

El guard va en `SceneManager.goto` y no en el `Mapper`, a propósito: así vale para todo lo que
pueda pedir una escena (MIDI, OSC, la barra de escenas, el teclado) y no solo para las notas.

Y no es un no-op cosmético, es lo que evita un corte visible: `goto` vuelve a disparar las
`actions` de entrada, y varias reubican la masa entera (`particles.resetInBox` en la 10,
`fillColumn` en la 12). O sea que un doble disparo en Ableton —o una nota sostenida que se
retriggerea— borraba de golpe el estado del fluido en mitad de la escena.

Queda `goto(id, { force: true })` para pedir el re-disparo a mano desde la consola. Verificado con
capturas: cinco `scene.goto` seguidos de la escena en curso dejan la masa intacta girando, y el
mismo `goto` con `force` la hace nacer de nuevo desde el piso de la caja.

### mappings.default.json

Ahora arranca con **28 filas de escena en orden** (`sc01` … `sc28`), sin huecos, y después los 17
mapeos de acciones. Las `source` siguen vacías: las llena Manuel con «learn» desde el editor.

**Ojo:** los mapeos que ya estén guardados en el localStorage de una máquina NO se actualizan
solos —el default solo se lee la primera vez—. Para levantar la lista nueva hay que darle
«restaurar mapeos por defecto» en el editor, y eso borra lo aprendido hasta ahora.

### Verificado

Las 28 escenas a 60 fps, 0.8 a 6.7 ms (las seis libres cuestan lo que cuesta la pantalla en negro).
`smoke-settings` y `smoke-learn` en verde. Referencia MIDI/OSC regenerada: lista las 28.

## Decimocuarta vuelta: las notas de Ableton, ordenadas (2026-09-06)

Manuel: *"fijate con Ableton MCP, canal SCENES tenés clips que se llaman del 11 al 22. A esos
creales una nota para que triggereen la escena. Algunos creo que ya están hechos pero otros
quizás tienen nota repetida —o sea, hay varios clips 19 por ejemplo, pero deberían ser el mismo
siempre, misma nota—. Esa nota que tiran a ese canal y device es la que tenés que mapear para el
MIDI learn: configuralo vos directamente así no lo tengo que hacer yo una por una. Recordá que el
clip 1 de escena 1 tiene una nota que no es la más grave de todas: se saltea una, y de ahí
arrancan el resto"*.

### Lo que había

Pista **31** del set (`scene`), salida a **RTX3090 (Port 2), Ch. 10**, sin devices: solo manda
notas al visualizador. 33 clips con nombre, del "1" al "22" (sin "6" ni "16"). Leyendo los
pitches apareció el desorden que Manuel intuía:

| clip | pitch que tenía | debía ser |
|---|---|---|
| 1 a 5 | 1 a 5 | ✔ ya estaban bien |
| 7 (×4) | 6 | 7 |
| 8 | 7 | 8 |
| 9 (×3) | 8 | 9 |
| 10 | **8** (pisaba al 9) | 10 |
| 11 | 9 | 11 |
| 12 | 10 | 12 |
| 13 | **9** (pisaba al 11) | 13 |
| 14, 15 | 38, 39 | 14, 15 |
| 17, 18 | 40, 41 | 17, 18 |
| 19 (×4) | 42 | 19 |
| 20, 21 | 44, 45 | 20, 21 |
| 22 (×2) | 46 | 22 |

O sea: dos pares de escenas compartían nota (la 9 con la 10 y la 11 con la 13 — dispararan lo que
dispararan, una de las dos nunca iba a sonar), y a partir del clip 14 los pitches saltaban a otra
octava sin relación con el número de escena.

### La convención, escrita

**Escena N = nota N del canal 10.** La escena 1 es la nota 1 y no la 0: la más grave queda libre,
que es lo que Manuel pidió recordar. Del 1 al 28, corrida y sin huecos, igual que los ids.

Cada clip quedó con **cuatro notas cortas seguidas** de su altura al principio, repetidas por
seguridad para que el disparo no se pierda. Antes eran siete y llenaban el clip entero; con el
guard anti-retrigger de la vuelta anterior eso ya no hace falta, y cuatro es suficiente margen.

**Lo que NO se tocó:** siete de esos clips tenían además notas de **pitch 120** (36 o 63 por
clip), que no son de escena y van a otra cosa. Se usó `edit_notes` en vez de `add_notes_to_clip`
justamente para eso: se quitaron solo las notas del pitch viejo y se agregó la ráfaga nueva, así
que el 120 quedó intacto (verificado: el clip "21" pasó de 73 notas a 67 = 63 del 120 + 4 nuevas).

Tampoco se creó ningún clip: faltan el "6" y el "16", y Manuel dijo que esas escenas por ahora no
las usa.

### Los mapeos del visualizador

`public/mappings.default.json` ya trae las 28 filas de escena con su `source` puesta
(`{ kind: "note", channel: 10, note: N }`), o sea que no hay que hacer «learn» de a una.

Verificado en el navegador headless mandando las notas a mano por `vis.mapper.dispatch`: las
notas 1, 5, 7, 10, 14, 15, 17, 19, 22 y 28 caen cada una en su escena, y cuatro notas seguidas de
la escena en curso no la vuelven a disparar.

**Dos avisos que quedan del lado de Manuel:** el set de Ableton NO se guardó (los cambios están
aplicados en Live, pero hay que darle Ctrl+S), y el editor solo lee `mappings.default.json` la
primera vez — para levantar estos mapeos hay que darle «restaurar mapeos por defecto».

## Decimoquinta vuelta: el cuadro va anclado arriba a la izquierda (2026-09-06)

Manuel: *"hacé que la página de visuales se vea fullscreen pero arriba a la izquierda de la
ventana del browser, no en el centro"*.

Era una línea en `fitStage` (`render/Renderer.js`), en el modo `'native'` — el que usa el show.
Centraba el `#stage` a mano con `(innerWidth − w) / 2` / `(innerHeight − h) / 2`; ahora queda
siempre en `left: 0; top: 0`, igual que ya hacía el modo `'fit'` (el de desarrollo). Lo que no
entra en la ventana queda afuera por abajo y por la derecha, no repartido a los cuatro lados.

Verificado con una ventana de 3600 × 1800 (bien más grande que los 2688 × 1008 del cuadro): el
`#stage` da `left: 0, top: 0` en vez de centrado. `smoke-dpr.mjs` sigue en verde en las cuatro
escalas de Windows (100 / 130 / 150 / 200 %): el cuadro sigue saliendo 1:1 en pantalla, lo único
que cambió es dónde se ancla dentro de la ventana.

## Decimosexta vuelta: la 10 con el atractor, la 11 que brota, y el kick que tira rayos (2026-09-06)

### Primero: no se había roto nada

Manuel: *"algo rompiste porque ahora no se ve el contenido 3d de los palitos"*. El 3D estaba
intacto (28 escenas a 60 fps, capturas normales). Lo que pasaba es el anclaje de la vuelta
anterior: el cuadro quedó a 1:1 pegado arriba a la izquierda, y en una ventana más chica que
2688 × 1008 lo que se ve es la esquina superior izquierda —que en casi todas las escenas es
negra— con la masa fuera de cuadro. Antes, centrado, se veía el medio.

`fitStage` ahora **achica el cuadro para que entre completo** y nunca lo agranda más allá de 1:1.
La escala se calcula en píxeles FÍSICOS (`innerWidth · dpr`), que es lo que mantiene el uno a uno
con la escala de Windows en 130 %. Y lleva **un píxel de tolerancia**: sin él, una ventana que en
teoría mide 2688 físicos cae en 2687.7 por el redondeo del dpr y el cuadro se achicaba un píxel
— lo cazó `smoke-dpr.mjs`, que volvió a quedar en verde en las cuatro escalas.

Verificado: ventana de 1600 × 900 → el cuadro entra completo en (0, 0); ventana de 3600 × 1800 →
2688 × 1008 a 1:1, también en (0, 0).

### `particles.fraction`: la escena decide cuántos palitos usa

`particles.count` es estado vivo (lo fija el preset de calidad según la máquina) y por eso no se
puede listar en una escena. `particles.fraction` sí, y multiplica. Las que quedan afuera **no se
simulan ni se dibujan** (el kernel corta por `numParticles`), así que bajarla también baja el
costo. El count efectivo se redondea a múltiplo de 256, el tamaño del workgroup.

Y cuando la fracción **sube**, las que entran vienen de donde las dejó la escena anterior —
repartidas por todo el escenario— y aparecerían de golpe. Para eso está el kernel nuevo
**`spawnRange`**: reubica solo ese rango de índices en una esfera en el centro de la caja, con el
retardo de nacimiento proporcional al radio. El reparto usa la raíz cúbica del azar, que es lo que
lo deja parejo en volumen (sin ella se amontonan en el centro, porque una esfera tiene mucho más
volumen en la cáscara que en el núcleo).

### La 10: un décimo de los palitos, cortos, y un agujero negro que pasea

Manuel: *"escena 10, hacé que sean un 10 por ciento de palitos y que estén siendo atraídas en el
centro de la caja como con el atractor ese que hablamos. Además asegurate que ese atractor haga
que se conviertan en negro fullnegro los palitos que más se acercan, pero que varíe así no se
pegan todos. También en esta escena hacelos la mitad de largos"*.

- `particles.fraction` **0.1** y `particles.length` **0.5**. Es la primera vez que aparecen los
  palitos en el show y con los 131 072 completos la caja es una masa maciza donde no se distingue
  uno de otro; con 13 000 cortos se ven sueltos y se les lee el grano.
- **`orb.darkenJitter`** (param nuevo): cuánto varía el radio de apagado DE UNA PARTÍCULA A OTRA.
  En 0.85 para esta escena. Sin él, todos los palitos a la misma distancia se apagan en el mismo
  frame y el agujero queda con el borde de una pelota de billar; con él se disuelve palito por
  palito, que es lo que pidió Manuel con *"que varíe así no se pegan todos"*.

**Lo que costó, y vale anotarlo porque es geométrico y va a volver a pasar:** con el orbe clavado
en el centro y la masa juntada en una bola, **el agujero queda dentro del volumen y la cara de
adelante lo tapa**. Se probaron ocho combinaciones de fuerza y radio y en todas la masa se veía
gris pareja, nunca con un negro que se leyera. Los uniformes estaban perfectos (`dark` 0.68,
radio y posición correctos): el problema no era el efecto, era que estaba oculto.

Dos cosas lo resolvieron:
1. **Densidad 0.25** (mínimo del param bajado de 0.4 a 0.15) para que la masa LLENE la caja en vez
   de juntarse en una pelota que ocupa media caja.
2. **El orbe PASEA** despacio (un ciclo cada ~16 s, amplitud chica para no salirse de la caja).
   Así el agujero cruza la masa y llega al frente, y ahí sí se ve que los palitos se apagan al
   acercarse.

Y para que el orbe esté encendido de punta a punta sin parpadear: `attack` en **0** (cada disparo
pone la envolvente en 1 de una; con ataque, el redisparo la llevaría a 0 primero y se vería el
bache), `decay` al máximo y el automático a 0.5 Hz, que la resetea antes de que caiga del 0.92.

### La 11: los nuevos brotan del centro y los blancos se tiñen

Manuel: *"cuando paso a la 11 tienen que ir naciendo desde el centro los palitos nuevos rojos, y
los blancos convertirse a rojos"*. La fracción vuelve a 1, así que los otros nueve décimos son
palitos nuevos y `spawnRange` los hace brotar de una esfera de 0.5 m en el centro de la caja.

Y el color **NO corta** acá — única escena del show donde eso es a propósito. Con el corte de
0.15 s de `COLOR_RAPIDO` el cambio pasa antes de que el ojo lo registre; con 1.2 s se ve la masa
teñirse mientras la nueva brota.

### La 12: entra en fade y sube más suave

`particles.flowY` **0.35 → 0.18** (tercera bajada; la velocidad de régimen queda en una séptima
parte de la del arranque) y el color y la opacidad entran en **3.5 s** en vez del corte. Como la
11 es roja, el rojo→azul pasa por violeta: en 0.15 s ni se ve, en 3.5 s es justamente lo que se
quiere ver.

### El bloque rojo llega al rojo pleno

Manuel: *"no sé si vibran muy rápido, pero no parecen verse con el brillo máximo de rojo"*. Tenía
razón y el error era de forma de onda: la versión anterior promediaba tres senos y modulaba con
eso, así que matemáticamente llegaba a 1 pero solo cuando los tres coincidían en el pico — o sea
casi nunca. El bloque vivía a media luz.

Ahora son **bajones**: la onda se rectifica (`max(0, …)`, así la mitad del ciclo vale exactamente
0 y el gain queda clavado en 1) y se eleva al cuadrado para que los bajones sean cortos y secos.
Medido sobre 180 frames: **102 en rojo pleno** (gain 1), mínimo 0.43. Rojo pleno que parpadea, no
rojo lavado que respira.

### El kick dispara los rayos, en todas las escenas

El *"deep dark kick"* es el pad **nota 0** del Drum Rack `amen_tearsofthekiller1` (pista 10,
`DRUM`). Esa pista sale a audio, pero su MIDI se rutea a la pista **34** (`DRUM`, sin clips), que
es la que manda para afuera por **RTX3090 (Port 2), Ch. 1**. O sea: **nota 0, canal 1**.

Y ahí cierra un detalle de la vuelta anterior: las escenas arrancan en la nota 1 porque **la 0 ya
estaba ocupada por el kick**. Por eso Manuel había avisado que la escena 1 "no es la más grave, se
saltea una".

`ej07` (`ray.spawn`, arg `random`) queda mapeado a esa nota y **sin filtro de escenas**. Y para que
funcione de verdad, `rays.enabled`, `rays.opacity` y `debris.opacity` pasan al `BASE` en
true/1: `Rays.spawn` se corta solo si `rays.enabled` está en false, así que el valor de REPOSO
tenía que cambiar. No molesta donde no corresponde — `Rays` multiplica su opacidad por
`layer3d.opacity`, así que en las escenas 2D el rayo no se dibuja aunque la nota llegue.

Verificado mandando la nota a mano en nueve escenas (1, 5, 10, 12, 14, 17, 19, 22 y 25): en todas
aparece un rayo nuevo. Y la nota 14 del canal 10 sigue cambiando de escena: canal 1 y canal 10 no
se pisan.

### Verificado

Las 28 escenas a 60 fps, 0.9 a 2.4 ms. `smoke-settings`, `smoke-persist` y `smoke-dpr` en verde.
Referencia MIDI/OSC regenerada (301 filas).

## Decimoséptima vuelta: la 20 nueva y el kick que cambia el color (2026-09-06)

Manuel: *"modificá que haya una ESCENA EXTRA 20 antes de la que ahora es 20; esa tiene que ser la
escena que tiene el atractor de los palitos cuando están sueltos. Antes están sueltos pero sin ese
atractor. [...] Tenés que arreglar en la web, en el mapeo pero también en el Ableton corregir los
clips midis"*. Y después: *"en la que ahora va a ser nota 23 / escena 23, la que ahora es 22 'a
punto de explotar', los palitos tienen que switchear entre azul y rojo con el golpe del kick que
triggerea los rays; esa misma nota tiene que ir switcheando eso"*.

### La nube suelta se parte en dos escenas

La 19 tenía el orbe adentro, o sea que la masa se soltaba y aparecía el atractor en el mismo
momento: dos ideas gastadas juntas. Ahora son dos escenas y comparten el helper `nubeSuelta(conOrbe)`:

- **19 — Partículas libres**: la masa recién salida de la caja, organizada solo por el campo.
- **20 — Partículas libres + atractor**: la misma nube más el orbe, y nada más. El corte entre las
  dos es exactamente la aparición de algo que se lleva a los palitos.

Todo lo que venía después se corrió un lugar: Torbellino 20 → **21**, Torbellino en la caja 21 →
**22**, A punto de explotar 22 → **23**, y las seis libres 23-28 → **24-29**. **El show pasa a 29
escenas.**

La equivalencia con el storyboard queda cortada en la 20: de la 1 a la 15 coinciden, de la 16 a la
19 es id + 1, y de la 20 en adelante ya no hay correspondencia porque la 20 es una escena que el
storyboard no tiene.

### Los clips de Ableton, corridos

Manuel había dejado un clip llamado **"20 extra"** en el slot 28 del canal `scene` (una copia del
"19", con la nota 19). La corrección, en un solo `batch_commands` para que sea **una sola acción de
deshacer** en Live:

| slot | era | pasó a ser |
|---|---|---|
| 28 | "20 extra", nota 19 | **"20", nota 20** |
| 29 | "20", nota 20 | **"21", nota 21** |
| 30 | "21", nota 21 | **"22", nota 22** |
| 31 y 32 | "22", nota 22 | **"23", nota 23** |

Otra vez con `edit_notes` y no `add_notes_to_clip`: cinco de esos clips llevan además notas de
pitch 120 que no son de escena, y quitando solo las del pitch viejo quedaron intactas (verificado:
el "20" nuevo tiene 40 notas = 36 del 120 + 4 nuevas). Los colores ya eran todos `color_index 7`,
así que solo hubo que confirmarlo en el clip nuevo.

Verificado mandando las notas 18 a 24 y la 29 por `vis.mapper.dispatch`: cada una cae en su
escena, con el nombre correcto.

### El kick también cambia el color en la 23

`particles.altColor` (param nuevo) es el color que espera su turno, y la acción
**`particles.colorFlip`** intercambia los dos. Se hace intercambiando y no guardando un original
aparte porque así la alternancia **no tiene estado propio**: los dos params SON el estado, y un
cambio de escena los reescribe a los dos y deja todo en su lugar (verificado: al volver a la 23 el
base arranca en rojo aunque se haya salido en azul).

El corte es inmediato a propósito: esto cuelga de un golpe de batería, y un fundido llega tarde y
se lee como una mancha en vez de un switch.

El mapeo aprovecha que el Mapper hace **fan-out** —varias filas para la misma fuente—: la nota 0
del canal 1 dispara `ray.spawn` en todas las escenas (`ej07`) y además `particles.colorFlip`
**solo en la 23** (`ej18`, con el filtro `scenes`). Medido: cinco golpes seguidos dan
rojo → azul → rojo → azul → rojo, cada uno con su rayo, y el mismo golpe en la 19 no toca el color.

### Verificado

Las 29 escenas a 60 fps, 0.9 a 2.4 ms. `smoke-settings`, `smoke-learn`, `smoke-persist` y
`smoke-dpr` en verde. Mapeos regenerados (29 filas de escena + 18 de acciones) y referencia
MIDI/OSC al día. Capturas de la 19 (nube roja entera, sin agujeros) contra la 20 (el mordisco negro
del atractor) para confirmar que la diferencia entre las dos se lee.

## Decimoctava vuelta: la caja de la 10 crece desde la base (2026-09-06)

Manuel: *"cuando cargo la escena 10 hacé que el bound, o sea la caja, vaya apareciendo como
creciendo desde la base hacia arriba, y que actúe como oclusión: afuera de ella no se ven los
palitos, hasta que termina de crecer y ahí se ve normal, como funciona ahora. Pero solo cuando
cargo esa escena tiene que hacer ese juego"*.

Ya existía `particles.birthTime` para que la MASA naciera de abajo hacia arriba, pero la CAJA
(`BoxWire`) se dibujaba entera de una, sin relación con eso. Lo nuevo es que la caja también
crece, y mientras crece corta todo lo que hay por encima de su borde actual — masa y aristas por
igual.

### Cómo quedó

- Param nuevo `box.growDuration` (default 0 = apagado) y acción `box.grow`, calcados del mismo
  patrón que ya usa `Floor` para el piso que se extiende (`floor.reveal` / `floor.revealDist`,
  "sin fade: pixel puro"). Con el default en 0, **ninguna escena que no lo pida cambia**: el corte
  nunca se activa y el resto del show queda byte a byte igual.
- `BoxWire` escucha `box.grow`, arranca un contador PROPIO (no un param — así no hay riesgo de que
  quede "pegado" filtrando a la escena siguiente, la misma fuga que documenta `redBlock`) y cada
  frame calcula la altura Y hasta donde ya creció. Esa altura se publica en `ctx.boxGrowTopY`, el
  mismo mecanismo que ya usa `Orb` para pasarle su estado a `StickRenderer` (los elementos de
  `Layer3D` corren antes que los palitos, así que llega a tiempo en el mismo frame).
- El corte es un `positionWorld.y <= techo` (aristas) o `particle.position.y <= techo` (palitos,
  convertido a unidades de grilla igual que la posición del orbe), con umbral DURO — nada de
  degradado, mismo criterio que ya está probado en el piso.
- Cuando no hay crecimiento en curso el techo vale `1e4` (muy por encima de cualquier coordenada
  real del escenario), así el corte es matemáticamente un no-op sin necesitar una rama aparte en
  el shader.
- Escena 10: `box.growDuration: 3.0` (los mismos 3 s que `birthTime`, para que la caja termine de
  abrirse justo cuando la masa termina de formarse) con transición 0 —igual trampa que
  `birthTime`/`fraction`: la acción `box.grow` corre en el primer frame del fundido, así que el
  param tiene que valer 3.0 ya en ese frame— y `box.grow` sumado a las acciones de entrada.

### Verificado con capturas

Secuencia en la 10 (t≈0.15/0.75/1.5/2.5/3.5/5 s tras entrar): al principio solo se ve el piso de
la caja con un puñado de palitos pegados a la base; a los 0.75 s las aristas verticales ya
crecieron un tramo y la masa visible corta EXACTO a esa misma altura (se ve el borde plano); a los
1.5 s el corte está a media caja; a los 3.5 s la caja ya está completa (las ocho aristas y el techo
dibujados) y la masa la llena entera, sin rastro del corte — igual que se veía antes de este
cambio.

`walk-scenes.mjs` sobre las 29 escenas: 60 fps (58-59 en un par, dentro de lo normal), 0.8 a 2.5 ms,
sin errores de consola nuevos. Referencia MIDI/OSC regenerada.

## Corrección de piso, rayos y rendimiento (2026-09-06)

- Escena 7: reinicio inmediato y despliegue de 9 s compensado por perspectiva. Params.tween acepta una función de easing para ese caso.
- Rayos: trazo blanco de 0.01 m; sin halos ni las seis luces puntuales que cambiaban los shaders en cada golpe. Impactos y fuerzas conservados.
- Escena 21: modificador directo de velocidad después de reconstruir la grilla, respuesta inmediata y mayor alcance. Se desactiva al salir.
- AO/bloom apagados ahora omiten trabajo; GTAO a media resolución; preparación de pases al inicio. FPS usa tiempo real.
- Medición final de 100 s: ~60 FPS, peor intervalo 19.4 ms, sin intervalos >20 ms. Una pasada intermedia tuvo un intervalo aislado de 26.4 ms; no garantiza cero pausas con carga externa arbitraria. Detalles y evidencia en RENDIMIENTO.md.


## Decimonovena vuelta: Fluids con audio propio, sin rayado y con la 26 en vivo (2026-09-06)

Pedido de Manuel, textual: *"escena de fluids 25 y 25 estan mas oscuras tambien tiene banding la
visual arregla todo eso. ademas hace qel auio se reproduzca del a pagina porq del ableton se
desincroniza. ademas al final q terina la secucnai como q se frena el fluid deja de andar. tien q
seguir corriendo y en la 26 tiene qh aber un fluid q lo voy a controlar con midi"*.

### El rayado era falta de supersampling

Comparado contra la página original de Fluids con el MISMO documento (`fluids.show.json`, hash
idéntico en los dos proyectos), una fila de píxeles del gradiente daba:

```
integración a 1×  221 220 218 220 222 224 223 220 220 221 224 224 223 222 ...
original          84  84  84  84  83  83  83  83  83  83  83  82  82  82  ...
```

El original es monótono; el nuestro tenía ruido de ±3 niveles con estructura, que ampliado se ve
como un **damero de ~2 px más rayos radiales saliendo de cada luz**. En un monitor pasa; en 8 m de
LED es un rayado sucio.

La causa: la página original renderiza a **DPR 2** (buffer 5376×2016 bajado a 2688×1008 — su
`SUPERSAMPLE_LADDER` arranca en 2) y la integración pasaba `dpr = 1`. Probado a 1, 1.5 y 2 con el
timeline congelado en el mismo instante: a 1.5 el ruido sigue, **a 2 la fila vuelve a ser
monótona** y los rayos radiales desaparecen. `FluidRuntime` ahora arranca en 2 y hay
`fluids.supersample` para bajarlo si alguna vez hace falta.

**Salió gratis**: 1.5 ms de render medianos en los tres casos. El costo lo manda el campo de
radiancia, que es de resolución fija (1024²), no el tamaño del canvas.

### Lo de "más oscuras" no era pérdida de brillo

Medido contra el original en los mismos tiempos, el brillo medio era equivalente: 21,4 contra 21,9
a los 6 s, 19,7 contra 21,7 a los 13 s. Lo que apagaba la imagen era el tramado, no una ganancia
perdida. **La comparación cuadro a cuadro no sirve más allá de eso**: el fluido es caótico y a los
40 s las dos corridas ya divergen (a los 123 s el original tiene la masa roja como occluder oscuro
y la nuestra la tiene emitiendo).

Aun así Manuel la ve apagada en la pared, así que se agregó `fluids.gain`, que multiplica la
energía que entra al transporte y la exposición con la que se muestra —las dos juntas, que es
subir la potencia de las lámparas; tocar sólo el brillo del grade lavaría los negros, que es lo que
sostiene esta imagen—. Arranca en **1,25**: medido a mitad de secuencia lleva el brillo medio de
38 a 58 y la mitad iluminada del cuadro de 37 % a 62 %, sin mover los picos (p99 244→242). En 1
queda el show exactamente como está escrito en el documento.

### El audio pasó a la página

Con el track por Ableton, la imagen y la música son dos relojes distintos y en 2:32 se separan.
Ahora la salida reproduce `fluids.wav` y el tiempo de la secuencia sale de
`AudioContext.currentTime`: cada frame vuelve a anclar el reloj local al del track, así que un
frame perdido **saltea** el show en vez de correrlo. Es el `AudioTransport` de la página original,
portado a `src/radiance/AudioTransport.js`.

- `fluids.audioMode` pasó de tener un solo valor `external` a `web` (por defecto) / `external`.
  `external` recupera el comportamiento anterior para ensayar con Ableton, y cambiar de modo no
  corta la secuencia en curso.
- `fluids.volume` gobierna el nivel. Master y blackout siguen siendo sólo imagen.
- Chrome no deja sonar nada sin un gesto: el primer clic o tecla en la salida habilita el audio y
  hasta entonces el panel lo avisa.
- **Trampa nueva, y costó una corrida:** armar el audio dentro de `prepare()` dejó la salida sin
  arrancar. Con `--enable-features=Vulkan` en headless, crear el `AudioContext` y decodificar dos
  minutos y medio de WAV no volvía nunca: `walk-scenes` se quedó 78 s sin ver `window.vis`. Ahora
  el armado va **en segundo plano** y, si el cue 25 llega antes de que el WAV esté listo, la imagen
  arranca con el reloj de pared y el track entra solo en la posición en la que va la secuencia.
  El arranque volvió a 3,1 s. Hay un test que lo fija.
- La onda del editor sale del mismo buffer que se reproduce; sólo se decodifica aparte en un
  `OfflineAudioContext` cuando el modo es `external`. Antes se decodificaba dos veces.

### El final ya no congela

`RadianceController.frame` calculaba `frozen` cuando el timeline llegaba al final y `FluidRuntime`
cortaba el frame entero: ni renderizaba ni pisaba el solver. Ahora `frozen` es siempre `false`: el
reloj de la secuencia se detiene en la duración del documento, pero la física sigue corriendo con
el último estado de las curvas. Comprobado: tras el final, `renderedFrames` y `solverFrame` siguen
subiendo mientras `session.time` queda clavado en 152,694.

También quedó fijado que el track puede terminar unos milisegundos antes que el documento (152,691
contra 152,694): cuando el WAV se acaba, el reloj se cierra en la duración escrita.

### La 26 es el motor libre

Ya existía `enterLive` y los diez `fluids.live.*`, sin escena asignada. Ahora la nota 26 del canal
10 entra ahí. Los params pasaron de `sceneReset: false` a **estado de escena**: punto de partida en
`scenes/index.js`, reposo en `scenes/base.js`, así los CC que Manuel mueva en vivo no quedan
pegados al volver a entrar.

**Lo que costó encontrar: en el motor libre la luz se reparte entre TODAS las partículas y además
sube con la velocidad.** El director publica `allEmitters: 1` y el live lo hereda por
`...this.lastRender`. Consecuencias:

- Una masa grande y quieta se lee como una mancha azul apagada, por más que se suba `light`.
  Probado: de `light` 1.8 a 3 el brillo medio no se movió (1,58 → 1,60).
- Lo que se ve es **población chica y en movimiento**: con emisión 0,3 y 10.000 partículas el
  cuadro queda casi negro; con emisión 0,018 y ~1.000 partículas quedan gotas luminosas que caen,
  tiran halo y sombra, y a los 20 s se siguen leyendo igual (brillo medio 15,9 a los 6 s).
- Por eso `fluids.live.emission` va de **0 a 0,25** y no de 0 a 1: con el rango viejo, un CC de 128
  pasos dejaba cuatro escalones útiles.

Probado y descartado en el camino:

- **Forzar `allEmitters: 1` explícito con `velocityEmissionFloor` alto**: reparte 4 unidades de
  energía entre todas las partículas con ganancia 0,22, contra 18 de los emisores puntuales. Peor.
- **Poner `allEmitters: 0`**: pantalla negra. No es lo mismo que omitir la clave, porque omitirla
  deja pasar el `1` del director. Ocho juegos de valores se midieron con esto puesto sin querer y
  hubo que repetirlos.
- **`velocityEmissionSensitivity: 6`**: no movió nada.
- **Gravedad 0 con la masa en el centro**: bola azul oscura; las dos luces clave quedan adentro de
  la masa y se tapan solas.
- **Gravedad negativa**: la masa se pega al techo con las dos luces adentro. Se ven dos puntitos.

### Verificación

- 224 tests de código: 203 del paquete Radiance, 16 de sesión (7 nuevos, todos de audio y reloj),
  4 del preview y 1 de mapeos. TypeScript y build del paquete Radiance aprobados.
- `check-radiance.mjs`: 7 comprobaciones, incluidas las dos nuevas (el final que sigue corriendo y
  la 26 que emite y responde). 481 frames a 60 FPS, peor intervalo 17,2 ms, ninguno >20 ms **con el
  supersampling 2× puesto**.
- `walk-scenes.mjs`: las 29 escenas a 60 fps, 0,6 a 1,6 ms, sin errores de consola nuevos.
- `smoke-settings` y `smoke-persist` aprobados. Referencia MIDI/OSC regenerada.

### Bugs preexistentes que aparecieron y no son de esta vuelta

- `check-radiance.mjs` esperaba `rays.width = 0.014`. El valor vigente es **0,042** desde la vuelta
  de rayos con luz (`docs/VALIDACION-RAYOS.md`); esa comprobación había quedado en el número viejo.
  Actualizada.
- `smoke-learn.mjs` reprueba «acción + nota → modo trigger». La prueba busca el primer mapeo de
  `particles.kick` y encuentra el `drum-vortex-kick-21` que agregó esa misma vuelta, no el que
  acaba de aprender. **Sin tocar**: es de ese trabajo.
- `walk-scenes.mjs` esperaba 8 s fijos al arrancar. Se cambió por esperar a que `vis` exista, que
  es lo que hace que la herramienta no dependa de cuánto tarde la máquina.

## Vigésima vuelta: la 26 es el final de la 25, reactivo a JEJE FLUID (2026-09-07)

Pedido de Manuel, textual: *"EL ESCENA 26 TIENE Q SER EL FINAL DE LA ESCENA 25, NO UNA ESCENA NUEVA.
CORREGI ESO. PORQ VA A PARITR DE LA ESCENA 25 SOLO Q AHORA VA A REACCIONAR A MIDIS DE MI ABLETON
LIVE. [...] QUIERO TENER ALGO COMO BIEN MATEMATICO ONDA SINCRONICO GEOMETRICO QUE ALTERE LOS
FLUIDOS PERO COMBINADO CON LOS FLUIDOS. MUSCHA DINAMICA RITMICA [...] PRIMERO Q MEEPICE MAS
FLUIDO PERO AL FINAL COMO Q HAYA PONELE CUADRADOS Y COSAS CON O SIN EMISSIVE Q NO SOLO GENERAN
SOMBRAS E ILUMINACION SINO Q INTERACTUAN CON EL FLUIDO Y A SU VEZ EL FLUIDO TMB TIENE Q CAMBIAR
[...] TMB ANTES Q NADA CORREGI Q TODA LA ILUMINACION QUEDO MAS BAJO EN LO DE LOS LFUIDOS Q EN EL
ORGIINAL Q YO TENIA [...] ONDA RYOJI IKEDA EL SHOW"*. El plan está en `PARTE 1/PLAN-ESCENA-26.md`.

### Antes que nada: la luz. Tres mediciones, dos equivocadas

1. La medición de la vuelta anterior comparaba cuadros a los 40 s o más: el fluido es caótico y
   las dos corridas ya habían divergido. No decía nada. Se pasó a los primeros 8 s.
2. Ahí la página original **sí** se veía más clara (brillo medio 18-21 constante contra 21-24 con
   caídas a 2,6 y 0,2). El original crea el solver con 20 000 partículas (`[6666, 6666, 6666, 2]`)
   y la integración con cero: parecía la causa. Se implementó esa población en la 25 y **la
   integración quedó más oscura**: las 6 666 blancas tapaban la línea emisora en vez de sumarle.
   Revertido. `SHOW_INITIAL_POPULATION` quedó sólo para entrar en 26 sin venir de la 25.
3. Lo que pasa de verdad: la página original tiene un bug de arranque. `useShowDoc()` empieza con
   el documento **vacío**, adopta el real de forma asíncrona, y el director sólo recibe el
   documento nuevo cuando hay una edición. Una carga fresca del original corre el documento vacío:
   sin curvas de emisión ni exposición, sin `reset-fluid`, con las 20 000 partículas blancas
   alumbrando todo el tiempo. **Eso es lo que Manuel recuerda como "el original más brillante".**
   Forzando el documento real en la página original (import por CDP), original e integración dan
   lo mismo: 21,4 contra 21,9 a los 6 s.

Conclusión: la integración es fiel. La oscuridad de la 25 es la que el documento escribe (cierre con
lámpara sobre el material 0 y viscosidad 1). La palanca sin tocar el documento sigue siendo
`fluids.gain` (1,25). Si Manuel quiere el look del original vacío —todo blanco, sin dramaturgia—,
es otro show, no un bug.

### La 26 como continuación: el modo `sequel`

La 26 anterior (motor libre con gotas azules) era una escena nueva. Ahora `FluidRuntime` tiene un
cuarto modo, `sequel`: al llegar la nota 26 no se resetea nada. El director sigue con un **clon
mutable** del documento (`sequelDoc`), el reloj sigue desde donde quedó la 25 (`sequelTime`; la
nota puede llegar antes del final y el timeline se detiene ahí), y:

- las **notas inyectan eventos** del show con `t = ahora` e id único (`flash`+`burst` el kick,
  `strobe-lines` el contratiempo, `shadow-bar`, `fracture`, `blackout`, `set-lamp` al entrar);
- los **faders escriben keys `hold`** en las curvas del clon, en el instante actual, borrando las
  keys futuras: desde ahí la curva vale lo que dice el CC. El documento guardado no se toca;
- las **losetas** van encima de `out.geometry` (dibujo y luz) y de `out.interactions` (fuerza);
- la sesión (transporte y WAV) queda pausada: en la 26 la música es la de Ableton.

Los faders son `fluids.seq.gravity/cohesion/viscosity/light/exposure/bodies` (curvas del
documento), `grid`, `mono`, `tileLife`; las acciones `pulse/strobe/tile/tileBig/sweep/crack/dark/
freeze/clear/reset`. Todo `sceneReset: false`: al entrar se cargan con lo que las curvas valen en
ese instante, así que no son preset de nadie. `fluids.live.*` volvió a ser capacidad sin escena y
salió del `BASE`.

### La propuesta Ikeda, como quedó después de mirar

Grilla de celdas cuadradas de 1 m (8 × 3, 336 px), con subdivisiones ×2 y ×4. Losetas colocadas
por la secuencia de van der Corput (cubre pareja, sin agrupar, determinista), alternando **blanca**
(lámpara: emite, expulsa el fluido con `repel`, proyecta sombras duras de la masa) y **negra**
(agujero: absorbe, tapa con máscara, congela lo que tiene dentro con `lock`; al morir, `unlock`).
Serie de strobes 1·2·4·8·12. Monocromo en 3 s. Todo cae en la grilla y en el pulso.

Lo que dijeron las capturas (tres ensayos con el patrón de JEJE FLUID simulado a 140 BPM dentro
de la página, y una tanda alrededor de un kick):

- **Ensayo 1, negro entre golpes.** El final de la 25 deja la lámpara sobre el material 0 (unas
  burbujas), viscosidad 1 y `bodies` 0. A los 12 s el cuadro era negro salvo la loseta. Arreglo:
  al entrar, `set-lamp` a los dos materiales con más partículas (histograma de `materialIds`) y
  `bodies` 0,15 escrito de una, para que la masa heredada sea un cuerpo gris con borde punteado.
- **La lámpara a 1,25 inundaba medio cuadro** de gris plano. A 0,9 el cuadrado sigue blanco y la
  masa hace sombra dura detrás. Con varias, la emisión se divide por √cantidad, y encima va una
  máscara blanca (`top: true`, dibujo puro) para que el cuadrado no se vea gris cuando alumbra poco.
- **La loseta negra no existía**: negro sobre negro. Marco blanco de 4 px de máscara.
- **El congelado era un toggle** y el botón que lo dispara llega una vez por vuelta de 29 negras:
  el fluido quedaba quieto 12 s de cada 25 (ensayo 1, `frozen: true` a los 12 y a los 20 s). Pasó
  a **stutter**: foto fija durante `tileLife` negras y suelta sola.
- **Vida fija de 2 negras con el 808 cada 2 negras = una sola loseta viva, siempre.** Nunca se
  acumulaban. Ahora la vida es `tileLife` (4) × (1 + n/24): la loseta 24 vive el doble, la 48 el
  triple. Ensayo 3: 2 losetas a los 5 s, 5 a los 30, 8 al minuto, 10 con la grilla ya en ×2 a los
  95 s. "Primero fluido, al final cuadrados" sin CC.
- **La viscosidad del documento es la buena para el ritmo.** Medido (desplazamiento medio de las
  partículas en 350 ms): con viscosidad 1, 6,8 px sin golpe y 22,9 con kick; con 0,5, 16,6 y 14,5.
  O sea: quieta, la masa salta con cada golpe y se enciende al moverse (la emisión va con la
  velocidad y el freno del cierre la apaga en medio segundo); suelta, fluye sola y el kick no se
  lee. El primer kick sobre la masa compacta del cierre midió 246 px: la abre en un **anillo
  encendido**, que es la entrada de la 26. Los faders bajan la viscosidad si Manuel quiere agua.

### Ableton

Leído con el MCP: escena 37 de Session "JEJE FLUID", 140 BPM. DRUM sale por el canal 1 (kick n0
cada negra, contratiempo n2, 808 n4 cada 2), PERC por el canal 2 (n38, n39, n49, n47, n45, n40 en
sus posiciones del loop de 29 negras); SINUS/PAD/raro/amb 1 no salen por MIDI. Se agregó el clip
"26" en el track "scene" (pista 31), slot 37: medio compás con cuatro notas de pitch 26. Disparar
la escena de Session entra en la 26. Los mapeos (`mappings.default.json` v13) son sólo para la 26,
así el kick sigue tirando rayos en la 16-23.

### Verificación

- TypeScript del paquete Radiance; 16 tests de sesión.
- `check-radiance.mjs`: 8 comprobaciones con la de la 26 nueva (hereda partículas ±200, sesión
  pausada, faders en los valores del documento, `sequelTime` sigue, 2 losetas con dos 808, evento
  con el kick, stutter que se suelta solo, el fader no toca el documento guardado, el solver avanza,
  vuelta a la 1). 481 frames a 60 FPS, en desarrollo y sobre el build de producción.
- Ensayos y medición de dinámica, arriba. Capturas conservadas en `radiance-check/seq/ensayo3/` y
  `radiance-check/seq/kick/`.
- `walk-scenes`: 29 escenas a 60 fps, 0,5-1,9 ms. Referencia MIDI/OSC regenerada. Build aprobado.
- `tools/tmp-seq.mjs`, `tmp-dyn.mjs` y las herramientas de la medición de luz se borraron.

### Trampas nuevas

- **Los faders llegan al runtime en el frame siguiente**: `RadianceController.frame()` los junta
  y los pasa con el frame. Una acción disparada en el mismo tick que un `params.set` ve el valor
  viejo (la prueba del stutter fijaba `tileLife` 1 y disparaba junto: duró 4 negras).
- **`lock` es un círculo**, no un cuadrado: la loseta negra congela el círculo inscripto y la
  máscara tapa el resto. No hizo falta compensar esquinas.
- **El primer kick de la 26 abre la masa del cierre.** Es lo buscado, pero si alguna vez la 26
  tiene que entrar quieta, el pulso no puede ir al kick en los primeros compases.

### Corrección del mismo día: las losetas son obstáculos: el fluido choca y rebota

Manuel, textual: *"esta bien pero falta q esos cuadrados que creas interacuten con las particulas
osea q estas choquen ahi y reboten"*. Tenía razón: la blanca repelía con un radio y la negra
congelaba lo de adentro; ninguna era un cuerpo contra el que chocar.

- **El WASM ya tenía un colisionador rectangular** (`_pvfs_collide_particles_rect`) que el worker
  nunca cableó: sólo usaba el círculo (`collide`, con el que rebota la línea del show y la cuña de
  las fracturas). Sus cuatro números son **dos esquinas** (x0, y0, x1, y1): se probaron las tres
  lecturas posibles sobre un cuadrado de 1 m con ~3 000 partículas adentro y sólo ésa lo vacía
  (0 adentro a los 120 ms); centro+medios lados y centro+lados no mueven nada. Modo nuevo
  `collide-rect` en `kot-fluid.worker.js`, con `hw`/`hh` en fracción del alto que el runtime pasa a
  px. El cliente tiraba interacciones a partir de 32 por frame (tope pensado para punteros): con
  48 losetas más los 13 círculos de la línea las viejas dejaban de chocar sin aviso. Tope en 128.
- **Un obstáculo que aparece entero sobre la masa es una bomba.** El solver proyecta afuera en un
  subpaso todo lo que encuentra adentro: sobre la masa compacta del cierre (3 500 adentro) la
  pantalla entera se llenó de partículas voladas a los 120 ms y a los 2 s la masa estaba pegada a
  las paredes del dominio. El obstáculo **crece en 0,4 s** (`TILE_GROW`); el cuadrado se dibuja de
  golpe igual. En la condición real de la 26 (después de los primeros kicks, masa repartida) el
  cuadrado más denso tenía 1 090 adentro: 109 a los 120 ms, 0 a los 2,5 s, nada al borde.
- **Cicatrices.** El obstáculo aprieta las partículas contra su borde en una línea de un punto de
  grosor y, con la viscosidad del cierre, al morir la loseta la línea se queda recta donde estuvo
  el borde (diez a los 60 s, vistas ampliando la captura: cadenas de puntos con su sombra). Un
  `repel` de 6 frames desde el centro de la loseta al morir las desarma. Ya no hay `lock`/`unlock`
  de losetas; el congelado global del stutter sigue igual.
- **La masa se iba a las paredes.** Con el kick siempre hacia afuera, las partículas pegadas al
  borde del dominio iban 14 → 167 → 320 a los 8 / 30 / 60 s. Ahora **cada cuarto kick contrae**
  (`attractor` modo atraer, radio 0,9, fuerza 2, 0,3 s): 27 → 67 → 240 → 4 a los 8 / 30 / 60 /
  90 s. Y de paso la respiración —tres afuera, una adentro— es un compás que se ve.
- Ensayo de 90 s con el patrón de JEJE FLUID: 0 partículas adentro de toda loseta que pasó los
  0,4 s; 19 interacciones por frame con 10 losetas; solver 3-5 ms; 60 FPS. En las capturas la masa
  envuelve el cuadrado negro del centro y se aplasta contra su lado, hay fluido apoyado sobre el
  borde superior de una loseta, y con la grilla en 50 cm las masas quedan achatadas contra las
  lámparas. Capturas en `radiance-check/seq/obstaculos2/`.
- `check-radiance` suma la comprobación «las losetas llegan al solver como colisionadores».

### Tercer pedido del día: losetas que se mueven, vida con techo y el glow azul de amb 1

Manuel, textual: *"NO ESTA INTERACTUANDO EL FLUIDO CON LOS CUADRADOS ARREGLAO YA. TAMBIEN QUIERO Q
SEA MAS DINAMICO PORQ AHORA VEO Q LOS CUADRADOS PRIMERO CAMBIABAN PERO AL FINAL QUEDARON COMO
COLGADOS Y QUEDARON FIJOS. TIENE Q SEGUIR CAMBIANDO. Y SUMA OTRA DINAMICA QUE LOS CUADRADOS NO
SOLO APAREZCAN Y DESAPAREZCAN SINO Q TAMBIEN SE MUEVAN EN EL ESPACIO EN X O EN Y DE MANERA
GEOMETRICA EN BASE A LOS MIDIS [...] EL SINTE AMB1 ESE TIENE QUE GENERAR COMO QUE CREZCA UN POCO
LA LUZ [...] QUE SE PRENDAN UNAS DE LAS PARTICULAS EMISSIVE AZULES QUE VAYA AUMENTANDO SU
EMISSIVENESS CDO SUENA LA NOTA Y CDO NO SUENA Q SE APAGUE, CON UN POCO DE DECAY [...] TENES Q
CREAR UNO DE ESOS CANALES QUE MANDAN MIDI [...] HACELO BIEN NO ROMPAS NADA"*.

- **"No interactúa":** la ventana que tenía abierta corría el worker viejo. Un Worker en memoria no
  se recarga con el HMR de Vite, y el worker viejo no conoce `collide-rect`: la interacción llegaba
  y no hacía nada. Se abrió una ventana nueva; con recargar alcanza. Es una trampa para anotar:
  **después de tocar `kot-fluid.worker.js` hay que recargar la salida.**
- **Colgados y fijos:** la vida crecía sin techo con la cuenta (a los cinco minutos, medio minuto
  por loseta). Techo ×4 (16 negras con el fader en 4). La grilla ya no se subdivide por losetas
  vivas (que ahora tienen techo) sino por colocadas: ×2 desde la 48.ª, ×4 desde la 120.ª.
- **Se mueven:** con cada 808, todas las losetas vivas avanzan una celda —las blancas en x, las
  negras en y, signo alternado por la cuenta— deslizándose una negra (`stepTiles`/`tilePos`), y en
  el borde rebotan. El colisionador viaja con el dibujo: una loseta en marcha arrastra el fluido y
  deja estela (capturas en `radiance-check/seq/movimiento2/`). La nueva no da el paso hasta el 808
  siguiente. Y n38 (alarm keypad), además del barrido, **invierte** el color de todas (`flip`).
- **Lo que se rompió y se arregló en el mismo ensayo:** al salir del stutter había 370, 636 y
  1 154 partículas adentro de losetas en marcha. El `lock` global gana al colisionador: la loseta
  seguía deslizándose sobre partículas trabadas y al soltar el rectángulo expulsaba todo de golpe.
  Ahora las losetas viven en `tileClock` = tiempo de la 26 menos lo congelado: durante el stutter
  no se deslizan, no nacen ni mueren, y el 808 no coloca nada. Time stop de verdad.
- **El estrobo de 12 líneas** a intensidad plena dejaba la pared entera blanca (t = 19 s). Ahora
  la intensidad baja ÷√n desde 4 líneas y las orientaciones alternan horizontal/vertical.
- **amb 1:** el instrumento (pista 19, Ambiente Pad) no sale por MIDI. Con el MCP se creó la pista
  de envío **AMB1** (índice 46): entrada "amb 1" Post FX, monitor In, salida RTX3090 (Port 2)
  **canal 11** —el único libre: los envíos usan 1 DRUM, 2 PERC, 3 atractor, 4 BASS, 5 FOLEY,
  6 foley2, 7 sub y clip cc, 8 sub(PAD), 10 scene—. Igual que DRUM y PERC. El primer intento en
  batch expiró porque Live se colgó (Manuel lo reabrió; el set volvió con 46 pistas y el clip "26"
  intacto) y se rehízo paso a paso, verificando el routing al final. En la web, `mappings.default.json`
  v14: cualquier nota del canal 11 → `fluids.seq.amb` en modo `gate`. El `gate` del Mapper ahora
  **cuenta notas sostenidas por fila**: en JEJE FLUID amb 1 toca Do6 y Re#6 superpuestas 32 negras
  y soltar una no puede cerrar la compuerta.
- **El glow:** `updateGlow` sigue la compuerta con ataque de 2,5 s y caída de 0,8 s ("que vaya
  aumentando cuando suena, que se apague con un poco de decay"). Escribe el `mix` del `set-lamp`
  de entrada —cuyo secundario pasó a ser el segundo material con más partículas, al final de la 25
  un cuarto de la masa (histograma [684, 4014, 1530, 0])— hasta 0,7, y funde el color de ese
  material al azul `0x3060ff` por encima del monocromo. Al 0,85 teñía la pared entera; Manuel pidió
  "un poco". Consecuencia: ese cuarto de partículas ya no emite si amb 1 no suena (antes emitía al
  0,85 siempre); en JEJE FLUID amb 1 suena casi todo el tiempo.
- **Verificación:** `check-radiance` con las comprobaciones nuevas (paso de losetas, compuerta con
  acorde, glow que sube y decae) en desarrollo y producción, 480 frames a 60 FPS; 49 tests de
  node; `walk-scenes`; smokes; referencia regenerada (22 filas `fluids.seq`).
- **Pendiente de Manuel:** el master de Live se lee en 0,0 después de reabrir (antes 0,74). No lo
  tocó este trabajo (sólo se creó AMB1); revisar el fader.

### Cuarto pedido del día: azules que emiten quietos, cuatro lámparas al azar, tamaños mezclados

Manuel, textual: *"se ven los azules PERO NO SE VUELVEN EMISSIVE CON NOTA MIDI Q LES LLEGA"* y,
enseguida: *"HACE QUE TAMBIEN CAMBIE QUE CUBOS TIENEN EMISSIVE Y CUALES NO. Y HACE Q LOS Q NO SON
EMISSIVE QUE NO TENGAN EL BORDE BLANCO PORQ QUEDA MAL. [...] AL PRINCIPIO SE VEN CUADRADOS MAS
GRANDES Y DESPUES SOLO SE VEN LOS CHICOS, PIERDE DINAMISMO. [...] LAS LINEAS ESAS BLANCAS CON
EMISSIVE NO ME GUSTA. EN VEZ DE ESO HACE QUE ESOS FLASH SEAN DE LOS CUBOS. QUE VAS CAMBIANDO
CUALES SON LOS QUE SON EMISSIVE, QUE SIEMPRE SEAN SOLO 4 CUBOS EMISSIVE, Q VAYA SIENDO RANDOM"*.

- **Los azules no emitían.** La sonda (`mix` de la lámpara, `nextEmission` del render, dataset del
  canvas) mostró que toda la cadena estaba bien: el material 2 era el secundario con peso 0,67. Lo
  que faltaba estaba en el shader: la emisión de cada partícula va multiplicada por la **compuerta
  de velocidad** (`velocityGain`), y una partícula quieta emite al piso, 12 %. El fluido del cierre
  está quieto, así que los azules mostraban su pigmento (`bodies`) pero no luz. Uniform nuevo
  `uNextSteady` en los dos shaders del render (fuente y visible): el material secundario reactivo
  emite con ganancia ≥ 1 aunque esté parado, sólo mientras el overlay secundario está aplicado (un
  crossfade de material principal no lo hereda). El principal conserva "lo quieto es tenue y lo que
  corre flamea". Estado nuevo del render: `reactiveSecondarySteady`, que la 26 pone en 1.
- **Cuatro lámparas al azar.** Las losetas ya no nacen blancas o negras: nacen negras y hay siempre
  cuatro lámparas (o todas, si hay menos), elegidas con un generador determinista (mulberry32) para
  que el ensayo se repita igual. El contratiempo (n2) pasó de estrobo de líneas a **relámpago**:
  vuelve a sortear las cuatro y las hace destellar ×2 durante 120 ms. Con el contratiempo cada
  negra, un cuarto de los cuadros son de destello; por eso no es más fuerte, y `telemetry().flash`
  dice si una captura es de destello (dos de las cinco del ensayo lo eran, y parecían "la pared muy
  clara" hasta que se miró el número). n38 (`flip`) ahora es otro sorteo sin destello. Se fueron
  `strobe-lines`, la serie 1·2·4·8·12 y el marco blanco de las negras.
- **Tamaños mezclados.** La grilla base pasó a 50 cm (16 × 6) y las losetas miden 1, 2 o 4 celdas
  por la serie `2, 2, 1, 2, 4, 1`; la grande del bowl ride mide 2 m; `grid` > 0,5 achica todo a la
  mitad. Se fue la subdivisión por cuenta de colocadas (a la 48.ª todo pasaba a 50 cm y "se pierde
  dinamismo"). El paso es de una celda para las de 50 cm y de dos para las demás.
- **Lo que se rompió con los tamaños:** la emisión de una loseta va por área, así que una de 2 m a
  0,6 tiraba cuatro veces la luz y dejó la pared entera blanca; la emisión se normaliza al tamaño
  (luz de una de 1 m a 0,4, techo 1,0 para las de 50 cm). Y una de 2 m creciendo en 0,4 s mandó
  1 016 partículas al borde del dominio: el crecimiento escala con el tamaño (0,8 s las de 2 m) y
  bajó a 139.
- Ensayo de 40 s: tamaños `221` → `2412` → `241` → `2124` → `21241`, cuatro lámparas en cuanto hay
  cuatro losetas, 0 adentro de toda loseta quieta y crecida, 60 FPS. Capturas en
  `radiance-check/seq/lamparas3/`. `check-radiance` pasa en desarrollo y producción.

### Quinto pedido del día: pistones industriales, lámparas chicas y glow rápido

Manuel, textual: *"el release de la nota q hace el emissive azul tiene q durar 1 segundo [...] la
potencia de emissive azul tiene q ser 40 porciento mas fuerte y el ataque [...] mas rapido y como
con una vibracion [...] los cuadrados a veces son muy grandes y es como que no es tan frenetico al
ritmo de la musica [...] son demasiados los prendidos. nunca tienen q prender los q son mas
grandes. [...] a veces esta todo muy oscuro y solo un cuadrado o un par de cuadrados ilumina. y
que se apaguen las particulas blancas [...] como si fuesen animaciones industriales que estan
modificando un ambiente de laboratorio. mas mecanico industrial"*.

- **Glow:** ataque con constante de 0,22 s (95 % en 0,7 s) y una vibración de 11 Hz en la emisión
  cuya amplitud se apaga al llegar; release **lineal de 1 s**; techo del `mix` 0,85 (el de la
  lámpara) y ganancia parada 1,15 (`GLOW_STEADY`, va en el uniform `uNextSteady`, que ahora lleva
  la ganancia y no un booleano): 0,85 × 1,15 = +40 % sobre el 0,7 anterior. Medido cada 50 ms:
  0 → 0,86 entre 2,00 y 2,70 s con el `mix` oscilando; 0,866 → 0 entre 14,00 y 14,85 s.
- **Tamaños:** se fue la de 2 m; la serie es `1, 1, 2, 1, 1, 2` (dos de cada tres de 50 cm); el
  bowl ride pone una de 1 m; `grid` > 0,5 las hace todas de 50 cm.
- **Lámparas:** entre una y tres por sorteo (`1, 1, 2, 2, 3`), **sólo entre las de 50 cm**. Medido
  en 40 s: una el 44 % del tiempo, dos el 44 %, tres el 9 %.
- **Las blancas se apagan por compás:** cada cuatro kicks se sortea (40 %) si el material principal
  emite; cuando no, la lámpara principal pasa al material 3, que al final de la 25 no tiene
  partículas, y sólo alumbran los cubos y las azules. Hizo falta `instantEmissionRole` en la 26:
  un cambio de material principal funde, y mientras funde el render suspende la lámpara secundaria
  (el glow parpadeaba). Medido: blancas prendidas el 22 % del tiempo.
- **Movimiento mecánico:** el paso pasó del 808 al **kick** (cada negra) y el deslizamiento de una
  negra suavizada a **lineal, 0,18 s por celda** (arranque y frenada en seco, ~5 px por subpaso).
  La mitad de las losetas son **pistones**: el signo del paso apunta al centro de masa del fluido y
  al pasarlo vuelven, así que martillan la masa de un lado y del otro; la otra mitad patrulla y
  rebota. El 808 sólo coloca la loseta nueva.
- Ensayo de 40 s: 0 partículas adentro de toda loseta crecida, borde del dominio 4–84, 60 FPS.
  Capturas en `radiance-check/seq/pistones/`: pared oscura con uno, dos o tres cubos chicos
  alumbrando, blancas apagadas, azules encendidas con la nota, y los bloques de 1 m arando la masa.
  `check-radiance` actualizado (paso con el kick, glow rápido, release de 1 s) pasa en desarrollo y
  producción.

### Sexto pedido del día: máquinas que no se pisan, atractor del canal 3, luz que late

Manuel, textual: *"te falta q los cuadrados sean mecanicos y por lo tanto no pueden chocarse
solaparse entre ellos, ademas le falta mas dinamismo a la iluminacion. y los fluidos no estan
moviendose con los atractores q usamos en las otras escenas y antes estaban. [...] el emisor
azul queda siempre prendido pero fijate q la nota deja de sonar osea el release es muy largo"*, y
*"NO ESTA PASANDO Q CUANDO LAS PARTICULAS SE ACELERAN, Y SI SON EMISSIVE TENDRIAN Q ILUMINARSE
MAS"*.

- **No se pisan.** Las losetas ocupan rectángulos de celdas (`isFree`, que mira dónde está y a
  dónde va cada una). Al nacer, la celda de van der Corput se prueba hasta 32 veces con un cursor
  propio de la secuencia hasta encontrar una libre (si no hay, esa vez no nace). Al dar el paso,
  si el destino está ocupado rebotan contra la otra y prueban para el otro lado; si tampoco,
  esperan el golpe siguiente. Medido: 0 solapes en todo el ensayo y en `check-radiance`.
- **Atractor del canal 3.** La pista de envío "atractor" (canal 3) es la que mueve las otras
  escenas y en la 26 no hacía nada. Mapeo v15: cualquier nota del canal 3 → `fluids.seq.attract`
  (gate). Mientras está abierta, un `attractor` del show vive desde un punto sorteado del centro
  (radio 0,9, fuerza 3 × velocidad, `sustain` 1, paseo 0,12), alternando atracción y remolino con
  cada nota; su `dur` se corre medio segundo por delante en cada frame (el director lo apaga con
  `fade` en los últimos 0,3 s) y al soltar se lo deja terminar 0,3 s después. Medido:
  desplazamiento medio del fluido en 350 ms de 38 px sin atractor, 73 con atracción, 226 con
  remolino. En JEJE FLUID no hay clip de atractor: lo toca Manuel.
- **Las blancas se apagan… sólo si están quietas.** Apagarlas cambiando la lámpara principal al
  material vacío las dejaba muertas también en movimiento, y Manuel pidió que la aceleración
  encienda. Ahora "apagadas" = piso de emisión por velocidad 0 (quietas, cuerpos negros; el kick
  las hace relampaguear) y "prendidas" = piso 0,2. Además el techo de emisión por velocidad sube
  de 3,4 a 5,5 y la sensibilidad de 1,4 a 2,6: lo que corre flamea, blancas y azules (las azules
  parten de su ganancia parada 1,15 y de ahí para arriba).
- **La luz late.** Cada kick pulsa las lámparas (+80 %, 150 ms), el relámpago volvió a ×2,5 y cada
  lámpara sale del sorteo con intensidad propia (0,6–1,2).
- **Release del azul a 0,5 s** (medido 0,43). Y lo que hay que saber: en JEJE FLUID la nota de amb 1
  dura 32 negras con un corte de 0,15 s en el loop, así que mientras ese clip suene el azul va a
  estar casi siempre prendido: la compuerta sigue a la nota, y "que se apague" depende de que la
  nota se corte en Ableton.
- Ensayo de 34 s con amb 1 y el atractor tocados por script: capturas en
  `radiance-check/seq/maquinas/`; `check-radiance` (suma solapes = 0 tras seis golpes, atractor
  que prende y apaga, release < 0,02 a 0,65 s) pasa en desarrollo y producción a 60 FPS; 49 tests;
  build; referencia regenerada.

### Séptimo pedido del día: esquive real y el barrido que invierte la iluminación

Manuel, textual: *"TENES Q MEJORAR EL SISTEMA QUE LOS CUADRADOS NUNCA TIENEN Q SOLAPARSE. TIENE Q
MOVERSE EVITANDO CHOCARSE Y PISARSE. ADEMAS LA LINEA Q PASA COMO UN BARRIDO NEGRO TIENE QUE
ALTERAR LA ILUMINACION DE TODO SOBRE ELLA. OSEA INVERTIRLA [...] LO Q PASA POR AHI INVERTIDO POR
EJEMPLO Q ES BLANCO EMISSIVE, PASA A SER NEGRO, Y LAS PARTICULAS Q ERAN NEGRAS PASAN A SER
BLANCAS EMISSIVE, Y LAS AZULES PASAN A SER ROJO EMISSIVE"*.

- **El solape que quedaba.** La comprobación anterior miraba las celdas: dos losetas nunca
  terminaban en la misma, pero **a mitad del deslizamiento sí se pisaban** (dos que se cruzan pasan
  una por encima de la otra). Ahora cada loseta ocupa su **caja barrida** —su celda, y mientras se
  desliza también la de la que viene— y un paso sólo se acepta si esa caja no toca la de ninguna
  otra. Con eso no hay solape en ningún instante, y se mide sobre los rectángulos DIBUJADOS
  (`tilePos`), no sobre las celdas: 40 muestras por segundo durante 35 s con hasta 11 losetas,
  cero solapes.
- **Esquivar, no sólo rebotar.** Cada loseta prueba cuatro rumbos por orden: el pistón tira hacia
  el centro de masa por su eje y después por el otro; la patrulla sigue derecho, si no puede
  **dobla noventa grados** y recién después se vuelve. Si ningún rumbo está libre, se queda quieta
  ese golpe. No se traban: 10 de 11 moviéndose al final del ensayo.
- **Una carrera por vez.** Con seis kicks a 40 ms (un redoble) aparecía un solape: la loseta
  arrancaba un paso nuevo mientras todavía viajaba, y su caja pasaba a ser [B,C] cuando visualmente
  seguía entre A y B. Ahora un golpe que llega con el deslizamiento en curso no la mueve. En el
  show no se notaba (kick cada 429 ms contra 180 ms de deslizamiento), pero un redoble existe.
- **El barrido invierte.** Dejó de inyectar `shadow-bar`. Una barra negra **no se puede invertir**:
  borra la luz, y debajo no queda imagen que dar vuelta (invertir una franja negra da una franja
  blanca lisa). Ahora es una banda vertical de 1 m con borde duro que cruza en 0,8 s a velocidad
  constante, y la inversión la hace el **paso de grade** (`postFragmentShader`), que ve la imagen
  ya compuesta —campo de radiancia, partículas y cubos—: cubo blanco → negro, cubo negro → blanco,
  partículas blancas → negras, pared iluminada → oscura. El runtime no dibuja nada, sólo manda
  `invertX/Half/Tilt/Amount` en el estado de render; fuera de la 26 ese estado no existe.
- **El azul al rojo.** El complemento crudo de un azul puro es amarillo. Restarle el verde en
  proporción a lo azul que era el pixel lo lleva a rojo. Con un `clamp` lineal, el fondo —que tiene
  tinte azul del glow— quedaba naranja de punta a punta; con `smoothstep(0.05, 0.3)` el fondo se
  invierte a gris neutro y sólo lo francamente azul sale rojo.
- Capturas en `radiance-check/seq/invert3/`: en el borde de la banda se ve un cubo partido al
  medio, mitad blanco (invertido) mitad negro. `check-radiance` suma dos comprobaciones (sin
  solapes a mitad del deslizamiento; la banda enciende, cruza y se apaga) y pasa en desarrollo y
  producción a 60 FPS; 49 tests; build; 29 escenas a 60 FPS.

### Octavo pedido del día: los dos kicks del rack y el azul al doble

Manuel, textual: *"FIJATE CON ABLETON MCP QUE HAY 2 NOTAS DE KICK SINCOPADAS. TENES Q USAR AMBAS
ASI LOS CUADRADOS SON MAS DINAMICOS"*, y después *"LA NOTA DEL CANAL AMB 1 [...] TIENE Q HACER
AUMENTAR MAS LA LUZ DEL EMISSIVE AZUL [...] EL DOBLE DE LO Q HACE. TIPO EMPIEZA A SUBIR LA NOTA Y
EMPIEZA DEL NIVEL MINIMO DE ESA EMISSIVE, HASTA EL DOBLE DE LO Q LLEGA AHORA. Y CDO DEJA DE SONAR
LA NOTA, EN 1 SEGUNDO VUELVE A SU VALOR MINIMO"*.

- **Los dos kicks.** Leído con el MCP (`get_drum_pads` del rack `amen_tearsofthekiller1`): el pad 0
  es **"deep dark kick"** y el pad 2 es **"Instrument Rack"**, que adentro tiene el **"Cymatics -
  Kick 69"**. En el loop del clip (beats 12–18) el 0 cae en cada negra y el 2 en cada contratiempo:
  sincopados entre sí. Tenía el 2 sólo para el relámpago; ahora además dispara `fluids.seq.step`,
  un paso más de todas las losetas. El del contratiempo es **cruzado**: empuja por el eje
  perpendicular al del golpe de la negra, así el recorrido es una escalera en vez de una línea.
  Medido en 34 s: **4,9 cambios de celda por segundo** (las corcheas de 140 son 4,67), contra 2,3
  con un solo kick. Ninguna loseta se traba y cero solapes.
- **El azul, del mínimo al doble.** Eran dos cosas separadas y ahora las dos se mueven con la
  envolvente: cuánta lámpara azul reciben (el `mix`, de **0,2 a 0,85**) y cuánto emiten **paradas**
  (`uNextSteady`, de 0 a **2,3**, el doble de la ganancia anterior de 1,15). El 0,2 es el mínimo que
  Manuel pidió: sin nota las azules no se apagan del todo, quedan como gotas apagadas. El color del
  material se queda azul aunque no suene (mezcla 0,6 a 1): si volviera al gris del monocromo
  dejarían de ser "las azules" entre nota y nota.
- **Release de 1 s al mínimo** (medido: 0,763 → 0,2 entre 17,95 y 18,85 s). Ojo con la vuelta
  anterior: lo había bajado a 0,5 s porque Manuel dijo que "quedaba siempre prendido", pero eso era
  por la nota de amb 1, que dura 32 negras. Ahora vuelve a 1 s **hasta el mínimo**, que es lo
  pedido, y lo que hace que no parezca "siempre prendido" es el piso.
- Capturas en `radiance-check/seq/glow/`: sin nota las gotas azules están ahí pero apagadas; con la
  nota irradian y tiñen de azul la pared entera.
- `check-radiance` suma dos comprobaciones (el segundo kick mueve las losetas; el glow llega arriba
  de 0,7 y vuelve al mínimo, no a cero) y pasa en desarrollo y producción a 60 FPS; 49 tests; build;
  29 escenas a 60 FPS; smokes; referencia regenerada (mapeos v16).
- **Trampa de la prueba:** el bloque de losetas de `check-radiance` empezó a fallar al espaciar los
  golpes 210 ms: con la vida de fábrica (4 negras = 1,7 s) las losetas se morían a mitad de la
  tanda y no quedaba nada que mirar. La prueba ahora les pone vida larga y coloca dos antes.
