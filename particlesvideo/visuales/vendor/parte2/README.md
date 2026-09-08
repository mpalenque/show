# Milky WebGPU · paquete PARTE 2 web

**Empezar por [ENTREGA_PARTE2_WEBGPU.md](ENTREGA_PARTE2_WEBGPU.md):** qué es este paquete, qué carpeta copiar (toda `milky-webgpu`, incluida `media/`), dónde están los medios DDS, la sustitución temporal de secuencias faltantes, arranque, validación y trabajo pendiente. Este README conserva la documentación del laboratorio Milky con el que empezó el port.

**Sistema completo del show:** abrir **ABRIR PARTE 2.cmd** o [Parte 2 · MIDI de vvvv](http://127.0.0.1:8787/system.html?mode=show). Solicita MIDI al arrancar, selecciona **loopMIDI Port** y espera las notas originales del show. Incluye siete players DDS, seis bloques, Milky A/FULL/FINAL, INK, composición y controles MIDI/OSC. [Manual del sistema e integración con Parte 1](system/README.md).

Demo ejecutable de **cinco presets**: 1A, 3A, 2A y SPLASHA de `Milky/sUPER MILKY MULTI.v4p`, más **MILKY FINAL · INK**, la quinta entrada de `2D/milky FULL.v4p`.

La rama FINAL usa los archivos originales `../2D/ink/DDS/INK000000.DDS` a `INK001066.DDS`. Las otras cuatro variantes son procedurales. Para abrir directamente la rama final: <http://127.0.0.1:8787/?preset=final>.

## Abrir

En Windows, doble clic en **ABRIR MILKY.cmd** para la galería o **ABRIR FINAL.cmd** para la explosión. Usa Node.js instalado, inicia un servidor local y abre Chrome. También se puede ejecutar `npm start` dentro de esta carpeta y abrir <http://127.0.0.1:8787> en Chrome o Edge con WebGPU habilitado. No abrir `index.html` directamente con `file://`.

El servidor escucha solamente en `127.0.0.1:8787`. No necesita internet, paquetes npm, CDN ni credenciales. Al abrir con el lanzador el servidor queda ejecutándose en segundo plano para poder volver a la demo.

## Controles

- Selector de preset y **Ver todos** para comparar.
- Espacio: pausa; R: reinicia feedback; B: inyecta una forma o dispara FINAL; F: pantalla completa; G: galería; teclas 1–5: presets.
- K y S: kick/snare de 3A. En FINAL, K alterna tinta completa/estrecha con línea central y cambia el desplazamiento auxiliar; S no tiene conexión.
- Semillas automáticas originales o dibujo manual con el cursor. El ritmo automático emula eventos de kick/snare, sin audio ni MIDI externo.
- Persistencia modifica la opacidad de mezcla; Deformación y Detalle multiplican las intensidades originales. La selección de preset restablece su opacidad de mezcla; los multiplicadores son globales. En galería, una opacidad modificada manualmente se aplica a todos.
- Resolución 800×1280 para los cuatro primeros, y 3840×1200 para FINAL. Los niveles 50 % y 150 % son variantes de prueba y cambian el aspecto del dither y del feedback. FINAL tiene además etapas independientes INK de 1280×720 y anillo de 960×320, escaladas con el nivel elegido.
- Cadencia 30/60/120 pasos por segundo. Presentación vinculada a `requestAnimationFrame`, separada de los pasos de simulación. Cambiar la cadencia puede modificar el aspecto, como en el original.
- La captura PNG guarda el preset seleccionado a la resolución de simulación, sin los controles.

## Qué se trasladó

Shaders WGSL derivados de los HLSL instalados en `C:/vvvv_beta_42_x64/packs/dx11/nodes/texture11`: Dither, NormalMap, Displace, DistortFlow, UnsharpMask, Blend y HSCB. Fórmulas, parámetros y grafos se documentan en `shaders.js` y `presets.js`.

El feedback principal guarda la salida Unsharp del paso anterior. 3A/SPLASHA también conservan la salida del desplazamiento principal del paso anterior. HSCB de 2A modifica sólo la salida, sin volver al feedback. Texturas RGBA8 y mipmaps generados en GPU. MIDI/OSC externos y la composición general de Parte 2 quedan fuera de esta demo.

El primer feedback se inicializa blanco para representar el fallback WhiteTexture que usa el motor DX11 cuando un FrameDelay todavía no tiene recurso. Las semillas sí tienen fondo negro opaco. La grilla de 2A tiene una celda y dos triángulos; no es una textura de ruido añadida.

## Milky FINAL / la rama de explosión

Ruta del patch: `player maximus → 2D/milky FULL → Input 5 → ../milky final → distort milky final + PLAYER INK`. No confundir con las copias antiguas de `Milky/milky final.v4p` ni con `3D/BOMBA.v4p`, que no está conectado a esta ruta.

La tinta se gira 180°, se invierte y pasa por flujo vertical con feedback (.013, .97), NormalMap/Displace, UnsharpHSV, Growth, otro desplazamiento y Levels. Growth conserva por separado su feedback interno RGBA16F y su salida RGBA8. La tinta procesada alimenta el Milky principal: Dither6, dos desplazamientos, Exclusion.94 y Unsharp(1.75,.03,.55). La salida lleva HSCB con brillo2.34 y contraste rectangular0/4 cada .19s, más un desplazamiento controlado por otro feedback de anillo. Los HSCB y Blend deshabilitados del patch se omiten.

En escenas 69–80, BOTON controla la activación de Dither/Exclusion y la rampa de tinta. La demo reproduce ese rango con **Activar feedback / BOTON**; los controles FX1/FX2/FX4 reemplazan sus entradas OSC, inicialmente0. FX1 cambia deriva horizontal y Unsharp del anillo; FX2 cambia deriva vertical/profundidad de normales; FX4 aplica el desplazamiento final. FX3 no está conectado.

**Disparar explosión** reinicia la rampa de 3,04s. El mapeo Float usado es `floor(52.44 + 547.56 × progreso)` (dos Map originales, nominalmente60..600 con extrapolación previa−.014). **Repetir** reinicia ese transporte cada4,5s para explorar; ese bucle lo agrega la demo. Posición de tinta permite fijar un frame. Las vistas **Tinta original**, **Tinta expandida** y **Resultado final** muestran respectivamente la tinta girada/invertida, la salida de `distort milky final` y toda la rama. Desactivar **Contraste pulsante** es un control de inspección, distinto del patch activado.

Los DDS son BC7_UNORM (DX10/DXGI98),1280×720. Se suben comprimidos directamente a WebGPU si la GPU admite `texture-compression-bc`. Caché GPU limitada a48 frames (~42,2MiB), cuatro lecturas concurrentes y hasta8 frames futuros previstos; no se carga toda la secuencia. Sin BC se usan los JPG originales, con posibles diferencias de compresión y mayor memoria. La simulación espera si falta el frame actual. El servidor sólo expone los nombres numéricos válidos dentro de `2D/ink`; no necesita copiar los assets.

## Límites de fidelidad

Esto es un port funcional, **no una equivalencia píxel a píxel validada contra una captura de vvvv**. Las semillas se rasterizan analíticamente y sus bordes pueden diferir del rasterizador de líneas de DX11. El algoritmo original de RandomSpread y el estado aleatorio de la sesión no están recuperados: se usa un PRNG reproducible para sus cambios de dirección. 3A arranca con el primer estado de sus selectores, ya que los números guardados están reemplazados por cables desde Random.

Las dimensiones transitorias del primer frame sin recurso del original no se reproducen: se inicializa directamente al tamaño elegido. Diferencias de redondeo, interpolación, mipmaps y primer estado pueden amplificarse en feedbacks. No se agregó Perlin/Simplex, bloom decorativo ni otros efectos para simular el resultado.

En FINAL, los feedbacks vertical, Growth y anillo también se inician blancos por el fallback WhiteTexture; el patch no conecta un reset inicial. No se recuperó el estado del show. Quedan pendientes de comprobación en ejecución nativa el Map Float predeterminado, la conservación del valor2 en el IOBox Boolean y su wrap a Input1 en Switch de dos entradas, y la fase inicial de Rectangle. La demo utiliza esas interpretaciones, coherentes con el cableado, y random reproducible. El anillo (59 sectores con Resolution60) y los quads se rasterizan analíticamente; la cobertura de bordes puede variar. El aspecto de FINAL con controles OSC distintos también cambia mucho: los valores guardados que reciben cables no describen la actuación en vivo.

Algunas direcciones de 3A pueden contraer la imagen hasta casi desaparecer antes del siguiente pulso; ese comportamiento deriva de sus valores originales. Kick/snare cambian esos estados. Reset permite volver al arranque reproducible de la demo.

## Validación

`smoke-test.mjs` comprueba compilación WebGPU, ausencia de errores de validación, imagen no uniforme en los cinco presets, evolución, reset determinista, selección, triggers y resolución original. Los hashes de los cuatro primeros coinciden con su validación anterior al añadir FINAL. `live-test.mjs` verifica la galería completa a resolución nativa, pausa, exportación PNG y layout móvil. `final-ui-test.mjs` prueba controles y vistas de FINAL. `final-live-test.mjs` mide diez segundos de FINAL individual a3840×1200, contando pasos efectivos, incluidos los tiempos de espera de DDS. Necesitan Playwright disponible para quien quiera repetirlos; no es dependencia de la demo.

Se puede indicar `MILKY_PLAYWRIGHT` con la ruta a `playwright-core/index.mjs` y `MILKY_BROWSER` con el ejecutable Chrome. Las capturas y resultados están en `captures/`. La medición en Chrome headless es una comprobación de esta demo; no compara la performance con vvvv ni mide exclusivamente tiempo GPU.

Medición FINAL en esta máquina con adaptador NVIDIA y DDS BC7: 600 pasos en 10,004s, **59,98 FPS efectivos**, a3840×1200. Sin errores de GPU; caché limitada a48 frames. Evidencia completa en `captures/final-live-validation.json`.
