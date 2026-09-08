**Análisis de PARTE 2 — vvvv beta y viabilidad de port a web**

**Actualización: sistema web implementado.** El paquete completo para trasladar a otro repositorio es la carpeta `milky-webgpu`; su documento de entrada es [milky-webgpu/ENTREGA_PARTE2_WEBGPU.md](milky-webgpu/ENTREGA_PARTE2_WEBGPU.md) (estado, medios encontrados en el disco `I:`, sustitución temporal de secuencias faltantes, validación y pendientes). [Abrir Parte 2 con seis videos](http://127.0.0.1:8787/system.html?look=sixDDS) o ejecutar `milky-webgpu/ABRIR PARTE 2.cmd`. El port incluye siete transportes DDS, seis bloques, bancos Milky A/FULL, FINAL, INK independiente, composición, máscara/warp, MIDI original, CC para todos los parámetros públicos, Learn, OSC y un adaptador para integrar con Parte 1. [Manual y límites comprobados](milky-webgpu/system/README.md). Las pruebas de navegador y rendimiento del port están en `milky-webgpu/captures/`; la comparación contra vvvv sigue pendiente. El análisis estático que sigue documenta la fuente original.

Revisión del 6 de septiembre de 2026. Se analizaron los XML actuales de los patches, sus conexiones, los shaders de `C:\vvvv_beta_42_x64` y las cabeceras de los DDS de la carpeta efectiva. Es un análisis estático: no se ejecutó una comparación de imágenes ni un benchmark. Los cambios que ya tenía el proyecto no se modificaron.

El sistema puede trasladarse a WebGPU conservando los algoritmos, los DDS y los controles. La igualdad visual debe validarse especialmente en los feedbacks; la misma performance no puede afirmarse antes de medir ambos motores en condiciones iguales.

**Cómo está armado.** [PARTE 2.v4p](<PARTE 2.v4p>) contiene principalmente [player maximus.v4p](<player maximus.v4p>), un medidor de FPS y MainLoop con máximos de 300 FPS en foreground y background. Ese número es un límite configurado, no una medición.

El flujo de imagen principal es: players DDS y generadores Milky/tinta → quads y composición por capas → textura 3840×2160 → displacement global → quad de salida y overlay gráfico → Renderer DX11. Hay transforms específicos para distribuir, escalar y desplazar la imagen y sus seis franjas. La ventana alterna dimensiones 400×100 / 3840×2160 por lógica de escenas; eso no cambia el tamaño fijo del render intermedio principal.

Hay siete instancias principales de [Player FULL.v4p](<Player FULL.v4p>): una full y seis independientes para las franjas. No son seis recortes obligatorios de un único video. Además, `PLAYER INK.v4p` se instancia dentro de dos ramas de efectos para aportar imágenes de tinta.

**Reproducción DDS.** `Player FULL` obtiene el comienzo, final y nombre del clip desde [Ordenar secuencias dds.v4p](<Ordenar secuencias dds.v4p>). La tabla efectiva contiene 68 clips y 48.030 frames. En esta versión son tablas guardadas: el proceso que reconstruye el catálogo está desactivado y no alimenta esas tablas.

[2D/Selector frames.v4p](<2D/Selector frames.v4p>) usa un LFO para recorrer el rango y convierte el resultado a índice entero. El avance nominal es 30 FPS. La fórmula exacta del período es `(hasta - desde) / 30 + mas lento`; con `mas lento = 0`, da `(cantidad - 1) / 30` segundos. Hay Reset manual y Pause interno. No aparece un cable que reinicie el LFO al cambiar de clip: el cambio de selección modifica su rango conservando la fase, salvo otra intervención.

[Player (DX11.Texture) frame.v4p](<Player (DX11.Texture) frame.v4p>) usa `PlayerDX11Texture.dll`. El wrapper solicita el frame actual y los tres siguientes, muestra el primero y tiene `Wait for Frame = 1`, `Decoder = Automatic`. Esto verifica la ventana de precarga solicitada, pero no revela toda la política interna de caché de la DLL. Ocultar una franja por alpha no demuestra que su player deje de evaluarse.

La ruta efectiva es `C:\Users\mpale\OneDrive\Desktop\DDS2`. Se leyeron los headers de todos sus archivos:

| Resolución | Frames presentes | Formato | Bytes por frame con header |
|---|---:|---|---:|
| 1280×720 | 305 | DXT1 / BC1 | 460.928 |
| 1920×1080 | 4.205 | DXT1 / BC1 | 1.036.928 |
| 3840×2160 | 385 | DXT1 / BC1 | 4.147.328 |

Son 4.895 archivos, 6.097.586.560 bytes, aproximadamente 5,68 GiB. Todos declaran `mipMapCount = 0`. Están completos los primeros doce clips de la tabla, y hay cinco frames del decimotercero. Esta carpeta no alcanza para comprobar el show completo de 68 clips.

**Qué es el “noise” de este patch.** En las cadenas Milky analizadas no hay un generador explícito Perlin, Simplex o fBm. Su aspecto orgánico se construye realimentando imágenes. Una forma o imagen inicial pasa por deformación, mezcla y contraste; el resultado se guarda con `FrameDelay` y vuelve al procesamiento del frame siguiente. Las pequeñas diferencias espaciales se amplifican y producen manchas, filamentos, ondulaciones y patrones de aspecto ruidoso. Estas descripciones visuales se infieren del procesamiento; no sustituyen una captura del patch funcionando.

Los efectos concretos son:

| Efecto | Funcionamiento comprobado |
|---|---|
| FrameDelay / feedback | Conserva la textura anterior. El resultado depende de la historia de imágenes y de la cantidad de evaluaciones. |
| NormalMap | Calcula diferencias entre muestras vecinas para formar un mapa de dirección a partir de la imagen. Usa radio, profundidad y mipmaps. |
| Displace, modo RedGreenXY | Interpola entre la coordenada original y RG de la textura de control: `uv = lerp(uv, control.rg, direction * amount)`. |
| Displace, modo NormalMap | Usa RG centrado en 0,5 como desplazamiento: `uv += (control.rg - 0.5) * direction * amount`. No es la misma fórmula que RedGreenXY. |
| DistortFlow | Calcula un gradiente de la imagen de control, lo gira 90 grados e integra desplazamientos. Produce circulación de la imagen; no genera un campo de noise independiente. |
| Dither | Cuantiza con una matriz periódica determinista de 8×8. Es el efecto más directamente asociado al grano/punteado de estas ramas. No es ruido aleatorio renovado cada frame. |
| UnsharpMask / UnsharpHSV | Refuerza diferencias y bordes a distintas escalas; las variantes HSV también alteran color. Dentro del feedback contribuye a formar estructuras persistentes. |
| Blend | Combina semilla y feedback con operaciones como Exclusion, Add, Glow o Reflect. Hay operaciones configuradas que están desactivadas; no se deben contar todas como visibles simultáneamente. |
| HSCB, Invert, Edge y Levels | Modifican color/contraste, invierten, extraen bordes y remapean niveles. Son parte del aspecto final y, en algunas ramas, del propio feedback. |

**Los cuatro Milky de las franjas.** [Milky/sUPER MILKY MULTI.v4p](<Milky/sUPER MILKY MULTI.v4p>) devuelve un banco ordenado como `1A, 3A, 2A, SPLASHA`. Sus dos renderers de semillas son de 800×1280. Uno inyecta un quad con pulsos de un segundo; otro usa una grilla roja en wireframe cuya rotación recorre un LFO de doce segundos. Hay además un pulso de 22 segundos asociado a la selección de entrada de 2A.

La entrada externa `Texture In` de SUPER MULTI no está conectada en `player maximus`: aquí sus máscaras se generan desde las semillas internas. En cambio, `2D/milky FULL` sí recibe la textura del player DDS full.

Parámetros relevantes de las variantes A, tomando los valores de los controles conectados cuando sustituyen al valor guardado del shader:

| Variante | Configuración distintiva |
|---|---|
| [1A](<Milky/milky 1A.v4p>) | Exclusion 0,79; NormalMap radio 1 y profundidad −0,14; Unsharp 0,83 / Shape 0,24; Dither 4,85; mezcla Glow 0,84; DistortFlow Amount 0,001. |
| [3A](<Milky/milky 3A.v4p>) | Exclusion 0,65; NormalMap radio 12 y profundidad 0,46; Unsharp 1 / Shape 0,04; Dither 5,49; segundo desplazamiento −0,005. Reflect está desactivado. El primer Displace usa Amount 0,032 y dirección seleccionada aleatoriamente entre −0,05 / 2 / −2 por snare; el kick cambia la dirección del segundo. |
| [2A](<Milky/milky 2A.v4p>) | Add 0,77; Displace 0,54 con dirección (0,004; 0,01); Unsharp 0,36 / Shape 2,34 / Saturation 0,96; DistortFlow 0,1; Dither 7; HSCB con brillo 2,2 y contraste 0. Darken está desactivado. |
| [SPLASHA](<Milky/milky SPLASHA.v4p>) | Exclusion 0,82; normales radio 12 y profundidad 0,46; desplazamiento principal 0,03 con dirección −0,4; Unsharp 1 / Shape 0,04; Dither 5,49; Reflect y segundo desplazamiento 0,105, con dirección animada. |

No todos esos parámetros tienen unidades visuales directas: `Threshold = 7`, por ejemplo, no significa “7 % de ruido”. Debe conservarse la ecuación del shader.

**Milky full y tinta.** [2D/milky FULL.v4p](<2D/milky FULL.v4p>) selecciona entre cinco entradas y permite combinar el resultado con el DDS. La rama [milky final.v4p](<milky final.v4p>) añade otros feedbacks, controles OSC y [distort milky final.v4p](<distort milky final.v4p>).

**Rama final identificada y añadida a la demo.** El quinto selector (Input 5, índice 4) apunta a `../milky final.v4p`, en la raíz. Es la candidata al efecto descrito como una explosión: `PLAYER INK` reproduce tinta real, la gira 180°, invierte y procesa con Growth y feedback. Se encontraron los 1.067 DDS BC7 de 1280×720 completos en `2D/ink/DDS`. La rama principal produce 3840×1200 y conserva además un feedback de anillo a 960×320. En escenas 69–80, BOTON habilita Dither/Exclusion y conduce una rampa lineal de 3,04 s sobre los frames de tinta. FX1/FX2/FX4 y Kick modifican el resultado. `3D/BOMBA.v4p` es un sistema de partículas aparte, sin referencias activas desde esta cadena.

La demo incluye ahora **MILKY FINAL · INK**, controles manuales equivalentes a esas señales y vistas de entrada/procesamiento/salida. Usa los DDS comprimidos directamente en WebGPU y mantiene los feedbacks de Growth internos en RGBA16F. Se midieron 59,98 FPS efectivos a 3840×1200 durante 10 s en esta máquina NVIDIA, sin errores; esto no establece igualdad de performance ni equivalencia píxel a píxel con vvvv. Detalles, hipótesis pendientes y evidencia en [milky-webgpu/README.md](<milky-webgpu/README.md>).

`distort milky final` y [INK dripping2.v4p](<2D/GLITCHH/glitchpack_2/glitchpack/INK dripping2.v4p>) contienen procesamiento de tinta emparentado. Trabajan con tamaños conectados de 1280×720 en varias etapas, aunque hay valores antiguos de 3840×2126 guardados y reemplazados por cables. La rama Growth hereda el tamaño de su entrada; también existe una textura dinámica de 720×1280.

- `verticalFlow` desplaza el frame anterior verticalmente según el rojo de la imagen actual. Con `scale = 0,013` y `progress = 0,97`, la fórmula es `salida = 0,03 * actual + 0,97 * anterior(uv + (0, 0,013 * actual.r))`. El sampler es Wrap. Fuente: [verticalFlow.tfx](<2D/GLITCHH/glitchpack_2/glitchpack/verticalFlow.tfx>).
- Después aparecen NormalMap con profundidad 2,36 y radio 1, Displace 0,61 y UnsharpHSV con Amount 2, Shape −1,46, Hue −1,42, Saturation 0,5 y Value 1.
- `Growth` propaga la imagen del feedback alrededor de cada píxel, con unas 24 muestras circulares por actualización más las muestras del mapa. Parámetros conectados: Speed 100, Fade 0,12, MapShape −0,4 y EdgeWidth 1. Es expansión de imagen guiada por un mapa; no un simulador completo de fluidos. Tiene un buffer interno RGBA16F y una salida RGBA8 en el módulo instalado.
- Otro NormalMap y Displace de Amount 0,54 deforman esa expansión. Levels termina de remapear negros: entrada 0,38629 y salida 0,24456.
- Hay un mixer Glitch, pero su Fader está en cero: no corresponde describir un glitch animado fuerte como activo. También hay HSCB desactivados y un primer Displace con Amount conectado a cero.

**Deformación de la composición completa.** En `player maximus`, `NormalGlow` transforma la salida Milky seleccionada en un mapa de normales a varias escalas. Aunque se llame Glow, aquí se usa como control del warp, no como un bloom añadido a la imagen. El shader genera mipmaps y combina gradientes de varios niveles.

Ese mapa alimenta el Displace final en modo NormalMap, con Amount −0,31. `Full displace = 1` selecciona la salida Milky sin multiplicarla por `Mask 6`; la otra posición permite la rama de máscara. El Enabled del warp está automatizado: con el cableado actual, el kick puede activarlo en escenas 65–68; en 69–80 el selector lo fuerza a cero. INK dripping se habilita en escena 66.

Una particularidad para copiar fielmente: el Displace final guarda `MapSmooth = 0,33`, pero la función NormalMap del shader instalado calcula un LOD que luego no utiliza para muestrear el control. No se debe inventar un blur adicional al portar ese parámetro.

**Controles.** [MIDI SEQ PLAYER.v4p](<MIDI SEQ PLAYER.v4p>) usa `loopMIDI Port`. Distribuye selección de clips (`SeqX6`, `SeqSOLO`), alpha/activación (`VIDX6`, `MILKYX6`, `VID FULL`, `MILKY FULL`), selección de máscara, escenas y triggers de kick, snare e INK. Las velocidades MIDI también se convierten en índices de selección; no son sólo intensidad.

Los bangs de snare producen rotaciones y espejados aleatorios en los quads Milky. El Random aquí controla estados/eventos, no produce una textura de noise. El receptor UDP usa puerto 1002 y decodifica `/fx1` a `/fx4`; dentro de `milky final`, `/fx1`, `/fx2` y `/fx4` tienen conexiones a parámetros de deformación. No se verificó un efecto visible de `/fx3` en esta cadena.

**Límites de la reconstrucción.** Hay rutas antiguas a Dropbox/SG13 para tres ramas de `milky FULL` y para el player interno de INK. Existen variantes relacionadas en el proyecto, pero no se puede asumir que sean sustitutos idénticos. `INK dripping2` también referencia un `UnsharpHSV.tfx` relativo ausente; hay shaders homónimos en la instalación. Una resolución automática por nombre en vvvv debe comprobarse en ejecución.

Además hay pins antiguos como `Control Blur` e `Iterations` en ciertos nodos Displace que no existen en el shader instalado. No prueban una segunda iteración. Se verificó que UnsharpMask de `packs/dx11` y el de `dx11-vvvv-girlpower` difieren en su estructura de pasadas: para el port hay que usar el archivo realmente referenciado.

**Cómo lo llevaría a web.** La propuesta es WebGPU con shaders WGSL, lectura DDS en workers, precarga circular y texturas persistentes para los feedbacks. Los BC1 disponibles pueden subirse comprimidos si el adaptador ofrece y se solicita `texture-compression-bc`. Es necesario leer la cabecera DDS y extraer sus bloques; no es una imagen que el navegador cargue directamente en una etiqueta HTML. [Especificación WebGPU](https://www.w3.org/TR/webgpu/#texture-formats), [formato DDS de Microsoft](https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds-pguide).

La selección de una carpeta local requiere acceso concedido por el usuario. Los archivos pueden procesarse desde workers. MIDI puede trasladarse mediante Web MIDI. Para conservar OSC por UDP en una página web normal hace falta un puente local, por ejemplo UDP↔WebSocket. [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [Web MIDI](https://www.w3.org/TR/webmidi/), [Direct Sockets y su disponibilidad especializada](https://developer.chrome.com/docs/iwa/direct-sockets).

La equivalencia exige mantener orden de operaciones, resoluciones intermedias, mipmaps, filtros, Clamp/Wrap/Mirror, formatos, alpha, inicialización y pasos de feedback. No basta con dar a un shader un tiempo global. Estos feedbacks avanzan por evaluación y no incluyen necesariamente un delta temporal: ejecutarlos 60 veces en lugar de 120 puede cambiar su evolución. Un port debe reproducir la cadencia original o definir y validar su equivalencia temporal. Las diferencias de precisión entre APIs también pueden acumularse en una cadena realimentada. [Precisión numérica de WGSL](https://www.w3.org/TR/WGSL/#floating-point-accuracy).

**Qué significa “misma performance”.** El registro del equipo enumera una RTX 3090 con 24 GiB y una Intel UHD 770. Esto no identifica cuál usa el patch o cuál elegiría el navegador. No se obtuvo una medición de FPS del original.

Como cálculo de volumen, un stream BC1 4K30 mueve aproximadamente 124,4 MB/s de bloques si cada frame se lee y sube una vez. Siete streams 4K30 distintos serían unos 871 MB/s antes de overhead; no es la carga constatada del show, que mezcla resoluciones. La precarga de siete por cuatro frames BC1 4K representa unos 116 MB de bloques. Los intermedios de efectos ocupan más: una textura 3840×2160 RGBA8 son 33,2 MB, y RGBA16F 66,4 MB, sin mipmaps.

Los costes relevantes son lectura/subida DDS, memoria de intermedios, mipmaps, filtros con varias muestras y feedbacks. NormalGlow, Unsharp y Growth tienen más trabajo por píxel que un simple quad. No hay fundamento para prometer un porcentaje de mejora o penalización por usar web.

La presentación mediante `requestAnimationFrame` normalmente sigue al monitor y suele pausarse en pestañas ocultas. WebGPU no tiene un límite universal de cálculo de 60 FPS, pero 300 evaluaciones del MainLoop de vvvv no equivalen a 300 imágenes presentadas por el navegador. [requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

La prueba concluyente debe usar la misma GPU, secuencias, resolución, capas, parámetros y cadencia de feedback, comparando imágenes desde el mismo reset y una misma secuencia de controles. Se deben medir tiempos de frame, p95/p99, cuadros perdidos, cambio de clip/seek, memoria y respuesta MIDI, tanto con caché como con lectura de disco. Un objetivo como 3840×2160 a 60 FPS sostenidos es verificable; todavía no está demostrado para este port.
