# Composición de PARTE 2

Auditoría del XML vigente de `player maximus.v4p`, `Tex transf.v4p`, `Mask 6.v4p`, `2D/milky FULL.v4p`, `2D/GLITCHH/glitchpack_2/glitchpack/INK dripping2.v4p` y shaders instalados. Esta reconstrucción distingue los cables efectivos de los valores guardados que esos cables sustituyen.

## Orden real de capas

`Group 5 → Renderer TempTarget 12 → Displace 32 → Quad 261 → Group 32422 → Renderer 260`.

| Orden | Rama y nodos | Transformación efectiva |
|---|---|---|
| 1 | Group171, Layer2: Milky FULL Quad168 | Centro `(0,.8057)`, escala `(2,.7061)` |
| 2 | Group171, Layer5: DDS FULL Quad6 | Mismo quad; textura escalaY `.82`, translateY `.06`; brillo desde Decay242 |
| 3 | Group5, Layer2: seis Milky Quad11 | Seis centros equidistantes, ancho total de distribución `1.4`, ancho individual `448/3840*2` |
| 4 | Group5, Layer4: seis DDS Quad53 | Las mismas seis posiciones; seis players diferentes |
| 5 | Group5, Layer5: INK dripping, Quad168 interno | Centro `(0,.41)`, escala `(.66,1.63)` |
| 6 | Deformación completa | NormalGlow → Displace NormalMap, Amount `-.31`, Direction `(1,1)` |
| 7 | Group32422, Layer2: Quad32457 | PNG original de calibración; RGB `.82677`, alpha `.20517`, quad `2×2` |

Group5 Layer3/6 y Group171 Layer1/3/4 están vacíos. Quad32448 y los FileTexture de GRID GRAL/vlcsnapshot no alcanzan el renderer; no se añaden a la composición.

El ancho de las seis franjas sustituye `ScaleX=.19`: Map32451 convierte `448` desde `0..3840` a `0..2`, resultando `.2333333333`. LinearSpread51 recibe Width `1.4`; los centros X son `−.5833333, −.35, −.1166667, .1166667, .35, .5833333`. Transform52 recibe ScaleY `1.66`, TranslateY `.47`, y como transform padre el377, ScaleY `.3551`, TranslateY `.6312`. Resultado: centroY `.798097`, alto `.589466`. El View191 multiplica Y por `1.57` y traslada `−.82`.

## Resoluciones y encuadres

El original compone a **3840×2160**, con View191; su quad de presentación escala `2×2` y se traslada `Y=−.43`. La salida solicitada ahora para la pantalla LED es **2688×1008**, con seis bloques de **448×1008**.

`show-strip` extrae la región activa del quad FULL: su altura normalizada en el intermedio original es `.7061*1.57/2 = .5542885`, y su borde superior es `.00038125`. Esa región se normaliza al nuevo lienzo. La distribución LED sustituye los transforms de las franjas por `x=0,y=.8057,width=2,stripWidth=1/3,height=.7061,rotation=0`. Así, cada quad proyecta `[(i+.5)/6,.5,1/6,1]`: los centros quedan en X224,672,1120,1568,2016,2464; cada bloque ocupa todo Y0..1007. No se conserva el margen del encuadre anterior, que hacía los rectángulos más chicos.

Se compensa el desplazamiento final `−.43`. La composición se presenta con rectángulo normalizado `[.5,.5,1,1]`, sin un segundo ajuste de aspecto. Los IDs de parámetros, gates MIDI, rotaciones UV y opacidades no cambian. `display-profile.js` migra las preferencias y snapshots viejos a este encuadre una sola vez. Es una adaptación explícita al tamaño físico solicitado; los valores originales de vvvv están documentados arriba.

`reference` conserva el intermedio 16:9 y la cámara original, manteniendo los transforms de capas que estén configurados. `compositor.composition` permite inspeccionar el intermedio. NormalGlow sigue usando el tamaño de su fuente, independientemente del tamaño del compositor.

## Texturas y máscaras: dos configuraciones antiguas incompletas

`Tex transf.v4p` ahora contiene un **GetSlice (Node)**. El antiguo cable `Switch` termina en un pin que no existe en ese tipo. El `Index` válido recibe un IOBox sin valor guardado, por lo que queda en cero. La entrada Zip contiene escalaX `.28` y rotación `.25`, pero la selección efectiva está en la primera: todos los DDS usan el recorte X `.28`. La interfaz permite cambiar esos transforms manualmente; no se atribuye a los metadatos del clip una rotación que el XML no conecta al índice válido.

`Mask 6.v4p` renderiza a **400×300**. Su R(Node)7 no guarda `Receive String="Transform quads"`; el proyecto sí guarda ese nombre explícitamente en R109/R110 del patch principal. No hay evidencia estática de que las seis transformaciones lleguen a Mask6. La opción `legacy-overlap` representa el caso de transform identidad: seis quads coincidentes en el centro, con el último valor opaco predominando. La opción `stripes` conecta explícitamente las seis posiciones y permite trabajar como máscara de franjas. El valor original `Full displace=1` evita por completo esta rama problemática.

El control de la máscara original recibe LFO103, período **1.56 s**, Random bang spread2, y seis toggles. `snareComposition` reproduce los cambios binarios independientes de rotación `[0,.5]` y espejo `[1,−1]` de los Milky; la secuencia aleatoria exacta de vvvv no se conoce.

## NormalGlow y warp

Se tradujo directamente `C:/vvvv_beta_42_x64/packs/dx11-vvvv-girlpower/nodes/texture11/Filter/NormalGlow.tfx`. Defaults efectivos: **Depth1, Shape0, MaxRadius1**. El IOBox87 de `.33333` está desconectado y no cambia esos parámetros.

NormalGlow genera mipmaps, acumula gradientes de canales máximos por nivel, aplica el factor de aspecto y normaliza según el acumulado. La única regularización añadida evita divisiones `0/0` sobre imágenes perfectamente uniformes; produce una normal neutra. Su salida es RGBA8 UNORM, igual que los demás targets de composición.

Displace32 selecciona **NormalMap**, Amount `−.31`, dirección default `(1,1)`. `MapSmooth=.33` se calcula en el HLSL pero no participa en esa técnica: no se añade blur ficticio.

## Escenas y controles

- Escenas **65–68**: el warp puede habilitarse con `kick WARP`.
- Escenas **69–80**: Switch32404 selecciona Input2 conectado a cero y lo deshabilita.
- Escena **66**: EQ208 habilita el quad de INK dripping2.
- Escena **67 o superior**: LE241 dispara Decay242 para el valor/brillo del DDS FULL. Attack se recibe del IOBox373 y vale **60 s**, sustituyendo el77 guardado.
- Escenas **60–80**: se publica `ESTE PATCH` y se agranda la ventana; **no hay un cable que deshabilite la salida final fuera de ese rango**. El Enabled del Quad261 está conectado a un1 constante.
- `VID FULL` habilita el quad DDS completo; `MILKY FULL>0` habilita el quad Milky completo y su magnitud se mapea a la selección0..4.
- `VIDX6` controla los seis alpha de DDS; `MILKYX6` los seis alpha de Milky; `MILKYX6 select` elige variantes de la salida SUPER MULTI.

Banco FULL: `milky1, milky3, milky2, milkySPLASH, milkyfinal`. Banco MULTI: `1A,3A,2A,SPLASHA`. Las versiones A no son sustitutos demostrados de las versiones FULL.

## Guía gráfica real

Único archivo externo que llega al overlay de salida:

`C:/Users/mpale/Downloads/Group 1 (1).png` — **3840×2160**, **37.626 bytes**. Contiene un fondo gris y un rectángulo rojo central de calibración; se inspeccionó visualmente. No contiene anillos, marcos animados ni una textura de noise. Los anillos del Milky FINAL ya están dentro de su textura de entrada y no se dibujan otra vez en el compositor.

El overlay está habilitado en el XML original. La demo lo ofrece desactivado inicialmente para permitir ver el contenido sin esa guía, y conserva sus valores al habilitarlo. El host puede servir el archivo en `/assets/part2-overlay.png`; `loadOverlay()` no sustituye archivos ausentes por dibujos inventados.

## API e implementación

`Compositor(engine,{width,height})`, `await init()`, `render({fullVideo,fullMilky,warpSource,stripes:[{video,milky}],inkDripping,overlay,params})` devuelve y actualiza `output`. Se llama después de `engine.begin()` y antes del `writeBuffer/submit` del host. `resize()` y `dispose()` sólo administran recursos propios. `loadOverlay(url)` es opcional; también se acepta un wrapper de textura preparado externamente.

`DEFAULT_COMPOSITION`, `cloneCompositionDefaults()` y `COMPOSITION_PARAMETERS` exponen 123 parámetros públicos. Todos tienen rutas a valores reales. `sceneAutomation`/`sceneComposition` exponen las compuertas de escena sin imponerlas sobre los controles manuales. El host decide aplicar esa automatización.

Las capas usan alpha premultiplicado y mezcla de GPU para evitar copiar una textura de fondo entre cada franja. El orden de source-over conserva el cableado original. Los modos Add/Multiply/Screen, transforms extra y las variantes reparadas de máscara son controles adicionales explícitos.
