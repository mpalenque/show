# Retopo 8:3 — poligonización Voronoi/Delaunay de imagen y video (WebGPU)

Convierte una imagen o un video en una **retopología poligonal en relieve**: se analiza el
frame, se distribuyen sitios según el detalle de la imagen, se relajan con Lloyd sobre sus
celdas de Voronoi y el resultado se dibuja como polígonos sólidos que **salen del panel en
el eje Z**, con PBR, sombras y ambient occlusion GTAO.

El formato de pantalla es un panel fijo de **8 × 3** (el mismo del proyecto `flow/`), montado
en un muro con marco, así que el encuadre siempre respeta esa relación.

```bash
npm install
npm run dev      # http://localhost:1235
npm run build
```

Requiere un navegador con WebGPU (Chrome/Edge 113+, Safari 18+).
Cargá un archivo con el botón o arrastrándolo a la ventana.

## Cómo funciona

```
imagen/video ──► canvas 8:3 (análisis)  ──► luminancia + Sobel ──► campo de densidad
                                                                        │
                    importance sampling (N sitios) ◄────────────────────┘
                                    │
                    Lloyd ponderado sobre celdas de Voronoi  (relaja y ordena los sitios)
                                    │
              ┌─────────────────────┴─────────────────────┐
        Delaunay (triángulos)                    Voronoi (celdas)
              └─────────────────────┬─────────────────────┘
                                    │
        geometría: cara frontal + paredes laterales + cara trasera por polígono
                                    │
        GPU (TSL/WebGPU): cada polígono lee su color/luminancia promedio y se
        desplaza en Z; normal plana exacta por derivadas ⇒ facetas nítidas
                                    │
        post: GTAO + denoise bilateral + bloom + tone mapping
```

- **CPU por frame**: promedio de color y luminancia de cada polígono (mapa píxel→polígono
  precalculado). Cuesta ~1 ms para 4.500 polígonos a 512×192.
- **CPU al retopologizar**: análisis completo, ~40 ms con los valores por defecto
  (2.200 sitios, 3 iteraciones de Lloyd, 512 px de ancho de análisis).
- **GPU**: dos texturas float chicas por frame; toda la extrusión, el color y las normales
  se calculan en el shader, así que mover cualquier parámetro de relieve/color es gratis.

## Parámetros (panel derecho)

**0 · morph** — el fader principal
| | |
|---|---|
| `polygonize` | **0 = la imagen se ve normal** (plana, sin luz 3D, sin polígonos). Subiéndolo aparecen los polígonos, salen en Z y el color se va aplanando |
| `extrude Z` | cuánto sobresalen del muro cuando el morph está en 1 |
| `flatten colour` | 1 = cada polígono toma el color promedio de su área; 0 = cada polígono conserva el detalle de la imagen adentro (look "foto rota en placas") |
| `shading onset` | en qué punto del morph la imagen plana pasa a estar iluminada en 3D |

**0b · where it applies** — aplicación selectiva (todo dosificable, todo funciona con video)
| | |
|---|---|
| `base everywhere` | piso mínimo de polígonos en toda la imagen: sirve para tener una base y encima reforzar zonas |
| `shape mask` | `radial`, `linear sweep` o las dos multiplicadas |
| `shape amount` | dosis de la máscara de posición (0 = ignorarla) |
| `center x/y`, `radius` | círculo donde se aplica |
| `sweep angle/position` | barrido lineal en cualquier ángulo |
| `softness`, `invert` | borde suave y negativo de la máscara |
| `animate` + `animate speed` | la máscara se mueve sola (reveal animado) |
| `by brightness` | `amount`, `from`, `to`, `softness`: se aplica sólo donde el brillo está en ese rango (p.ej. sólo las luces, o sólo las sombras) |
| `by colour (hue)` | `amount`, `hue °`, `width`, `softness`, `min saturation`: se aplica sólo a los colores cercanos a ese tono. Con `min saturation` se evita afectar los grises |
| `by control texture (plasma)` | máscara orgánica generada proceduralmente, ver abajo |

Las máscaras se multiplican entre sí y el resultado escala el morph polígono por polígono,
así que se pueden combinar: por ejemplo "sólo los azules, sólo en la mitad derecha, y sólo
las zonas claras".

### Textura de control (plasma)

Un campo fbm tileable con domain warping y gradiente opcional, generado en CPU.
El **mismo** campo alimenta dos cosas, así que siempre coinciden:

- **`amount (sizes)`** — mezcla el plasma en el campo de densidad del análisis, o sea
  decide **dónde hay más y menos polígonos**: los tamaños quedan orgánicos e
  independientes del contenido de la imagen. (rehace la topología)
- **`amount (mask)`** — máscara de selección en GPU: **dónde se aplica el relieve**,
  con `threshold`, `softness` e `invert`. En vivo, y con `drift speed` se mueve sola.

Forma del campo: `blob size` (tamaño de las manchas), `octaves`, `roughness`,
`warp` (deformación orgánica), `contrast`, `gradient mix` + `gradient angle`,
`invert texture`, `seed`. Ubicación: `scale`, `offset x/y`.
`show texture` reemplaza el relieve por la textura para poder calibrarla.

**1 · polygonization** (rehace la topología)
| | |
|---|---|
| `mode` | `delaunay triangles` (look low-poly) o `voronoi cells` (mosaico) |
| `sites` | cantidad de sitios. Delaunay genera ~2× triángulos |
| `size variation` | **cuánta diferencia de tamaño hay entre polígonos**. Lloyd ponderado iguala la *masa* de cada celda, así que el área queda ∝ 1/densidad: en 0 todos los polígonos salen del mismo tamaño, en 3–4 conviven triángulos enormes en las zonas planas con triángulos chiquitos en el detalle |
| `edge attraction` / `edge gamma` | cuánto atraen los bordes de la imagen a los polígonos |
| `dark attraction` | atrae polígonos hacia las zonas oscuras |
| `lloyd iterations` / `strength` | relajación ponderada sobre Voronoi: celdas más parejas y orgánicas |
| `border points` | puntos fijos en el borde para que la malla cubra el panel entero |
| `analysis width` | resolución del análisis (alto = width × 3/8) |
| `pre blur` | desenfoque previo: menos ruido en el campo de densidad |
| `seed` | semilla determinista |
| `solid` | genera paredes laterales y cara trasera (prismas sólidos) |
| `auto (video)` + `auto rate` | rehace la topología en vivo mientras corre el video |

**2 · relief (Z)**
`depth gamma`, `invert`, y sobre todo `smooth→flat→loose`, un solo fader con tres etapas:

- **0** — superficie continua: cada esquina a su propia altura (low-poly arrugado).
- **0.5** — cada polígono es una **faceta plana** de verdad (plano ajustado por mínimos
  cuadrados sobre sus esquinas). Es el valor por defecto y el que hace que el modo Voronoi
  se vea como un mosaico de placas y no como triángulos.
- **1** — cada polígono se despega en una placa paralela al muro.

Además `gap` (separación entre polígonos: es lo que hace visible el AO), `thickness`,
`root to wall` (1 = prismas que nacen del muro), `lift`, `random jitter`,
`wobble` + `wobble speed` (animación).

**3 · color** — exposure, saturación, contraste, gamma, posterize, sombreado de
laterales/traseras y atenuación por profundidad, emissive.

**4 · material** — roughness (y su variación por luminancia), metalness, intensidad
del environment, wireframe.

**5 · lighting** — key direccional con sombras (posición XYZ), fill, rim rasante
(es la que dibuja el filo de cada faceta), ambient.

**6 · ambient occlusion & post** — GTAO: strength, radius, falloff, thickness,
contrast, samples, resolución; denoise bilateral; bloom; exposición y tone mapping.

**7 · framing** — fit cover/contain, zoom, offset, mirror, preview del source,
marco (ancho/profundidad/valor), fov, padding, auto orbit, reset de cámara.

## Notas

- El fader `polygonize` en 0 muestra la imagen **sin iluminación ni especular**: el material
  hace un crossfade entre el resultado iluminado y la imagen cruda, así que no queda ningún
  brillo del environment ensuciando la foto. Sí pasa por el tone mapping del render; si
  querés la imagen literal, poné `tone map` en `none`.
- Arrastrar `sites` (o cualquier parámetro de topología) no re-analiza en cada paso: espera
  140 ms de quietud y recién ahí rehace la malla. Probado con 12.000 sitios en los dos
  modos (288k triángulos) a 115 fps.
- Cada retopología crea una `BufferGeometry` nueva sobre buffers reutilizados (los buffers
  sólo crecen, nunca se reasignan al bajar). Reutilizar la geometría con subidas parciales
  dejaba datos viejos en la GPU al bajar la cantidad de polígonos, y aparecía la
  triangulación anterior en vez de la nueva.
- Los pesos de las máscaras se calculan una vez en el vertex stage y viajan como varying;
  si no, el fragment stage repetía toda la cadena (incluidas las lecturas de la textura de
  control) por cada nodo del material.

- La cámara mira hacia +Z, por eso el mapeo de X está espejado en `polyMesh.js`: así los
  polígonos coinciden con la imagen original.
- El encuadre automático enfoca el **plano frontal** del relieve, de modo que subir
  `extrude` no hace que los polígonos se salgan de cuadro. Al mover la cámara a mano el
  auto-fit se desactiva (se reactiva con *reset camera*).
- `frame ≥ relief` mantiene la profundidad del marco por encima de la extrusión.
- `window.conf` y `window.app` quedan expuestos en la consola para automatizar pruebas.

## Créditos

- HDRI [autumn_field_puresky](https://polyhaven.com/a/autumn_field_puresky) — Polyhaven.
- Textura de concreto — [texturecan.com](https://www.texturecan.com/details/216/).
- Triangulación: [d3-delaunay](https://github.com/d3/d3-delaunay) / delaunator.
- Render: [three.js](https://threejs.org) WebGPU + TSL, GTAO/Denoise/Bloom de los ejemplos de three.
