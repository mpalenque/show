# Contexto vigente — Visuales LED

**Actualizado: 2026-09-06, vuelta de imagen, audio web y motor libre.** Leer este archivo antes de usar planes o reportes anteriores. Las nuevas instrucciones de Manuel prevalecen sobre cualquier documento.

## Qué está armando Manuel

Un show visual para LED **2688×1008, 8×3 m**, con salida Chrome, editor separado y control desde Ableton mediante MIDI/OSC. Parte 1 conserva sus escenas 1–23, incluyendo línea vertical de la 2, despliegue del piso con fuga de la 7 y torbellino de la 21. El show Fluids está escrito como documento de curvas y eventos; se ejecuta con un solver de partículas, no como un video.

**Corrección posterior, 2026-09-06 — grillas finas y escena 7:** las grillas finas de 4–8 aparecen y cambian sus bloques de golpe con la nota, sin fade de opacidad ni carga progresiva en 6; los corrimientos de offsets siguen siendo suaves. Cada disparo de **7/ch10**, incluso con 7 ya activa, vuelve a extender el piso desde cero hacia la fuga durante **16 s**. Al iniciar se bloquea un frame la malla previa para que el primer cuadro nunca muestre el piso completo; el siguiente arranca desde el frente. Esta excepción sólo repite `floor.reveal`, sin reponer los presets de las grillas ni reiniciar la escena entera. Espacio en 7 y la acción `floor.reveal` hacen el mismo despliegue. Las demás escenas conservan la protección frente a notas de selección repetidas.

Validación: 11 tests nuevos de grillas/piso y prueba Chrome/WebGPU con el parser MIDI real aprobados, además del build. Se verificaron grillas completas y sin alpha intermedio en el primer frame, Note Off sin redisparo, avance del piso hasta 60 m y reinicios a mitad/final conservando las grillas. [Controles y reproducción de las pruebas](CONFIGURACION.md#grillas-finas-y-disparos-del-piso-en-escena-7).

**Corrección posterior, 2026-09-06 — escena 2:** una sola línea blanca vertical completa, de 3 px, empieza en el centro útil de la pantalla y se mueve sola a **70 px/s** desde la entrada. La nota de inversión (`line.flip`, MIDI ch2 nota36) sólo cambia el sentido de la línea existente, sin recrearla ni cambiar su posición. Al llegar al borde reaparece por el opuesto manteniendo el sentido; no rebota ni se apaga. Los disparos `line.strike` se ignoran en este modo continuo; los truenos por nota siguen en 3–6/9. La nota de selección de escena (ch10 nota2) conserva la protección contra reinicios repetidos.

Validado con 10 tests nuevos de línea/mapeos, el test existente de migración Fluids y Chrome/WebGPU: movimiento sin notas, MIDI Note On/Off, posición intacta al invertir, selección repetida sin reinicio y cruce de borde sin rebote. Build aprobado; captura y reporte local en `performance-check/scene2/`. [Controles y comandos de prueba](CONFIGURACION.md#línea-autónoma-de-la-escena-2).

**Decisión posterior, 2026-09-06 — rays e iluminación:** ancho de rayos **0,042 m**, tres veces los 0,014 m anteriores. Cada rayo lleva una luz puntual del mismo color durante la caída y una cola que se apaga con el impacto. Las luces usan los 32 slots existentes, sin sombras por cubemap ni cambios de cantidad durante los golpes. En **21 — Torbellino**, los palitos no tienen emisión propia ni bloom y reciben sólo las luces de los rays; sin rayos quedan oscuros. Se conserva la iluminación anterior en las demás escenas, incluidas 22/23. La oclusión de contacto se refuerza en 21 sin aumentar muestras ni resolución de AO.

Esta modificación aprobó 6 tests nuevos y 44 comprobaciones WebGPU: ~60 FPS a resolución nativa con 131.072 palitos y ráfagas de 14,5 rays/s, hasta 19 luces activas, sin intervalos >20 ms en la pasada final de 3 s por caso. Son mediciones cortas, no garantía de rendimiento continuo. [Validación y alcance](VALIDACION-RAYOS.md).

## Decisiones actuales que reemplazan la asignación anterior

| Escena | Qué muestra y qué hace | Disparo existente |
|---|---|---|
| **24 — Previa Fluids** | Fondo negro, sólo una línea blanca intacta. Motor preparado y población vacía; tiempo en 0, detenido. La línea toma posición y tamaño iniciales del documento, con rotación 0; no ejecuta emisión ni fracturas de la secuencia. | Nota MIDI **24**, canal **10**. |
| **25 — PLAY Fluids** | Reinicia y reproduce desde 0 toda la secuencia del timeline, de 152,694 s en el export incluido. | Nota MIDI **25**, canal **10**. |
| **26 — Fluids live** | El mismo motor sin documento ni timeline: fluido libre gobernado por `fluids.live.*` desde MIDI. Al entrar emite gotas luminosas que caen; a partir de ahí mandan los controles. Al salir, los controles vuelven a su reposo del `BASE`. | Nota MIDI **26**, canal **10**. |
| **27–29** | Libres/reservadas. | Sin contenido nuevo asignado. |

**El audio del show sale de la página, no de Ableton.** Mandándolo por Ableton, la imagen y el track corrían con dos relojes distintos y se separaban a lo largo de los 152,694 s. Ahora la salida reproduce `fluids.wav` y el tiempo de la secuencia se lee de `AudioContext.currentTime`: un frame perdido saltea el show en vez de correrlo. `fluids.audioMode` en `external` recupera el comportamiento anterior (página muda, reloj de pared) para ensayar con la música por Ableton. `fluids.volume` gobierna el nivel.

Chrome no deja sonar nada hasta que hubo un gesto en la ventana: el primer clic o tecla en la salida habilita el audio, y hasta entonces el panel de la salida lo avisa. **El armado del audio no bloquea el arranque**: se hace en segundo plano y, si el cue llega antes de que el WAV termine de decodificar, el track entra solo en la posición en la que va la secuencia.

**Al terminar la secuencia el fluido sigue corriendo.** El reloj del timeline se detiene en la duración del documento y la escena 25 se mantiene, pero la física ya no se congela: el cuadro sigue vivo hasta la próxima nota.

Las notas repetidas de la escena ya activa no la reinician. Repetir la secuencia requiere `fluids.restart` o una nueva entrada desde otra escena. Entrar en 24, 25 o 26 desactiva cualquier loop de ensayo.

Las definiciones anteriores «24 = PLAY / 25 = live», «audio siempre externo» y «el final conserva el cierre congelado» son históricas y están reemplazadas.

## Imagen de Fluids

**El motor renderiza con supersampling 2×** (`fluids.supersample`, buffer 5376×2016 sobre el cuadro lógico de 2688×1008), igual que la página original del show. A 1× quedaba a la vista la trama de la reconstrucción del campo de radiancia —un damero de ~2 px más rayos radiales— que sobre la pared LED se lee como un rayado sucio. Medido en la RTX 3090, subirlo no movió el tiempo de render: lo manda el campo, que es de resolución fija.

`fluids.gain` multiplica la energía que entra al transporte y la exposición con que se muestra, sin tocar el documento. Arranca en **1,25**: medido a mitad de secuencia, ese cuarto de ganancia lleva el brillo medio de 38 a 58 y la mitad iluminada del cuadro de 37 % a 62 % sin mover los picos (p99 244→242). En 1 el show queda exactamente como está escrito.

## Dónde operar

- Salida: `http://localhost:5173/`, ventana `vis-salida`.
- Editor de escenas, parámetros y mapeos: `http://localhost:5173/editor.html`.
- Editor del timeline Fluids: `http://localhost:5173/fluids.html`.

La salida posee documento, revisión, reloj, motor y —desde esta vuelta— el audio. El editor remoto conserva curvas, eventos, waveform, deshacer/rehacer, gestos e import/export, y envía órdenes a esa salida. No crea otro solver ni reproduce sonido propio. [Operación](integracion-radiance/OPERACION.md).

## Fuentes y estado conservado

Proyecto activo: `particlesvideo/visuales`, dentro del repo `particlesvideo`. El código Radiance consumido por el build está en `vendor/radiance`; todos sus assets públicos están en `public/radiance`.

El documento incluido es `public/radiance/show/fluids.show.json`: **152,694 s, 256 eventos, 400 claves y 0 clips de gesto**, recuperado de Downloads. El documento editado de la salida se guarda con su revisión en **`vis.radiance.show.v1`**. No se comprobó si el navegador del proyecto original conserva una edición posterior; se puede importar un export más reciente sin resembrar ni borrar lo actual.

La copia completa `PARTE 1/radiance-live-show` conserva el proyecto original, código, documentación, assets y Git. El origen `C:/Users/mpale/OneDrive/Desktop/heidi/radiance-live-show` permanece separado. El plan original de Fluids **sí está preservado**, además en una copia versionable bajo [docs/origen-radiance](origen-radiance/INDICE.md), con SHA-256 por archivo.

## Verificación y límites

Para esta vuelta están aprobados **224 tests de código**: 203 del paquete Radiance, 16 de sesión, 4 del preview y 1 de mapeos; TypeScript y build del paquete Radiance también aprobados. El recorrido del navegador aprueba **8 comprobaciones**, en desarrollo y sobre el build de producción: cancelación de un cue pendiente, previa 24 detenida, **el track de la página sonando y siendo el reloj de la secuencia**, cue 25 alineado y sin re-disparo por notas repetidas, 25→24, entrada directa en 25, **el final que detiene el reloj y deja el fluido corriendo** y **la 26 emitiendo y respondiendo a sus controles**. El WAV queda listo 331 ms después de arrancar y el desfase entre el cue MIDI y el reloj de la secuencia midió 1 ms. La previa sigue midiendo una banda blanca de 320×8 px del cuadro lógico, sin píxeles coloreados. Las 29 escenas recorridas dan 60 FPS y 0,6–1,6 ms por frame. [Validación de esta vuelta](VALIDACION-FLUIDS-2026-09-06.md) · [validación de la entrega anterior](integracion-radiance/VALIDACION-CUES-24-25.md).

Medido contra la página original con el mismo documento (hash idéntico), el brillo medio de la integración era equivalente —21,4 contra 21,9 a los 6 s— y lo que sí faltaba era el supersampling: una fila de píxeles del gradiente daba `221 220 218 220 222 224 223…` a 1× contra `84 84 84 84 83 83…` en el original. A 2× la fila vuelve a ser monótona. **La comparación de contenido cuadro a cuadro no es concluyente**: el fluido es caótico y a los 40 s las dos corridas ya divergen.

**Falla preexistente conocida:** `tools/smoke-learn.mjs` reprueba «acción + nota → modo trigger». La prueba busca el primer mapeo de `particles.kick` y encuentra el `drum-vortex-kick-21` que trajo la vuelta de rayos con luz, no el que acaba de aprender. Es de esa vuelta, no de ésta.

**El rendimiento varía; no está garantizado un mínimo sin caídas.** La primera prueba nueva de producción tuvo 45 intervalos >20 ms y máximo 83,6 ms; al repetir sin cambiar código, registró ~60 FPS, máximo 17,5 ms y ninguno >20 ms. El ensayo final de desarrollo, que además comprueba desactivar loops al entrar, registró 480 frames a ~60 FPS, máximo 17,8 ms y ninguno >20 ms. Había otras aplicaciones activas al observar el equipo después de la primera prueba, pero esa observación no demuestra una causa única. Se conservan ambas mediciones.

En esas pruebas anteriores la presentación sostuvo su presupuesto de 20 ms, pero el solver WASM bajó a **42,45 Hz** en una ventana de 1 s y tuvo pasos de hasta **36,4 ms**. Mantener 60 FPS de salida no demuestra física nueva en cada frame. El límite estricto de 50 Hz de física no quedó resuelto; se conservaron los tres subpasos para no cambiar el show escrito.

Los artefactos nuevos están bajo `radiance-check/cues-24-25/`. Los reportes de **210 tests y tres pasadas completas a ~60 FPS pertenecen a la asignación anterior**; no son una nueva prueba completa de los 152,694 s con esta asignación. [Informe histórico y condiciones](integracion-radiance/RENDIMIENTO.md). El funcionamiento nuevo está validado; la garantía estricta de rendimiento sigue sin cumplirse.

## Mapa de lectura para continuar

1. [Arquitectura y entradas de cada sistema](ARQUITECTURA-Y-SISTEMAS.md).
2. [Configuración de arranque, MIDI, OSC y almacenamiento](CONFIGURACION.md).
3. [Plan original de Fluids](origen-radiance/docs/plan-fluids-show.md) y [cómo funciona el motor/show original](origen-radiance/docs/fluids-show-como-funciona.md), cuando se cambie el comportamiento interno.
4. [NOTAS](../NOTAS.md) para decisiones anteriores y problemas ya encontrados; [plan de integración anterior](integracion-radiance/PLAN-INTEGRACION-RADIANCE.md) sólo como historia de implementación.

Al cambiar una decisión del show, actualizar primero su estado vigente en este archivo y los documentos operativos afectados. Conservar planes originales e informes de pruebas con su alcance histórico; no editar sus resultados para hacerlos pasar por una prueba nueva.
